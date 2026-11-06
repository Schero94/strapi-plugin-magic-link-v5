'use strict';

const { isIP } = require('node:net');

/**
 * Validates and canonicalizes IPv4/IPv6 strings for stable deny-list matching.
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
    return zone ? `${canonical}%${zone}` : canonical;
  } catch {
    return null;
  }
};

module.exports = { normalizeIpAddress };
