'use strict';

/**
 * Crypto Utility for Magic Link Plugin
 *
 * SECURITY POLICY
 * ---------------
 * Two secrets are required at runtime:
 *
 *   MAGIC_LINK_ENCRYPTION_KEY  — AES-256 key for reversible secrets (TOTP)
 *   MAGIC_LINK_OTP_PEPPER      — pepper mixed into OTP code hashes
 *
 * In production NODE_ENV these MUST be set via env (or the plugin refuses
 * to boot). In non-production they fall back to a derived value so local
 * dev setups keep working — but a prominent WARN is emitted once.
 *
 * NEVER rotate the encryption key: it is NOT `APP_KEYS`, because Strapi's
 * APP_KEYS are meant to be rotatable. Rotating the encryption key would
 * make every existing TOTP secret undecryptable.
 */

const crypto = require('crypto');

let warnedMissingKey = false;
let warnedMissingPepper = false;

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Derives a dev-mode fallback value from the strongest available secret.
 * Order matches what Strapi guarantees: ADMIN_JWT_SECRET > APP_KEYS > none.
 */
const devFallbackMaterial = () =>
  process.env.ADMIN_JWT_SECRET ||
  (Array.isArray(process.env.APP_KEYS) ? process.env.APP_KEYS[0] : process.env.APP_KEYS) ||
  'magic-link-dev-fallback-DO-NOT-USE-IN-PRODUCTION';

/**
 * Returns the 32-byte AES-256 key derived from MAGIC_LINK_ENCRYPTION_KEY.
 *
 * @throws {Error} When the env var is missing in production
 */
const getEncryptionKey = () => {
  const raw = process.env.MAGIC_LINK_ENCRYPTION_KEY;
  if (raw && raw.length > 0) {
    return crypto.createHash('sha256').update(raw).digest();
  }

  if (isProduction()) {
    throw new Error(
      '[magic-link] MAGIC_LINK_ENCRYPTION_KEY env var is required in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  if (!warnedMissingKey) {
    warnedMissingKey = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[magic-link] MAGIC_LINK_ENCRYPTION_KEY not set — using dev fallback. ' +
      'Set this env var before going to production (it is NOT rotatable).'
    );
  }
  return crypto.createHash('sha256').update(devFallbackMaterial()).digest();
};

/**
 * Returns the pepper used to salt OTP code hashes.
 * The pepper is public-by-design among plugin users, but must not be
 * the published default, otherwise anyone who dumps the DB can rainbow-
 * attack the 10^6 OTP space in seconds.
 */
const getOtpPepper = () => {
  const raw = process.env.MAGIC_LINK_OTP_PEPPER || process.env.OTP_PEPPER;
  if (raw && raw.length >= 16) {
    return raw;
  }

  if (isProduction()) {
    throw new Error(
      '[magic-link] MAGIC_LINK_OTP_PEPPER env var is required in production ' +
      '(min 16 characters). Generate one with: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"'
    );
  }

  if (!warnedMissingPepper) {
    warnedMissingPepper = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[magic-link] MAGIC_LINK_OTP_PEPPER not set — using dev fallback. ' +
      'Set this before deploying to production.'
    );
  }
  return 'magic-link-otp-dev-pepper-DO-NOT-USE-IN-PRODUCTION';
};

/**
 * Hash a value using SHA256 (one-way, for comparison)
 * @param {string} value - Value to hash
 * @returns {string} - Hashed value (hex)
 */
const hash = (value) => {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex');
};

/**
 * Hash a token with a salt for secure storage
 * @param {string} token - Token to hash
 * @param {string} salt - Optional salt (will generate if not provided)
 * @returns {object} - { hash, salt }
 */
const hashToken = (token, salt = null) => {
  if (!token) return { hash: null, salt: null };
  const tokenSalt = salt || crypto.randomBytes(16).toString('hex');
  const hashedToken = crypto.createHash('sha256')
    .update(token + tokenSalt)
    .digest('hex');
  return { hash: hashedToken, salt: tokenSalt };
};

/**
 * Verify a token against its hash
 * @param {string} token - Token to verify
 * @param {string} storedHash - Stored hash
 * @param {string} salt - Salt used during hashing
 * @returns {boolean} - True if token matches
 */
const verifyToken = (token, storedHash, salt) => {
  if (!token || !storedHash) return false;
  const { hash: computedHash } = hashToken(token, salt);
  return crypto.timingSafeEqual(
    Buffer.from(computedHash, 'hex'),
    Buffer.from(storedHash, 'hex')
  );
};

/**
 * Encrypt a value using AES-256-GCM (reversible)
 * Use for TOTP secrets that need to be decrypted
 * @param {string} value - Value to encrypt
 * @returns {string} - Encrypted value (base64)
 */
const encrypt = (value) => {
  if (!value) return null;
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(String(value), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Return iv:authTag:encryptedData as base64
  return Buffer.from(
    iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted
  ).toString('base64');
};

/**
 * Decrypt a value encrypted with encrypt().
 *
 * SECURITY: This function is strict. If the ciphertext is malformed,
 * truncated, or the auth tag does not verify, an Error is thrown. We never
 * return the raw input on failure — doing so would allow an attacker with
 * DB write access to downgrade an encrypted secret to plaintext by simply
 * corrupting the base64 wrapper.
 *
 * @param {string} encryptedValue - Encrypted value (base64 from encrypt())
 * @returns {string|null} Decrypted UTF-8 string, or null if input was null
 * @throws {Error} If the value is not in the expected iv:tag:ct format
 *                 or if authenticated decryption fails.
 */
const decrypt = (encryptedValue) => {
  if (!encryptedValue) return null;

  const key = getEncryptionKey();
  const data = Buffer.from(encryptedValue, 'base64').toString('utf8');
  const parts = data.split(':');

  if (parts.length !== 3) {
    throw new Error('[Crypto] decrypt: malformed ciphertext (expected iv:tag:ct)');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('[Crypto] decrypt: missing ciphertext components');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};

/**
 * Generate a cryptographically secure random string
 * @param {number} length - Length of the string
 * @returns {string} - Random string (hex)
 */
const generateSecureRandom = (length = 32) => {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
};

/**
 * Hash OTP code for secure storage (with timing-safe comparison).
 * Uses getOtpPepper() which enforces env presence in production.
 * @param {string} code - OTP code to hash
 * @returns {string|null} - Hex SHA-256 digest, or null if code is empty
 */
const hashOTP = (code) => {
  if (!code) return null;
  const pepper = getOtpPepper();
  return crypto.createHash('sha256')
    .update(code + pepper)
    .digest('hex');
};

/**
 * Verify OTP code against stored hash (timing-safe)
 * @param {string} code - Code to verify
 * @param {string} storedHash - Stored hash
 * @returns {boolean} - True if code matches
 */
const verifyOTP = (code, storedHash) => {
  if (!code || !storedHash) return false;
  const computedHash = hashOTP(code);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedHash, 'hex'),
      Buffer.from(storedHash, 'hex')
    );
  } catch {
    return false;
  }
};

/**
 * Check if a value is already encrypted
 * @param {string} value - Value to check
 * @returns {boolean} - True if appears to be encrypted
 */
const isEncrypted = (value) => {
  if (!value) return false;
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const parts = decoded.split(':');
    return parts.length === 3 && parts[0].length === 32 && parts[1].length === 32;
  } catch {
    return false;
  }
};

/**
 * Hash a JWT for safe storage (one-way, non-reversible).
 * Stored hashes allow revocation checks without keeping the real JWT in the DB.
 * @param {string} jwt - The JWT string to hash
 * @returns {string|null} SHA256 hex digest
 */
const hashJwt = (jwt) => {
  if (!jwt) return null;
  return crypto.createHash('sha256').update(jwt).digest('hex');
};

module.exports = {
  hash,
  hashToken,
  verifyToken,
  encrypt,
  decrypt,
  generateSecureRandom,
  hashOTP,
  verifyOTP,
  isEncrypted,
  hashJwt,
};

