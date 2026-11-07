'use strict';

/**
 * One-time, idempotent migration of stored Magic Link settings to the 6.0
 * contract. Runs on every bootstrap and only writes when something changed.
 *
 * - E-mail templates: legacy lodash `<%= VAR %>` placeholders become
 *   `{{VAR}}`, and `URL?loginToken=CODE` becomes `{{LOGIN_URL}}`.
 * - WhatsApp and SMS settings are removed (e-mail is the only channel).
 * - `otp_type` is forced to 'email'.
 * - `token_length` is clamped into the secure range.
 * - The historical default `confirmationUrl` (the bare server URL, which has
 *   no login route) is cleared so the link builder uses the API login URL.
 */

const { migrateLegacyTemplate } = require('./template-renderer');

const REMOVED_KEY_PATTERN = /^(whatsapp_|sms_)/;
const TEMPLATE_KEYS = ['message_html', 'message_text', 'object'];

/**
 * Returns a migrated copy of the settings and whether anything changed.
 *
 * @param {object} settings - Stored settings.
 * @param {{serverUrl?: string, clampTokenLength: (n: unknown) => number}} options - Context.
 * @returns {{settings: object, changed: boolean, removedKeys: number}} Result.
 */
const migrateSettings = (settings, { serverUrl, clampTokenLength }) => {
  const next = { ...(settings || {}) };
  let changed = false;
  let removedKeys = 0;

  for (const key of Object.keys(next)) {
    if (REMOVED_KEY_PATTERN.test(key)) {
      delete next[key];
      removedKeys += 1;
      changed = true;
    }
  }

  for (const key of TEMPLATE_KEYS) {
    if (typeof next[key] === 'string') {
      const migrated = migrateLegacyTemplate(next[key]);
      if (migrated !== next[key]) {
        next[key] = migrated;
        changed = true;
      }
    }
  }

  if (next.otp_type !== undefined && next.otp_type !== 'email') {
    next.otp_type = 'email';
    changed = true;
  }

  if (next.token_length !== undefined) {
    const clamped = clampTokenLength(next.token_length);
    if (clamped !== next.token_length) {
      next.token_length = clamped;
      changed = true;
    }
  }

  const normalize = (value) =>
    String(value || '')
      .trim()
      .replace(/\/+$/, '');
  if (
    serverUrl &&
    typeof next.confirmationUrl === 'string' &&
    normalize(next.confirmationUrl) === normalize(serverUrl)
  ) {
    next.confirmationUrl = '';
    changed = true;
  }

  return { settings: next, changed, removedKeys };
};

module.exports = { migrateSettings };
