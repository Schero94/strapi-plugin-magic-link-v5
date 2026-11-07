'use strict';

const { isIP } = require('node:net');
const {
  RateLimiterMemory,
  RateLimiterMySQL,
  RateLimiterPostgres,
  RateLimiterRedis,
  RateLimiterSQLite,
} = require('rate-limiter-flexible');
const { ipRateLimitKey } = require('../utils/ip-address');
const { dialectOf, updateStoreKey, withClusterLock } = require('../utils/cluster');

/**
 * Rate Limiter Service (rate-limiter-flexible 11).
 *
 * - Limiters are built lazily from the plugin settings and rebuilt only when
 *   the limit values change, so saving unrelated settings keeps counters.
 *   The always-on `verify` and `admin` limiters are built once per process
 *   and survive rebuilds and the admin reset (security review 2026-11-07).
 * - Client addresses are keyed through `ipRateLimitKey`: IPv4-mapped IPv6 is
 *   folded into IPv4 and IPv6 is keyed per /64, so a client cannot dodge a
 *   limit by rotating addresses inside its own prefix.
 * - Counters live in the Strapi database by default (table
 *   `magic_link_rate_limits`, created once at startup under a cluster lock),
 *   so every process (Railway replicas, pm2 cluster) shares the same
 *   counters and a limit means the same thing with 1 or 8 processes:
 *   RateLimiterPostgres / RateLimiterMySQL / RateLimiterSQLite with
 *   `storeType: 'knex'` on Strapi's own knex connection.
 * - Optional Redis: plugin config `rateLimit: { redis: { storeClient,
 *   useRedisPackage } }`. The database limiter is its insurance limiter, so
 *   a Redis outage keeps the limits shared instead of falling back to
 *   per-process memory.
 * - `rateLimit: { store: 'memory' }` keeps counters in process memory
 *   (single process only; also used when there is no database, e.g. tests).
 * - Admin reset and setting changes reach every process through the
 *   database: the reset bumps a shared epoch that is part of every public
 *   limiter key, and settings are re-read every SETTINGS_CACHE_TTL_MS.
 * - Internal limiter errors fail closed (request refused).
 * - Second-factor code checks (TOTP, backup codes, e-mail OTP) use the
 *   `verify` limiter, which stays on when public rate limiting is disabled,
 *   so turning off send throttling never opens a brute-force path.
 *
 * Docs: github.com/animir/node-rate-limiter-flexible/wiki (Memory, Redis,
 * API-methods: consume rejects with RateLimiterRes or Error).
 */

const LIMITER_TYPES = ['ip', 'email', 'otp', 'login', 'admin', 'verify', 'webhook'];
// Admin-initiated actions (token creation) per admin user and window.
const ADMIN_POINTS = 60;
const ADMIN_WINDOW_SECONDS = 15 * 60;
// Second-factor code checks per account (or per login challenge): 10 tries
// per 15 minutes, then a 15 minute block. Always enforced.
const VERIFY_POINTS = 10;
const VERIFY_WINDOW_SECONDS = 15 * 60;
const VERIFY_BLOCK_SECONDS = 15 * 60;
// Provider delivery webhooks per caller address (all processes together).
const WEBHOOK_POINTS = 600;
const WEBHOOK_WINDOW_SECONDS = 60;
// Longest window for one-time markers (webhook replay protection).
const ONCE_MAX_SECONDS = 2 * 60 * 60;
/** Limiter types that ignore `rate_limit_enabled: false`. */
const ALWAYS_ON_TYPES = new Set(['admin', 'verify', 'webhook']);
/** Shared counter table (created by this plugin, not a Strapi content type). */
const TABLE_NAME = 'magic_link_rate_limits';
const EPOCH_KEY = 'rate_limit_epoch';
// Expired counters older than this are deleted by the leased cleanup job.
const EXPIRED_GRACE_MS = 60 * 60 * 1000;
const SETTINGS_CACHE_TTL_MS = 5_000;

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
  let fixedLimiters = null;
  let limiterSignature = '';
  let cachedSettings = null;
  let settingsCacheTime = 0;
  let localEpoch = 0;
  let tableReady = null;
  const stats = {
    blocked: Object.fromEntries(LIMITER_TYPES.map((type) => [type, 0])),
    errors: 0,
    since: new Date().toISOString(),
  };

  /**
   * Plugin config `rateLimit.store`: 'database' (default) or 'memory'.
   * @returns {'database'|'memory'}
   */
  function configuredStore() {
    const store = strapi.config?.get?.('plugin::magic-link.rateLimit.store');
    return store === 'memory' ? 'memory' : 'database';
  }

  /**
   * Database client used for shared counters, or null for memory.
   * @returns {'postgres'|'mysql'|'sqlite'|null}
   */
  function databaseBackend() {
    if (configuredStore() === 'memory') return null;
    return dialectOf(strapi);
  }

  /**
   * Creates the shared counter table once, under a cluster lock so several
   * starting processes do not race on CREATE TABLE. Columns follow
   * rate-limiter-flexible 11 (lib/RateLimiter{Postgres,MySQL,SQLite}.js):
   * key varchar(255) primary key, points integer, expire bigint (ms).
   * @returns {Promise<void>}
   */
  function ensureTable() {
    if (!tableReady) {
      tableReady = withClusterLock(strapi, 'rate-limit-table', async (trx) => {
        const schema = strapi.db.getSchemaConnection(trx);
        if (await schema.hasTable(TABLE_NAME)) return;
        await schema.createTable(TABLE_NAME, (table) => {
          table.string('key', 255).primary();
          table.integer('points').notNullable().defaultTo(0);
          table.bigInteger('expire').nullable();
        });
      }).catch((error) => {
        tableReady = null;
        throw error;
      });
    }
    return tableReady;
  }

  /**
   * Current reset epoch. Shared through the plugin store when a database is
   * available, so a reset on one process resets the counters of all.
   * @returns {Promise<number>}
   */
  async function readEpoch() {
    if (!dialectOf(strapi)) return localEpoch;
    const value = Number(
      await strapi.store({ type: 'plugin', name: 'magic-link' }).get({ key: EPOCH_KEY })
    );
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }

  /**
   * Loads rate-limit settings from the plugin store (cached for 5 s, so a
   * change made on another process applies within 5 s).
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
      epoch: await readEpoch(),
    };
    settingsCacheTime = now;
    return cachedSettings;
  }

  /**
   * Redis options from the plugin config, or null.
   * @returns {object|null}
   */
  function getRedisOptions() {
    const redis = strapi.config?.get?.('plugin::magic-link.rateLimit.redis');
    return redis && redis.storeClient ? redis : null;
  }

  /**
   * Database limiter on Strapi's knex connection, or null without a
   * database. Expired rows are removed by `cleanupExpired` (leased job), not
   * by per-limiter timers.
   * @param {object} options - rate-limiter-flexible options.
   * @returns {object|null} Limiter.
   */
  function createDatabaseLimiter(options) {
    const backend = databaseBackend();
    if (!backend) return null;
    const common = {
      ...options,
      storeClient: strapi.db.connection,
      storeType: 'knex',
      tableName: TABLE_NAME,
      tableCreated: true,
      clearExpiredByTimeout: false,
    };
    if (backend === 'postgres') {
      const schemaName = strapi.db.getSchemaName?.();
      return new RateLimiterPostgres({ ...common, ...(schemaName ? { schemaName } : {}) });
    }
    if (backend === 'mysql') {
      return new RateLimiterMySQL({
        ...common,
        dbName: strapi.db.connection.client.connectionSettings.database,
      });
    }
    return new RateLimiterSQLite(common);
  }

  /**
   * Creates one limiter: Redis (database or memory insurance) when
   * configured, else the shared database limiter, else memory.
   * @param {object} options - rate-limiter-flexible options.
   * @returns {object} Limiter.
   */
  function createLimiter(options) {
    const redis = getRedisOptions();
    const database = createDatabaseLimiter(options);
    if (!redis) return database || new RateLimiterMemory(options);
    return new RateLimiterRedis({
      ...options,
      storeClient: redis.storeClient,
      ...(redis.useRedisPackage ? { useRedisPackage: true } : {}),
      rejectIfRedisNotReady: true,
      insuranceLimiter: database || new RateLimiterMemory(options),
    });
  }

  /**
   * Creates the always-on limiters (admin actions, second-factor code
   * checks, webhook callers, one-time markers). Their limits are fixed and
   * do not depend on the settings or the reset epoch.
   * @returns {object} Map of limiter instances keyed by purpose
   */
  function buildFixedLimiters() {
    return {
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
      webhook: createLimiter({
        keyPrefix: 'ml_webhook',
        points: WEBHOOK_POINTS,
        duration: WEBHOOK_WINDOW_SECONDS,
      }),
      once: createLimiter({ keyPrefix: 'ml_once', points: 1, duration: ONCE_MAX_SECONDS }),
    };
  }

  /**
   * Creates the limiters for the current settings. The always-on limiters
   * are created once per process and reused, so neither a settings change
   * nor an admin "reset" clears the brute-force counters for code checks.
   * Public key prefixes carry the reset epoch.
   * @param {object} s - Settings object from getSettings()
   * @returns {object} Map of limiter instances keyed by purpose
   */
  function buildLimiters(s) {
    const window = s.windowMinutes * 60;
    if (!fixedLimiters) fixedLimiters = buildFixedLimiters();
    const prefix = (name) => (s.epoch > 0 ? `ml_${name}_e${s.epoch}` : `ml_${name}`);
    return {
      ip: createLimiter({ keyPrefix: prefix('ip'), points: s.maxAttempts, duration: window }),
      email: createLimiter({ keyPrefix: prefix('email'), points: s.maxAttempts, duration: window }),
      otp: createLimiter({ keyPrefix: prefix('otp'), points: s.maxAttempts, duration: window }),
      login: createLimiter({
        keyPrefix: prefix('login'),
        points: s.loginMaxAttempts,
        duration: s.loginWindowMinutes * 60,
        blockDuration: s.loginBlockMinutes * 60,
      }),
      ...fixedLimiters,
    };
  }

  const signatureOf = (s) =>
    [
      s.maxAttempts,
      s.windowMinutes,
      s.loginMaxAttempts,
      s.loginWindowMinutes,
      s.loginBlockMinutes,
      s.epoch,
    ].join('|');

  /**
   * Returns the current limiters, building them on first use or when the
   * limit values or the reset epoch changed.
   * @returns {Promise<object>} Limiter instances
   */
  async function getLimiters() {
    const s = await getSettings();
    if (databaseBackend()) await ensureTable();
    const signature = signatureOf(s);
    if (!limiters || signature !== limiterSignature) {
      limiters = buildLimiters(s);
      limiterSignature = signature;
    }
    return limiters;
  }

  /**
   * Human-readable backend for the admin statistics.
   * @returns {string}
   */
  function backendLabel() {
    const database = databaseBackend();
    if (getRedisOptions()) {
      return database
        ? `redis, ${database} insurance (rate-limiter-flexible)`
        : 'redis (rate-limiter-flexible)';
    }
    return database
      ? `database: ${database}, shared by all processes (rate-limiter-flexible)`
      : 'in-memory (rate-limiter-flexible)';
  }

  return {
    /**
     * Checks and consumes one point (fail-closed).
     * @param {string} identifier - IP address, e-mail hash, or other key
     * @param {string} type - 'ip', 'email', 'otp', 'login', 'admin', 'verify' or 'webhook'
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
     * Records `key` once: true the first time, false while the marker lives
     * (`ttlSeconds`, at most two hours). Shared by all processes through the
     * limiter store, so a replayed webhook is skipped on every process.
     * Store errors return true (feedback is idempotent; nothing is lost).
     * @param {string} key - Marker key (no personal data).
     * @returns {Promise<boolean>} Whether this is the first sighting.
     */
    async markOnce(key) {
      try {
        const lims = await getLimiters();
        await lims.once.consume(String(key).slice(0, 200));
        return true;
      } catch (rlRejected) {
        if (rlRejected instanceof Error) {
          stats.errors += 1;
          strapi.log.warn('[magic-link] Replay marker store unavailable');
          return true;
        }
        return false;
      }
    },

    /**
     * Deletes counters that expired more than an hour ago from the shared
     * table. Memory and Redis expire keys on their own. Idempotent, safe to
     * run in several processes; the bootstrap runs it from one (lease).
     * @returns {Promise<{cleaned: number}>}
     */
    async cleanupExpired() {
      if (!databaseBackend()) return { cleaned: 0 };
      try {
        await ensureTable();
        const cleaned = await strapi.db
          .getConnection(TABLE_NAME)
          .where('expire', '<', Date.now() - EXPIRED_GRACE_MS)
          .del();
        return { cleaned: Number(cleaned) || 0 };
      } catch {
        strapi.log.debug('[magic-link] Rate-limit cleanup skipped');
        return { cleaned: 0 };
      }
    },

    /**
     * Clears the public (settings-driven) counters on every process while
     * retaining the currently loaded policy: the shared reset epoch is part
     * of every public key, so bumping it starts fresh counters everywhere
     * (other processes within SETTINGS_CACHE_TTL_MS). The always-on `verify`
     * and `admin` counters are kept: an admin reset must never reopen code
     * guessing.
     */
    async resetAll() {
      if (dialectOf(strapi)) {
        await updateStoreKey(strapi, EPOCH_KEY, (current) => {
          const value = Number(current);
          return { value: (Number.isSafeInteger(value) && value > 0 ? value : 0) + 1 };
        });
      } else {
        localEpoch += 1;
      }
      cachedSettings = null;
      settingsCacheTime = 0;
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
        backend: backendLabel(),
        // Rejection counters are kept per process; with several processes
        // they show the share of the process that answered this request.
        statsScope: 'process',
      };
    },
  };
};

module.exports.normalizeLimiterIdentifier = normalizeLimiterIdentifier;
module.exports.RATE_LIMIT_TABLE = TABLE_NAME;
module.exports.VERIFY_LIMIT = Object.freeze({
  points: VERIFY_POINTS,
  windowSeconds: VERIFY_WINDOW_SECONDS,
  blockSeconds: VERIFY_BLOCK_SECONDS,
});
