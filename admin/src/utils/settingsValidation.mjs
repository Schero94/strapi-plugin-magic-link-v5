const JWT_EXPIRY_PATTERN = /^\d+[dh]$/;
const MAX_JWT_EXPIRY_LENGTH = 16;
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks the JWT expiry format accepted by the settings API before save.
 *
 * @param {unknown} value - Admin settings field value
 * @returns {boolean} Whether the value matches the bounded `number + h|d` format
 */
export function isValidJwtExpiry(value) {
  return (
    typeof value === 'string' &&
    value.length <= MAX_JWT_EXPIRY_LENGTH &&
    JWT_EXPIRY_PATTERN.test(value)
  );
}

/**
 * Checks an optional settings email using the address bounds enforced by the API.
 *
 * @param {unknown} value - Optional sender or Reply-To address
 * @returns {boolean} Whether the field is blank or contains a valid email
 */
export function isValidOptionalEmail(value) {
  if (typeof value !== 'string') return false;

  const address = value.trim();
  return address === '' || (address.length <= 320 && EMAIL_ADDRESS_PATTERN.test(address));
}
