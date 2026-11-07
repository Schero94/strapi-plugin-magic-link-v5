'use strict';

/**
 * Delivery status of a login e-mail, stored per token so admins can see
 * whether the provider accepted the message. Works with every send path
 * (Magic Mail, Email Designer 5, the Strapi e-mail plugin); Magic Mail is
 * optional.
 *
 * | status   | meaning                                                      |
 * |----------|--------------------------------------------------------------|
 * | sent     | the provider accepted the message (not proof of inbox delivery) |
 * | rejected | the message or recipient was refused before acceptance       |
 * | failed   | transport, credential or provider error; nothing was accepted |
 *
 * Error shapes this relies on (installed versions, checked 2026-11-07):
 * - nodemailer 10.3.1 (`dist/cjs/errors.d.ts`, `smtp-connection`): `code`
 *   (EENVELOPE, EAUTH, ECONNECTION, ETIMEDOUT, ...), `responseCode` (SMTP
 *   reply) and `permanent` (true for 5yz except 503).
 * - Magic Mail 4.0 email-router: `code` MAGIC_MAIL_* (MAGIC_MAIL_VALIDATION
 *   for refused input), `status` for provider HTTP errors.
 * - HTTP-based Strapi e-mail providers: `status` or `statusCode`.
 *
 * Only a short reason code is stored: never the error message, which can
 * contain the address, the login link or provider response bodies.
 */

const DELIVERY_STATUSES = Object.freeze(['sent', 'rejected', 'failed']);
const DELIVERY_CHANNELS = Object.freeze(['magic-mail', 'email-designer', 'email']);
const MAX_REASON_LENGTH = 64;
const MAX_MESSAGE_ID_LENGTH = 255;

/** Credential or configuration problems on our side: never the recipient's fault. */
const OWN_SIDE_CODES = new Set(['EAUTH', 'ENOAUTH', 'EOAUTH2', 'ECONFIG', 'ETLS', 'EREQUIRETLS']);

/** HTTP statuses where the provider refused the request content (address, payload). */
const REJECTING_HTTP_STATUS = new Set([400, 406, 413, 422]);

/**
 * @param {unknown} value
 * @returns {string|null} An upper-case code of at most 64 characters, or null.
 */
const toReasonCode = (value) => {
  if (typeof value !== 'string') return null;
  const code = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!code) return null;
  return code.slice(0, MAX_REASON_LENGTH);
};

/**
 * @param {*} error
 * @returns {number|null} HTTP status of a provider error.
 */
const httpStatusOf = (error) => {
  const status = Number.isInteger(error.status) ? error.status : error.statusCode;
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
};

/**
 * Maps a send error to a delivery status and a log- and UI-safe reason code.
 *
 * @param {*} error - Error thrown by a send path.
 * @returns {{status: 'rejected'|'failed', reason: string}}
 */
const classifyDeliveryError = (error) => {
  if (!error || typeof error !== 'object') return { status: 'failed', reason: 'UNKNOWN' };

  const code =
    typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : null;
  const smtpCode = Number.isInteger(error.responseCode) ? error.responseCode : null;

  if (code && OWN_SIDE_CODES.has(code)) return { status: 'failed', reason: code };
  if (code === 'MAGIC_MAIL_VALIDATION' || code === 'INVALID_RECIPIENT') {
    return { status: 'rejected', reason: code };
  }
  if (smtpCode !== null && smtpCode >= 500 && smtpCode <= 599 && smtpCode !== 503) {
    return { status: 'rejected', reason: `SMTP_${smtpCode}` };
  }
  // 4yz replies (greylisting, mailbox busy) are transient, even on the envelope.
  if (smtpCode !== null) return { status: 'failed', reason: `SMTP_${smtpCode}` };
  // EENVELOPE without a reply: nodemailer refused the address locally.
  if (code === 'EENVELOPE') return { status: 'rejected', reason: code };

  const httpStatus = httpStatusOf(error);
  if (httpStatus !== null) {
    return {
      status: REJECTING_HTTP_STATUS.has(httpStatus) ? 'rejected' : 'failed',
      reason: `HTTP_${httpStatus}`,
    };
  }
  if (code) return { status: 'failed', reason: code };
  if (typeof error.message === 'string' && error.message.startsWith('Template rendering failed')) {
    return { status: 'failed', reason: 'TEMPLATE_RENDERING' };
  }
  return { status: 'failed', reason: 'UNKNOWN' };
};

/**
 * Normalises a provider message id for storage (stage 2 maps bounce
 * webhooks to tokens by this id). Printable ASCII only, at most 255 chars.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
const sanitizeMessageId = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_MESSAGE_ID_LENGTH) return null;
  return /^[\x21-\x7E]+$/.test(trimmed) ? trimmed : null;
};

/**
 * Reads the message id from a provider result: nodemailer `info.messageId`,
 * Magic Mail `{messageId}`, or an array of results (SendGrid client).
 *
 * @param {*} result
 * @returns {string|null}
 */
const messageIdOf = (result) => {
  const candidate = Array.isArray(result) ? result[0] : result;
  if (!candidate || typeof candidate !== 'object') return null;
  return sanitizeMessageId(candidate.messageId ?? candidate.id ?? null);
};

/**
 * Builds the token attributes for a delivery outcome.
 *
 * @param {{status: string, channel: string, reason?: string|null, messageId?: string|null, at?: Date}} outcome
 * @returns {{delivery_status: string, delivery_channel: string|null, delivery_reason: string|null, delivery_message_id: string|null, delivery_updated_at: Date}}
 */
const toDeliveryAttributes = ({ status, channel, reason = null, messageId = null, at }) => ({
  delivery_status: DELIVERY_STATUSES.includes(status) ? status : 'failed',
  delivery_channel: DELIVERY_CHANNELS.includes(channel) ? channel : null,
  delivery_reason: toReasonCode(reason),
  delivery_message_id: sanitizeMessageId(messageId),
  delivery_updated_at: at instanceof Date ? at : new Date(),
});

module.exports = {
  DELIVERY_STATUSES,
  DELIVERY_CHANNELS,
  classifyDeliveryError,
  sanitizeMessageId,
  messageIdOf,
  toDeliveryAttributes,
  toReasonCode,
};
