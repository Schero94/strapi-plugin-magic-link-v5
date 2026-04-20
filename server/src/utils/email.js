'use strict';

/**
 * Email helpers used across controllers, services and validation schemas.
 *
 * RFC 5321 §2.3.11 specifies that the domain part of an address is
 * case-insensitive. Strictly the local part is not — but every real-world
 * mailbox provider (Gmail, Apple, Microsoft, Yahoo, Proton, and mainstream
 * SMTP servers) treats it as case-insensitive too, so we normalise the
 * full address on the way in. This avoids subtle bugs on Postgres (and
 * any other collation-sensitive DB) where `WHERE email = 'x'` misses a
 * row stored as `X`. MySQL with `utf8mb4_general_ci` happens to work
 * without normalisation — our normalisation makes the behaviour portable.
 *
 * Do NOT use this helper for display purposes — it loses the original
 * casing. It is safe for equality lookups, token creation, and rate-limit
 * keys.
 */

/**
 * Normalises an email for case-insensitive equality lookups.
 *
 * @param {unknown} raw - Arbitrary input; only strings are normalised.
 * @returns {string|null} Lower-cased, trimmed email, or null if input is
 *   not a non-empty string.
 */
const normalizeEmail = (raw) => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
};

module.exports = { normalizeEmail };
