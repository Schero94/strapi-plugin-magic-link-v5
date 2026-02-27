'use strict';

const { RateLimiterMemory } = require('rate-limiter-flexible');

/**
 * Rate Limiter Service
 * Uses in-memory rate limiting via rate-limiter-flexible for atomic,
 * race-condition-free, fail-closed rate limiting.
 *
 * Limiters are lazily initialized on first use so that settings
 * from the plugin store are respected.
 */
module.exports = ({ strapi }) => {
  let limiters = null;
  let cachedSettings = null;
  let settingsCacheTime = 0;
  const SETTINGS_CACHE_TTL_MS = 60_000;

  /**
   * Loads rate-limit settings from the plugin store (cached for 60 s)
   * @returns {Promise<object>} Merged settings with defaults
   */
  async function getSettings() {
    const now = Date.now();
    if (cachedSettings && now - settingsCacheTime < SETTINGS_CACHE_TTL_MS) {
      return cachedSettings;
    }
    const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
    const raw = await pluginStore.get({ key: 'settings' });
    cachedSettings = {
      enabled: raw?.rate_limit_enabled !== false,
      maxAttempts: raw?.rate_limit_max_attempts || 5,
      windowMinutes: raw?.rate_limit_window_minutes || 15,
      loginMaxAttempts: raw?.rate_limit_login_max_attempts || 10,
      loginWindowMinutes: raw?.rate_limit_login_window_minutes || 15,
      loginBlockMinutes: raw?.rate_limit_login_block_minutes || 30,
    };
    settingsCacheTime = now;
    return cachedSettings;
  }

  /**
   * Creates or re-creates the in-memory limiters based on current settings
   * @param {object} s - Settings object from getSettings()
   * @returns {object} Map of limiter instances keyed by purpose
   */
  function buildLimiters(s) {
    return {
      ip: new RateLimiterMemory({
        keyPrefix: 'ml_ip',
        points: s.maxAttempts,
        duration: s.windowMinutes * 60,
      }),
      email: new RateLimiterMemory({
        keyPrefix: 'ml_email',
        points: s.maxAttempts,
        duration: s.windowMinutes * 60,
      }),
      otp: new RateLimiterMemory({
        keyPrefix: 'ml_otp',
        points: s.maxAttempts,
        duration: s.windowMinutes * 60,
      }),
      login: new RateLimiterMemory({
        keyPrefix: 'ml_login',
        points: s.loginMaxAttempts,
        duration: s.loginWindowMinutes * 60,
        blockDuration: s.loginBlockMinutes * 60,
      }),
    };
  }

  /**
   * Returns the current set of limiters, building them on first call
   * @returns {Promise<object>} Limiter instances
   */
  async function getLimiters() {
    if (!limiters) {
      const s = await getSettings();
      limiters = buildLimiters(s);
    }
    return limiters;
  }

  return {
    /**
     * Check if a request should be rate limited (fail-closed)
     * @param {string} identifier - IP address, email, or other key
     * @param {string} type - Limiter type: 'ip', 'email', 'otp', or 'login'
     * @returns {Promise<{allowed: boolean, retryAfter: number}>}
     */
    async checkRateLimit(identifier, type = 'ip') {
      const s = await getSettings();
      if (!s.enabled) {
        return { allowed: true, retryAfter: 0 };
      }

      try {
        const lims = await getLimiters();
        const limiter = lims[type] || lims.ip;
        await limiter.consume(identifier);
        return { allowed: true, retryAfter: 0 };
      } catch (rlRejected) {
        if (rlRejected instanceof Error) {
          strapi.log.error('[RATE-LIMIT] Internal error (fail-closed):', rlRejected.message);
          return { allowed: false, retryAfter: 60 };
        }
        const retryAfter = Math.ceil(rlRejected.msBeforeNext / 1000) || 1;
        strapi.log.warn(`[RATE-LIMIT] Blocked ${type}: ${identifier} (retry in ${retryAfter}s)`);
        return { allowed: false, retryAfter };
      }
    },

    /**
     * Cleans up rate limit state (resets all in-memory limiters)
     * @returns {Promise<{cleaned: number}>}
     */
    async cleanupExpired() {
      limiters = null;
      cachedSettings = null;
      settingsCacheTime = 0;
      strapi.log.info('[CLEANUP] Rate limit state reset');
      return { cleaned: 1 };
    },

    /**
     * Rebuilds limiters after settings change
     */
    async reloadSettings() {
      cachedSettings = null;
      settingsCacheTime = 0;
      const s = await getSettings();
      limiters = buildLimiters(s);
      strapi.log.info('[RATE-LIMIT] Limiters reloaded with new settings');
    },

    /**
     * Returns current rate limit statistics
     * @returns {Promise<object>} Stats overview
     */
    async getStats() {
      const s = await getSettings();
      return {
        totalEntries: 0,
        maxAttempts: s.maxAttempts,
        windowMinutes: s.windowMinutes,
        loginMaxAttempts: s.loginMaxAttempts,
        loginWindowMinutes: s.loginWindowMinutes,
        loginBlockMinutes: s.loginBlockMinutes,
        ipLimits: 0,
        emailLimits: 0,
        blocked: 0,
        backend: 'in-memory (rate-limiter-flexible)',
      };
    },
  };
};
