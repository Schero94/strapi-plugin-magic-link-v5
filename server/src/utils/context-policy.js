'use strict';

/**
 * Token context policy shared by the public send-link path, the admin token
 * creation and every login response.
 *
 * The context is client data. It must never carry authentication state:
 * challenge state lives in the server-only `challenge` attribute of the token,
 * so the keys below are reserved and rejected (public API) or stripped
 * (everywhere else).
 */

const RESERVED_CONTEXT_KEYS = Object.freeze([
  // Second-factor state (historically stored in context)
  'requiresOTP',
  'otpVerified',
  'requiresTOTP',
  'totpVerified',
  'mfaVerified',
  'totpLogin',
  // Identity and lifetime
  'userId',
  'userDocumentId',
  'user',
  'expires_at',
  'expiresAt',
  'ttl',
  // JWT registered / session claims
  'id',
  'iat',
  'exp',
  'nbf',
  'iss',
  'sub',
  'aud',
  'jti',
  'sessionId',
  'type',
]);

const SENSITIVE_CONTEXT_KEYS = Object.freeze([
  'password',
  'secret',
  'apiKey',
  'token',
  'resetPasswordToken',
  'confirmationToken',
]);

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const LIMITS = Object.freeze({
  maxKeys: 20,
  maxKeyLength: 64,
  maxStringLength: 2000,
  maxJsonLength: 5000,
  maxDepth: 3,
});

const lower = (value) => String(value).trim().toLowerCase();
const RESERVED_LOWER = new Set(RESERVED_CONTEXT_KEYS.map(lower));
const SENSITIVE_LOWER = new Set(SENSITIVE_CONTEXT_KEYS.map(lower));

/**
 * Returns true when a key is reserved for server-side state.
 *
 * @param {string} key - Context key.
 * @returns {boolean} Whether the key is reserved.
 */
const isReservedContextKey = (key) => RESERVED_LOWER.has(lower(key));

/**
 * Normalises a whitelist/blacklist setting (array or comma separated string).
 *
 * @param {unknown} value - Stored setting.
 * @returns {string[]} Lower-cased entries.
 */
const normalizeKeyList = (value) => {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\n]/) : [];
  return list
    .filter((entry) => typeof entry === 'string')
    .map(lower)
    .filter(Boolean);
};

const depthOf = (value, depth = 0) => {
  if (value === null || typeof value !== 'object') return depth;
  let max = depth + 1;
  for (const child of Object.values(value)) {
    max = Math.max(max, depthOf(child, depth + 1));
    if (max > LIMITS.maxDepth + 1) break;
  }
  return max;
};

const hasForbiddenKeys = (value) => {
  if (value === null || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) return true;
    if (hasForbiddenKeys(child)) return true;
  }
  return false;
};

/**
 * Copies one context value within the size limits, or returns undefined when
 * the value is not acceptable.
 *
 * @param {unknown} value - Context value.
 * @returns {unknown} Bounded copy or undefined.
 */
const boundValue = (value) => {
  if (value === null) return null;
  if (typeof value === 'string') return value.substring(0, LIMITS.maxStringLength);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'object') {
    if (depthOf(value) > LIMITS.maxDepth || hasForbiddenKeys(value)) return undefined;
    try {
      const json = JSON.stringify(value);
      if (json.length > LIMITS.maxJsonLength) return undefined;
      return JSON.parse(json);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

/**
 * Applies the admin-configured allow/deny policy plus the fixed reserved and
 * sensitive key lists. Used for public send-link, admin-created tokens and
 * for every context returned to a client.
 *
 * @param {unknown} context - Raw context (object or JSON string).
 * @param {object} [settings] - Plugin settings with context_whitelist / context_blacklist.
 * @returns {Record<string, unknown>} The filtered context.
 */
const filterContext = (context, settings = {}) => {
  let source = context;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return {};
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

  const whitelist = normalizeKeyList(settings?.context_whitelist);
  const blacklist = normalizeKeyList(settings?.context_blacklist);
  const out = {};
  let count = 0;

  for (const [key, value] of Object.entries(source)) {
    if (count >= LIMITS.maxKeys) break;
    const normalizedKey = lower(key);
    if (!key || key.length > LIMITS.maxKeyLength || FORBIDDEN_OBJECT_KEYS.has(key)) continue;
    if (RESERVED_LOWER.has(normalizedKey) || SENSITIVE_LOWER.has(normalizedKey)) continue;
    if (whitelist.length > 0 && !whitelist.includes(normalizedKey)) continue;
    if (blacklist.includes(normalizedKey)) continue;
    const bounded = boundValue(value);
    if (bounded === undefined) continue;
    out[key] = bounded;
    count += 1;
  }

  return out;
};

/**
 * Lists the reserved keys that appear in a raw client context, so the public
 * API can reject the request with a clear validation error.
 *
 * @param {unknown} context - Raw context.
 * @returns {string[]} Reserved keys found.
 */
const findReservedKeys = (context) => {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return [];
  return Object.keys(context).filter(isReservedContextKey);
};

module.exports = {
  LIMITS,
  RESERVED_CONTEXT_KEYS,
  SENSITIVE_CONTEXT_KEYS,
  filterContext,
  findReservedKeys,
  isReservedContextKey,
  normalizeKeyList,
};
