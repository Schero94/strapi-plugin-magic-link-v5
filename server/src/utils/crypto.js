'use strict';

/**
 * Crypto Utility for Magic Link Plugin
 *
 * SECURITY POLICY
 * ---------------
 * Two secrets are required at runtime:
 *
 *   MAGIC_LINK_ENCRYPTION_KEY  - AES-256-GCM key material for reversible
 *                                secrets (TOTP). At least 32 characters, e.g.
 *                                64 hex characters from 32 random bytes.
 *   MAGIC_LINK_OTP_PEPPER      - pepper for OTP code hashes and backup-code
 *                                HMACs. At least 32 characters.
 *
 * Both are checked eagerly in bootstrap: a missing or too short value stops
 * the plugin from starting. The only escape hatch is
 * MAGIC_LINK_ALLOW_DEV_SECRETS=true outside NODE_ENV=production, which uses a
 * derived development fallback and logs a warning. NODE_ENV alone is not
 * trusted, because staging hosts often run without NODE_ENV=production.
 *
 * Rotating the encryption key: set the new key in MAGIC_LINK_ENCRYPTION_KEY
 * and the old one in MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS. Decryption falls
 * back to the previous key and bootstrap re-encrypts stored TOTP secrets
 * with the new key. Remove the previous key afterwards.
 */

const crypto = require('crypto');

const MIN_SECRET_LENGTH = 32;
const DEV_PEPPER = 'magic-link-otp-dev-pepper-DO-NOT-USE-IN-PRODUCTION';

let warnedDevKey = false;
let warnedDevPepper = false;

const isProduction = () => process.env.NODE_ENV === 'production';
const devSecretsAllowed = () =>
  !isProduction() && process.env.MAGIC_LINK_ALLOW_DEV_SECRETS === 'true';

const GENERATE_HINT =
  "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";

/**
 * Derives a development fallback value from the strongest available secret.
 * Order matches what Strapi guarantees: ADMIN_JWT_SECRET > APP_KEYS > none.
 * Kept identical to 5.x so development data stays decryptable.
 *
 * @returns {string} Fallback material.
 */
const devFallbackMaterial = () =>
  process.env.ADMIN_JWT_SECRET ||
  String(process.env.APP_KEYS || '').split(',')[0] ||
  'magic-link-dev-fallback-DO-NOT-USE-IN-PRODUCTION';

/**
 * Derives the 32-byte AES key from key material (SHA-256, as in 5.x).
 *
 * @param {string} material - Key material.
 * @returns {Buffer} Key.
 */
const deriveKey = (material) => crypto.createHash('sha256').update(material).digest();

/**
 * Returns the 32-byte AES-256 key derived from MAGIC_LINK_ENCRYPTION_KEY.
 *
 * @returns {Buffer} Key.
 * @throws {Error} When the key is missing or too short and development
 *   secrets are not explicitly allowed.
 */
const getEncryptionKey = () => {
  const raw = process.env.MAGIC_LINK_ENCRYPTION_KEY;
  if (raw && raw.length >= MIN_SECRET_LENGTH) {
    return deriveKey(raw);
  }

  if (!devSecretsAllowed()) {
    throw new Error(
      raw
        ? `[magic-link] MAGIC_LINK_ENCRYPTION_KEY must be at least ${MIN_SECRET_LENGTH} characters. ` +
            'Set the new key and move the old one to MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS. ' +
            GENERATE_HINT
        : '[magic-link] MAGIC_LINK_ENCRYPTION_KEY is required (it is NOT rotatable without ' +
            'MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS). ' +
            GENERATE_HINT
    );
  }

  if (!warnedDevKey) {
    warnedDevKey = true;
    console.warn(
      '[magic-link] MAGIC_LINK_ALLOW_DEV_SECRETS=true: using a development encryption key.'
    );
  }
  return deriveKey(raw || devFallbackMaterial());
};

/**
 * Returns the previous encryption key used during key rotation, if any.
 *
 * @returns {Buffer|null} Key or null.
 */
const getPreviousEncryptionKey = () => {
  const raw = process.env.MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS;
  return raw ? deriveKey(raw) : null;
};

/**
 * Returns the pepper used for OTP code hashes and backup-code HMACs.
 *
 * @returns {string} Pepper.
 * @throws {Error} When the pepper is missing or too short and development
 *   secrets are not explicitly allowed.
 */
const getOtpPepper = () => {
  const raw = process.env.MAGIC_LINK_OTP_PEPPER || process.env.OTP_PEPPER;
  if (raw && raw.length >= MIN_SECRET_LENGTH) {
    return raw;
  }

  if (!devSecretsAllowed()) {
    throw new Error(
      `[magic-link] MAGIC_LINK_OTP_PEPPER is required (min ${MIN_SECRET_LENGTH} characters). ` +
        GENERATE_HINT
    );
  }

  if (!warnedDevPepper) {
    warnedDevPepper = true;
    console.warn('[magic-link] MAGIC_LINK_ALLOW_DEV_SECRETS=true: using a development OTP pepper.');
  }
  return raw || DEV_PEPPER;
};

/**
 * Checks both secrets once. Called from bootstrap so a misconfiguration
 * stops the start instead of failing on the first login.
 *
 * @throws {Error} When a secret is missing or too weak.
 */
const assertSecretsConfigured = () => {
  getEncryptionKey();
  getOtpPepper();
};

/**
 * HMAC-SHA256 keyed with a purpose-specific key derived from the pepper.
 *
 * @param {string} purpose - Domain separation label.
 * @param {string} value - Value to hash.
 * @returns {string} Hex digest.
 */
const keyedHash = (purpose, value) => {
  const key = Buffer.from(
    crypto.hkdfSync('sha256', getOtpPepper(), Buffer.alloc(0), `magic-link:${purpose}`, 32)
  );
  return crypto.createHmac('sha256', key).update(String(value)).digest('hex');
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
  const hashedToken = crypto
    .createHash('sha256')
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
  return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(storedHash, 'hex'));
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
  return Buffer.from(iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted).toString(
    'base64'
  );
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
 * @param {Buffer} key - AES-256 key.
 * @returns {string} Decrypted UTF-8 string
 * @throws {Error} If the value is not in the expected iv:tag:ct format
 *                 or if authenticated decryption fails.
 */
const decryptWithKey = (encryptedValue, key) => {
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
 * Decrypts and reports whether the previous (rotation) key was needed.
 *
 * @param {string} encryptedValue - Encrypted value (base64 from encrypt()).
 * @returns {{value: string|null, usedPreviousKey: boolean}} Result.
 * @throws {Error} When neither key authenticates the ciphertext.
 */
const decryptWithInfo = (encryptedValue) => {
  if (!encryptedValue) return { value: null, usedPreviousKey: false };
  try {
    return { value: decryptWithKey(encryptedValue, getEncryptionKey()), usedPreviousKey: false };
  } catch (error) {
    const previous = getPreviousEncryptionKey();
    if (!previous) throw error;
    return { value: decryptWithKey(encryptedValue, previous), usedPreviousKey: true };
  }
};

const decrypt = (encryptedValue) => decryptWithInfo(encryptedValue).value;

/**
 * Generate a cryptographically secure random string
 * @param {number} length - Length of the string
 * @returns {string} - Random string (hex)
 */
const generateSecureRandom = (length = 32) => {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
};

/**
 * Hash OTP code for secure storage (with timing-safe comparison).
 * Uses getOtpPepper(), which requires a configured pepper.
 * @param {string} code - OTP code to hash
 * @returns {string|null} - Hex SHA-256 digest, or null if code is empty
 */
const hashOTP = (code) => {
  if (!code) return null;
  const pepper = getOtpPepper();
  return crypto
    .createHash('sha256')
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
    return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(storedHash, 'hex'));
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
  MIN_SECRET_LENGTH,
  assertSecretsConfigured,
  decryptWithInfo,
  keyedHash,
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
