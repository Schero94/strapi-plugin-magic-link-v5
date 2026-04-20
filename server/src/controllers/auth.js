'use strict';
/**
 * Auth.js controller
 *
 * @description: A set of functions called "actions" for managing `Auth`.
 */

const _ = require('lodash');
const { nanoid } = require('nanoid');
const i18n = require('../utils/i18n');
const cryptoUtils = require('../utils/crypto');
const { normalizeEmail } = require('../utils/email');
const { resolveJwt } = require('../utils/jwt');
const { appendJwtSession } = require('../utils/jwt-session-store');
const {
  sendLinkSchema,
  mfaVerifyTotpSchema,
  loginWithTotpSchema,
  parseBody,
} = require('./validation');

module.exports = {
  /**
   * Handles magic link login token verification with rate limiting
   */
  async login(ctx) {
    const { loginToken } = ctx.query;
    const magicLink = strapi.plugin('magic-link').service('magic-link');
    const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
    const userService = strapi.plugin('users-permissions').service('user');
    const jwtService = strapi.plugin('users-permissions').service('jwt');
    const isEnabled = await magicLink.isEnabled();

    if (!isEnabled) {
      return i18n.sendError(ctx, 'plugin.disabled', 400);
    }

    if (_.isEmpty(loginToken)) {
      return i18n.sendError(ctx, 'token.invalid', 400);
    }

    const ipAddress = ctx.request.ip;
    const loginCheck = await rateLimiter.checkRateLimit(ipAddress, 'login');
    if (!loginCheck.allowed) {
      ctx.set('Retry-After', String(loginCheck.retryAfter));
      return ctx.tooManyRequests(`Too many login attempts. Please try again in ${loginCheck.retryAfter} seconds.`);
    }

    const token = await magicLink.fetchToken(loginToken);

    if (!token || !token.is_active) {
      return i18n.sendError(ctx, 'token.invalid', 400);
    }

    const isValid = await magicLink.isTokenValid(token);

    if (!isValid) {
      await magicLink.deactivateToken(token);
      return i18n.sendError(ctx, 'token.invalid', 400);
    }

    // Check if OTP is enabled
    const settings = await magicLink.settings();
    const licenseGuard = strapi.plugin('magic-link').service('license-guard');
    const hasOTPFeature = await licenseGuard.hasFeature('otp-email');

    // If OTP is enabled and available, require OTP verification
    if (settings.otp_enabled && hasOTPFeature) {
      // Mark token as requiring OTP using Document Service API.
      // Keep this BEFORE generating the code so a concurrent login attempt
      // with the same link cannot race past the flag.
      await strapi.documents('plugin::magic-link.token').update({
        documentId: token.documentId,
        data: {
          context: {
            ...(token.context || {}),
            requiresOTP: true,
            otpVerified: false,
          },
        },
      });

      const otpService = strapi.plugin('magic-link').service('otp');
      const otpEntry = await otpService.createOTP(token.email, 'email', {
        magicLinkToken: token.token,
        expirySeconds: settings.otp_expiry || 300,
        codeLength: settings.otp_length || 6,
        ipAddress: ctx.request.ip,
        userAgent: ctx.request.header['user-agent'],
      });

      // Surface mail-transport failures as an actionable 503 instead of
      // a generic 500. The code row already exists so the frontend can
      // prompt the user to hit /otp/resend without starting from scratch.
      try {
        await otpService.sendOTPEmail(token.email, otpEntry.code, {
          subject: 'Your Verification Code',
          expiryMinutes: Math.floor((settings.otp_expiry || 300) / 60),
        });
      } catch (mailErr) {
        strapi.log.error(`[magic-link] OTP email delivery failed for ${token.email}: ${mailErr.message}`);
        ctx.status = 503;
        ctx.body = {
          data: null,
          error: {
            status: 503,
            name: 'OtpDeliveryError',
            message: 'Verification code could not be sent. Please request a new code.',
            details: {
              code: 'OTP_EMAIL_FAILED',
              resendEndpoint: '/api/magic-link/otp/resend',
              email: token.email,
              loginToken: token.token,
            },
          },
        };
        return;
      }

      return ctx.send({
        requiresOTP: true,
        message: 'OTP verification required',
        email: token.email,
        loginToken: token.token,
        expiresIn: settings.otp_expiry || 300,
      });
    }

    // Check whether Magic Link must be followed by a TOTP challenge.
    //
    // `mfa_mode` is the authoritative switch:
    //   'disabled' → TOTP step always skipped
    //   'optional' → only prompted when the user has TOTP configured+enabled
    //   'required' → every user MUST configure TOTP; logins without it fail
    //
    // The legacy `mfa_require_totp` flag maps to 'required' for
    // backwards compatibility with existing installs. If both are set,
    // mfa_mode wins.
    const mfaMode = ['disabled', 'optional', 'required'].includes(settings.mfa_mode)
      ? settings.mfa_mode
      : (settings.mfa_require_totp ? 'required' : 'disabled');

    if (mfaMode !== 'disabled') {
      const otpService = strapi.plugin('magic-link').service('otp');

      // Lower-case the token email for the lookup so a legacy uppercase
      // address in the DB still matches — createToken now writes lower-
      // case, but tokens issued on older builds may still carry the
      // original casing.
      const lookupEmail = normalizeEmail(token.email);
      const users = await strapi.documents('plugin::users-permissions.user').findMany({
        filters: { email: lookupEmail },
        limit: 1,
      });
      const user = users && users.length > 0 ? users[0] : null;

      if (user) {
        const totpStatus = await otpService.getTOTPStatus(user.id);

        // Mode: required — user MUST have TOTP configured. Block otherwise.
        if (mfaMode === 'required' && !(totpStatus.configured && totpStatus.enabled)) {
          return ctx.badRequest(
            'TOTP is required but not yet configured for this account. Please set up TOTP in your profile and try again.'
          );
        }

        // Mode: optional/required — if TOTP is enabled, force the challenge.
        if (totpStatus.configured && totpStatus.enabled) {
          // Mark token as requiring TOTP verification using Document Service API
          await strapi.documents('plugin::magic-link.token').update({
            documentId: token.documentId,
            data: {
              context: {
                ...(token.context || {}),
                requiresTOTP: true,
                totpVerified: false,
                userId: user.id,
                userDocumentId: user.documentId
              }
            }
          });
          
          // Return response indicating TOTP is required
          return ctx.send({
            requiresTOTP: true,
            message: 'TOTP verification required for MFA',
            email: token.email,
            loginToken: token.token,
            userId: user.id
          });
        }
      }
    }
    
    // No OTP or TOTP required, proceed with normal login
    // Collect request information for security logging
    const requestInfo = {
      userAgent: ctx.request.header['user-agent'],
      ipAddress: ctx.request.ip
    };

    await magicLink.updateTokenOnLogin(token, requestInfo);

    // Case-insensitive user lookup, same rationale as the MFA branch above.
    const mainLookupEmail = normalizeEmail(token.email);
    const users = await strapi.documents('plugin::users-permissions.user').findMany({
      filters: { email: mainLookupEmail },
      limit: 1,
    });
    const user = users && users.length > 0 ? users[0] : null;

    if (!user) {
      return i18n.sendError(ctx, 'wrong.email', 400);
    }

    if (user.blocked) {
      // Kill the token before returning so the already-blocked user cannot
      // hammer the endpoint from multiple IPs with the same link. The
      // standard rate-limiter alone does not cover IP rotation.
      await magicLink.deactivateToken(token);
      return i18n.sendError(ctx, 'blocked.user', 403);
    }

    if (!user.confirmed) {
      await userService.edit(user.id, { confirmed: true });
    }
    
    // In Strapi v5, sanitization works differently
    // We need to handle it differently to avoid the "Missing schema" error
    const sanitizedUser = { ...user };
    delete sanitizedUser.password;
    delete sanitizedUser.resetPasswordToken;
    delete sanitizedUser.confirmationToken;
    delete sanitizedUser.roles;

    let context;
    try {
      context = token.context || {};
    } catch (e) {
      context = {};
    }
    
    // Sanitize context values (size limits) but pass ALL fields through.
    // Security-sensitive fields are already filtered by whitelist/blacklist
    // in the token creation step (tokens.js). No need to filter again here.
    const sensitiveKeys = ['password', 'secret', 'apiKey', 'token', 'resetPasswordToken', 'confirmationToken'];
    const sanitizedContext = {};
    for (const [key, val] of Object.entries(context)) {
      // Skip internal/sensitive keys as safety net
      if (sensitiveKeys.includes(key)) continue;
      if (val === undefined) continue;

      if (typeof val === 'string') {
        sanitizedContext[key] = val.substring(0, 2000);
      } else if (typeof val === 'boolean') {
        sanitizedContext[key] = val;
      } else if (typeof val === 'number' && !isNaN(val)) {
        sanitizedContext[key] = val;
      } else if (typeof val === 'object' && val !== null) {
        try {
          const jsonStr = JSON.stringify(val).substring(0, 5000);
          sanitizedContext[key] = JSON.parse(jsonStr);
        } catch {
          // Skip values that cannot be serialized
        }
      }
    }
    
    // Generate JWT — resolveJwt handles sync/Promise return uniformly.
    const jwtToken = await resolveJwt(jwtService.issue({
      id: user.id,
      context: sanitizedContext,
    }));

    strapi.log.debug('[magic-link] JWT Token generated:', typeof jwtToken, jwtToken ? 'has value' : 'empty');
    
    // Hole JWT-Konfiguration, um Ablaufzeit zu berechnen
    let expirationTime = settings.jwt_token_expires_in || '30d';
    
    // Parse die Ablaufzeit (z.B. "30d" -> 30 Tage)
    let expiresAt = new Date();
    if (expirationTime.endsWith('d')) {
      const days = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setDate(expiresAt.getDate() + days);
    } else if (expirationTime.endsWith('h')) {
      const hours = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setHours(expiresAt.getHours() + hours);
    } else if (expirationTime.endsWith('m')) {
      const minutes = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setMinutes(expiresAt.getMinutes() + minutes);
    } else {
      // Fallback auf 30 Tage
      expiresAt.setDate(expiresAt.getDate() + 30);
    }
    
    await appendJwtSession(strapi, {
      id: `session_${Date.now()}_${nanoid(12)}`,
      userId: user.id,
      userEmail: user.email,
      username: user.username || user.email.split('@')[0],
      jwtTokenHash: cryptoUtils.hashJwt(jwtToken),
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      isRevoked: false,
      ipAddress: requestInfo.ipAddress,
      userAgent: requestInfo.userAgent,
      source: 'Magic Link Login',
      lastUsedAt: new Date().toISOString(),
      context: sanitizedContext,
    });
    
    // `use_jwt_token` lets the admin suppress the JWT in the response
    // body. This is useful for SSO-style integrations where an external
    // system (e.g. a reverse proxy or session broker) issues the real
    // token AFTER Magic-Link validation. In that case the response only
    // confirms "this user clicked a valid link".
    const issueJwtInResponse = settings?.use_jwt_token !== false;

    const responseBody = {
      user: sanitizedUser,
      context: sanitizedContext,
      expires_at: expiresAt.toISOString(),
      expiry_formatted: new Intl.DateTimeFormat('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(expiresAt),
    };
    if (issueJwtInResponse) {
      responseBody.jwt = jwtToken;
    } else {
      responseBody.tokenIssued = true; // hint for clients that a session exists server-side
    }
    ctx.send(responseBody);
  },

  async sendLink(ctx) {
    // Strapi v5 pattern für Service Zugriff
    const magicLink = strapi.plugin('magic-link').service('magic-link');
    const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
    const whatsappService = strapi.plugin('magic-link').service('whatsapp');

    const isEnabled = await magicLink.isEnabled();

    if (!isEnabled) {
      return i18n.sendError(ctx, 'plugin.disabled', 400);
    }

    const params = parseBody(sendLinkSchema, ctx.request.body);

    const email = params.email || null;
    const phoneNumber = params.phoneNumber || params.phone || null;
    const context = params.context || {};
    const username = params.username || null;
    const deliveryMethod = params.delivery || params.via || 'email';
    
    // Rate limiting check - both IP and email/phone
    const ipAddress = ctx.request.ip;
    const ipCheck = await rateLimiter.checkRateLimit(ipAddress, 'ip');
    
    if (!ipCheck.allowed) {
      return ctx.tooManyRequests(`Too many requests. Please try again in ${ipCheck.retryAfter} seconds.`);
    }
    
    if (email) {
      const emailCheck = await rateLimiter.checkRateLimit(email, 'email');
      
      if (!emailCheck.allowed) {
        return ctx.tooManyRequests(`Too many requests for this email. Please try again in ${emailCheck.retryAfter} seconds.`);
      }
    }

    // Load settings once for the user-lookup / policy block.
    const sendLinkSettings = await magicLink.settings();
    const allowPublicRegistration = sendLinkSettings?.allow_magic_links_on_public_registration === true;
    const requireVerifiedEmail = sendLinkSettings?.verify_email === true;

    // --------------------------------------------------------------------
    //  USER ENUMERATION HARDENING
    // --------------------------------------------------------------------
    // Earlier versions returned different error messages for
    //   (a) email unknown,
    //   (b) email typo / casing mismatch,
    //   (c) email known but not confirmed,
    //   (d) user blocked.
    // A client could therefore enumerate which addresses belong to real
    // accounts. We now answer all of those cases with the SAME generic
    // success envelope below. Internally we still short-circuit so no
    // real token / mail is sent, and the admin can inspect the reason in
    // the structured server log.
    //
    // The only non-generic failure we still surface is a downstream
    // delivery error (SMTP/WhatsApp failed AFTER user/token creation) —
    // see the WhatsApp branch further down where we must tell the caller
    // that their delivery endpoint is not available.
    const GENERIC_SEND_RESPONSE = {
      email: email || null,
      username: username || null,
      sent: true,
      delivery: phoneNumber ? 'whatsapp' : 'email',
    };
    const silentReject = (reason) => {
      strapi.log.warn(`[magic-link] sendLink rejected silently: ${reason} (email=${email || '-'}, ip=${ipAddress})`);
      return ctx.send(GENERIC_SEND_RESPONSE);
    };

    // Remember whether the user existed BEFORE we potentially auto-create
    // them, so we can trigger the welcome email only on genuine first-time
    // sign-ups. Always look up by normalised email to match the DB state.
    const lookupEmail = normalizeEmail(email);
    let existingUser = null;
    try {
      const lookup = await strapi.documents('plugin::users-permissions.user').findMany({
        filters: lookupEmail ? { email: lookupEmail } : { username },
        limit: 1,
      });
      existingUser = (lookup && lookup[0]) || null;
    } catch {
      existingUser = null;
    }

    // Gate on public registration: if the user does not exist yet and the
    // admin did NOT opt in to public-registration via Magic Link, answer
    // with the generic response instead of revealing "unknown user".
    if (!existingUser && !allowPublicRegistration) {
      return silentReject('unknown_email_and_public_registration_disabled');
    }

    let user;
    try {
      user = await magicLink.user(email, username);
    } catch {
      return silentReject('user_service_error');
    }

    if (!user) {
      return silentReject('user_not_found_or_created');
    }

    if (lookupEmail && normalizeEmail(user.email) !== lookupEmail) {
      return silentReject('email_mismatch_after_lookup');
    }

    if (user.blocked) {
      return silentReject('blocked_user');
    }

    // `verify_email`: only send Magic Links to accounts whose email has
    // been confirmed (e.g. via classic registration flow). Prevents
    // account takeover via typosquatted email addresses.
    if (requireVerifiedEmail && !user.confirmed && existingUser) {
      return silentReject('email_not_confirmed');
    }

    // `welcome_email`: if the user was just auto-created, fire a welcome
    // mail in the background. We never block the Magic-Link flow on the
    // welcome mail succeeding.
    if (!existingUser && sendLinkSettings?.welcome_email === true) {
      setImmediate(async () => {
        try {
          await strapi.plugin('email').service('email').send({
            to: user.email,
            from: sendLinkSettings?.from_email
              ? `${sendLinkSettings.from_name || ''} <${sendLinkSettings.from_email}>`.trim()
              : undefined,
            replyTo: sendLinkSettings?.response_email || undefined,
            subject: `Welcome${sendLinkSettings?.from_name ? ' to ' + sendLinkSettings.from_name : ''}!`,
            text: `Hi ${user.username || user.email},\n\nThanks for joining. Your Magic Link is on the way.`,
            html: `<p>Hi ${user.username || user.email},</p><p>Thanks for joining. Your Magic Link is on the way.</p>`,
          });
        } catch (welcomeErr) {
          strapi.log.warn(`[magic-link] Welcome email failed for ${user.email}: ${welcomeErr.message}`);
        }
      });
    }

    try {
      const token = await magicLink.createToken(user.email, context);
      
      // Check if WhatsApp delivery is requested and available
      const settings = await magicLink.settings();
      const useWhatsApp = (deliveryMethod === 'whatsapp' || phoneNumber) && 
                          settings?.whatsapp_enabled && 
                          phoneNumber;

      if (useWhatsApp) {
        // Send via WhatsApp
        const whatsappStatus = whatsappService.getStatus();
        
        if (!whatsappStatus.isConnected) {
          return ctx.badRequest('WhatsApp is not connected. Please connect WhatsApp in the admin panel first.');
        }

        const result = await magicLink.sendLoginLinkViaWhatsApp(token, phoneNumber);
        
        if (!result.success) {
          return ctx.badRequest(result.error || 'Failed to send WhatsApp message');
        }

        ctx.send({
          email,
          phoneNumber,
          username,
          sent: true,
          delivery: 'whatsapp',
        });
      } else {
        // Send via Email (default)
        await magicLink.sendLoginLink(token);
        ctx.send({
          email,
          username,
          sent: true,
          delivery: 'email',
        });
      }
    } catch (err) {
      return ctx.badRequest(err);
    }
  },

  /**
   * Verifies a TOTP code after a successful Magic Link click (MFA scenario 1).
   * Rate-limited per-IP and per-token to prevent brute-force against the
   * 6-digit TOTP space.
   *
   * @route POST /api/magic-link/verify-mfa-totp
   * @throws {BadRequestError} When the token/code is invalid or expired
   */
  async verifyMFATOTP(ctx) {
    const { loginToken, totpCode } = parseBody(mfaVerifyTotpSchema, ctx.request.body);

    const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
    const ipAddress = ctx.request.ip;
    const ipCheck = await rateLimiter.checkRateLimit(ipAddress, 'otp');
    if (!ipCheck.allowed) {
      ctx.set('Retry-After', String(ipCheck.retryAfter));
      return ctx.tooManyRequests(`Too many TOTP attempts. Please try again in ${ipCheck.retryAfter} seconds.`);
    }
    const tokenKey = `totp:${loginToken.substring(0, 32)}`;
    const tokenCheck = await rateLimiter.checkRateLimit(tokenKey, 'otp');
    if (!tokenCheck.allowed) {
      ctx.set('Retry-After', String(tokenCheck.retryAfter));
      return ctx.tooManyRequests(`Too many TOTP attempts for this login. Please try again in ${tokenCheck.retryAfter} seconds.`);
    }

    const magicLink = strapi.plugin('magic-link').service('magic-link');
    const otpService = strapi.plugin('magic-link').service('otp');
    const userService = strapi.plugin('users-permissions').service('user');
    const jwtService = strapi.plugin('users-permissions').service('jwt');

    const token = await magicLink.fetchToken(loginToken);
    
    if (!token || !token.is_active) {
      return ctx.badRequest('Invalid or expired token');
    }
    
    // Check if token requires TOTP
    const context = token.context || {};
    if (!context.requiresTOTP || !context.userId) {
      return ctx.badRequest('TOTP verification not required for this token');
    }
    
    // Verify TOTP code
    const verificationResult = await otpService.verifyTOTP(context.userId, totpCode, false);
    
    if (!verificationResult.valid) {
      return ctx.badRequest(verificationResult.message || 'Invalid TOTP code');
    }
    
    // Mark token as TOTP-verified using Document Service API
    await strapi.documents('plugin::magic-link.token').update({
      documentId: token.documentId,
      data: {
        context: {
          ...context,
          totpVerified: true
        }
      }
    });
    
    // Proceed with login
    const requestInfo = {
      userAgent: ctx.request.header['user-agent'],
      ipAddress: ctx.request.ip
    };
    
    await magicLink.updateTokenOnLogin(token, requestInfo);
    
    // Find user using Document Service API
    // Prefer documentId (Strapi v5), fallback to id for backward compatibility
    let user = null;
    if (context.userDocumentId) {
      user = await strapi.documents('plugin::users-permissions.user').findOne({
        documentId: context.userDocumentId,
      });
    } else if (context.userId) {
      const users = await strapi.documents('plugin::users-permissions.user').findMany({
        filters: { id: context.userId },
        limit: 1,
      });
      user = users && users.length > 0 ? users[0] : null;
    }
    
    if (!user) {
      return ctx.badRequest('User not found');
    }

    if (user.blocked) {
      // Match the main login() branch: kill the token and return the
      // same i18n key + 403 status the rest of the plugin uses.
      await magicLink.deactivateToken(token);
      return i18n.sendError(ctx, 'blocked.user', 403);
    }

    if (!user.confirmed) {
      await userService.edit(user.id, { confirmed: true });
    }
    
    // Sanitize user data
    const sanitizedUser = { ...user };
    delete sanitizedUser.password;
    delete sanitizedUser.resetPasswordToken;
    delete sanitizedUser.confirmationToken;
    delete sanitizedUser.roles;
    
    // Sanitize context from token (pass all fields except sensitive ones)
    const mfaSensitiveKeys = ['password', 'secret', 'apiKey', 'token', 'resetPasswordToken', 'confirmationToken', 'requiresTOTP', 'totpVerified', 'userId'];
    const mfaSanitizedContext = {};
    for (const [key, val] of Object.entries(context)) {
      if (mfaSensitiveKeys.includes(key)) continue;
      if (val === undefined) continue;
      if (typeof val === 'string') {
        mfaSanitizedContext[key] = val.substring(0, 2000);
      } else if (typeof val === 'boolean') {
        mfaSanitizedContext[key] = val;
      } else if (typeof val === 'number' && !isNaN(val)) {
        mfaSanitizedContext[key] = val;
      } else if (typeof val === 'object' && val !== null) {
        try {
          const jsonStr = JSON.stringify(val).substring(0, 5000);
          mfaSanitizedContext[key] = JSON.parse(jsonStr);
        } catch {
          // Skip values that cannot be serialized
        }
      }
    }
    
    // Generate JWT with context (resolveJwt tolerates sync-string and
    // Promise return values from jwtService.issue, identical to the
    // defensive handling in login()).
    const settings = await magicLink.settings();
    const jwtToken = await resolveJwt(jwtService.issue({
      id: user.id,
      mfaVerified: true,
      context: mfaSanitizedContext,
    }));
    
    // Calculate expiration
    let expirationTime = settings.jwt_token_expires_in || '30d';
    let expiresAt = new Date();
    if (expirationTime.endsWith('d')) {
      const days = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setDate(expiresAt.getDate() + days);
    } else if (expirationTime.endsWith('h')) {
      const hours = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setHours(expiresAt.getHours() + hours);
    }
    
    await appendJwtSession(strapi, {
      id: `session_${Date.now()}_${nanoid(12)}`,
      userId: user.id,
      userEmail: user.email,
      username: user.username || user.email.split('@')[0],
      jwtTokenHash: cryptoUtils.hashJwt(jwtToken),
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      isRevoked: false,
      ipAddress: requestInfo.ipAddress,
      userAgent: requestInfo.userAgent,
      source: 'Magic Link + TOTP (MFA)',
      lastUsedAt: new Date().toISOString(),
      mfaVerified: true,
      context: mfaSanitizedContext,
    });
    
    ctx.send({
      jwt: jwtToken,
      user: sanitizedUser,
      mfaVerified: true,
      context: mfaSanitizedContext,
      expires_at: expiresAt.toISOString()
    });
  },

  /**
   * Passwordless login using Email + TOTP code (primary factor, scenario 2).
   * Rate-limited per-IP and per-email. Responds with a generic error message
   * for non-existent users or incorrect codes to prevent user enumeration.
   *
   * @route POST /api/magic-link/login-totp
   * @throws {ForbiddenError} When the feature/license is not available
   * @throws {BadRequestError} When email/code is invalid (generic message)
   */
  async loginWithTOTP(ctx) {
    const { email: normalizedEmail, totpCode } = parseBody(loginWithTotpSchema, ctx.request.body);

    const magicLink = strapi.plugin('magic-link').service('magic-link');
    const otpService = strapi.plugin('magic-link').service('otp');
    const licenseGuard = strapi.plugin('magic-link').service('license-guard');
    const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
    const userService = strapi.plugin('users-permissions').service('user');
    const jwtService = strapi.plugin('users-permissions').service('jwt');

    const ipAddress = ctx.request.ip;
    const ipCheck = await rateLimiter.checkRateLimit(ipAddress, 'login');
    if (!ipCheck.allowed) {
      ctx.set('Retry-After', String(ipCheck.retryAfter));
      return ctx.tooManyRequests(`Too many login attempts. Please try again in ${ipCheck.retryAfter} seconds.`);
    }
    const emailCheck = await rateLimiter.checkRateLimit(`totp:${normalizedEmail}`, 'otp');
    if (!emailCheck.allowed) {
      ctx.set('Retry-After', String(emailCheck.retryAfter));
      return ctx.tooManyRequests(`Too many TOTP attempts. Please try again in ${emailCheck.retryAfter} seconds.`);
    }

    const settings = await magicLink.settings();
    if (!settings.totp_as_primary_auth) {
      return ctx.forbidden('TOTP login is not enabled');
    }

    const hasFeature = await licenseGuard.hasFeature('otp-totp');
    if (!hasFeature) {
      return ctx.forbidden('TOTP login requires Advanced license');
    }

    const GENERIC_INVALID = 'Invalid credentials';

    const users = await strapi.documents('plugin::users-permissions.user').findMany({
      filters: { email: normalizedEmail },
      limit: 1,
    });
    const user = users && users.length > 0 ? users[0] : null;

    if (!user) {
      return ctx.badRequest(GENERIC_INVALID);
    }

    if (user.blocked) {
      return ctx.badRequest(GENERIC_INVALID);
    }

    const totpStatus = await otpService.getTOTPStatus(user.id);

    if (!totpStatus.configured || !totpStatus.enabled) {
      return ctx.badRequest(GENERIC_INVALID);
    }

    const verificationResult = await otpService.verifyTOTP(user.id, totpCode, false);

    if (!verificationResult.valid) {
      return ctx.badRequest(GENERIC_INVALID);
    }
    
    // User is verified, proceed with login
    if (!user.confirmed) {
      await userService.edit(user.id, { confirmed: true });
    }
    
    // Sanitize user data
    const sanitizedUser = { ...user };
    delete sanitizedUser.password;
    delete sanitizedUser.resetPasswordToken;
    delete sanitizedUser.confirmationToken;
    delete sanitizedUser.roles;
    
    // Generate JWT — resolveJwt keeps sync/Promise handling uniform.
    const jwtToken = await resolveJwt(jwtService.issue({
      id: user.id,
      totpLogin: true,
    }));
    
    // Calculate expiration
    let expirationTime = settings.jwt_token_expires_in || '30d';
    let expiresAt = new Date();
    if (expirationTime.endsWith('d')) {
      const days = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setDate(expiresAt.getDate() + days);
    } else if (expirationTime.endsWith('h')) {
      const hours = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setHours(expiresAt.getHours() + hours);
    }
    
    await appendJwtSession(strapi, {
      id: `session_${Date.now()}_${nanoid(12)}`,
      userId: user.id,
      userEmail: user.email,
      username: user.username || user.email.split('@')[0],
      jwtTokenHash: cryptoUtils.hashJwt(jwtToken),
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      isRevoked: false,
      ipAddress: ctx.request.ip,
      userAgent: ctx.request.header['user-agent'],
      source: 'TOTP Login (Primary)',
      lastUsedAt: new Date().toISOString(),
      totpLogin: true,
    });
    
    ctx.send({
      jwt: jwtToken,
      user: sanitizedUser,
      loginMethod: 'totp',
      expires_at: expiresAt.toISOString()
    });
  },
}; 