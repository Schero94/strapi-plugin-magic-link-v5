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
const { updateJwtSessions } = require('./utils/jwt-session-store');
const {
  RBAC_ACTIONS,
  migrateLegacyAccessPermission,
  runEvery,
  runLater,
  warnOnUnsafeProxyConfig,
} = require('./utils/lifecycle');

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

  const pluginStore = strapi.store({
    type: 'plugin',
    name: 'magic-link',
  });
  let settings = await pluginStore.get({ key: 'settings' });

  if (!settings) {
    const value = createDefaultSettings();

    await pluginStore.set({ key: 'settings', value });
  } else {
    const migration = migrateSettings(settings, {
      serverUrl: strapi.config.get('server.url', ''),
      clampTokenLength,
    });
    const next = migration.settings;
    if (next.store_login_info === undefined) next.store_login_info = true;
    if (migration.changed || settings.store_login_info === undefined) {
      await pluginStore.set({ key: 'settings', value: next });
      if (migration.removedKeys > 0) {
        strapi.log.info(`[magic-link] Removed ${migration.removedKeys} obsolete WhatsApp/SMS setting(s)`);
      }
    }
  }

  // Authenticator enrolments from before 6.0.0: namespace them by principal
  // (users-permissions vs admin), fail closed where ownership is not
  // provable, store per-enrolment TOTP parameters and finish a key rotation.
  // Unmigrated rows have no principal key and are never used for a login.
  try {
    const totpStats = await strapi.plugin('magic-link').service('otp').migrateTotpConfigs();
    if (totpStats.assigned || totpStats.disabled || totpStats.reencrypted) {
      strapi.log.info(
        `[magic-link] TOTP migration: ${totpStats.assigned} assigned, ${totpStats.disabled} disabled, ` +
          `${totpStats.reencrypted} re-encrypted`
      );
    }
  } catch {
    strapi.log.error('[magic-link] TOTP enrolment migration failed; unmigrated enrolments stay inactive');
  }

  // Admin RBAC (6.0.0): read, manage, tokens.issue, settings.read/update.
  // Roles that held the 5.x `access` action get read + manage.
  await strapi.admin.services.permission.actionProvider.registerMany([...RBAC_ACTIONS]);
  try {
    const { roles } = await migrateLegacyAccessPermission(strapi);
    if (roles > 0) {
      strapi.log.info(`[magic-link] Migrated the 5.x "access" permission to read + manage for ${roles} role(s)`);
    }
  } catch {
    strapi.log.error('[magic-link] Admin permission migration failed; grant Magic Link Read/Manage to roles manually');
  }

  warnOnUnsafeProxyConfig(strapi);

  // Older releases stored plaintext JWTs in the session audit list; keep
  // only their hashes and drop records past the retention period.
  try {
    await updateJwtSessions(strapi, (sessions) => sessions);
  } catch {
    strapi.log.error('[magic-link] JWT session list could not be cleaned');
  }

  // Reject revoked users-permissions JWTs (see middlewares/jwt-revocation.js).
  strapi.server.use(createJwtRevocationMiddleware({ strapi }));

  // /api/passwordless/* compatibility rewrite. Registered here (not in
  // register()) so it runs after Strapi's errors/security/CORS middlewares.
  strapi.server.use(passwordlessCompat({}, { strapi }));

  // Background jobs. Every timer is tracked and cleared in destroy(), and a
  // failing job is logged instead of becoming an unhandled rejection.
  const plugin = () => strapi.plugin('magic-link');

  // Login tokens stored without salt by very old releases can no longer be
  // used; deactivate them once so they do not linger as active rows.
  runLater(
    strapi,
    4000,
    async () => {
      const count = await plugin().service('magic-link').deactivateLegacyTokens();
      if (count > 0) strapi.log.info(`[magic-link] Deactivated ${count} legacy unhashed login token(s)`);
    },
    () => strapi.log.debug('[magic-link] Legacy token cleanup skipped')
  );

  runLater(
    strapi,
    10000,
    () => plugin().service('otp').cleanupExpiredCodes(),
    () => strapi.log.debug('[magic-link] OTP cleanup skipped')
  );

  // Every 5 minutes: expired OTP codes, expired JWT revocation entries and
  // login tokens that expired more than 30 days ago.
  runEvery(
    strapi,
    5 * 60 * 1000,
    async () => {
      await plugin().service('otp').cleanupExpiredCodes();
      const magicLinkService = plugin().service('magic-link');
      await magicLinkService.getBlockedJwtTokens();
      await magicLinkService.cleanupExpiredTokens();
    },
    () => strapi.log.debug('[magic-link] Periodic cleanup skipped')
  );

  // Users created by releases before 4.x carry the provider 'magic-link';
  // switch them to 'local' so password login keeps working for them.
  runLater(
    strapi,
    5000,
    async () => {
      const updated = await strapi.db.query('plugin::users-permissions.user').updateMany({
        where: { provider: 'magic-link' },
        data: { provider: 'local' },
      });
      if (updated?.count > 0) {
        strapi.log.info(`[magic-link] Migrated ${updated.count} user(s) from provider "magic-link" to "local"`);
      }
    },
    () => strapi.log.error('[magic-link] Provider migration failed')
  );
};
