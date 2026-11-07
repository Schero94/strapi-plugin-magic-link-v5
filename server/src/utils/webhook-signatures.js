'use strict';

const crypto = require('crypto');

/**
 * Authentication checks for provider delivery webhooks (bounces and
 * complaints). Docs read 2026-11-07:
 *
 * - SendGrid Signed Event Webhook: ECDSA P-256 / SHA-256 over
 *   `timestamp + rawBody`, base64 DER signature in
 *   `X-Twilio-Email-Event-Webhook-Signature`, timestamp in
 *   `X-Twilio-Email-Event-Webhook-Timestamp`, verification key from the UI
 *   (base64 SPKI). twilio.com/docs/sendgrid/for-developers/tracking-events/
 *   getting-started-event-webhook-security-features; sendgrid-nodejs
 *   packages/eventwebhook.
 * - Mailgun: hex HMAC-SHA256 of `timestamp + token` with the HTTP webhook
 *   signing key; tokens must not be reused.
 *   documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks
 * - Amazon SNS (SES notifications): RSA signature, SHA1 for
 *   SignatureVersion 1, SHA256 for 2, over `Key\nValue\n` pairs in byte
 *   order; the certificate must come over HTTPS from an SNS host; unexpected
 *   TopicArns must be rejected.
 *   docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 * - Postmark does not sign webhooks; it recommends HTTP Basic auth on the
 *   webhook URL. postmarkapp.com/developer/webhooks/bounce-webhook
 */

/** Accepted clock skew / delivery delay for signed timestamps (seconds). */
const MAX_WEBHOOK_AGE_SECONDS = 60 * 60;

/** SNS signing certificates and subscribe URLs live on these hosts only. */
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const SNS_TYPES = new Set(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']);

/**
 * @param {unknown} timestamp - Unix seconds as string or number
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function isFreshTimestamp(timestamp, nowMs = Date.now()) {
  const text = String(timestamp ?? '');
  if (!/^\d{9,11}$/.test(text)) return false;
  return Math.abs(nowMs / 1000 - Number(text)) <= MAX_WEBHOOK_AGE_SECONDS;
}

/**
 * @param {unknown} key - base64 SPKI DER or PEM
 * @returns {crypto.KeyObject|null} EC public key or null
 */
function toSendGridPublicKey(key) {
  if (typeof key !== 'string' || !key.trim()) return null;
  const text = key.trim();
  try {
    const keyObject = text.includes('BEGIN PUBLIC KEY')
      ? crypto.createPublicKey(text)
      : crypto.createPublicKey({
          key: Buffer.from(text.replace(/\s+/g, ''), 'base64'),
          format: 'der',
          type: 'spki',
        });
    return keyObject.asymmetricKeyType === 'ec' ? keyObject : null;
  } catch {
    return null;
  }
}

/**
 * @param {{publicKey: unknown, rawBody: Buffer, signature: unknown, timestamp: unknown, nowMs?: number}} input
 * @returns {boolean}
 */
function verifySendGridSignature({ publicKey, rawBody, signature, timestamp, nowMs }) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !signature) return false;
  if (!isFreshTimestamp(timestamp, nowMs)) return false;
  const key = toSendGridPublicKey(publicKey);
  if (!key) return false;
  try {
    return crypto.verify(
      'sha256',
      Buffer.concat([Buffer.from(String(timestamp), 'utf8'), rawBody]),
      { key, dsaEncoding: 'der' },
      Buffer.from(signature, 'base64')
    );
  } catch {
    return false;
  }
}

/**
 * @param {{signingKey: unknown, timestamp: unknown, token: unknown, signature: unknown, nowMs?: number}} input
 * @returns {boolean}
 */
function verifyMailgunSignature({ signingKey, timestamp, token, signature, nowMs }) {
  if (typeof signingKey !== 'string' || !signingKey) return false;
  if (typeof token !== 'string' || !/^[A-Za-z0-9]{10,200}$/.test(token)) return false;
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  if (!isFreshTimestamp(timestamp, nowMs)) return false;
  const expected = crypto.createHmac('sha256', signingKey).update(`${timestamp}${token}`).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/**
 * Checks an HTTP Basic `Authorization` header against configured
 * credentials in constant time (Postmark).
 *
 * @param {unknown} header
 * @param {{username?: unknown, password?: unknown}} expected
 * @returns {boolean}
 */
function verifyBasicAuth(header, { username, password } = {}) {
  if (typeof username !== 'string' || typeof password !== 'string') return false;
  if (!username || password.length < 12) return false;
  if (typeof header !== 'string' || !/^Basic [A-Za-z0-9+/=]{1,1024}$/.test(header)) return false;
  const given = crypto
    .createHash('sha256')
    .update(Buffer.from(header.slice(6), 'base64'))
    .digest();
  const wanted = crypto.createHash('sha256').update(`${username}:${password}`).digest();
  return crypto.timingSafeEqual(given, wanted);
}

/**
 * @param {unknown} value
 * @returns {URL|null} a URL on an SNS host over HTTPS, without credentials or port
 */
function toSnsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  return SNS_HOST.test(url.hostname) ? url : null;
}

/**
 * Builds the SNS string to sign (`Key\nValue\n` in byte order).
 *
 * @param {Record<string, unknown>} message
 * @returns {string|null}
 */
function snsStringToSign(message) {
  const keys =
    message.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  let out = '';
  for (const key of keys) {
    const value = message[key];
    if (value === undefined || value === null) {
      if (key === 'Subject') continue;
      return null;
    }
    if (typeof value !== 'string') return null;
    out += `${key}\n${value}\n`;
  }
  return out;
}

/**
 * Verifies an SNS message: type, allowed TopicArn, signing certificate URL,
 * certificate validity, signature and timestamp.
 *
 * @param {Record<string, unknown>} message - parsed SNS JSON body
 * @param {{allowedTopicArns: string[], fetchCertificate: (url: string) => Promise<string>, nowMs?: number}} options
 * @returns {Promise<boolean>}
 */
async function verifySnsMessage(
  message,
  { allowedTopicArns, fetchCertificate, nowMs = Date.now() }
) {
  if (!message || typeof message !== 'object' || !SNS_TYPES.has(message.Type)) return false;
  if (!Array.isArray(allowedTopicArns) || !allowedTopicArns.includes(message.TopicArn))
    return false;
  const algorithm =
    message.SignatureVersion === '1'
      ? 'RSA-SHA1'
      : message.SignatureVersion === '2'
        ? 'RSA-SHA256'
        : null;
  if (!algorithm || typeof message.Signature !== 'string') return false;
  const certUrl = toSnsUrl(message.SigningCertURL);
  if (!certUrl || !certUrl.pathname.endsWith('.pem')) return false;
  const published = Date.parse(String(message.Timestamp || ''));
  if (!Number.isFinite(published) || Math.abs(nowMs - published) > MAX_WEBHOOK_AGE_SECONDS * 1000) {
    return false;
  }
  const stringToSign = snsStringToSign(message);
  if (!stringToSign) return false;
  try {
    const cert = new crypto.X509Certificate(await fetchCertificate(certUrl.href));
    if (Date.parse(cert.validFrom) > nowMs || Date.parse(cert.validTo) < nowMs) return false;
    return crypto.verify(
      algorithm,
      Buffer.from(stringToSign, 'utf8'),
      cert.publicKey,
      Buffer.from(message.Signature, 'base64')
    );
  } catch {
    return false;
  }
}

/**
 * The SubscribeURL of a verified SubscriptionConfirmation, if it is a genuine
 * SNS ConfirmSubscription link for the same topic.
 *
 * @param {Record<string, unknown>} message
 * @returns {string|null}
 */
function snsSubscribeUrl(message) {
  const url = toSnsUrl(message?.SubscribeURL);
  if (!url) return null;
  if (url.searchParams.get('Action') !== 'ConfirmSubscription') return null;
  if (url.searchParams.get('TopicArn') !== message.TopicArn) return null;
  return url.href;
}

module.exports = {
  MAX_WEBHOOK_AGE_SECONDS,
  SNS_HOST,
  isFreshTimestamp,
  toSendGridPublicKey,
  verifySendGridSignature,
  verifyMailgunSignature,
  verifyBasicAuth,
  verifySnsMessage,
  snsStringToSign,
  snsSubscribeUrl,
  toSnsUrl,
};
