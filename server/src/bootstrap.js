'use strict';

/**
 * An asynchronous bootstrap function that runs before
 * your application gets started.
 *
 * This gives you an opportunity to set up your data model,
 * run jobs, or perform some special logic.
 */

// IMPORTANT: every action needs `subCategory` set, otherwise Strapi 5's
// role editor simply does not render its checkbox. Before adding the
// explicit 'General' subCategory here, the `plugin::magic-link.access`
// permission was invisible in Settings → Roles → Plugins → Magic Link,
// so an admin could neither grant it to nor revoke it from a role —
// they only saw the two Settings checkboxes (Read / Edit) and had no
// way to control whether the plugin menu link and License page were
// reachable for the role.
const magicLinkActions = {
  actions: [
    {
      section: 'plugins',
      displayName: 'Access the Magic Link plugin',
      uid: 'access',
      subCategory: 'General',
      pluginName: 'magic-link',
    },
    {
      section: 'plugins',
      displayName: 'Read',
      uid: 'settings.read',
      subCategory: 'Settings',
      pluginName: 'magic-link',
    },
    {
      section: 'plugins',
      displayName: 'Edit',
      uid: 'settings.update',
      subCategory: 'Settings',
      pluginName: 'magic-link',
    },
  ],
};

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
    const value = {
      enabled: true,
      createUserIfNotExists: true,
      expire_period: 3600,
      // Empty = API login URL (<server.url><api prefix>/magic-link/login).
      // Set frontend_url + frontend_login_path for a frontend landing page.
      confirmationUrl: '',
      from_name: 'Administration Panel',
      from_email: '', // Empty by default - will use Strapi email config
      response_email: '',
      token_length: 32,
      stays_valid: false,
      store_login_info: true,
      // Context Field Control
      context_whitelist: [], // If set, only these fields are allowed in context (e.g., ['redirectTo', 'role'])
      context_blacklist: ['password', 'secret', 'apiKey', 'token'], // These fields are always removed from context
      object: 'Magic Link Login',
      // Placeholders: {{LOGIN_URL}}, {{URL}}, {{CODE}}, {{EXPIRY_TEXT}},
      // {{EXPIRES_AT}}, {{EMAIL}}, {{USER}} (values are HTML-escaped).
      message_html: `<p>Hi!</p>
<p><a href="{{LOGIN_URL}}">Click here to log in</a>.</p>
<p>This link expires in {{EXPIRY_TEXT}}.</p>`,
      message_text: `Hi!
Use this link to log in: {{LOGIN_URL}}
This link expires in {{EXPIRY_TEXT}}.`,
      // Additional settings from passwordless-plugin
      // NOTE: `max_login_attempts` is superseded by the rate_limit_* group.
      // It remains in the UI for backwards compatibility but has no effect;
      // brute-force protection is exclusively handled by rate_limit_enabled
      // + rate_limit_max_attempts + rate_limit_window_minutes.
      login_path: '/magic-link/login',
      user_creation_strategy: 'email',
      verify_email: false,
      welcome_email: false,
      use_jwt_token: true,
      jwt_token_expires_in: '30d',
      // Legacy. Use confirmationUrl (backend redirect target) and
      // frontend_url + frontend_login_path (SPA deep-link target) instead.
      // Kept for schema stability; the backend never reads it.
      callback_url: '',
      allow_magic_links_on_public_registration: false,
      // Rate Limiting Settings
      rate_limit_enabled: true,
      rate_limit_max_attempts: 5,
      rate_limit_window_minutes: 15,
      // OTP Settings (Premium Feature)
      otp_enabled: false,
      otp_type: 'email',
      otp_length: 6,
      otp_expiry: 300,
      otp_max_attempts: 3,
      otp_resend_cooldown: 60,
      // When true (recommended, default), every /otp/send and /otp/verify
      // call MUST carry a valid magicLinkToken that originated the challenge.
      // Set to false only for legacy integrations that expose OTP as a
      // standalone flow. Disabling this weakens authentication significantly.
      otp_strict_binding: true,
      // TOTP Settings (Advanced Feature)
      totp_issuer: 'Magic Link',
      totp_algorithm: 'SHA1',
      totp_digits: 6,
      totp_period: 30,
      // MFA Settings (Premium/Advanced Feature).
      // mfa_mode is canonical. A true legacy flag still forces required mode
      // when older Settings UI data left mfa_mode set to disabled.
      mfa_mode: 'disabled', // 'disabled' | 'optional' | 'required'
      mfa_require_totp: false,
      totp_as_primary_auth: false, // Allow login with Email + TOTP only (Advanced)
      // Frontend URL for Magic Link redirects
      frontend_url: '', // e.g., https://myapp.com - if empty, uses callback_url
      frontend_login_path: '/auth/magic-link', // Path appended to frontend_url for login
    };

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

  await strapi.admin.services.permission.actionProvider.registerMany(
    magicLinkActions.actions
  );

  // Reject revoked users-permissions JWTs (see middlewares/jwt-revocation.js).
  strapi.server.use(createJwtRevocationMiddleware({ strapi }));

  // /api/passwordless/* compatibility rewrite. Registered here (not in
  // register()) so it runs after Strapi's errors/security/CORS middlewares.
  strapi.server.use(passwordlessCompat({}, { strapi }));

  // Login tokens stored without salt by very old releases can no longer be
  // used; deactivate them once so they do not linger as active rows.
  setTimeout(async () => {
    try {
      const count = await strapi.plugin('magic-link').service('magic-link').deactivateLegacyTokens();
      if (count > 0) strapi.log.info(`[magic-link] Deactivated ${count} legacy unhashed login token(s)`);
    } catch {
      strapi.log.debug('[magic-link] Legacy token cleanup skipped');
    }
  }, 4000);

  // Initialize OTP Cleanup Job
  // Note: strapi is captured as closure from the bootstrap function parameter
  
  // Initial cleanup for OTP codes
  setTimeout(async () => {
    try {
      const otpService = strapi.plugin('magic-link').service('otp');
      await otpService.cleanupExpiredCodes();
    } catch {
      strapi.log.debug('[CLEANUP] OTP cleanup skipped - DB not ready');
    }
  }, 10000);
  
  // Cleanup expired OTP codes every 5 minutes - strapi is captured as closure
  setInterval(async () => {
    try {
      const otpService = strapi.plugin('magic-link').service('otp');
      await otpService.cleanupExpiredCodes();
    } catch {
      // Silent fail - service handles its own logging
    }
    try {
      // Prunes expired JWT revocation entries and long-expired login tokens.
      const magicLinkService = strapi.plugin('magic-link').service('magic-link');
      await magicLinkService.getBlockedJwtTokens();
      await magicLinkService.cleanupExpiredTokens();
    } catch {
      strapi.log.debug('[magic-link] Token cleanup skipped');
    }
  }, 5 * 60 * 1000);

  // License-guard initialization is intentionally a no-op in the
  // marketplace build. The license-key activation flow in the admin UI
  // remains available, but the plugin no longer auto-validates on boot
  // and does NOT start a periodic ping. We still call initialize() so
  // any future hook in the service has a stable entry point.
  try {
    const licenseGuardService = strapi.plugin('magic-link').service('license-guard');
    setTimeout(async () => {
      try {
        await licenseGuardService.initialize();
      } catch (initErr) {
        // Initialization is best-effort — never fatal.
        strapi.log.debug('[magic-link] license-guard initialize() warning:', initErr.message);
      }
    }, 3000);
  } catch (error) {
    strapi.log.debug('[magic-link] license-guard service not available at bootstrap:', error.message);
  }

  // [AUTO-MIGRATION] Update old 'magic-link' provider to 'local'
  // This ensures users can login with both Magic-Link AND Email/Password
  setTimeout(async () => {
    try {
      const usersToUpdate = await strapi.documents('plugin::users-permissions.user').findMany({
        filters: { provider: 'magic-link' },
      });

      if (usersToUpdate && usersToUpdate.length > 0) {
        strapi.log.info('[MIGRATION] Found %d user(s) with old provider "magic-link"', usersToUpdate.length);
        
        // Update all users using Document Service API
        for (const user of usersToUpdate) {
          await strapi.documents('plugin::users-permissions.user').update({
            documentId: user.documentId,
          data: { provider: 'local' },
        });
        }

        strapi.log.info('[SUCCESS] Migration complete: Updated %d user(s) to provider "local"', usersToUpdate.length);
        strapi.log.info('[INFO] Users can now login with both Magic-Link AND Email/Password');
      }
    } catch {
      strapi.log.error('[magic-link] Provider migration failed');
    }
  }, 5000); // Wait 5 seconds to ensure DB is ready
};
