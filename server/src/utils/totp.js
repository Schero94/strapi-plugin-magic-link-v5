'use strict';

/**
 * TOTP and backup-code primitives.
 *
 * TOTP is implemented with otplib 13 (functional API). Secrets are stored as
 * RFC 4648 base32 strings, the same format speakeasy produced, so secrets
 * enrolled with Magic Link <= 5.x stay valid without re-enrolment.
 *
 * Docs checked (2026-11-07): otplib.yeojz.dev (context7
 * /websites/otplib_yeojz_dev) for verify({ secret, token, algorithm, digits,
 * period, epoch, epochTolerance }) -> { valid, delta, epoch, timeStep },
 * generateURI({ issuer, label, secret, algorithm, digits, period }) and
 * generateSecret({ length }); installed otplib 13.6.0 dist/index.d.cts and
 * @otplib/totp 13.6.0 dist/index.d.cts. verify throws TokenLengthError /
 * TokenFormatError for malformed tokens, so every call is wrapped.
 */

const nodeCrypto = require('node:crypto');
const otplib = require('otplib');
const cryptoUtils = require('./crypto');

const ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'];
const DIGITS = [6, 8];
const MIN_PERIOD = 15;
const MAX_PERIOD = 300;
const DEFAULT_PARAMS = Object.freeze({ algorithm: 'SHA1', digits: 6, period: 30 });

const BACKUP_CODE_COUNT = 10;
// Crockford-style alphabet without 0/O/1/I/L/U: 30 symbols, 16 symbols per
// code = 78.5 bits of entropy.
const BACKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const BACKUP_CODE_LENGTH = 16;
const BACKUP_HASH_VERSION = 2;

/**
 * Normalises TOTP parameters into the supported set.
 *
 * @param {object} [source] - Object with totp_algorithm/totp_digits/totp_period
 *   (settings) or algorithm/digits/period (stored enrolment).
 * @returns {{algorithm: string, digits: number, period: number}} Parameters.
 */
const normalizeParams = (source = {}) => {
  const rawAlgorithm = String(source.algorithm ?? source.totp_algorithm ?? '').toUpperCase();
  const algorithm = ALGORITHMS.includes(rawAlgorithm) ? rawAlgorithm : DEFAULT_PARAMS.algorithm;
  const rawDigits = Number(source.digits ?? source.totp_digits);
  const digits = DIGITS.includes(rawDigits) ? rawDigits : DEFAULT_PARAMS.digits;
  const rawPeriod = Number(source.period ?? source.totp_period);
  const period = Number.isFinite(rawPeriod)
    ? Math.min(Math.max(Math.round(rawPeriod), MIN_PERIOD), MAX_PERIOD)
    : DEFAULT_PARAMS.period;
  return { algorithm, digits, period };
};

/**
 * Normalises a stored base32 secret (upper case, no spaces or padding).
 *
 * @param {string} secret - Base32 secret.
 * @returns {string} Normalised secret.
 */
const normalizeSecret = (secret) => String(secret || '').replace(/[\s=]/g, '').toUpperCase();

/**
 * Generates a new 160-bit base32 secret (RFC 4226 recommendation).
 *
 * @returns {string} Base32 secret.
 */
const generateSecret = () => otplib.generateSecret({ length: 20 });

/**
 * Builds the otpauth:// URI with every parameter the authenticator needs.
 *
 * @param {object} params
 * @param {string} params.secret - Base32 secret.
 * @param {string} params.issuer - Issuer shown in the app.
 * @param {string} params.label - Account label (e-mail).
 * @param {{algorithm: string, digits: number, period: number}} params.totp - Parameters.
 * @returns {string} otpauth URI.
 */
const buildUri = ({ secret, issuer, label, totp }) =>
  otplib.generateURI({
    issuer: String(issuer || 'Magic Link').slice(0, 128),
    label: String(label || 'account').slice(0, 320),
    secret: normalizeSecret(secret),
    algorithm: totp.algorithm.toLowerCase(),
    digits: totp.digits,
    period: totp.period,
  });

/**
 * Verifies a TOTP code with a tolerance of one time step in each direction.
 *
 * @param {object} params
 * @param {string} params.secret - Base32 secret.
 * @param {string} params.code - Submitted code.
 * @param {{algorithm: string, digits: number, period: number}} params.totp - Parameters.
 * @param {number} [params.now] - Current time in ms (tests).
 * @returns {Promise<{valid: boolean, timeStep?: number}>} Result.
 */
const verifyCode = async ({ secret, code, totp, now = Date.now() }) => {
  const token = String(code || '').replace(/\s/g, '');
  if (!/^\d+$/.test(token) || token.length !== totp.digits) return { valid: false };
  try {
    const result = await otplib.verify({
      secret: normalizeSecret(secret),
      token,
      algorithm: totp.algorithm.toLowerCase(),
      digits: totp.digits,
      period: totp.period,
      epoch: Math.floor(now / 1000),
      epochTolerance: totp.period,
    });
    if (!result?.valid || !Number.isInteger(result.timeStep)) return { valid: false };
    return { valid: true, timeStep: result.timeStep };
  } catch {
    return { valid: false };
  }
};

/**
 * Generates a TOTP code (tests and diagnostics only).
 *
 * @param {object} params - { secret, totp, now }.
 * @returns {Promise<string>} Code.
 */
const generateCode = async ({ secret, totp, now = Date.now() }) =>
  otplib.generate({
    secret: normalizeSecret(secret),
    algorithm: totp.algorithm.toLowerCase(),
    digits: totp.digits,
    period: totp.period,
    epoch: Math.floor(now / 1000),
  });

/**
 * Formats a raw backup code as XXXX-XXXX-XXXX-XXXX.
 *
 * @param {string} raw - 16 symbols.
 * @returns {string} Display form.
 */
const formatBackupCode = (raw) => raw.match(/.{1,4}/g).join('-');

/**
 * Normalises user input of a backup code (case, dashes, spaces).
 *
 * @param {string} value - Input.
 * @returns {string|null} 16 symbols or null when it cannot be a backup code.
 */
const normalizeBackupCode = (value) => {
  const raw = String(value || '').replace(/[\s-]/g, '').toUpperCase();
  if (raw.length !== BACKUP_CODE_LENGTH) return null;
  for (const char of raw) {
    if (!BACKUP_ALPHABET.includes(char)) return null;
  }
  return raw;
};

/**
 * Generates fresh backup codes (unbiased, crypto.randomInt).
 *
 * @param {number} [count] - Number of codes.
 * @returns {string[]} Display-formatted codes.
 */
const generateBackupCodes = (count = BACKUP_CODE_COUNT) => {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    let raw = '';
    for (let j = 0; j < BACKUP_CODE_LENGTH; j += 1) {
      raw += BACKUP_ALPHABET[nodeCrypto.randomInt(0, BACKUP_ALPHABET.length)];
    }
    codes.push(formatBackupCode(raw));
  }
  return codes;
};

/**
 * Keyed hash of a backup code, bound to its owner so a hash cannot be moved
 * to another account.
 *
 * @param {string} principalKey - Owner key (e.g. "up:12").
 * @param {string} code - Backup code (any formatting).
 * @returns {string|null} Hex HMAC or null for malformed input.
 */
const hashBackupCode = (principalKey, code) => {
  const normalized = normalizeBackupCode(code);
  if (!normalized) return null;
  return cryptoUtils.keyedHash('backup-code', `${principalKey}:${normalized}`);
};

/**
 * Timing-safe search of a backup code hash in a stored list.
 *
 * @param {string[]} hashes - Stored hashes.
 * @param {string} candidate - Hash to find.
 * @returns {number} Index or -1.
 */
const findHashIndex = (hashes, candidate) => {
  if (!candidate || !Array.isArray(hashes)) return -1;
  const target = Buffer.from(candidate, 'hex');
  let found = -1;
  hashes.forEach((stored, index) => {
    if (typeof stored !== 'string') return;
    const buffer = Buffer.from(stored, 'hex');
    if (buffer.length === target.length && nodeCrypto.timingSafeEqual(buffer, target) && found === -1) {
      found = index;
    }
  });
  return found;
};

module.exports = {
  ALGORITHMS,
  BACKUP_CODE_COUNT,
  BACKUP_HASH_VERSION,
  DEFAULT_PARAMS,
  buildUri,
  findHashIndex,
  generateBackupCodes,
  generateCode,
  generateSecret,
  hashBackupCode,
  normalizeBackupCode,
  normalizeParams,
  normalizeSecret,
  verifyCode,
};
