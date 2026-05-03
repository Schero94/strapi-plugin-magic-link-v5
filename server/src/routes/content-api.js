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
    {
      method: 'GET',
      path: '/login',
      handler: 'auth.login',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/send-link',
      handler: 'auth.sendLink',
      config: {
        auth: false,
        policies: [],
      },
    },
    // OTP Routes
    {
      method: 'POST',
      path: '/otp/send',
      handler: 'otp.send',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/otp/verify',
      handler: 'otp.verify',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/otp/resend',
      handler: 'otp.resend',
      config: {
        auth: false,
        policies: [],
      },
    },
    // MFA Routes
    {
      method: 'POST',
      path: '/verify-mfa-totp',
      handler: 'auth.verifyMFATOTP',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/login-totp',
      handler: 'auth.loginWithTOTP',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
