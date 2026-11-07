'use strict';

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

module.exports = { getMagicMailRouter, isMagicMailPreSendFailure, describeMagicMailError };
