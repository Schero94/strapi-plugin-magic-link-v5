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
// way to control whether the plugin menu link and the License / Upgrade
// / WhatsApp settings pages were reachable for the role.
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

module.exports = async ({ strapi }) => {
  // Fail fast on missing production secrets. getEncryptionKey() and
  // getOtpPepper() throw when NODE_ENV=production and their env vars are
  // not set — eager check here turns that into a clear boot-time error
  // instead of a runtime error on the first OTP request.
  try {
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
    // Get server URL in Strapi v5 way
    const serverUrl = strapi.config.get('server.url', 'http://localhost:1337');
    
    const value = {
      enabled: true,
      createUserIfNotExists: true,
      expire_period: 3600,
      confirmationUrl: serverUrl,
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
      message_html: `<p>Hi!</p>
<p>Please click on the link below to login.</p>
<p><%= URL %>?loginToken=<%= CODE %></p>
<p>Thanks.</p>`,
      message_text: `Hi!
Please click on the link below to login.
<%= URL %>?loginToken=<%= CODE %>
Thanks.`,
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
      callback_url: serverUrl,
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
      // SMS Provider Settings — reserved for a future release.
      // The SMS-OTP path in services/otp.js currently only logs the
      // outgoing code; wiring these values into a real provider
      // (Twilio / Vonage) is tracked as future work. The settings are
      // kept so that integrators can pre-fill values without losing
      // them on upgrade.
      sms_provider: null,
      sms_api_key: '',
      sms_api_secret: '',
      sms_from_number: '',
      // TOTP Settings (Advanced Feature)
      totp_issuer: 'Magic Link',
      totp_algorithm: 'SHA1',
      totp_digits: 6,
      totp_period: 30,
      // MFA Settings (Premium/Advanced Feature).
      // mfa_mode is the authoritative switch; mfa_require_totp is a legacy
      // alias that maps to mfa_mode='required' for backwards compat.
      mfa_mode: 'disabled', // 'disabled' | 'optional' | 'required'
      mfa_require_totp: false,
      totp_as_primary_auth: false, // Allow login with Email + TOTP only (Advanced)
      // WhatsApp Settings
      whatsapp_enabled: false,
      whatsapp_debug: false, // Enable verbose WhatsApp logging
      whatsapp_app_name: 'Magic Link', // App name shown in WhatsApp message
      whatsapp_message_template: `*{{appName}} Login*

Klicke auf den Link um dich einzuloggen:

{{link}}

Dieser Link ist {{expiry}} gültig.

_Falls du diesen Link nicht angefordert hast, ignoriere diese Nachricht._`,
      // Frontend URL for Magic Link redirects
      frontend_url: '', // e.g., https://myapp.com - if empty, uses callback_url
      frontend_login_path: '/auth/magic-link', // Path appended to frontend_url for login
    };

    await pluginStore.set({ key: 'settings', value });
  } else if (settings && settings.store_login_info === undefined) {
    // If store_login_info is undefined, set it to true
    settings.store_login_info = true;
    await pluginStore.set({ key: 'settings', value: settings });
  }

  await strapi.admin.services.permission.actionProvider.registerMany(
    magicLinkActions.actions
  );

  // JWT-Blacklist-Middleware hinzufügen
  strapi.server.use(async (ctx, next) => {
    // Nur fortfahren, wenn es eine Authentifizierung gibt
    const token = ctx.request.header.authorization;
    if (token && token.startsWith('Bearer ')) {
      try {
        const jwtToken = token.substring(7);
        
        // Sicherer Service-Zugriff mit Null-Check
        const magicLinkPlugin = strapi.plugin('magic-link');
        if (!magicLinkPlugin || !magicLinkPlugin.service) {
          // Plugin noch nicht vollständig geladen, überspringe Check
          return next();
        }
        
        const magicLink = magicLinkPlugin.service('magic-link');
        if (!magicLink || !magicLink.isJwtTokenBlocked) {
          // Service noch nicht vollständig geladen, überspringe Check
          return next();
        }
        
        // Prüfen, ob der Token gesperrt ist
        const isBlocked = await magicLink.isJwtTokenBlocked(jwtToken);
        
        if (isBlocked) {
          return ctx.unauthorized('This token has been revoked');
        }
      } catch (error) {
        // Bei Fehlern lieber fortfahren als die Anfrage zu blockieren
        console.error('Error checking JWT token blacklist:', error);
      }
    }
    
    return next();
  });

  // Initialize Rate Limiter Cleanup Job
  // Note: strapi is captured as closure from the bootstrap function parameter
  
  // Initial cleanup - wait longer for DB to be ready
  setTimeout(async () => {
    try {
      const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
      await rateLimiter.cleanupExpired();
    } catch (error) {
      // Silently ignore on first cleanup if DB not ready yet
      strapi.log.debug('[CLEANUP] Rate limit cleanup skipped - DB not ready');
    }
  }, 10000);
  
  // Cleanup every 30 minutes - strapi is captured as closure
  setInterval(async () => {
    try {
      const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
      await rateLimiter.cleanupExpired();
    } catch (error) {
      // Silent fail - service handles its own logging
    }
  }, 30 * 60 * 1000);

  // Initialize OTP Cleanup Job
  // Note: strapi is captured as closure from the bootstrap function parameter
  
  // Initial cleanup for OTP codes
  setTimeout(async () => {
    try {
      const otpService = strapi.plugin('magic-link').service('otp');
      await otpService.cleanupExpiredCodes();
    } catch (error) {
      strapi.log.debug('[CLEANUP] OTP cleanup skipped - DB not ready');
    }
  }, 10000);
  
  // Cleanup expired OTP codes every 5 minutes - strapi is captured as closure
  setInterval(async () => {
    try {
      const otpService = strapi.plugin('magic-link').service('otp');
      await otpService.cleanupExpiredCodes();
    } catch (error) {
      // Silent fail - service handles its own logging
    }
  }, 5 * 60 * 1000);

  // Initialize License Guard
  try {
    const licenseGuardService = strapi.plugin('magic-link').service('license-guard');
    
    // Wait a bit for all services to be ready
    setTimeout(async () => {
      const licenseStatus = await licenseGuardService.initialize();
      
      if (!licenseStatus.valid && licenseStatus.demo) {
        strapi.log.warn('╔════════════════════════════════════════════════════════════════╗');
        strapi.log.warn('║  [WARNING] MAGIC LINK PLUGIN RUNNING IN DEMO MODE             ║');
        strapi.log.warn('║                                                                ║');
        strapi.log.warn('║  To activate, create a license via Admin UI:                  ║');
        strapi.log.warn('║  Go to Settings → Magic Link → License                        ║');
        strapi.log.warn('╚════════════════════════════════════════════════════════════════╝');
      } else if (licenseStatus.valid) {
        // Get license key from store if data is not available (grace period)
        const pluginStore = strapi.store({
          type: 'plugin',
          name: 'magic-link',
        });
        const storedKey = await pluginStore.get({ key: 'licenseKey' });
        
        strapi.log.info('╔════════════════════════════════════════════════════════════════╗');
        strapi.log.info('║  [SUCCESS] MAGIC LINK PLUGIN LICENSE ACTIVE                    ║');
        strapi.log.info('║                                                                ║');
        
        if (licenseStatus.data) {
          // Full license data available (online validation)
          strapi.log.info(`║  License: ${licenseStatus.data.licenseKey}                    ║`);
          strapi.log.info(`║  User: ${licenseStatus.data.firstName} ${licenseStatus.data.lastName}`.padEnd(66) + '║');
          strapi.log.info(`║  Email: ${licenseStatus.data.email}`.padEnd(66) + '║');
        } else if (storedKey) {
          // Grace period / offline mode
          strapi.log.info(`║  License: ${storedKey} (Offline Mode)                         ║`);
          strapi.log.info(`║  Status: Grace Period Active                                  ║`);
        }
        
        strapi.log.info('║                                                                ║');
        strapi.log.info('║  [AUTO] Pinging every 15 minutes                               ║');
        strapi.log.info('╚════════════════════════════════════════════════════════════════╝');
      }
    }, 3000); // Wait 3 seconds for API to be ready
  } catch (error) {
    strapi.log.error('[ERROR] Error initializing License Guard:', error);
  }

  // [AUTO-MIGRATION] Update old 'magic-link' provider to 'local'
  // This ensures users can login with both Magic-Link AND Email/Password
  try {
    setTimeout(async () => {
      // Using Document Service API
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
      } else {
        strapi.log.info('[INFO] Migration skipped: All users already using provider "local"');
      }
    }, 5000); // Wait 5 seconds to ensure DB is ready
  } catch (error) {
    strapi.log.error('[ERROR] Migration failed:', error);
  }
};
