'use strict';

/**
 * License Guard Service
 *
 * The plugin is fully functional without a license key; nothing is gated.
 * A stored key is display metadata only.
 *
 * Privacy (6.0.0):
 * - The only outbound calls go to the license server and only carry the
 *   license key (verify on save, details lookup for the License page).
 *   No hostname, IP address, OS details, device id or admin data is sent.
 * - Lookups are cached for 10 minutes, so opening the License page does not
 *   call the server every time.
 * - Remote lookups can be switched off with the plugin config
 *   `license: { remoteLookup: false }` or MAGIC_LINK_LICENSE_LOOKUP=false.
 *   The License page then shows the stored key without details.
 * - The key is URL-encoded and must match a strict format.
 *
 * Outbound HTTP uses `fetch` with an AbortController timeout and one retry.
 */

const LICENSE_SERVER_URL = 'https://magicapi.fitlex.me';
const LICENSE_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const LOOKUP_CACHE_TTL_MS = 10 * 60 * 1000;

// MAGIC_LICENSE_TIMEOUT_MS tunes the timeout for slow networks.
const envTimeout = Number(process.env.MAGIC_LICENSE_TIMEOUT_MS);
const DEFAULT_FETCH_TIMEOUT_MS = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 12000;
const FETCH_RETRIES = 1;
const FETCH_RETRY_BACKOFF_MS = 750;

/**
 * Wraps `fetch` with a hard timeout and one retry. Each attempt uses a fresh
 * AbortController.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  let lastError;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      lastError = err;
      if (attempt < FETCH_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, FETCH_RETRY_BACKOFF_MS));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/**
 * Whether a string has the license key format.
 *
 * @param {unknown} value - Candidate key.
 * @returns {boolean} Whether the format is valid.
 */
const isValidLicenseKey = (value) => typeof value === 'string' && LICENSE_KEY_PATTERN.test(value);

/**
 * Masks a license key for display: only the last four characters remain.
 *
 * @param {unknown} key - License key.
 * @returns {string} Masked key or ''.
 */
const maskLicenseKey = (key) => {
  if (typeof key !== 'string' || !key) return '';
  return key.length < 12 ? '••••••••' : `••••-••••-${key.slice(-4)}`;
};

module.exports = ({ strapi }) => {
  const lookupCache = new Map();

  /**
   * Whether remote license lookups are allowed by config and environment.
   * @returns {boolean}
   */
  const remoteLookupEnabled = () => {
    if (String(process.env.MAGIC_LINK_LICENSE_LOOKUP || '').toLowerCase() === 'false') return false;
    return strapi.config?.get?.('plugin::magic-link.license.remoteLookup', true) !== false;
  };

  return {
    /**
     * License server base URL (fixed).
     * @returns {string}
     */
    getLicenseServerUrl() {
      return LICENSE_SERVER_URL;
    },

    isRemoteLookupEnabled() {
      return remoteLookupEnabled();
    },

    /**
     * Verifies a license key with the license server. Sends only the key.
     *
     * @param {string} licenseKey
     * @returns {Promise<{valid: boolean, data: object|null, networkError?: boolean, disabled?: boolean}>}
     */
    async verifyLicense(licenseKey) {
      if (!isValidLicenseKey(licenseKey)) return { valid: false, data: null };
      if (!remoteLookupEnabled()) return { valid: false, data: null, disabled: true };
      try {
        const response = await fetchWithTimeout(`${LICENSE_SERVER_URL}/api/licenses/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ licenseKey, pluginName: 'magic-link' }),
        });
        const data = await response.json();
        if (data?.success) {
          return { valid: Boolean(data.data && data.data.isActive && !data.data.isExpired), data: data.data || null };
        }
        return { valid: false, data: null };
      } catch {
        strapi.log.warn('[magic-link] License server unreachable');
        return { valid: false, data: null, networkError: true };
      }
    },

    /**
     * Looks up license details for the License page (cached for 10 minutes).
     *
     * @param {string} licenseKey
     * @returns {Promise<{status: 'ok'|'not-found'|'unavailable'|'disabled', license: object|null}>}
     */
    async lookupLicense(licenseKey) {
      if (!isValidLicenseKey(licenseKey)) return { status: 'not-found', license: null };
      if (!remoteLookupEnabled()) return { status: 'disabled', license: null };

      const cached = lookupCache.get(licenseKey);
      if (cached && cached.expiresAt > Date.now()) return cached.value;

      let value;
      try {
        const response = await fetchWithTimeout(
          `${LICENSE_SERVER_URL}/api/licenses/key/${encodeURIComponent(licenseKey)}`
        );
        const data = await response.json();
        value = data?.success ? { status: 'ok', license: data.data || null } : { status: 'not-found', license: null };
      } catch {
        strapi.log.warn('[magic-link] License lookup failed');
        // Failures are not cached, so a retry can succeed immediately.
        return { status: 'unavailable', license: null };
      }
      lookupCache.clear();
      lookupCache.set(licenseKey, { value, expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS });
      return value;
    },

    /**
     * 5.x API: license details or null.
     *
     * @param {string} licenseKey
     * @returns {Promise<object|null>}
     */
    async getLicenseByKey(licenseKey) {
      return (await this.lookupLicense(licenseKey)).license;
    },

    /**
     * Persists a license key in the plugin store.
     *
     * @param {string} licenseKey
     * @returns {Promise<boolean>}
     */
    async storeLicenseKey(licenseKey) {
      if (!isValidLicenseKey(licenseKey)) return false;
      try {
        const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
        await pluginStore.set({ key: 'licenseKey', value: licenseKey });
        await pluginStore.set({ key: 'lastValidated', value: new Date().toISOString() });
        lookupCache.clear();
        strapi.log.info('[magic-link] License key stored');
        return true;
      } catch {
        strapi.log.error('[magic-link] License key storage failed');
        return false;
      }
    },

    /** Boot hook: no remote validation, no periodic ping. */
    async initialize() {
      return { valid: true };
    },

    /** Destroy hook: drops cached lookups. */
    cleanup() {
      lookupCache.clear();
    },

    // Permissive feature stubs kept for 5.x callers. Nothing is gated.

    /** @returns {Promise<boolean>} always true */
    async hasFeature() {
      return true;
    },

    /** @returns {Promise<number>} -1 (unlimited) */
    async getMaxTokens() {
      return -1;
    },

    /** @returns {Promise<number>} -1 (unlimited) */
    async getMaxSessions() {
      return -1;
    },

    /** @returns {Promise<number>} -1 (unlimited) */
    async getMaxIPBans() {
      return -1;
    },

    /** @returns {Promise<string[]>} supported second factors */
    async getAvailableOTPTypes() {
      return ['email', 'totp', 'backup-codes'];
    },

    /**
     * Tier info for display only.
     * @returns {Promise<{tier: string, features: object, hasKey: boolean}>}
     */
    async getLicenseTierInfo() {
      let hasKey = false;
      try {
        const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
        hasKey = Boolean(await pluginStore.get({ key: 'licenseKey' }));
      } catch {
        hasKey = false;
      }
      return {
        tier: hasKey ? 'pro' : 'free',
        hasKey,
        features: { premium: hasKey, advanced: hasKey, enterprise: hasKey },
      };
    },
  };
};

module.exports.isValidLicenseKey = isValidLicenseKey;
module.exports.maskLicenseKey = maskLicenseKey;
