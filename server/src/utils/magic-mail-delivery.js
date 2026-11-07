'use strict';

const crypto = require('node:crypto');

/**
 * Decides whether a Magic Mail send failure may fall back to another provider
 * without risking a duplicate login e-mail.
 *
 * Source of truth: the Magic Mail 4.0 email-router `send()` contract
 * (server/src/services/email-router.js). It throws these error codes before
 * any provider accepted the message:
 * - MAGIC_MAIL_NO_ACCOUNT / MAGIC_MAIL_QUOTA_EXHAUSTED / MAGIC_MAIL_ACCOUNT_QUOTA:
 *   no account could take the message.
 * - MAGIC_MAIL_ACCOUNT_UNAVAILABLE: the requested account does not exist.
 * - MAGIC_MAIL_ACCOUNT_CONFIG: credentials are missing or unreadable.
 * - `magicMailRetryable === true`: the provider answered with a status that
 *   guarantees non-acceptance (Magic Mail already tried every account).
 * - "Template rendering failed": rendering runs before dispatch.
 *
 * Every other error (timeouts, connection resets, other provider statuses)
 * is ambiguous: the provider may already have accepted the message. Those
 * must not fall back. Note that Magic Mail 4.0 also intercepts the Strapi
 * e-mail plugin, so a native fallback would route through Magic Mail again.
 */

const PRE_SEND_CODES = new Set([
  'MAGIC_MAIL_NO_ACCOUNT',
  'MAGIC_MAIL_QUOTA_EXHAUSTED',
  'MAGIC_MAIL_ACCOUNT_QUOTA',
  'MAGIC_MAIL_ACCOUNT_UNAVAILABLE',
  'MAGIC_MAIL_ACCOUNT_CONFIG',
]);

const TEMPLATE_ERROR_PREFIX = 'Template rendering failed';

/**
 * Returns the Magic Mail email-router service when Magic Mail is installed
 * and exposes `send()`, otherwise null.
 *
 * @param {object} strapi - Strapi instance.
 * @returns {{send: Function}|null}
 */
const getMagicMailRouter = (strapi) => {
  const plugin = typeof strapi.plugin === 'function' ? strapi.plugin('magic-mail') : null;
  if (!plugin || typeof plugin.service !== 'function') return null;
  let router;
  try {
    router = plugin.service('email-router');
  } catch {
    return null;
  }
  return router && typeof router.send === 'function' ? router : null;
};

/**
 * Returns true when the error proves that Magic Mail did not hand the
 * message to any provider, so another provider may send it.
 *
 * @param {*} error - Error thrown by the email-router `send()`.
 * @returns {boolean}
 */
const isMagicMailPreSendFailure = (error) => {
  if (!error || typeof error !== 'object') return false;
  // Magic Mail 4.4 stored it as uncertain: the provider may have accepted it.
  if (typeof error.magicMailOutboxId === 'string' && error.magicMailOutboxId) return false;
  if (PRE_SEND_CODES.has(error.code)) return true;
  if (error.magicMailRetryable === true) return true;
  return typeof error.message === 'string' && error.message.startsWith(TEMPLATE_ERROR_PREFIX);
};

/**
 * Returns a log-safe label for a Magic Mail error: only the error code or
 * class name, never the message (it can contain addresses or tokens).
 *
 * @param {*} error
 * @returns {string}
 */
const describeMagicMailError = (error) => {
  if (!error || typeof error !== 'object') return 'unknown';
  if (typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)) return error.code;
  if (Number.isInteger(error.status)) return `HTTP ${error.status}`;
  if (typeof error.message === 'string' && error.message.startsWith(TEMPLATE_ERROR_PREFIX)) {
    return 'TEMPLATE_RENDERING';
  }
  return typeof error.name === 'string' && /^[A-Za-z]{1,64}$/.test(error.name)
    ? error.name
    : 'Error';
};

/**
 * Magic Mail 4.4 outbox (installed source checked 2026-11-08: Magic Mail
 * 4.4.1, server/src/services/email-router.js `send(input, options)` and
 * services/queue.js). With the owner setting `queueFailedSends` on, a send
 * that fails is captured instead of thrown:
 * - proven non-acceptance resolves as
 *   `{success: true, queued: true, status: 'pending', outboxId}`: Magic Mail
 *   retries it later, so no other provider may send the same mail;
 * - an ambiguous failure throws the provider error with
 *   `error.magicMailOutboxId` and leaves an `uncertain` row that Magic Mail
 *   never re-sends on its own.
 * `notAfter` (a Date) stops the worker from sending a queued mail later than
 * that; `idempotencyKey` (scoped by `idempotencyScope`) stores one source
 * message at most once. Magic Link never passes `queue: true`.
 */
const OUTBOX_SCOPE = 'magic-link';

/**
 * Returns true when the installed Magic Mail has the 4.4 outbox (a `queue`
 * service with `capture`). Older versions ignore the outbox options, but
 * Magic Link then sends exactly as before.
 *
 * @param {object} strapi - Strapi instance.
 * @returns {boolean}
 */
const supportsMagicMailOutbox = (strapi) => {
  const plugin = typeof strapi.plugin === 'function' ? strapi.plugin('magic-mail') : null;
  if (!plugin || typeof plugin.service !== 'function') return false;
  try {
    const queue = plugin.service('queue');
    return Boolean(queue && typeof queue.capture === 'function');
  } catch {
    return false;
  }
};

/**
 * Stable outbox idempotency key for one login mail: a SHA-256 of the purpose
 * and the record id. Never derived from the login token or the code.
 *
 * @param {string} purpose - 'login-link' or 'otp'.
 * @param {string|number} id - Token documentId or OTP row id.
 * @returns {string} 64 hex characters.
 */
const outboxKeyFor = (purpose, id) =>
  crypto
    .createHash('sha256')
    .update(`magic-link:${purpose}:${String(id)}`)
    .digest('hex');

/**
 * @param {unknown} value - Date, ISO string or epoch milliseconds.
 * @returns {Date|null}
 */
const toValidDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

/**
 * Options for the Magic Mail `send()` call of a login link or an OTP code.
 *
 * - Magic Mail without the outbox: null (call `send(mail)` as before).
 * - A record with a future expiry and an id: `notAfter` = the expiry, plus
 *   an idempotency key derived from the id. A captured mail is then never
 *   sent after the link or code expired, and never stored twice.
 * - No usable expiry or id: `queue: false`, so nothing is captured and the
 *   send behaves as before.
 *
 * @param {object} strapi - Strapi instance.
 * @param {{purpose: string, id?: string|number|null, expiresAt?: unknown, now?: number}} input
 * @returns {{notAfter: Date, idempotencyKey: string, idempotencyScope: string}|{queue: false}|null}
 */
const buildMagicMailSendOptions = (strapi, { purpose, id, expiresAt, now = Date.now() }) => {
  if (!supportsMagicMailOutbox(strapi)) return null;
  const expiry = toValidDate(expiresAt);
  const hasId = (typeof id === 'string' && id.length > 0) || Number.isInteger(id);
  if (!expiry || expiry.getTime() <= now || !hasId) return { queue: false };
  return {
    notAfter: expiry,
    idempotencyKey: outboxKeyFor(purpose, id),
    idempotencyScope: OUTBOX_SCOPE,
  };
};

/**
 * Sends through the Magic Mail router with the outbox options when the
 * installed version supports them, else with the 4.0 call shape.
 *
 * @param {{send: Function}} router - Magic Mail email-router.
 * @param {object} mail - Message.
 * @param {object|null} options - From buildMagicMailSendOptions.
 * @returns {Promise<*>} The router result.
 */
const sendViaMagicMail = (router, mail, options) =>
  options ? router.send(mail, options) : router.send(mail);

/**
 * True when Magic Mail captured the send into its outbox instead of handing
 * it to a provider: delivery is pending and owned by Magic Mail.
 *
 * @param {*} result - Resolved value of `send()`.
 * @returns {boolean}
 */
const isMagicMailQueuedResult = (result) =>
  Boolean(result && typeof result === 'object' && result.queued === true) &&
  result.status !== 'sent';

/**
 * True when Magic Mail recorded an ambiguous failure as `uncertain` in its
 * outbox (the provider may have accepted the message).
 *
 * @param {*} error - Error thrown by `send()`.
 * @returns {boolean}
 */
const isMagicMailUncertain = (error) =>
  Boolean(error && typeof error === 'object') &&
  typeof error.magicMailOutboxId === 'string' &&
  error.magicMailOutboxId.length > 0;

module.exports = {
  getMagicMailRouter,
  isMagicMailPreSendFailure,
  describeMagicMailError,
  supportsMagicMailOutbox,
  outboxKeyFor,
  buildMagicMailSendOptions,
  sendViaMagicMail,
  isMagicMailQueuedResult,
  isMagicMailUncertain,
  OUTBOX_SCOPE,
};
