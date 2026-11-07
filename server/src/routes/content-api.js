'use strict';

/**
 * Content API routes
 *
 * NOTE: License gating was removed from these endpoints in the marketplace
 * refactor. All magic-link / OTP / MFA flows are available without a
 * license key. The optional license-key activation in the admin UI is
 * cosmetic / branding only and does NOT block any user-facing route.
 */

module.exports = {
  type: 'content-api',
  routes: [
    // Recommended: the frontend landing page POSTs { loginToken } so the
    // token never appears in access logs, caches or Referer headers.
    {
      method: 'POST',
      path: '/login',
      handler: 'auth.login',
      config: {
        auth: false,
        policies: ['plugin::magic-link.ip-ban-check'],
      },
    },
    // Compatibility: GET /login?loginToken=... (token ends up in access logs).
    {
      method: 'GET',
      path: '/login',
      handler: 'auth.login',
      config: {
        auth: false,
        policies: ['plugin::magic-link.ip-ban-check'],
      },
    },
    {
      method: 'POST',
      path: '/send-link',
      handler: 'auth.sendLink',
      config: {
        auth: false,
        policies: ['plugin::magic-link.ip-ban-check'],
      },
    },
    // OTP Routes
    {
      method: 'POST',
      path: '/otp/send',
      handler: 'otp.send',
      config: {
        auth: false,
        policies: ['plugin::magic-link.ip-ban-check'],
      },
    },
    {
      method: 'POST',
      path: '/otp/verify',
      handler: 'otp.verify',
      config: {
        auth: false,
        policies: ['plugin::magic-link.ip-ban-check'],
      },
    },
    {
      method: 'POST',
      path: '/otp/resend',
      handler: 'otp.resend',
      config: {
        auth: false,
        policies: ['plugin::magic-link.ip-ban-check'],
      },
    },
    // MFA Routes
    {
      method: 'POST',
      path: '/verify-mfa-totp',
      handler: 'auth.verifyMFATOTP',
      config: {
        auth: false,
        policies: ['plugin::magic-link.ip-ban-check'],
      },
    },
    {
      method: 'POST',
      path: '/login-totp',
      handler: 'auth.loginWithTOTP',
      config: {
        auth: false,
        policies: ['plugin::magic-link.ip-ban-check'],
      },
    },
  ],
};
