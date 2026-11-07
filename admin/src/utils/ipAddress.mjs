const IPV4_PART = /^(0|[1-9]\d{0,2})$/;
const IPV6_PART = /^[\da-f]{1,4}$/i;
const IPV6_ZONE = /^[\da-z_.-]+$/i;
// ::ffff:a.b.c.d after WHATWG URL canonicalisation becomes ::ffff:XXXX:XXXX.
const MAPPED_IPV4_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

/**
 * Converts the canonical hex form of an IPv4-mapped IPv6 address back to
 * dotted IPv4 (`::ffff:c000:201` -> `192.0.2.1`), like the server does.
 *
 * @param {string} canonical - Canonical IPv6 text without zone.
 * @returns {string|null} IPv4 address, or null when the address is not mapped.
 */
const mappedToIpv4 = (canonical) => {
  const match = MAPPED_IPV4_HEX.exec(canonical);
  if (!match) return null;
  const high = parseInt(match[1], 16);
  const low = parseInt(match[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
};

/**
 * Checks IPv4 and IPv6 input using the same address forms as Node's net.isIP.
 * Leading and trailing whitespace is ignored before validation.
 *
 * @param {unknown} value - User-entered IP address.
 * @returns {boolean} Whether the value is a valid IPv4 or IPv6 address.
 */
export const isValidIpAddress = (value) => {
  if (typeof value !== 'string') return false;

  let address = value.trim();
  if (!address) return false;
  if (isValidIpv4(address)) return true;

  const zoneIndex = address.indexOf('%');
  if (zoneIndex !== -1) {
    const zone = address.slice(zoneIndex + 1);
    if (!zone || !IPV6_ZONE.test(zone) || address.indexOf('%', zoneIndex + 1) !== -1) return false;
    address = address.slice(0, zoneIndex);
  }

  return isValidIpv6(address);
};

/**
 * Returns a canonical address so equivalent IPv6 spellings share one ban entry.
 * IPv4-mapped IPv6 addresses become plain IPv4, matching the stored value of
 * the server (server/src/utils/ip-address.js).
 *
 * @param {unknown} value - User-entered IP address.
 * @returns {string|null} Canonical IPv4/IPv6 address, or null when invalid.
 */
export const normalizeIpAddress = (value) => {
  if (!isValidIpAddress(value)) return null;

  const address = value.trim();
  if (!address.includes(':')) return address;

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

const isValidIpv4 = (address) => {
  const parts = address.split('.');
  return parts.length === 4 && parts.every((part) => IPV4_PART.test(part) && Number(part) <= 255);
};

const isValidIpv6 = (address) => {
  if (!address.includes(':')) return false;

  const compressionIndex = address.indexOf('::');
  const isCompressed = compressionIndex !== -1;
  if (isCompressed && address.lastIndexOf('::') !== compressionIndex) return false;

  const [leftText, rightText = ''] = isCompressed ? address.split('::') : [address, ''];
  const left = leftText ? leftText.split(':') : [];
  const right = rightText ? rightText.split(':') : [];
  const parts = [...left, ...right];
  if (parts.some((part) => !part)) return false;

  let groupCount = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.includes('.')) {
      if (index !== parts.length - 1 || !isValidIpv4(part)) return false;
      groupCount += 2;
      continue;
    }

    if (!IPV6_PART.test(part)) return false;
    groupCount += 1;
  }

  return isCompressed ? groupCount < 8 : groupCount === 8;
};
