'use strict';

const { isIP } = require('node:net');

// ::ffff:a.b.c.d after WHATWG URL canonicalisation becomes ::ffff:XXXX:XXXX.
const MAPPED_IPV4_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

/**
 * Converts the canonical hex form of an IPv4-mapped IPv6 address back to
 * dotted IPv4 (`::ffff:c000:201` -> `192.0.2.1`).
 *
 * @param {string} canonical - Canonical IPv6 text without zone.
 * @returns {string|null} IPv4 address or null when the address is not mapped.
 */
const mappedToIpv4 = (canonical) => {
  const match = MAPPED_IPV4_HEX.exec(canonical);
  if (!match) return null;
  const high = parseInt(match[1], 16);
  const low = parseInt(match[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
};

/**
 * Validates and canonicalizes IPv4/IPv6 strings for stable deny-list matching.
 * IPv4-mapped IPv6 addresses (`::ffff:192.0.2.1`, as reported by dual-stack
 * listeners) are returned as plain IPv4, so an IPv4 ban matches both forms.
 *
 * @param {unknown} value - Address supplied by an admin or request context.
 * @returns {string|null} Canonical address, or null when the input is invalid.
 */
const normalizeIpAddress = (value) => {
  if (typeof value !== 'string') return null;
  const address = value.trim();
  const version = isIP(address);
  if (version === 0) return null;
  if (version === 4) return address;

  const zoneIndex = address.indexOf('%');
  const ipv6Address = zoneIndex === -1 ? address : address.slice(0, zoneIndex);
  const zone = zoneIndex === -1 ? '' : address.slice(zoneIndex + 1);
  try {
    const hostname = new URL(`http://[${ipv6Address}]/`).hostname;
    const canonical = hostname.slice(1, -1);
    const ipv4 = mappedToIpv4(canonical);
    if (ipv4) return ipv4;
    return zone ? `${canonical}%${zone}` : canonical;
  } catch {
    return null;
  }
};

/**
 * Expands a canonical IPv6 address (no zone) into its eight 16-bit groups.
 *
 * @param {string} canonical - Canonical IPv6 text.
 * @returns {string[]} Eight lower-case hex groups without leading zeros.
 */
const expandIpv6 = (canonical) => {
  const [head, tail] = canonical.split('::');
  const headGroups = head ? head.split(':') : [];
  if (tail === undefined) return headGroups.map((group) => parseInt(group, 16).toString(16));
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  return [...headGroups, ...Array(missing).fill('0'), ...tailGroups].map((group) =>
    parseInt(group, 16).toString(16)
  );
};

/**
 * Key used for per-client rate limits. IPv4 (and IPv4-mapped IPv6) keys on
 * the full address; IPv6 keys on the /64 network, because one client usually
 * controls a whole /64 and could otherwise rotate through 2^64 keys.
 * Invalid input yields one fixed key, so it can never bypass the limiter.
 *
 * @param {unknown} value - Request address.
 * @returns {string} Stable limiter key.
 */
const ipRateLimitKey = (value) => {
  const normalized = normalizeIpAddress(value);
  if (!normalized) return 'unknown';
  if (isIP(normalized) === 4) return normalized;
  const withoutZone = normalized.split('%')[0];
  return `${expandIpv6(withoutZone).slice(0, 4).join(':')}::/64`;
};

module.exports = { normalizeIpAddress, ipRateLimitKey };
