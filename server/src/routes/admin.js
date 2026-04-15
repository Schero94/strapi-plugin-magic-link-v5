'use strict';

/**
 * Admin routes
 */

module.exports = {
  type: 'admin',
  routes: [
    // Settings
    {
      method: 'GET',
      path: '/settings',
      handler: 'controller.getSettings',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'PUT',
      path: '/settings',
      handler: 'controller.updateSettings',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/reset-data',
      handler: 'controller.resetData',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    
    // Token Management
    {
      method: 'GET',
      path: '/tokens',
      handler: 'tokens.find',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'GET',
      path: '/security-score',
      handler: 'tokens.getSecurityScore',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'GET',
      path: '/validate-email',
      handler: 'tokens.validateEmail',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/tokens/:id/block',
      handler: 'tokens.block',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/tokens/:id/activate',
      handler: 'tokens.activate',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/tokens/:id/extend',
      handler: 'tokens.extend',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/tokens/:id/resend',
      handler: 'tokens.resend',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'DELETE',
      path: '/tokens/:id',
      handler: 'tokens.delete',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/ban-ip',
      handler: 'tokens.banIP',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'GET',
      path: '/banned-ips',
      handler: 'tokens.getBannedIPs',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/unban-ip',
      handler: 'tokens.unbanIP',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'GET',
      path: '/user-by-email',
      handler: 'tokens.findUserByEmail',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/tokens',
      handler: 'tokens.create',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },

    // JWT Token Management
    {
      method: 'GET',
      path: '/jwt-sessions',
      handler: 'jwt.getSessions',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/revoke-jwt',
      handler: 'jwt.revokeToken',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/unrevoke-jwt',
      handler: 'jwt.unrevokeToken',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/cleanup-sessions',
      handler: 'jwt.cleanupSessions',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },

    // License Management
    {
      method: 'GET',
      path: '/license/status',
      handler: 'license.getStatus',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/license/auto-create',
      handler: 'license.autoCreate',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/license/create',
      handler: 'license.createAndActivate',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/license/ping',
      handler: 'license.ping',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/license/store-key',
      handler: 'license.storeKey',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    
    // Rate Limiting
    {
      method: 'GET',
      path: '/rate-limit/stats',
      handler: 'rateLimit.getStats',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/rate-limit/cleanup',
      handler: 'rateLimit.cleanup',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'GET',
      path: '/rate-limit/cleanup',
      handler: 'rateLimit.cleanup',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/rate-limit/reset',
      handler: 'rateLimit.reset',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'GET',
      path: '/rate-limit/reset',
      handler: 'rateLimit.reset',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    
    // OTP Management (Admin)
    {
      method: 'GET',
      path: '/otp/codes',
      handler: 'otp.listCodes',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'DELETE',
      path: '/otp/codes/:id',
      handler: 'otp.deleteCode',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/otp/cleanup',
      handler: 'otp.cleanup',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    
    // TOTP Management (Admin - Advanced Feature)
    {
      method: 'POST',
      path: '/otp/totp/setup',
      handler: 'otp.setupTOTP',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/otp/totp/verify',
      handler: 'otp.verifyTOTP',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/otp/totp/disable',
      handler: 'otp.disableTOTP',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'GET',
      path: '/otp/totp/status',
      handler: 'otp.getTOTPStatus',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/otp/totp/backup-codes',
      handler: 'otp.generateBackupCodes',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    
    // WhatsApp Integration
    {
      method: 'GET',
      path: '/whatsapp/status',
      handler: 'whatsapp.getStatus',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/whatsapp/connect',
      handler: 'whatsapp.connect',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/whatsapp/disconnect',
      handler: 'whatsapp.disconnect',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'GET',
      path: '/whatsapp/qr',
      handler: 'whatsapp.getQRCode',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/whatsapp/check-number',
      handler: 'whatsapp.checkNumber',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
    {
      method: 'POST',
      path: '/whatsapp/test-message',
      handler: 'whatsapp.testMessage',
      config: {
        policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: ['plugin::magic-link.access'] } }],
      },
    },
  ],
}; 