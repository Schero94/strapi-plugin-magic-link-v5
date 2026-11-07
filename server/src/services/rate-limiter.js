'use strict';

const { isIP } = require('node:net');
const { RateLimiterMemory, RateLimiterRedis } = require('rate-limiter-flexible');
const { ipRateLimitKey } = require('../utils/ip-address');

/**
 * Rate Limiter Service (rate-limiter-flexible 11).
 *
 * - Limiters are built lazily from the plugin settings and rebuilt only when
 *   the limit values change, so saving unrelated settings keeps counters.
 * - Client addresses are keyed through `ipRateLimitKey`: IPv4-mapped IPv6 is
 *   folded into IPv4 and IPv6 is keyed per /64, so a client cannot dodge a
 *   limit by rotating addresses inside its own prefix.
 * - Counters live in process memory by default. Clustered deployments can
 *   share them through Redis with the plugin config
 *   `rateLimit: { redis: { storeClient, useRedisPackage } }`; an in-memory
 *   insurance limiter keeps limiting when Redis is unavailable.
 * - Internal limiter errors fail closed (request refused).
 * - Second-factor code checks (TOTP, backup codes, e-mail OTP) use the
 *   `verify` limiter, which stays on when public rate limiting is disabled,
 *   so turning off send throttling never opens a brute-force path.
 *
 * Docs: github.com/animir/node-rate-limiter-flexible/wiki (Memory, Redis,
 * API-methods: consume rejects with RateLimiterRes or Error).
 */

const LIMITER_TYPES = ['ip', 'email', 'otp', 'login', 'admin', 'verify'];
// Admin-initiated actions (token creation) per admin user and window.
const ADMIN_POINTS = 60;
const ADMIN_WINDOW_SECONDS = 15 * 60;
// Second-factor code checks per account (or per login challenge): 10 tries
// per 15 minutes, then a 15 minute block. Always enforced.
const VERIFY_POINTS = 10;
const VERIFY_WINDOW_SECONDS = 15 * 60;
const VERIFY_BLOCK_SECONDS = 15 * 60;
/** Limiter types that ignore `rate_limit_enabled: false`. */
const ALWAYS_ON_TYPES = new Set(['admin', 'verify']);

/**
 * Rewrites identifiers that carry a client address so they key on
 * `ipRateLimitKey`. Supports a bare address and the `ip:<scope>:<address>`
 * convention used by the controllers. Other identifiers pass unchanged.
 *
 * @param {unknown} identifier - Limiter key.
 * @returns {string} Normalised key.
 */
const normalizeLimiterIdentifier = (identifier) => {
  const value = String(identifier ?? '');
  if (isIP(value.trim())) return ipRateLimitKey(value);
  if (value.startsWith('ip:')) {
    const scopeEnd = value.indexOf(':', 3);
    if (scopeEnd > 3) {
      const address = value.slice(scopeEnd + 1);
      if (isIP(address.trim())) return `${value.slice(0, scopeEnd)}:${ipRateLimitKey(address)}`;
    }
  }
  return value;
};

const positive = (value, fallback) =>
  Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

module.exports = ({ strapi }) => {
  let limiters = null;
  let limiterSignature = '';
  let cachedSettings = null;
  let settingsCacheTime = 0;
  const SETTINGS_CACHE_TTL_MS = 60_000;
  const stats = {
    blocked: Object.fromEntries(LIMITER_TYPES.map((type) => [type, 0])),
    errors: 0,
    since: new Date().toISOString(),
  };

  /**
   * Loads rate-limit settings from the plugin store (cached for 60 s).
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
      maxAttempts: positive(raw?.rate_limit_max_attempts, 5),
      windowMinutes: positive(raw?.rate_limit_window_minutes, 15),
      loginMaxAttempts: positive(raw?.rate_limit_login_max_attempts, 10),
      loginWindowMinutes: positive(raw?.rate_limit_login_window_minutes, 15),
      loginBlockMinutes: positive(raw?.rate_limit_login_block_minutes, 30),
    };
    settingsCacheTime = now;
    return cachedSettings;
  }

  /**
   * Redis options from the plugin config, or null for in-memory limiting.
   * @returns {object|null}
   */
  function getRedisOptions() {
    const redis = strapi.config?.get?.('plugin::magic-link.rateLimit.redis');
    return redis && redis.storeClient ? redis : null;
  }

  /**
   * Creates one limiter: Redis with an in-memory insurance limiter when
   * configured, otherwise in-memory.
   * @param {object} options - rate-limiter-flexible options.
   * @returns {object} Limiter.
   */
  function createLimiter(options) {
    const redis = getRedisOptions();
    if (!redis) return new RateLimiterMemory(options);
    return new RateLimiterRedis({
      ...options,
      storeClient: redis.storeClient,
      ...(redis.useRedisPackage ? { useRedisPackage: true } : {}),
      rejectIfRedisNotReady: true,
      insuranceLimiter: new RateLimiterMemory(options),
    });
  }

  /**
   * Creates the limiters for the current settings.
   * @param {object} s - Settings object from getSettings()
   * @returns {object} Map of limiter instances keyed by purpose
   */
  function buildLimiters(s) {
    const window = s.windowMinutes * 60;
    return {
      ip: createLimiter({ keyPrefix: 'ml_ip', points: s.maxAttempts, duration: window }),
      email: createLimiter({ keyPrefix: 'ml_email', points: s.maxAttempts, duration: window }),
      otp: createLimiter({ keyPrefix: 'ml_otp', points: s.maxAttempts, duration: window }),
      login: createLimiter({
        keyPrefix: 'ml_login',
        points: s.loginMaxAttempts,
        duration: s.loginWindowMinutes * 60,
        blockDuration: s.loginBlockMinutes * 60,
      }),
      admin: createLimiter({
        keyPrefix: 'ml_admin',
        points: ADMIN_POINTS,
        duration: ADMIN_WINDOW_SECONDS,
      }),
      verify: createLimiter({
        keyPrefix: 'ml_verify',
        points: VERIFY_POINTS,
        duration: VERIFY_WINDOW_SECONDS,
        blockDuration: VERIFY_BLOCK_SECONDS,
      }),
    };
  }

  const signatureOf = (s) =>
    [
      s.maxAttempts,
      s.windowMinutes,
      s.loginMaxAttempts,
      s.loginWindowMinutes,
      s.loginBlockMinutes,
    ].join('|');

  /**
   * Returns the current limiters, building them on first use or when the
   * limit values changed.
   * @returns {Promise<object>} Limiter instances
   */
  async function getLimiters() {
    const s = await getSettings();
    const signature = signatureOf(s);
    if (!limiters || signature !== limiterSignature) {
      limiters = buildLimiters(s);
      limiterSignature = signature;
    }
    return limiters;
  }

  return {
    /**
     * Checks and consumes one point (fail-closed).
     * @param {string} identifier - IP address, e-mail hash, or other key
     * @param {string} type - 'ip', 'email', 'otp', 'login', 'admin' or 'verify'
     * @returns {Promise<{allowed: boolean, retryAfter: number}>}
     */
    async checkRateLimit(identifier, type = 'ip') {
      let s;
      try {
        s = await getSettings();
      } catch {
        stats.errors += 1;
        strapi.log.error('[magic-link] Rate-limit settings unavailable (fail-closed)');
        return { allowed: false, retryAfter: 60 };
      }
      // Admin and code-verification limits stay on when public limits are off.
      if (!s.enabled && !ALWAYS_ON_TYPES.has(type)) {
        return { allowed: true, retryAfter: 0 };
      }

      const limiterType = LIMITER_TYPES.includes(type) ? type : 'ip';
      try {
        const lims = await getLimiters();
        await lims[limiterType].consume(normalizeLimiterIdentifier(identifier));
        return { allowed: true, retryAfter: 0 };
      } catch (rlRejected) {
        if (rlRejected instanceof Error) {
          stats.errors += 1;
          strapi.log.error('[magic-link] Rate limiter internal error (fail-closed)');
          return { allowed: false, retryAfter: 60 };
        }
        stats.blocked[limiterType] += 1;
        const retryAfter = Math.ceil(rlRejected.msBeforeNext / 1000) || 1;
        strapi.log.warn(
          `[magic-link] Rate limit reached for ${limiterType} requests (retry in ${retryAfter}s)`
        );
        return { allowed: false, retryAfter };
      }
    },

    /**
     * Expired keys are removed by the limiter itself (memory: per-key timers,
     * Redis: key TTL), so there is nothing to clean manually.
     * @returns {Promise<{cleaned: number}>}
     */
    async cleanupExpired() {
      return { cleaned: 0 };
    },

    /** Clears active counters while retaining the currently loaded policy. */
    async resetAll() {
      limiters = null;
      limiterSignature = '';
      await getLimiters();
      Object.keys(stats.blocked).forEach((type) => {
        stats.blocked[type] = 0;
      });
      stats.errors = 0;
      stats.since = new Date().toISOString();
      strapi.log.info('[magic-link] Rate-limit counters reset');
      return { reset: true };
    },

    /**
     * Re-reads the settings after a save. Counters are kept unless the limit
     * values changed (a different window or point budget needs new limiters).
     */
    async reloadSettings() {
      cachedSettings = null;
      settingsCacheTime = 0;
      await getLimiters();
    },

    /**
     * Current limits and rejection counters since the last reset or restart.
     * @returns {Promise<object>} Stats overview
     */
    async getStats() {
      const s = await getSettings();
      const blockedTotal = Object.values(stats.blocked).reduce((sum, value) => sum + value, 0);
      return {
        enabled: s.enabled,
        maxAttempts: s.maxAttempts,
        windowMinutes: s.windowMinutes,
        loginMaxAttempts: s.loginMaxAttempts,
        loginWindowMinutes: s.loginWindowMinutes,
        loginBlockMinutes: s.loginBlockMinutes,
        blocked: blockedTotal,
        blockedByType: { ...stats.blocked },
        errors: stats.errors,
        since: stats.since,
        // 5.x field names, now filled with rejection counts.
        totalEntries: blockedTotal,
        ipLimits: stats.blocked.ip,
        emailLimits: stats.blocked.email,
        backend: getRedisOptions()
          ? 'redis (rate-limiter-flexible)'
          : 'in-memory (rate-limiter-flexible)',
      };
    },
  };
};

module.exports.normalizeLimiterIdentifier = normalizeLimiterIdentifier;
module.exports.VERIFY_LIMIT = Object.freeze({
  points: VERIFY_POINTS,
  windowSeconds: VERIFY_WINDOW_SECONDS,
  blockSeconds: VERIFY_BLOCK_SECONDS,
});
