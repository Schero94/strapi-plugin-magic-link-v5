/**
 * Pure helpers for the Magic Link settings form.
 *
 * Every rule here mirrors the server contract in
 * server/src/controllers/validation.js (settingsFieldSchemas) and
 * server/src/utils/login-url.js (isAllowedLinkUrl, resolveBaseLoginUrl), so
 * the form explains a problem before the API rejects it. The server stays
 * authoritative.
 */

/** Defaults for keys the server may not have stored yet (6.0.0 values). */
export const DEFAULT_SETTINGS = Object.freeze({
  createUserIfNotExists: true,
  expire_period: 3600,
  confirmationUrl: '',
  from_name: '',
  from_email: '',
  response_email: '',
  token_length: 32,
  stays_valid: false,
  object: '',
  message_html: '',
  message_text: '',
  context_whitelist: [],
  context_blacklist: ['password', 'secret', 'apiKey', 'token'],
  user_creation_strategy: 'email',
  verify_email: false,
  welcome_email: false,
  use_jwt_token: true,
  jwt_token_expires_in: '30d',
  allow_magic_links_on_public_registration: false,
  store_login_info: true,
  rate_limit_enabled: true,
  rate_limit_max_attempts: 5,
  rate_limit_window_minutes: 15,
  use_email_designer: false,
  email_designer_template_id: '',
  use_magic_mail: false,
  magic_mail_template_id: '',
  otp_enabled: false,
  otp_type: 'email',
  otp_length: 6,
  otp_expiry: 300,
  otp_max_attempts: 3,
  otp_resend_cooldown: 60,
  mfa_mode: 'disabled',
  mfa_require_totp: false,
  totp_as_primary_auth: false,
  totp_issuer: 'Magic Link',
  totp_digits: 6,
  totp_period: 30,
  frontend_url: '',
  frontend_login_path: '/auth/magic-link',
  passwordlessCompatibility: false,
});

/** WhatsApp and SMS settings were removed in 6.0.0 (e-mail only). */
const REMOVED_KEY_PATTERN = /^(whatsapp_|sms_)/;
const REMOVED_KEYS = new Set(['delivery', 'phoneNumber', 'phone', 'via', 'settings']);

/**
 * Accordion section of every validated field, used to open the section that
 * holds the first invalid field.
 */
export const FIELD_SECTIONS = Object.freeze({
  expire_period: 'general',
  token_length: 'general',
  context_whitelist: 'general',
  context_blacklist: 'general',
  frontend_url: 'general',
  frontend_login_path: 'general',
  confirmationUrl: 'general',
  jwt_token_expires_in: 'auth',
  from_name: 'email',
  from_email: 'email',
  response_email: 'email',
  object: 'email',
  message_html: 'email',
  message_text: 'email',
  otp_length: 'mfa',
  otp_expiry: 'mfa',
  otp_max_attempts: 'mfa',
  otp_resend_cooldown: 'mfa',
  totp_issuer: 'mfa',
  totp_period: 'mfa',
  totp_digits: 'mfa',
  mfa_mode: 'mfa',
  rate_limit_max_attempts: 'ratelimit',
  rate_limit_window_minutes: 'ratelimit',
});

/** Inclusive integer ranges accepted by the settings API. */
export const NUMBER_RANGES = Object.freeze({
  expire_period: [10, 31_536_000],
  token_length: [22, 128],
  otp_length: [4, 16],
  otp_expiry: [30, 86_400],
  otp_max_attempts: [1, 20],
  otp_resend_cooldown: [0, 86_400],
  rate_limit_max_attempts: [1, 1_000],
  rate_limit_window_minutes: [1, 10_080],
  totp_period: [15, 300],
});

const STRING_LIMITS = Object.freeze({
  from_name: 200,
  object: 500,
  message_html: 100_000,
  message_text: 50_000,
  totp_issuer: 128,
});

const JWT_EXPIRY_PATTERN = /^[1-9]\d{0,5}[mhd]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FRONTEND_PATH_PATTERN = /^(\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const CONTEXT_KEY_MAX = 128;
const CONTEXT_LIST_MAX = 100;

/** @param {unknown} value @returns {boolean} `number + m|h|d`, e.g. 15m, 1h, 30d */
export const isValidJwtExpiry = (value) =>
  typeof value === 'string' && value.length <= 16 && JWT_EXPIRY_PATTERN.test(value);

/** @param {unknown} value @returns {boolean} blank or a plausible e-mail address */
export const isValidOptionalEmail = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string') return false;
  const address = value.trim();
  return address === '' || (address.length <= 320 && EMAIL_PATTERN.test(address));
};

/**
 * Same policy as the server: https everywhere, http only for local hosts, no
 * credentials in the URL. Blank is allowed (the field is optional).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isValidLinkUrl = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  // Blank is trimmed to '' before saving.
  if (trimmed === '') return true;
  if (trimmed.length > 2048) return false;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol === 'http:') {
    const host = parsed.hostname.toLowerCase();
    return LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost');
  }
  return false;
};

/** @param {unknown} value @returns {boolean} blank or a path starting with "/" */
export const isValidFrontendPath = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.length <= 256 && FRONTEND_PATH_PATTERN.test(value));

/**
 * Turns the comma-separated text of a context list into an array.
 * @param {unknown} value - string or array
 * @returns {string[]}
 */
export const parseList = (value) => {
  const items = Array.isArray(value) ? value : String(value ?? '').split(',');
  return items.map((item) => String(item).trim()).filter(Boolean);
};

/** @param {unknown} value @returns {string} the list as editable text */
export const formatList = (value) =>
  typeof value === 'string' ? value : parseList(value).join(', ');

/**
 * Validates the form. Returns one error descriptor per invalid field.
 *
 * @param {Record<string, unknown>} settings
 * @returns {Record<string, {code: 'url'|'path'|'jwtExpiry'|'email'|'range'|'length'|'list'|'digits', min?: number, max?: number}>}
 */
export const validateSettings = (settings = {}) => {
  const errors = {};

  for (const key of ['frontend_url', 'confirmationUrl']) {
    if (!isValidLinkUrl(settings[key])) errors[key] = { code: 'url' };
  }
  if (!isValidFrontendPath(settings.frontend_login_path)) {
    errors.frontend_login_path = { code: 'path' };
  }
  if (
    settings.jwt_token_expires_in !== undefined &&
    !isValidJwtExpiry(settings.jwt_token_expires_in)
  ) {
    errors.jwt_token_expires_in = { code: 'jwtExpiry' };
  }
  for (const key of ['from_email', 'response_email']) {
    if (!isValidOptionalEmail(settings[key])) errors[key] = { code: 'email' };
  }
  for (const [key, [min, max]] of Object.entries(NUMBER_RANGES)) {
    // A cleared number input is present as undefined and is an error.
    if (!Object.hasOwn(settings, key)) continue;
    const value = settings[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      errors[key] = { code: 'range', min, max };
    }
  }
  if (
    settings.totp_digits !== undefined &&
    settings.totp_digits !== 6 &&
    settings.totp_digits !== 8
  ) {
    errors.totp_digits = { code: 'digits' };
  }
  for (const [key, max] of Object.entries(STRING_LIMITS)) {
    const value = settings[key];
    if (typeof value === 'string' && value.length > max) errors[key] = { code: 'length', max };
  }
  for (const key of ['context_whitelist', 'context_blacklist']) {
    if (settings[key] === undefined) continue;
    const list = parseList(settings[key]);
    if (list.length > CONTEXT_LIST_MAX || list.some((item) => item.length > CONTEXT_KEY_MAX)) {
      errors[key] = { code: 'list', max: CONTEXT_LIST_MAX };
    }
  }
  return errors;
};

/**
 * Orders invalid fields by their position on the page.
 * @param {Record<string, unknown>} errors
 * @returns {string[]}
 */
export const orderedErrorKeys = (errors) => {
  const order = Object.keys(FIELD_SECTIONS);
  return Object.keys(errors).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
  });
};

/**
 * Cleans a settings response: removes the WhatsApp/SMS keys and other
 * fields that no longer exist, fills defaults and normalises the MFA flags.
 *
 * @param {unknown} raw - `res.data.settings`
 * @returns {Record<string, unknown>}
 */
export const sanitizeLoadedSettings = (raw) => {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const clean = { ...DEFAULT_SETTINGS };
  for (const [key, value] of Object.entries(source)) {
    if (REMOVED_KEY_PATTERN.test(key) || REMOVED_KEYS.has(key)) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    clean[key] = value;
  }
  clean.otp_type = 'email';
  const mfaMode = resolveMfaMode(clean);
  clean.mfa_mode = mfaMode;
  clean.mfa_require_totp = mfaMode === 'required';
  for (const key of ['email_designer_template_id', 'magic_mail_template_id']) {
    clean[key] = clean[key] === null || clean[key] === undefined ? '' : String(clean[key]);
  }
  return clean;
};

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

/** Compares two values structurally (lists compare by their parsed items). */
const sameValue = (key, a, b) => {
  if (key === 'context_whitelist' || key === 'context_blacklist') {
    return stableStringify(parseList(a)) === stableStringify(parseList(b));
  }
  return stableStringify(a) === stableStringify(b);
};

/**
 * Settings that differ from the last loaded or saved state.
 * @param {Record<string, unknown>|null} initial
 * @param {Record<string, unknown>} current
 * @returns {Record<string, unknown>} changed keys with their current values
 */
export const diffSettings = (initial, current) => {
  if (!initial) return {};
  const patch = {};
  const keys = new Set([...Object.keys(initial), ...Object.keys(current ?? {})]);
  for (const key of keys) {
    if (!sameValue(key, initial[key], current?.[key])) patch[key] = current?.[key];
  }
  return patch;
};

/** @returns {boolean} true when the form has unsaved changes */
export const isSettingsDirty = (initial, current) =>
  initial !== null && Object.keys(diffSettings(initial, current)).length > 0;

/**
 * Builds the PUT payload: only changed keys, lists as arrays, trimmed URLs.
 * The server merges a partial update into the stored settings.
 *
 * @param {Record<string, unknown>} initial
 * @param {Record<string, unknown>} current
 * @returns {Record<string, unknown>}
 */
export const buildSavePayload = (initial, current) => {
  const patch = diffSettings(initial, current);
  for (const key of ['context_whitelist', 'context_blacklist']) {
    if (key in patch) patch[key] = parseList(patch[key]);
  }
  for (const key of ['frontend_url', 'confirmationUrl', 'from_email', 'response_email']) {
    if (typeof patch[key] === 'string') patch[key] = patch[key].trim();
  }
  for (const key of Object.keys(patch)) {
    if (REMOVED_KEY_PATTERN.test(key) || REMOVED_KEYS.has(key) || patch[key] === undefined) {
      delete patch[key];
    }
  }
  return patch;
};

/**
 * Reads the field name from a settings API validation error
 * ("Invalid request body at 'frontend_url': ...").
 *
 * @param {unknown} error - fetch client error
 * @returns {string|null}
 */
export const getServerErrorField = (error) => {
  const message =
    error?.response?.data?.error?.message ?? error?.response?.data?.message ?? error?.message ?? '';
  const match = /at '([A-Za-z0-9_]+)(?:\.[^']*)?'/.exec(String(message));
  return match && match[1] !== '(root)' ? match[1] : null;
};

/* ------------------------------------------------------------------ */
/* Login modes                                                         */
/* ------------------------------------------------------------------ */

const MFA_MODES = new Set(['disabled', 'optional', 'required']);

/**
 * Same rule as server/src/utils/mfa-mode.js: the legacy flag wins.
 * @param {Record<string, unknown>} settings
 * @returns {'disabled'|'optional'|'required'}
 */
export const resolveMfaMode = (settings = {}) => {
  if (settings.mfa_require_totp === true) return 'required';
  return MFA_MODES.has(settings.mfa_mode) ? settings.mfa_mode : 'disabled';
};

/**
 * Current login mode, derived only from the settings.
 * @param {Record<string, unknown>} settings
 * @returns {'magic-link'|'email-otp'|'totp'}
 */
export const getAuthMode = (settings = {}) => {
  if (resolveMfaMode(settings) !== 'disabled') return 'totp';
  if (settings.otp_enabled === true) return 'email-otp';
  return 'magic-link';
};

export const AUTH_MODES = Object.freeze(['magic-link', 'email-otp', 'totp']);

/**
 * Field changes for a mode. Choosing "authenticator app" starts with the
 * optional policy, so nobody is locked out by the selection itself.
 *
 * @param {'magic-link'|'email-otp'|'totp'} mode
 * @param {Record<string, unknown>} settings - current form values
 * @returns {Record<string, unknown>}
 */
export const applyAuthMode = (mode, settings = {}) => {
  if (mode === 'email-otp') {
    return { otp_enabled: true, mfa_mode: 'disabled', mfa_require_totp: false };
  }
  if (mode === 'totp') {
    const current = resolveMfaMode(settings);
    const policy = current === 'disabled' ? 'optional' : current;
    return { otp_enabled: false, mfa_mode: policy, mfa_require_totp: policy === 'required' };
  }
  return { otp_enabled: false, mfa_mode: 'disabled', mfa_require_totp: false };
};

/**
 * Field changes for the authenticator policy.
 * @param {'optional'|'required'} policy
 * @returns {Record<string, unknown>}
 */
export const applyTotpPolicy = (policy) =>
  policy === 'required'
    ? { mfa_mode: 'required', mfa_require_totp: true }
    : { mfa_mode: 'optional', mfa_require_totp: false };

/**
 * Reads an authenticator enrollment summary from the API response.
 * Accepts `{ data: { enrolled } }` and `{ enrolled }`.
 *
 * @param {unknown} payload
 * @returns {{enrolled: number}|null}
 */
export const parseEnrollmentSummary = (payload) => {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const enrolled = Number(data?.enrolled);
  return Number.isInteger(enrolled) && enrolled >= 0 ? { enrolled } : null;
};

/**
 * Whether "required for every user" may be chosen. With no enrolled user it
 * would lock everyone out, so it is blocked.
 *
 * @param {{enrolled: number}|null} summary - null when unknown
 * @returns {{allowed: boolean, reason: 'none-enrolled'|'unknown'|'some-enrolled'}}
 */
export const canRequireTotp = (summary) => {
  if (!summary) return { allowed: true, reason: 'unknown' };
  if (summary.enrolled === 0) return { allowed: false, reason: 'none-enrolled' };
  return { allowed: true, reason: 'some-enrolled' };
};

/* ------------------------------------------------------------------ */
/* Login link preview                                                  */
/* ------------------------------------------------------------------ */

const joinUrl = (base, path) => {
  const cleanBase = String(base || '').replace(/\/+$/, '');
  const cleanPath = String(path || '').trim();
  if (!cleanPath) return cleanBase;
  return `${cleanBase}/${cleanPath.replace(/^\/+/, '')}`;
};

/**
 * Preview of the link users receive, with the same precedence as the server:
 * frontend URL + path, then confirmation URL, then the API login route.
 * Invalid values are skipped, as the server skips them.
 *
 * @param {Record<string, unknown>} settings
 * @param {string} [origin] - admin origin, used for the API fallback
 * @returns {{url: string, source: 'frontend'|'confirmation'|'api'}}
 */
export const buildLoginUrlPreview = (settings = {}, origin = 'http://localhost:1337') => {
  const sample = 'loginToken=EXAMPLE';
  const withToken = (base) => {
    try {
      const url = new URL(base);
      url.search = url.search ? `${url.search.slice(1)}&${sample}` : sample;
      return url.toString();
    } catch {
      return `${base}?${sample}`;
    }
  };
  const frontend = typeof settings.frontend_url === 'string' ? settings.frontend_url.trim() : '';
  if (frontend && isValidLinkUrl(frontend)) {
    return {
      url: withToken(joinUrl(frontend, settings.frontend_login_path || '')),
      source: 'frontend',
    };
  }
  const confirmation =
    typeof settings.confirmationUrl === 'string' ? settings.confirmationUrl.trim() : '';
  if (confirmation && isValidLinkUrl(confirmation)) {
    return { url: withToken(confirmation), source: 'confirmation' };
  }
  return { url: withToken(joinUrl(joinUrl(origin, '/api'), '/magic-link/login')), source: 'api' };
};

/* ------------------------------------------------------------------ */
/* E-mail templates                                                    */
/* ------------------------------------------------------------------ */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {unknown} value @returns {string} */
export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

/**
 * Simple default e-mail in the admin language, using the safe placeholders.
 * @param {{heading: string, intro: string, button: string, expiry: string, ignore: string}} copy
 *   translated sentences; `expiry` already contains {{EXPIRY_TEXT}}
 * @returns {{html: string, text: string}}
 */
export const buildDefaultTemplates = (copy) => {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: Arial, sans-serif; padding: 24px; color: #1F2937;">
  <h2>${escapeHtml(copy.heading)}</h2>
  <p>${escapeHtml(copy.intro)}</p>
  <p><a href="{{LOGIN_URL}}">${escapeHtml(copy.button)}</a></p>
  <p style="color: #4B5563; font-size: 14px;">${escapeHtml(copy.expiry)}</p>
  <p style="color: #4B5563; font-size: 14px;">${escapeHtml(copy.ignore)}</p>
</body>
</html>`;
  const text = `${copy.heading}

${copy.intro}

{{LOGIN_URL}}

${copy.expiry}

${copy.ignore}`;
  return { html, text };
};

/**
 * True when replacing the template would discard custom content (it is not
 * empty and matches none of the given known templates).
 *
 * @param {string} current
 * @param {string[]} known - templates that may be replaced silently
 * @param {(value: string) => string} [normalize]
 * @returns {boolean}
 */
export const isCustomTemplate = (current, known, normalize = (value) => value) => {
  const value = normalize(String(current ?? '')).trim();
  if (value === '') return false;
  return !known.some((template) => normalize(String(template ?? '')).trim() === value);
};

/** @param {string} value @returns {{lines: number, chars: number}} */
export const templateStats = (value) => {
  const text = String(value ?? '');
  return { lines: text === '' ? 0 : text.split('\n').length, chars: text.length };
};

/** DOM id of a field, used for focus and labels. */
export const fieldId = (key) =>
  `magic-link-settings-${String(key).replace(/[^A-Za-z0-9_-]/g, '-')}`;
