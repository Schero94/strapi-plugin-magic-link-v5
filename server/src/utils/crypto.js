'use strict';

/**
 * Crypto Utility for Magic Link Plugin
 * Provides secure hashing and encryption functions
 */

const crypto = require('crypto');

// Use environment variable or fallback to a derived key
const getEncryptionKey = () => {
  const envKey = process.env.MAGIC_LINK_ENCRYPTION_KEY || process.env.APP_KEYS || process.env.API_TOKEN_SALT;
  if (!envKey) {
    // Fallback: derive key from Strapi's admin JWT secret (always available)
    const fallback = process.env.ADMIN_JWT_SECRET || 'magic-link-default-key-change-me';
    return crypto.createHash('sha256').update(fallback).digest();
  }
  // Ensure key is exactly 32 bytes for AES-256
  return crypto.createHash('sha256').update(envKey).digest();
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
 * Decrypt a value encrypted with encrypt()
 * @param {string} encryptedValue - Encrypted value (base64)
 * @returns {string} - Decrypted value
 */
const decrypt = (encryptedValue) => {
  if (!encryptedValue) return null;
  
  try {
    const key = getEncryptionKey();
    const data = Buffer.from(encryptedValue, 'base64').toString('utf8');
    const [ivHex, authTagHex, encryptedHex] = data.split(':');
    
    if (!ivHex || !authTagHex || !encryptedHex) {
      // Not encrypted format, return as-is (for backwards compatibility)
      return encryptedValue;
    }
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    // If decryption fails, assume it's not encrypted (backwards compatibility)
    console.warn('[Crypto] Decryption failed, returning original value');
    return encryptedValue;
  }
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
 * Hash OTP code for secure storage (with timing-safe comparison)
 * @param {string} code - OTP code to hash
 * @returns {string} - Hashed code
 */
const hashOTP = (code) => {
  if (!code) return null;
  // OTP codes are short, so we add pepper for additional security
  const pepper = process.env.OTP_PEPPER || 'magic-link-otp-pepper';
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

