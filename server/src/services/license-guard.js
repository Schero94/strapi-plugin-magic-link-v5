/**
 * License Guard Service
 *
 * Marketplace refactor (Strategy B):
 * - All user-facing features are unconditionally available — this service
 *   no longer gates anything in the runtime path.
 * - The license-key activation flow in the admin UI is preserved as a
 *   cosmetic / branding step. When the admin enters a key it is still
 *   verified once against the upstream license server, but no periodic
 *   ping is started and no feature is unlocked or locked based on the
 *   result.
 * - All "feature gate" helpers (`hasFeature`, `getMax*`,
 *   `getAvailableOTPTypes`, `getLicenseTierInfo`) now return permissive
 *   constants. They are kept so callers in legacy code paths keep working
 *   without TypeError, but they always permit.
 *
 * Outbound HTTP is wrapped in `fetchWithTimeout` (AbortController + 1
 * retry) so a slow license server cannot stall plugin boot or the
 * admin-side key save.
 */

'use strict';

const crypto = require('crypto');
const os = require('os');

const LICENSE_SERVER_URL = 'https://magicapi.fitlex.me';

// 12s default tolerates a cold-start on the license server (serverless
// containers need 5–10s for the first TLS handshake). Configurable via
// MAGIC_LICENSE_TIMEOUT_MS for unusually fast or slow networks.
const envTimeout = Number(process.env.MAGIC_LICENSE_TIMEOUT_MS);
const DEFAULT_FETCH_TIMEOUT_MS =
  Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 12000;
const FETCH_RETRIES = 1;
const FETCH_RETRY_BACKOFF_MS = 750;

/**
 * Wraps `fetch` with a hard timeout via AbortController and one retry
 * so a cold-start on the license server does not crash the call. Each
 * attempt uses a fresh AbortController (a shared one would cancel the
 * retry before it could connect).
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
      // eslint-disable-next-line no-await-in-loop
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      lastError = err;
      if (attempt < FETCH_RETRIES) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, FETCH_RETRY_BACKOFF_MS));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

module.exports = ({ strapi }) => ({
  // ======================================================================
  // Network helpers (used only during admin-side key activation)
  // ======================================================================

  /**
   * License server URL. Hard-coded — kept simple because the only call
   * site is the admin-side activation form. Not user-configurable.
   * @returns {string}
   */
  getLicenseServerUrl() {
    return LICENSE_SERVER_URL;
  },

  /**
   * Hashed device identifier used by the upstream activation server to
   * de-duplicate seats. Hash of MAC addresses + hostname; the raw values
   * never leave the host.
   * @returns {string}
   */
  generateDeviceId() {
    try {
      const networkInterfaces = os.networkInterfaces();
      const macAddresses = [];
      Object.values(networkInterfaces).forEach((interfaces) => {
        interfaces.forEach((iface) => {
          if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
            macAddresses.push(iface.mac);
          }
        });
      });
      const identifier = `${macAddresses.join('-')}-${os.hostname()}`;
      return crypto.createHash('sha256').update(identifier).digest('hex').substring(0, 32);
    } catch (error) {
      strapi.log.error('Error generating device ID:', error);
      return crypto.randomBytes(16).toString('hex');
    }
  },

  /**
   * Friendly device name for the activation payload.
   * @returns {string}
   */
  getDeviceName() {
    try {
      return os.hostname() || 'Unknown Device';
    } catch (error) {
      return 'Unknown Device';
    }
  },

  /**
   * First non-internal IPv4 address. Best-effort, used in the activation
   * payload only.
   * @returns {string}
   */
  getIpAddress() {
    try {
      const networkInterfaces = os.networkInterfaces();
      for (const name of Object.keys(networkInterfaces)) {
        for (const iface of networkInterfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            return iface.address;
          }
        }
      }
      return '127.0.0.1';
    } catch (error) {
      return '127.0.0.1';
    }
  },

  /**
   * Server-side user-agent string for the activation payload.
   * @returns {string}
   */
  getUserAgent() {
    return `Strapi/${strapi.config.info.strapi} Node/${process.version} ${os.platform()}/${os.release()}`;
  },

  // ======================================================================
  // License creation / verification (admin activation path only)
  // ======================================================================

  /**
   * Create a license on the upstream activation server. Used by the
   * admin "auto-create" / "create" flows. Failure to create is non-fatal
   * — the plugin keeps working, the user just doesn't get a key.
   *
   * @param {{ email: string, firstName?: string, lastName?: string }} args
   * @returns {Promise<object|null>} Upstream license payload, or null on failure
   */
  async createLicense({ email, firstName, lastName }) {
    try {
      const deviceId = this.generateDeviceId();
      const deviceName = this.getDeviceName();
      const ipAddress = this.getIpAddress();
      const userAgent = this.getUserAgent();

      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetchWithTimeout(`${licenseServerUrl}/api/licenses/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          deviceName,
          deviceId,
          ipAddress,
          userAgent,
          pluginName: 'magic-link',
          productName: 'Magic Link - Passwordless Authentication',
        }),
      });

      const data = await response.json();
      if (data.success) {
        strapi.log.info('[SUCCESS] License created:', data.data.licenseKey);
        return data.data;
      }
      strapi.log.warn('[WARNING] License creation rejected by server:', data.message || 'unknown');
      return null;
    } catch (error) {
      strapi.log.error('[ERROR] Error creating license:', error.message);
      return null;
    }
  },

  /**
   * Verify a license against the upstream activation server.
   * Called once when the admin saves a license key — never during
   * runtime feature checks, never on a schedule.
   *
   * @param {string} licenseKey
   * @returns {Promise<{valid: boolean, data: object|null}>}
   */
  async verifyLicense(licenseKey) {
    try {
      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetchWithTimeout(`${licenseServerUrl}/api/licenses/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey,
          pluginName: 'magic-link',
          productName: 'Magic Link - Passwordless Authentication',
        }),
      });

      const data = await response.json();
      if (data.success) {
        const isValid = !!(data.data && data.data.isActive && !data.data.isExpired);
        if (isValid) {
          const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
          await pluginStore.set({ key: 'lastValidated', value: new Date().toISOString() });
        }
        return { valid: isValid, data: data.data };
      }
      strapi.log.warn(
        `[WARNING] License verification failed: ${data.message || 'Unknown error'} (Key: ${licenseKey?.substring(0, 8)}...)`
      );
      return { valid: false, data: null };
    } catch (error) {
      strapi.log.warn(
        `[WARNING] License server unreachable during activation: ${error.message} ` +
          `(Key: ${licenseKey?.substring(0, 8)}...). Activation will not block this install.`
      );
      // We intentionally do NOT block on a network error here. The plugin
      // is fully functional without a key, so a temporarily unreachable
      // license server should not prevent the admin from saving one.
      return { valid: false, data: null, networkError: true };
    }
  },

  /**
   * Look up a license by key on the upstream server. Used by the admin
   * License page to display details. Network failures yield null.
   *
   * @param {string} licenseKey
   * @returns {Promise<object|null>}
   */
  async getLicenseByKey(licenseKey) {
    try {
      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetchWithTimeout(`${licenseServerUrl}/api/licenses/key/${licenseKey}`);
      const data = await response.json();
      if (data.success) return data.data;
      return null;
    } catch (error) {
      strapi.log.warn('[WARNING] Could not fetch license by key:', error.message);
      return null;
    }
  },

  /**
   * Look up licenses by user email. Used by admin "auto-create" to
   * decide whether to reuse an existing key.
   *
   * @param {string} email
   * @returns {Promise<Array>}
   */
  async getLicensesByEmail(email) {
    try {
      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetchWithTimeout(
        `${licenseServerUrl}/api/licenses/email/${encodeURIComponent(email)}`
      );
      const data = await response.json();
      if (data.success) return data.data;
      return [];
    } catch (error) {
      strapi.log.warn('[WARNING] Could not fetch licenses by email:', error.message);
      return [];
    }
  },

  // ======================================================================
  // Storage (plugin store)
  // ======================================================================

  /**
   * Persist a license key to the plugin store. Used by the admin
   * activation form.
   *
   * @param {string} licenseKey
   * @returns {Promise<boolean>}
   */
  async storeLicenseKey(licenseKey) {
    try {
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      await pluginStore.set({ key: 'licenseKey', value: licenseKey });
      await pluginStore.set({ key: 'lastValidated', value: new Date().toISOString() });
      strapi.log.info('[SUCCESS] License key stored');
      return true;
    } catch (error) {
      strapi.log.error('[ERROR] Error storing license key:', error.message);
      return false;
    }
  },

  // ======================================================================
  // Lifecycle (no-ops in the marketplace build)
  // ======================================================================

  /**
   * Boot-time initializer. In the marketplace build this is a no-op:
   * we do not auto-verify the stored key and we do not start a periodic
   * ping. Kept as a stable export so bootstrap.js continues to work.
   *
   * @returns {Promise<{valid: boolean}>}
   */
  async initialize() {
    // No remote validation, no periodic ping. The license key is
    // persisted purely so the admin UI can echo it back to the user.
    return { valid: true };
  },

  /**
   * Plugin destroy hook. No-op (no interval to clear in the marketplace
   * build).
   */
  cleanup() {
    /* intentional no-op */
  },

  // ======================================================================
  // Permissive feature stubs (kept for backward compatibility with any
  // legacy caller — they always permit, never gate)
  // ======================================================================

  /**
   * Always-permissive feature check. Kept so any legacy `if (await
   * licenseGuard.hasFeature(...))` site continues to compile and runs
   * the gated branch.
   *
   * @returns {Promise<boolean>} always true
   */
  // eslint-disable-next-line no-unused-vars
  async hasFeature(_featureName) {
    return true;
  },

  /**
   * @returns {Promise<number>} -1 (unlimited)
   */
  async getMaxTokens() {
    return -1;
  },

  /**
   * @returns {Promise<number>} -1 (unlimited)
   */
  async getMaxSessions() {
    return -1;
  },

  /**
   * @returns {Promise<number>} -1 (unlimited)
   */
  async getMaxIPBans() {
    return -1;
  },

  /**
   * @returns {Promise<string[]>} every supported OTP type
   */
  async getAvailableOTPTypes() {
    return ['email', 'totp', 'backup-codes'];
  },

  /**
   * Tier info for UI display. Reports `pro` when a key is stored,
   * `free` otherwise. Pure information — no behavior depends on this.
   *
   * @returns {Promise<{tier: string, features: object, hasKey: boolean}>}
   */
  async getLicenseTierInfo() {
    try {
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });
      const hasKey = !!licenseKey;
      return {
        tier: hasKey ? 'pro' : 'free',
        hasKey,
        features: {
          premium: hasKey,
          advanced: hasKey,
          enterprise: hasKey,
        },
      };
    } catch (error) {
      return {
        tier: 'free',
        hasKey: false,
        features: { premium: false, advanced: false, enterprise: false },
      };
    }
  },
});
