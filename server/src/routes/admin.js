'use strict';

/**
 * Admin API routes for magic-link.
 *
 * SECURITY MODEL
 * --------------
 * Every admin route is gated by the two-step policy chain returned from
 * `adminPolicy()`:
 *
 *   1. `admin::isAuthenticatedAdmin`
 *        Requires a valid admin JWT (blocks anonymous callers and
 *        end-user Content-API tokens).
 *
 *   2. `admin::hasPermissions` with `plugin::magic-link.access`
 *        Requires the caller to actually hold the plugin-access
 *        permission. Super-Admin has it by default; other admin roles
 *        only get it if a Super-Admin explicitly grants it via
 *        Settings → Administration Panel → Roles → Plugins → Magic Link.
 *
 * Before this pattern the admin routes were registered with an empty
 * policies array, which meant anonymous users could hit them — a
 * critical info-disclosure and data-mutation hole.
 */

const PLUGIN_ACCESS_ACTION = 'plugin::magic-link.access';

/**
 * Fresh array per call because Strapi mutates policy arrays during boot
 * and sharing one instance across routes would leak config between them.
 *
 * @returns {Array<string|object>}
 */
const adminPolicy = () => [
  'admin::isAuthenticatedAdmin',
  {
    name: 'admin::hasPermissions',
    config: { actions: [PLUGIN_ACCESS_ACTION] },
  },
];

module.exports = {
  type: 'admin',
  routes: [
    // ─────────────────────── Settings ───────────────────────
    {
      method: 'GET',
      path: '/settings',
      handler: 'controller.getSettings',
      config: { policies: adminPolicy() },
    },
    {
      method: 'PUT',
      path: '/settings',
      handler: 'controller.updateSettings',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/reset-data',
      handler: 'controller.resetData',
      config: { policies: adminPolicy() },
    },

    // ─────────────────────── Token Management ───────────────────────
    {
      method: 'GET',
      path: '/tokens',
      handler: 'tokens.find',
      config: { policies: adminPolicy() },
    },
    {
      method: 'GET',
      path: '/security-score',
      handler: 'tokens.getSecurityScore',
      config: { policies: adminPolicy() },
    },
    {
      method: 'GET',
      path: '/validate-email',
      handler: 'tokens.validateEmail',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/tokens/:id/block',
      handler: 'tokens.block',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/tokens/:id/activate',
      handler: 'tokens.activate',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/tokens/:id/extend',
      handler: 'tokens.extend',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/tokens/:id/resend',
      handler: 'tokens.resend',
      config: { policies: adminPolicy() },
    },
    {
      method: 'DELETE',
      path: '/tokens/:id',
      handler: 'tokens.delete',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/ban-ip',
      handler: 'tokens.banIP',
      config: { policies: adminPolicy() },
    },
    {
      method: 'GET',
      path: '/banned-ips',
      handler: 'tokens.getBannedIPs',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/unban-ip',
      handler: 'tokens.unbanIP',
      config: { policies: adminPolicy() },
    },
    {
      method: 'GET',
      path: '/user-by-email',
      handler: 'tokens.findUserByEmail',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/tokens',
      handler: 'tokens.create',
      config: { policies: adminPolicy() },
    },

    // ─────────────────────── JWT Session Management ───────────────────────
    {
      method: 'GET',
      path: '/jwt-sessions',
      handler: 'jwt.getSessions',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/revoke-jwt',
      handler: 'jwt.revokeToken',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/unrevoke-jwt',
      handler: 'jwt.unrevokeToken',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/cleanup-sessions',
      handler: 'jwt.cleanupSessions',
      config: { policies: adminPolicy() },
    },

    // ─────────────────────── License Management ───────────────────────
    {
      method: 'GET',
      path: '/license/status',
      handler: 'license.getStatus',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/license/auto-create',
      handler: 'license.autoCreate',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/license/create',
      handler: 'license.createAndActivate',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/license/ping',
      handler: 'license.ping',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/license/store-key',
      handler: 'license.storeKey',
      config: { policies: adminPolicy() },
    },

    // ─────────────────────── Rate Limiting ───────────────────────
    {
      method: 'GET',
      path: '/rate-limit/stats',
      handler: 'rateLimit.getStats',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/rate-limit/cleanup',
      handler: 'rateLimit.cleanup',
      config: { policies: adminPolicy() },
    },
    {
      method: 'GET',
      path: '/rate-limit/cleanup',
      handler: 'rateLimit.cleanup',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/rate-limit/reset',
      handler: 'rateLimit.reset',
      config: { policies: adminPolicy() },
    },
    {
      method: 'GET',
      path: '/rate-limit/reset',
      handler: 'rateLimit.reset',
      config: { policies: adminPolicy() },
    },

    // ─────────────────────── OTP Management ───────────────────────
    {
      method: 'GET',
      path: '/otp/codes',
      handler: 'otp.listCodes',
      config: { policies: adminPolicy() },
    },
    {
      method: 'DELETE',
      path: '/otp/codes/:id',
      handler: 'otp.deleteCode',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/otp/cleanup',
      handler: 'otp.cleanup',
      config: { policies: adminPolicy() },
    },

    // ─────────────────────── TOTP Management (Advanced) ───────────────────────
    {
      method: 'POST',
      path: '/otp/totp/setup',
      handler: 'otp.setupTOTP',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/otp/totp/verify',
      handler: 'otp.verifyTOTP',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/otp/totp/disable',
      handler: 'otp.disableTOTP',
      config: { policies: adminPolicy() },
    },
    {
      method: 'GET',
      path: '/otp/totp/status',
      handler: 'otp.getTOTPStatus',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/otp/totp/backup-codes',
      handler: 'otp.generateBackupCodes',
      config: { policies: adminPolicy() },
    },

    // ─────────────────────── WhatsApp Integration ───────────────────────
    {
      method: 'GET',
      path: '/whatsapp/status',
      handler: 'whatsapp.getStatus',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/whatsapp/connect',
      handler: 'whatsapp.connect',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/whatsapp/disconnect',
      handler: 'whatsapp.disconnect',
      config: { policies: adminPolicy() },
    },
    {
      method: 'GET',
      path: '/whatsapp/qr',
      handler: 'whatsapp.getQRCode',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/whatsapp/check-number',
      handler: 'whatsapp.checkNumber',
      config: { policies: adminPolicy() },
    },
    {
      method: 'POST',
      path: '/whatsapp/test-message',
      handler: 'whatsapp.testMessage',
      config: { policies: adminPolicy() },
    },
  ],
};
