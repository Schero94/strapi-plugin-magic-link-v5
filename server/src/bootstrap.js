'use strict';

/**
 * An asynchronous bootstrap function that runs before
 * your application gets started.
 *
 * This gives you an opportunity to set up your data model,
 * run jobs, or perform some special logic.
 */

// Top-level import so pack-up inlines this into the bundle.
//
// This used to live inside the bootstrap function below, but pack-up
// only inlines requires declared at module top-level — a dynamic
// require() inside a function is preserved as-is in dist/server/index.js
// and then fails at runtime because relative paths resolve from
// dist/server/ not from server/src/.
//
// The previous path was `../utils/crypto` which was always wrong even in
// source mode (from server/src/bootstrap.js that resolves to
// server/utils/crypto, which does not exist — the file lives at
// server/src/utils/crypto.js). The correct relative path is
// `./utils/crypto`.
const cryptoUtilsSelfTest = require('./utils/crypto');
const { createJwtRevocationMiddleware } = require('./middlewares/jwt-revocation');
const passwordlessCompat = require('./middlewares/passwordless-compat');
const { migrateSettings } = require('./utils/settings-migration');
const { clampTokenLength } = require('./services/magic-link');
const { createDefaultSettings } = require('./utils/default-settings');
const {
  migrateLegacySessions,
  migrateLegacySessionsIfPresent,
  pruneSessions,
} = require('./utils/jwt-session-store');
const { runExclusiveJob, updateStoreKey, withClusterLock } = require('./utils/cluster');
const { dedupeStoreKeys } = require('./utils/store-dedupe');
const { removeLegacyRegistrationKeys } = require('./utils/legacy-cleanup');
const {
  RBAC_ACTIONS,
  migrateLegacyAccessPermission,
  runEvery,
  runLater,
  trackCleanup,
  warnOnUnsafeProxyConfig,
} = require('./utils/lifecycle');

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
// Shorter than the interval, so the next round can be taken by any process.
const CLEANUP_LEASE_MS = 4 * 60 * 1000;
// One-off startup jobs: one process per rolling deploy is enough.
const STARTUP_LEASE_MS = 10 * 60 * 1000;

module.exports = async ({ strapi }) => {
  // Fail fast on missing or weak secrets (MAGIC_LINK_ENCRYPTION_KEY,
  // MAGIC_LINK_OTP_PEPPER, both >= 32 characters). Only an explicit
  // MAGIC_LINK_ALLOW_DEV_SECRETS=true outside production skips this.
  try {
    cryptoUtilsSelfTest.assertSecretsConfigured();
    cryptoUtilsSelfTest.encrypt('self-test');
    cryptoUtilsSelfTest.hashOTP('000000');
  } catch (e) {
    strapi.log.error(`[magic-link] ${e.message}`);
    throw e;
  }

  // Several processes may start at once (Railway replicas, pm2 cluster):
  // every startup step that writes shared state runs under a cluster-wide
  // database lock and re-reads what it changes (utils/cluster.js).
  try {
    const merged = await dedupeStoreKeys(strapi);
    if (merged > 0) {
      strapi.log.warn(`[magic-link] Merged ${merged} duplicate plugin-store row(s)`);
    }
  } catch {
    strapi.log.error('[magic-link] Duplicate plugin-store rows could not be merged');
  }

  await updateStoreKey(strapi, 'settings', (settings) => {
    if (!settings) return { value: createDefaultSettings() };
    const migration = migrateSettings(settings, {
      serverUrl: strapi.config.get('server.url', ''),
      clampTokenLength,
    });
    const next = migration.settings;
    if (next.store_login_info === undefined) next.store_login_info = true;
    if (!(migration.changed || settings.store_login_info === undefined)) return {};
    if (migration.removedKeys > 0) {
      strapi.log.info(
        `[magic-link] Removed ${migration.removedKeys} obsolete WhatsApp/SMS setting(s)`
      );
    }
    return { value: next };
  });

  // 7.0.0 dropped the optional registration key of 6.x: delete the stored
  // key and its timestamp once (idempotent, no outbound call).
  try {
    await removeLegacyRegistrationKeys(strapi);
  } catch {
    strapi.log.error('[magic-link] Unused 6.x plugin-store keys could not be removed');
  }

  // Authenticator enrolments from before 6.0.0: namespace them by principal
  // (users-permissions vs admin), fail closed where ownership is not
  // provable, store per-enrolment TOTP parameters and finish a key rotation.
  // Unmigrated rows have no principal key and are never used for a login.
  try {
    const totpStats = await withClusterLock(strapi, 'migration:totp', () =>
      strapi.plugin('magic-link').service('otp').migrateTotpConfigs()
    );
    if (totpStats.assigned || totpStats.disabled || totpStats.reencrypted) {
      strapi.log.info(
        `[magic-link] TOTP migration: ${totpStats.assigned} assigned, ${totpStats.disabled} disabled, ` +
          `${totpStats.reencrypted} re-encrypted`
      );
    }
  } catch {
    strapi.log.error(
      '[magic-link] TOTP enrolment migration failed; unmigrated enrolments stay inactive'
    );
  }

  // Admin RBAC (6.0.0): read, manage, tokens.issue, settings.read/update.
  // Roles that held the 5.x `access` action get read + manage.
  await strapi.admin.services.permission.actionProvider.registerMany([...RBAC_ACTIONS]);
  try {
    const { roles } = await withClusterLock(strapi, 'migration:rbac', () =>
      migrateLegacyAccessPermission(strapi)
    );
    if (roles > 0) {
      strapi.log.info(
        `[magic-link] Migrated the 5.x "access" permission to read + manage for ${roles} role(s)`
      );
    }
  } catch {
    strapi.log.error(
      '[magic-link] Admin permission migration failed; grant Magic Link Read/Manage to roles manually'
    );
  }

  warnOnUnsafeProxyConfig(strapi);

  // Releases before 6.2 kept the session audit list in one plugin-store
  // value (`jwt_sessions`). Move it into the session table once: under the
  // lock of that key, skipping records that are already rows, replacing
  // plaintext JWTs of very old releases by their hash and dropping records
  // past the retention period; the key is deleted afterwards. New logins
  // insert rows directly and never take this lock.
  try {
    const { migrated, skipped } = await migrateLegacySessions(strapi);
    if (migrated > 0 || skipped > 0) {
      strapi.log.info(
        `[magic-link] Moved ${migrated} JWT session record(s) into the session table (${skipped} already there)`
      );
    }
  } catch {
    strapi.log.error(
      '[magic-link] JWT session records could not be moved into the session table; retrying on next start'
    );
  }

  // Reject revoked users-permissions JWTs (see middlewares/jwt-revocation.js).
  strapi.server.use(createJwtRevocationMiddleware({ strapi }));

  // /api/passwordless/* compatibility rewrite. Registered here (not in
  // register()) so it runs after Strapi's errors/security/CORS middlewares.
  strapi.server.use(passwordlessCompat({}, { strapi }));

  // Bounce/complaint feedback from Magic Mail's signed provider webhooks
  // (no-op without Magic Mail; the own delivery-webhooks route covers that).
  try {
    trackCleanup(
      strapi,
      strapi.plugin('magic-link').service('delivery-feedback').subscribeToMagicMail()
    );
  } catch {
    strapi.log.warn('[magic-link] Magic Mail delivery feedback could not be subscribed');
  }

  // Background jobs. Every timer is tracked and cleared in destroy(), and a
  // failing job is logged instead of becoming an unhandled rejection.
  const plugin = () => strapi.plugin('magic-link');

  // Every job below runs in one process only: the process that wins the
  // job's lease (utils/cluster.js runExclusiveJob). The jobs themselves are
  // idempotent deleteMany/updateMany calls, so a lease that expires while a
  // job still runs is harmless.
  const exclusive = (name, ttlMs, job) => () => runExclusiveJob(strapi, name, ttlMs, job);

  // Login tokens stored without salt by very old releases can no longer be
  // used; deactivate them once so they do not linger as active rows.
  runLater(
    strapi,
    4000,
    exclusive('legacy-token-cleanup', STARTUP_LEASE_MS, async () => {
      const count = await plugin().service('magic-link').deactivateLegacyTokens();
      if (count > 0)
        strapi.log.info(`[magic-link] Deactivated ${count} legacy unhashed login token(s)`);
    }),
    () => strapi.log.debug('[magic-link] Legacy token cleanup skipped')
  );

  // Every 5 minutes: expired OTP codes, expired JWT revocation entries,
  // login tokens that expired more than 30 days ago, JWT session records
  // past their retention period or beyond the size cap (indexed DELETEs) and
  // stale shared rate-limit counters. The lease is shorter
  // than the interval, so each round is done by exactly one process.
  const periodicCleanup = exclusive('periodic-cleanup', CLEANUP_LEASE_MS, async () => {
    await plugin().service('otp').cleanupExpiredCodes();
    const magicLinkService = plugin().service('magic-link');
    await magicLinkService.pruneBlocklist();
    await magicLinkService.cleanupExpiredTokens();
    // Records a previous-release replica wrote after the start-up migration
    // (rolling deploy) or a failed start-up migration.
    try {
      await migrateLegacySessionsIfPresent(strapi);
    } catch {
      strapi.log.warn('[magic-link] Pre-6.2 JWT session records could not be moved yet');
    }
    await pruneSessions(strapi);
    await plugin().service('rate-limiter').cleanupExpired();
  });
  runLater(strapi, 10000, periodicCleanup, () =>
    strapi.log.debug('[magic-link] OTP cleanup skipped')
  );
  runEvery(strapi, CLEANUP_INTERVAL_MS, periodicCleanup, () =>
    strapi.log.debug('[magic-link] Periodic cleanup skipped')
  );

  // Users created by releases before 4.x carry the provider 'magic-link';
  // switch them to 'local' so password login keeps working for them.
  runLater(
    strapi,
    5000,
    exclusive('provider-migration', STARTUP_LEASE_MS, async () => {
      const updated = await strapi.db.query('plugin::users-permissions.user').updateMany({
        where: { provider: 'magic-link' },
        data: { provider: 'local' },
      });
      if (updated?.count > 0) {
        strapi.log.info(
          `[magic-link] Migrated ${updated.count} user(s) from provider "magic-link" to "local"`
        );
      }
    }),
    () => strapi.log.error('[magic-link] Provider migration failed')
  );
};
