'use strict';

/**
 * Admin API routes for magic-link.
 *
 * SECURITY MODEL (6.0.0)
 * ----------------------
 * Every route requires an authenticated admin (`admin::isAuthenticatedAdmin`)
 * plus one RBAC action checked by `admin::hasPermissions`:
 *
 * | Action                               | Routes                                                     |
 * |--------------------------------------|------------------------------------------------------------|
 * | plugin::magic-link.read              | list tokens, banned IPs, JWT sessions, OTP codes; own TOTP |
 * | plugin::magic-link.manage            | create/block/activate/extend/delete tokens, ban/unban IPs, |
 * |                                      | revoke/restore/clean sessions, delete/clean OTP codes      |
 * | plugin::magic-link.tokens.issue      | checked in tokens.create for `send_email: false`           |
 * |                                      | (the login link is returned to the admin: impersonation)   |
 * | plugin::magic-link.settings.read     | settings, rate-limit stats, license status, MFA summary    |
 * | plugin::magic-link.settings.update   | save/reset settings, rate-limit cleanup/reset, license key |
 * | plugin::magic-link.settings.security | checked in controller.updateSettings/resetData: changing   |
 * |                                      | link targets, templates, account, session or MFA settings  |
 *
 * The admin UI only hides controls; these policies are authoritative.
 */

const ACTIONS = Object.freeze({
  read: 'plugin::magic-link.read',
  manage: 'plugin::magic-link.manage',
  settingsRead: 'plugin::magic-link.settings.read',
  settingsUpdate: 'plugin::magic-link.settings.update',
});

/**
 * Fresh array per call because Strapi mutates policy arrays during boot
 * and sharing one instance across routes would leak config between them.
 *
 * @param {string} action - RBAC action uid.
 * @returns {Array<string|object>} Route policies.
 */
const requires = (action) => [
  'admin::isAuthenticatedAdmin',
  {
    name: 'admin::hasPermissions',
    config: { actions: [action] },
  },
];

const readPolicy = () => requires(ACTIONS.read);
const managePolicy = () => requires(ACTIONS.manage);
const settingsPolicy = (action) => requires(action);
const SETTINGS_READ_ACTION = ACTIONS.settingsRead;
const SETTINGS_UPDATE_ACTION = ACTIONS.settingsUpdate;
// The admin user's own authenticator (TOTP routes below).
const adminPolicy = readPolicy;

module.exports = {
  type: 'admin',
  routes: [
    // ─────────────────────── Settings ───────────────────────
    {
      method: 'GET',
      path: '/settings',
      handler: 'controller.getSettings',
      config: { policies: settingsPolicy(SETTINGS_READ_ACTION) },
    },
    {
      method: 'PUT',
      path: '/settings',
      handler: 'controller.updateSettings',
      config: { policies: settingsPolicy(SETTINGS_UPDATE_ACTION) },
    },
    {
      method: 'POST',
      path: '/reset-data',
      handler: 'controller.resetData',
      config: { policies: settingsPolicy(SETTINGS_UPDATE_ACTION) },
    },

    // ─────────────────────── Token Management ───────────────────────
    {
      method: 'GET',
      path: '/tokens',
      handler: 'tokens.find',
      config: { policies: readPolicy() },
    },
    {
      method: 'POST',
      path: '/tokens',
      handler: 'tokens.create',
      config: { policies: managePolicy() },
    },
    {
      method: 'POST',
      path: '/tokens/:id/block',
      handler: 'tokens.block',
      config: { policies: managePolicy() },
    },
    {
      method: 'POST',
      path: '/tokens/:id/activate',
      handler: 'tokens.activate',
      config: { policies: managePolicy() },
    },
    {
      method: 'POST',
      path: '/tokens/:id/extend',
      handler: 'tokens.extend',
      config: { policies: managePolicy() },
    },
    {
      method: 'DELETE',
      path: '/tokens/:id',
      handler: 'tokens.delete',
      config: { policies: managePolicy() },
    },

    // ─────────────────────── IP Bans ───────────────────────
    {
      method: 'GET',
      path: '/banned-ips',
      handler: 'tokens.getBannedIPs',
      config: { policies: readPolicy() },
    },
    {
      method: 'POST',
      path: '/ban-ip',
      handler: 'tokens.banIP',
      config: { policies: managePolicy() },
    },
    {
      method: 'POST',
      path: '/unban-ip',
      handler: 'tokens.unbanIP',
      config: { policies: managePolicy() },
    },

    // ─────────────────────── JWT Session Management ───────────────────────
    {
      method: 'GET',
      path: '/jwt-sessions',
      handler: 'jwt.getSessions',
      config: { policies: readPolicy() },
    },
    {
      method: 'POST',
      path: '/revoke-jwt',
      handler: 'jwt.revokeToken',
      config: { policies: managePolicy() },
    },
    {
      method: 'POST',
      path: '/unrevoke-jwt',
      handler: 'jwt.unrevokeToken',
      config: { policies: managePolicy() },
    },
    {
      method: 'POST',
      path: '/cleanup-sessions',
      handler: 'jwt.cleanupSessions',
      config: { policies: managePolicy() },
    },

    // ─────────────────────── License ───────────────────────
    {
      method: 'GET',
      path: '/license/status',
      handler: 'license.getStatus',
      config: { policies: settingsPolicy(SETTINGS_READ_ACTION) },
    },
    {
      method: 'POST',
      path: '/license/store-key',
      handler: 'license.storeKey',
      config: { policies: settingsPolicy(SETTINGS_UPDATE_ACTION) },
    },

    // ─────────────────────── Rate Limiting ───────────────────────
    {
      method: 'GET',
      path: '/rate-limit/stats',
      handler: 'rateLimit.getStats',
      config: { policies: settingsPolicy(SETTINGS_READ_ACTION) },
    },
    {
      method: 'POST',
      path: '/rate-limit/cleanup',
      handler: 'rateLimit.cleanup',
      config: { policies: settingsPolicy(SETTINGS_UPDATE_ACTION) },
    },
    {
      method: 'POST',
      path: '/rate-limit/reset',
      handler: 'rateLimit.reset',
      config: { policies: settingsPolicy(SETTINGS_UPDATE_ACTION) },
    },

    // ─────────────────────── OTP Management ───────────────────────
    {
      method: 'GET',
      path: '/otp/codes',
      handler: 'otp.listCodes',
      config: { policies: readPolicy() },
    },
    {
      method: 'DELETE',
      path: '/otp/codes/:id',
      handler: 'otp.deleteCode',
      config: { policies: managePolicy() },
    },
    {
      method: 'POST',
      path: '/otp/cleanup',
      handler: 'otp.cleanup',
      config: { policies: managePolicy() },
    },

    // ─────────────────────── TOTP ───────────────────────
    // Number of end users with an authenticator (Settings > MFA).
    {
      method: 'GET',
      path: '/totp/enrollment-summary',
      handler: 'otp.enrollmentSummary',
      config: { policies: settingsPolicy(SETTINGS_READ_ACTION) },
    },
    // The admin user's OWN authenticator. Enrolments are namespaced to the
    // admin principal (`admin:<id>`) and never act as an end user's second
    // factor. Re-setup, disable and new backup codes need a current code.
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
  ],
};
