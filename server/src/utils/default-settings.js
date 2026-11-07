'use strict';

/**
 * Default Magic Link settings. Used for a fresh install (bootstrap) and for
 * the admin "reset data" action, so both always agree.
 *
 * Security-relevant defaults: hashed 32-character links, single use, 1 hour
 * lifetime, no auto-registration, strict OTP binding, rate limiting on.
 *
 * @returns {object} A new settings object.
 */
const createDefaultSettings = () => ({
  enabled: true,
  createUserIfNotExists: true,
  expire_period: 3600,
  // Empty = API login URL (<server.url><api prefix>/magic-link/login).
  // Set frontend_url + frontend_login_path for a frontend landing page.
  confirmationUrl: '',
  from_name: 'Administration Panel',
  // Empty = the Strapi e-mail plugin `defaultFrom`.
  from_email: '',
  response_email: '',
  token_length: 32,
  stays_valid: false,
  store_login_info: true,
  // Context field control (applied to public and admin-created tokens).
  context_whitelist: [],
  context_blacklist: ['password', 'secret', 'apiKey', 'token'],
  object: 'Magic Link Login',
  // Placeholders: {{LOGIN_URL}}, {{URL}}, {{CODE}}, {{EXPIRY_TEXT}},
  // {{EXPIRES_AT}}, {{EMAIL}}, {{USER}} (values are HTML-escaped).
  message_html: `<p>Hi!</p>
<p><a href="{{LOGIN_URL}}">Click here to log in</a>.</p>
<p>This link expires in {{EXPIRY_TEXT}}.</p>`,
  message_text: `Hi!
Use this link to log in: {{LOGIN_URL}}
This link expires in {{EXPIRY_TEXT}}.`,
  login_path: '/magic-link/login',
  user_creation_strategy: 'email',
  verify_email: false,
  welcome_email: false,
  use_jwt_token: true,
  jwt_token_expires_in: '30d',
  // Legacy; the backend never reads it. Use confirmationUrl or frontend_url.
  callback_url: '',
  allow_magic_links_on_public_registration: false,
  // Rate limiting
  rate_limit_enabled: true,
  rate_limit_max_attempts: 5,
  rate_limit_window_minutes: 15,
  // E-mail OTP
  otp_enabled: false,
  otp_type: 'email',
  otp_length: 6,
  otp_expiry: 300,
  otp_max_attempts: 3,
  otp_resend_cooldown: 60,
  // Every /otp/send and /otp/verify call must carry the originating
  // magicLinkToken. Turning this off weakens authentication significantly.
  otp_strict_binding: true,
  // TOTP defaults for new enrolments (stored per enrolment).
  totp_issuer: 'Magic Link',
  totp_algorithm: 'SHA1',
  totp_digits: 6,
  totp_period: 30,
  // MFA: mfa_mode is canonical; mfa_require_totp mirrors 'required'.
  mfa_mode: 'disabled',
  mfa_require_totp: false,
  totp_as_primary_auth: false,
  // Frontend landing page for login links.
  frontend_url: '',
  frontend_login_path: '/auth/magic-link',
  passwordlessCompatibility: false,
});

module.exports = { createDefaultSettings };
