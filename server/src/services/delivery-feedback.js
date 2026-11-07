'use strict';

const { normalizeMessageId } = require('../utils/delivery-status');
const {
  verifySendGridSignature,
  verifyMailgunSignature,
  verifyBasicAuth,
  verifySnsMessage,
  snsSubscribeUrl,
} = require('../utils/webhook-signatures');

/**
 * Bounce and complaint feedback for login e-mails (delivery tracking, stage 2).
 *
 * Two sources move a token from `sent` to `bounced` or `complained`, matched
 * by the provider message id stored at send time (`delivery_message_id`):
 *
 * 1. Magic Mail (when installed): its signed provider webhooks emit
 *    `magic-mail.delivery.bounced|complained` on `strapi.eventHub`
 *    (subscribed in bootstrap).
 * 2. Without Magic Mail: `POST /api/magic-link/delivery-webhooks/:provider`
 *    for SendGrid, Mailgun, Amazon SES (via SNS) and Postmark. Every
 *    provider is off until its secret is set in the plugin config
 *    (`deliveryWebhooks`) or the matching environment variable.
 *
 * Feedback is idempotent (same status twice changes nothing) and every
 * status change is one conditional update, so parallel deliveries on several
 * processes cannot break the "a complaint never replaces a bounce" rule.
 * Replay markers and the per-caller limit are shared by all processes
 * through the rate-limiter store (database or Redis); a bounded in-memory
 * window stays in front of it. Only reason codes are stored; provider texts
 * and addresses never are. Responses carry no detail.
 */

const TOKEN_UID = 'plugin::magic-link.token';
const PROVIDERS = Object.freeze(['sendgrid', 'mailgun', 'ses', 'postmark']);
const MAX_EVENTS_PER_REQUEST = 1000;
const MAX_TOKENS_PER_MESSAGE = 10;
const RATE_LIMIT = Object.freeze({ max: 600, windowMs: 60_000, maxKeys: 10_000 });
const REPLAY_TTL_MS = 2 * 60 * 60 * 1000;
const REPLAY_MAX = 20_000;
const CERT_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_CERT_BYTES = 16 * 1024;

/** Postmark bounce types that mean the address will not receive mail. */
const POSTMARK_HARD = new Set([
  'HardBounce',
  'BadEmailAddress',
  'Blocked',
  'ManuallyDeactivated',
  'DMARCPolicy',
  'SpamNotification',
]);

/** @type {Map<string, number>} */
const replay = new Map();
/** @type {Map<string, {count: number, resetAt: number}>} */
const rateBuckets = new Map();
/** @type {Map<string, {pem: string, expiresAt: number}>} */
const certCache = new Map();

/**
 * Statuses a token may move from, per feedback kind: only accepted mail
 * (`sent`) changes, and a complaint never replaces a bounce.
 */
const ALLOWED_FROM = Object.freeze({
  bounced: Object.freeze(['sent', 'complained']),
  complained: Object.freeze(['sent']),
});

/**
 * The plugin's rate-limiter service when it offers the shared helpers.
 *
 * @returns {object|null} Service or null (unit tests, early startup).
 */
const sharedLimiter = () => {
  try {
    const service = strapi.plugin('magic-link')?.service?.('rate-limiter');
    return typeof service?.markOnce === 'function' ? service : null;
  } catch {
    return null;
  }
};

/**
 * Whether a replay key is new on every process (shared marker) and in this
 * process (local window). Records it in both.
 *
 * @param {string} key - Replay key.
 * @returns {Promise<boolean>} True for the first sighting.
 */
const firstSighting = async (key) => {
  if (wasSeen(key)) return false;
  const limiter = sharedLimiter();
  if (limiter && !(await limiter.markOnce(`replay:${key}`))) {
    remember(key);
    return false;
  }
  return true;
};

/** @param {string} key @param {number} [now] */
const wasSeen = (key, now = Date.now()) => (replay.get(key) || 0) > now;

/** @param {string} key @param {number} [now] */
const remember = (key, now = Date.now()) => {
  if (replay.size >= REPLAY_MAX) {
    for (const [entry, until] of replay) {
      if (until <= now || replay.size >= REPLAY_MAX * 0.9) replay.delete(entry);
      if (replay.size < REPLAY_MAX * 0.9) break;
    }
  }
  replay.set(key, now + REPLAY_TTL_MS);
};

/**
 * Fixed-window limiter per caller address (600 requests per minute).
 *
 * @param {string} ip
 * @param {number} [now]
 * @returns {boolean} true when the request may proceed
 */
const allowRequest = (ip, now = Date.now()) => {
  const key = String(ip || 'unknown').slice(0, 64);
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (rateBuckets.size >= RATE_LIMIT.maxKeys) {
      for (const [entry, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(entry);
      if (rateBuckets.size >= RATE_LIMIT.maxKeys) return false;
    }
    bucket = { count: 0, resetAt: now + RATE_LIMIT.windowMs };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT.max;
};

/** @param {unknown} value @returns {string} */
const codePart = (value) =>
  String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);

/**
 * @param {string} provider
 * @param {unknown} kind
 * @param {unknown} [smtpCode]
 * @returns {string} reason code such as `MAILGUN_BOUNCE_550`
 */
const reasonCode = (provider, kind, smtpCode) => {
  const code = /^[2-5]\d\d$/.test(String(smtpCode ?? '')) ? `_${smtpCode}` : '';
  return `${codePart(provider)}_${codePart(kind) || 'EVENT'}${code}`.slice(0, 64);
};

/**
 * @typedef {{eventId: string|null, messageId: string|null, kind: 'bounced'|'complained', reasonCode: string}} Feedback
 */

/** @param {unknown} payload @returns {Feedback[]} */
const parseSendGrid = (payload) => {
  if (!Array.isArray(payload)) return [];
  const out = [];
  for (const event of payload.slice(0, MAX_EVENTS_PER_REQUEST)) {
    if (!event || typeof event !== 'object') continue;
    let kind = null;
    let reason = null;
    if (event.event === 'bounce') {
      kind = 'bounced';
      const status = /^([45])\.\d+\.\d+$/.exec(String(event.status || ''));
      reason = reasonCode(
        'sendgrid',
        event.type === 'blocked' ? 'blocked' : 'bounce',
        status ? `${status[1]}00` : null
      );
    } else if (event.event === 'dropped') {
      kind = 'bounced';
      reason = reasonCode('sendgrid', 'dropped');
    } else if (event.event === 'spamreport') {
      kind = 'complained';
      reason = reasonCode('sendgrid', 'spamreport');
    }
    if (!kind) continue;
    out.push({
      eventId: typeof event.sg_event_id === 'string' ? event.sg_event_id : null,
      messageId: typeof event.sg_message_id === 'string' ? event.sg_message_id : null,
      kind,
      reasonCode: reason,
    });
  }
  return out;
};

/** @param {unknown} data - Mailgun `event-data` @returns {Feedback[]} */
const parseMailgun = (data) => {
  if (!data || typeof data !== 'object') return [];
  const headers = data.message && data.message.headers;
  const messageId =
    headers && typeof headers['message-id'] === 'string' ? headers['message-id'] : null;
  const eventId = typeof data.id === 'string' ? data.id : null;
  if (data.event === 'failed' && data.severity === 'permanent') {
    const smtp = data['delivery-status'] && data['delivery-status'].code;
    return [
      {
        eventId,
        messageId,
        kind: 'bounced',
        reasonCode: reasonCode('mailgun', data.reason || 'failed', smtp),
      },
    ];
  }
  if (data.event === 'complained') {
    return [
      { eventId, messageId, kind: 'complained', reasonCode: reasonCode('mailgun', 'complained') },
    ];
  }
  return [];
};

/**
 * Amazon SES notification carried in an SNS `Message` string.
 * Permanent bounces -> bounced; complaints -> complained; the rest is ignored.
 *
 * @param {unknown} messageText
 * @param {string|null} snsMessageId
 * @returns {Feedback[]}
 */
const parseSes = (messageText, snsMessageId) => {
  let note;
  try {
    note = JSON.parse(String(messageText));
  } catch {
    return [];
  }
  if (!note || typeof note !== 'object') return [];
  const type = note.notificationType || note.eventType;
  const messageId =
    note.mail && typeof note.mail.messageId === 'string' ? note.mail.messageId : null;
  if (type === 'Bounce' && note.bounce && note.bounce.bounceType === 'Permanent') {
    return [
      {
        eventId: snsMessageId,
        messageId,
        kind: 'bounced',
        reasonCode: reasonCode('ses', `bounce_${note.bounce.bounceSubType || 'general'}`),
      },
    ];
  }
  if (type === 'Complaint') {
    return [
      {
        eventId: snsMessageId,
        messageId,
        kind: 'complained',
        reasonCode: reasonCode('ses', 'complaint'),
      },
    ];
  }
  return [];
};

/** @param {unknown} payload - Postmark webhook body @returns {Feedback[]} */
const parsePostmark = (payload) => {
  if (!payload || typeof payload !== 'object') return [];
  const messageId = typeof payload.MessageID === 'string' ? payload.MessageID : null;
  const eventId =
    payload.ID !== undefined && payload.ID !== null ? `${payload.RecordType}:${payload.ID}` : null;
  if (payload.RecordType === 'Bounce' && POSTMARK_HARD.has(payload.Type)) {
    return [
      { eventId, messageId, kind: 'bounced', reasonCode: reasonCode('postmark', payload.Type) },
    ];
  }
  if (payload.RecordType === 'SpamComplaint') {
    return [
      {
        eventId,
        messageId,
        kind: 'complained',
        reasonCode: reasonCode('postmark', 'spam_complaint'),
      },
    ];
  }
  return [];
};

/**
 * Stored-id candidates for a reported id. Stage-1 rows keep the id as the
 * send path returned it (`<id@host>` from nodemailer/Mailgun, the bare
 * `x-message-id` from SendGrid), so both bracket forms are tried.
 *
 * @param {string} provider
 * @param {unknown} reportedId
 * @returns {{exact: string[], prefixes: string[]}}
 */
const messageIdCandidates = (provider, reportedId) => {
  const id = normalizeMessageId(reportedId);
  if (!id) return { exact: [], prefixes: [] };
  const ids = [id];
  if (provider === 'sendgrid' && id.includes('.')) ids.push(id.split('.')[0]);
  const exact = [...new Set(ids.flatMap((value) => [value, `<${value}>`]))];
  // SES ids come back bare; nodemailer's SES transport reports `<id@region.amazonses.com>`.
  const prefixes = provider === 'ses' ? [`${id}@`, `<${id}@`] : [];
  return { exact, prefixes };
};

/** @param {Buffer} raw @returns {unknown} */
const parseJson = (raw) => {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return undefined;
  }
};

/**
 * GET with timeout, no redirects and a size cap. Used for SNS certificates
 * and SubscribeURL confirmation (hosts validated by the caller).
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
const httpGet = async (url) => {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_CERT_BYTES) throw new Error('Response too large');
  return text;
};

/** @param {string} url @returns {Promise<string>} cached SNS signing certificate */
const fetchCertificate = async (url) => {
  const now = Date.now();
  const cached = certCache.get(url);
  if (cached && cached.expiresAt > now) return cached.pem;
  const pem = await httpGet(url);
  if (certCache.size > 50) certCache.clear();
  certCache.set(url, { pem, expiresAt: now + CERT_TTL_MS });
  return pem;
};

/** @param {unknown} value @returns {string} */
const str = (value) => (typeof value === 'string' ? value.trim() : '');

module.exports = ({ strapi }) => ({
  /**
   * Webhook secrets from `config/plugins.js` (`deliveryWebhooks`) with
   * environment fallbacks. Never exposed through any route.
   *
   * @returns {{sendgrid: {publicKey: string}, mailgun: {signingKey: string}, ses: {topicArns: string[]}, postmark: {username: string, password: string}}}
   */
  getWebhookConfig() {
    let config;
    try {
      config = strapi.config.get('plugin::magic-link.deliveryWebhooks', {}) || {};
    } catch {
      config = {};
    }
    const env = process.env;
    const arns = Array.isArray(config.ses?.topicArns)
      ? config.ses.topicArns
      : str(env.MAGIC_LINK_WEBHOOK_SES_TOPIC_ARNS)
          .split(',')
          .map((value) => value.trim());
    return {
      sendgrid: {
        publicKey:
          str(config.sendgrid?.publicKey) || str(env.MAGIC_LINK_WEBHOOK_SENDGRID_PUBLIC_KEY),
      },
      mailgun: {
        signingKey:
          str(config.mailgun?.signingKey) || str(env.MAGIC_LINK_WEBHOOK_MAILGUN_SIGNING_KEY),
      },
      ses: {
        topicArns: arns.filter((arn) =>
          /^arn:aws(-[a-z]+)?:sns:[a-z0-9-]+:\d{12}:[\w-]{1,256}$/.test(arn)
        ),
      },
      postmark: {
        username: str(config.postmark?.username) || str(env.MAGIC_LINK_WEBHOOK_POSTMARK_USERNAME),
        password: str(config.postmark?.password) || str(env.MAGIC_LINK_WEBHOOK_POSTMARK_PASSWORD),
      },
    };
  },

  /**
   * Verifies and processes one provider webhook.
   *
   * @param {{provider: string, rawBody: Buffer|undefined, headers: Record<string, string|undefined>, ip?: string}} input
   * @returns {Promise<{status: 200|400|401|429, applied: number}>}
   *   401 covers an unknown provider, a provider that is not configured and a bad signature.
   */
  async handleWebhook({ provider, rawBody, headers = {}, ip }) {
    if (!allowRequest(ip)) return { status: 429, applied: 0 };
    const limiter = sharedLimiter();
    if (limiter) {
      const shared = await limiter.checkRateLimit(`webhook:${String(ip || 'unknown')}`, 'webhook');
      if (!shared.allowed) return { status: 429, applied: 0 };
    }
    if (!PROVIDERS.includes(provider)) return { status: 401, applied: 0 };
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return { status: 400, applied: 0 };
    const config = this.getWebhookConfig();

    let events;
    let replayKey = null;

    if (provider === 'sendgrid') {
      if (!config.sendgrid.publicKey) return { status: 401, applied: 0 };
      const valid = verifySendGridSignature({
        publicKey: config.sendgrid.publicKey,
        rawBody,
        signature: headers['x-twilio-email-event-webhook-signature'],
        timestamp: headers['x-twilio-email-event-webhook-timestamp'],
      });
      if (!valid) return { status: 401, applied: 0 };
      const payload = parseJson(rawBody);
      if (payload === undefined) return { status: 400, applied: 0 };
      events = parseSendGrid(payload);
    } else if (provider === 'mailgun') {
      if (!config.mailgun.signingKey) return { status: 401, applied: 0 };
      const payload = parseJson(rawBody);
      if (!payload || typeof payload !== 'object') return { status: 400, applied: 0 };
      const signature = payload.signature || {};
      const valid = verifyMailgunSignature({
        signingKey: config.mailgun.signingKey,
        timestamp: signature.timestamp,
        token: signature.token,
        signature: signature.signature,
      });
      if (!valid) return { status: 401, applied: 0 };
      replayKey = `mailgun-token:${signature.token}`;
      if (!(await firstSighting(replayKey))) return { status: 200, applied: 0 };
      events = parseMailgun(payload['event-data']);
    } else if (provider === 'ses') {
      if (config.ses.topicArns.length === 0) return { status: 401, applied: 0 };
      const message = parseJson(rawBody);
      if (!message || typeof message !== 'object') return { status: 400, applied: 0 };
      const valid = await verifySnsMessage(message, {
        allowedTopicArns: config.ses.topicArns,
        fetchCertificate,
      });
      if (!valid) return { status: 401, applied: 0 };
      if (message.Type === 'SubscriptionConfirmation') {
        const subscribeUrl = snsSubscribeUrl(message);
        if (!subscribeUrl) return { status: 400, applied: 0 };
        try {
          await httpGet(subscribeUrl);
          strapi.log.info('[magic-link] Amazon SNS subscription confirmed for delivery webhooks');
        } catch {
          strapi.log.warn('[magic-link] Amazon SNS subscription could not be confirmed');
          return { status: 400, applied: 0 };
        }
        return { status: 200, applied: 0 };
      }
      if (message.Type !== 'Notification') return { status: 200, applied: 0 };
      events = parseSes(
        message.Message,
        typeof message.MessageId === 'string' ? message.MessageId : null
      );
    } else {
      if (!config.postmark.username || !config.postmark.password)
        return { status: 401, applied: 0 };
      if (!verifyBasicAuth(headers.authorization, config.postmark))
        return { status: 401, applied: 0 };
      const payload = parseJson(rawBody);
      if (!payload || typeof payload !== 'object') return { status: 400, applied: 0 };
      events = parsePostmark(payload);
    }

    let applied = 0;
    for (const event of events) {
      const key = event.eventId ? `${provider}:${String(event.eventId).slice(0, 160)}` : null;
      if (key && !(await firstSighting(key))) continue;
      applied += await this.applyFeedback({ provider, ...event });
      if (key) remember(key);
    }
    if (replayKey) remember(replayKey);
    return { status: 200, applied };
  },

  /**
   * Moves tokens whose login e-mail had `messageId` to bounced/complained.
   * Tokens that were never accepted (rejected/failed) are left alone; a
   * complaint never replaces a bounce.
   *
   * @param {{provider: string, messageId: unknown, kind: 'bounced'|'complained', reasonCode: unknown}} feedback
   * @returns {Promise<number>} tokens updated
   */
  async applyFeedback({ provider, messageId, kind, reasonCode: code }) {
    if (kind !== 'bounced' && kind !== 'complained') return 0;
    const { exact, prefixes } = messageIdCandidates(provider, messageId);
    if (exact.length === 0) return 0;
    const reason =
      typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code)
        ? code
        : reasonCode(provider, kind);

    const or = [{ delivery_message_id: { $in: exact } }];
    for (const prefix of prefixes) or.push({ delivery_message_id: { $startsWith: prefix } });
    const tokens = await strapi.db.query(TOKEN_UID).findMany({
      where: { $or: or },
      select: ['id', 'documentId', 'delivery_status'],
      limit: MAX_TOKENS_PER_MESSAGE,
    });

    let updated = 0;
    for (const token of tokens) {
      if (!ALLOWED_FROM[kind].includes(token.delivery_status)) continue;
      // Conditional update: the transition is checked by the database, so a
      // bounce and a complaint handled at once on two processes cannot let
      // the complaint overwrite the bounce.
      const result = await strapi.db.query(TOKEN_UID).updateMany({
        where: { id: token.id, delivery_status: { $in: [...ALLOWED_FROM[kind]] } },
        data: { delivery_status: kind, delivery_reason: reason, delivery_updated_at: new Date() },
      });
      updated += Number(result?.count) || 0;
    }
    return updated;
  },

  /**
   * Subscribes to Magic Mail's delivery events. Returns the unsubscribe
   * function, or null when Magic Mail is not installed.
   *
   * @returns {(() => void)|null}
   */
  subscribeToMagicMail() {
    if (!strapi.plugin('magic-mail') || typeof strapi.eventHub?.on !== 'function') return null;
    const listener = (kind) => async (payload) => {
      try {
        await this.applyFeedback({
          provider:
            typeof payload?.provider === 'string' ? payload.provider.slice(0, 32) : 'magic-mail',
          messageId: payload?.messageId,
          kind,
          reasonCode: payload?.reasonCode,
        });
      } catch {
        strapi.log.warn('[magic-link] Magic Mail delivery feedback could not be applied');
      }
    };
    const offs = [
      strapi.eventHub.on('magic-mail.delivery.bounced', listener('bounced')),
      strapi.eventHub.on('magic-mail.delivery.complained', listener('complained')),
    ];
    return () => offs.forEach((off) => typeof off === 'function' && off());
  },
});

module.exports.PROVIDERS = PROVIDERS;
module.exports.__test__ = {
  parseSendGrid,
  parseMailgun,
  parseSes,
  parsePostmark,
  messageIdCandidates,
  reasonCode,
  allowRequest,
  reset() {
    replay.clear();
    rateBuckets.clear();
    certCache.clear();
  },
};
