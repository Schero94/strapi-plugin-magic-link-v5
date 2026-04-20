'use strict';

/**
 * Utility wrappers for the users-permissions JWT service.
 *
 * Strapi v5's `jwtService.issue(...)` currently returns a plain string,
 * but earlier release candidates and two upcoming RFCs switch it to a
 * Promise<string>. `resolveJwt` keeps every call-site future-proof:
 *
 *   const jwt = await resolveJwt(jwtService.issue(payload));
 *
 * Awaiting a non-thenable is a no-op, so the helper is cheap and the
 * controllers stay consistent across login, MFA-TOTP, primary-TOTP and
 * OTP-verify flows.
 */

/**
 * Resolves a value that may or may not be a Promise to a concrete value.
 *
 * @template T
 * @param {T | Promise<T>} maybeThenable
 * @returns {Promise<T>}
 */
const resolveJwt = async (maybeThenable) => {
  if (maybeThenable && typeof maybeThenable.then === 'function') {
    return await maybeThenable;
  }
  return maybeThenable;
};

module.exports = { resolveJwt };
