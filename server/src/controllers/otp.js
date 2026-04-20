'use strict';

/**
 * OTP Controller
 *
 * Public endpoints for the OTP / TOTP second-factor flow and admin endpoints
 * for TOTP management.
 *
 * Security properties of the public endpoints:
 *  - Zod validation of every request body BEFORE any service call
 *  - Dual rate-limiting: per-IP AND per-email (closes single-axis bypass)
 *  - Strict binding: /otp/send and /otp/verify require a valid magicLinkToken
 *    that was produced by /magic-link/login with requiresOTP=true
 *    (can be disabled via otp_strict_binding setting for legacy flows)
 *  - Generic error messages: on invalid email, missing phone, or failed code
 *    the response does NOT distinguish between "user doesn't exist" and
 *    "wrong code" in order to prevent user enumeration
 *  - Sensitive context keys are dropped even on the successful path
 *  - OTP pool anti-inflation: createOTP invalidates prior unused codes
 *    so brute-force success probability stays constant at 1 / 10^length
 */

const {
  otpSendSchema,
  otpVerifySchema,
  otpResendSchema,
  totpTokenOnlySchema,
  parseBody,
} = require('./validation');
const { resolveJwt } = require('../utils/jwt');

const GENERIC_FAILURE = 'Invalid or expired verification code';
const GENERIC_OTP_RESPONSE = 'If the request is valid, a verification code will be sent.';

const SENSITIVE_CONTEXT_KEYS = [
  'password', 'secret', 'apiKey', 'token',
  'resetPasswordToken', 'confirmationToken',
  'requiresOTP', 'otpVerified',
  'requiresTOTP', 'totpVerified',
];

/**
 * Copies a context object, enforcing size limits and stripping sensitive keys.
 * @param {object} source
 * @returns {object}
 */
const sanitizeContext = (source) => {
  if (!source || typeof source !== 'object') return {};
  const out = {};
  for (const [key, val] of Object.entries(source)) {
    if (SENSITIVE_CONTEXT_KEYS.includes(key)) continue;
    if (val === undefined) continue;
    if (typeof val === 'string') {
      out[key] = val.substring(0, 2000);
    } else if (typeof val === 'boolean') {
      out[key] = val;
    } else if (typeof val === 'number' && !Number.isNaN(val)) {
      out[key] = val;
    } else if (typeof val === 'object' && val !== null) {
      try {
        out[key] = JSON.parse(JSON.stringify(val).substring(0, 5000));
      } catch {
        // drop values that fail round-trip serialization
      }
    }
  }
  return out;
};

/**
 * Applies IP + email rate limit for an OTP-related action. Returns the first
 * denial (retryAfter set on ctx). Returns null if the caller may proceed.
 *
 * @param {object} ctx - Koa context
 * @param {string} email - Lower-cased email
 * @param {string} scope - Logical scope tag ('send' | 'verify' | 'resend')
 * @returns {Promise<{status: number, message: string}|null>}
 */
const enforceOtpRateLimits = async (ctx, email, scope) => {
  const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
  const ipAddress = ctx.request.ip;

  const ipCheck = await rateLimiter.checkRateLimit(`ip:${scope}:${ipAddress}`, 'otp');
  if (!ipCheck.allowed) {
    ctx.set('Retry-After', String(ipCheck.retryAfter));
    return { status: 429, message: `Too many requests. Please try again in ${ipCheck.retryAfter} seconds.` };
  }

  if (email) {
    const emailCheck = await rateLimiter.checkRateLimit(`email:${scope}:${email}`, 'otp');
    if (!emailCheck.allowed) {
      ctx.set('Retry-After', String(emailCheck.retryAfter));
      return { status: 429, message: `Too many requests. Please try again in ${emailCheck.retryAfter} seconds.` };
    }
  }

  return null;
};

module.exports = {
  /**
   * Generates and sends an OTP code.
   *
   * Requires a valid magicLinkToken (when otp_strict_binding is enabled)
   * that was issued with requiresOTP=true — i.e. the user has completed the
   * first factor (clicked the magic link) and the server asked for a second
   * factor. This prevents /otp/send from being used as a standalone email
   * bombardment vector.
   *
   * @route POST /api/magic-link/otp/send
   */
  async send(ctx) {
    try {
      const { email: normalizedEmail, magicLinkToken } = parseBody(
        otpSendSchema,
        ctx.request.body
      );

      const otpService = strapi.plugin('magic-link').service('otp');
      const otpSettings = await otpService.getOTPSettings();

      if (!otpSettings.enabled) {
        return ctx.badRequest('OTP is not enabled');
      }

      const licenseGuard = strapi.plugin('magic-link').service('license-guard');
      const hasOTPFeature = await licenseGuard.hasFeature('otp-email');
      if (!hasOTPFeature) {
        return ctx.forbidden('OTP feature requires Premium license or higher');
      }

      const rlFail = await enforceOtpRateLimits(ctx, normalizedEmail, 'send');
      if (rlFail) return ctx.tooManyRequests(rlFail.message);

      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const settings = (await pluginStore.get({ key: 'settings' })) || {};
      const strictBinding = settings.otp_strict_binding !== false;

      if (strictBinding) {
        // Clear 400 when the client simply forgot to send the binding
        // token (usually a frontend bug) so the user is not left waiting
        // on an email that will never arrive. An INVALID binding — i.e.
        // token sent but mismatched — still returns the generic success
        // response below to prevent account enumeration.
        if (!magicLinkToken) {
          return ctx.badRequest(
            'magicLinkToken is required. Call /magic-link/login first and pass the returned loginToken as magicLinkToken.'
          );
        }

        const magicLink = strapi.plugin('magic-link').service('magic-link');
        const boundToken = await magicLink.validateBindingForChallenge(
          magicLinkToken,
          normalizedEmail,
          'otp'
        );
        if (!boundToken) {
          strapi.log.warn(
            `[OTP] Binding rejected for ${normalizedEmail} from ${ctx.request.ip} (send)`
          );
          return ctx.send({ success: true, message: GENERIC_OTP_RESPONSE });
        }
      } else {
        strapi.log.warn('[OTP] otp_strict_binding is disabled — running in legacy/insecure mode');
      }

      const otpEntry = await otpService.createOTP(normalizedEmail, otpSettings.type, {
        magicLinkToken,
        expirySeconds: otpSettings.expiry,
        codeLength: otpSettings.length,
        ipAddress: ctx.request.ip,
        userAgent: ctx.request.headers['user-agent'],
      });

      if (otpSettings.type === 'email') {
        await otpService.sendOTPEmail(normalizedEmail, otpEntry.code, {
          subject: 'Your Verification Code',
          expiryMinutes: Math.floor(otpSettings.expiry / 60),
        });
      } else if (otpSettings.type === 'sms') {
        const users = await strapi.documents('plugin::users-permissions.user').findMany({
          filters: { email: normalizedEmail },
          limit: 1,
        });
        const user = users && users[0];
        if (user?.phoneNumber) {
          await otpService.sendOTPSMS(user.phoneNumber, otpEntry.code);
        }
        // Generic response — do not reveal whether phone number was missing
      }

      return ctx.send({
        success: true,
        message: 'OTP code sent successfully',
        expiresIn: otpSettings.expiry,
        type: otpSettings.type,
      });
    } catch (error) {
      strapi.log.error('Error sending OTP:', error);
      return ctx.badRequest('Failed to send OTP code');
    }
  },

  /**
   * Verifies an OTP code and completes the magic-link login.
   *
   * When otp_strict_binding is enabled (default), a valid magicLinkToken
   * with requiresOTP=true is required; otherwise the flow falls back to
   * email-only verification (insecure legacy mode).
   *
   * @route POST /api/magic-link/otp/verify
   */
  async verify(ctx) {
    try {
      const { email: normalizedEmail, code, magicLinkToken } = parseBody(
        otpVerifySchema,
        ctx.request.body
      );

      const otpService = strapi.plugin('magic-link').service('otp');
      const magicLinkService = strapi.plugin('magic-link').service('magic-link');
      const otpSettings = await otpService.getOTPSettings();

      if (!otpSettings.enabled) {
        return ctx.badRequest('OTP is not enabled');
      }

      const rlFail = await enforceOtpRateLimits(ctx, normalizedEmail, 'verify');
      if (rlFail) return ctx.tooManyRequests(rlFail.message);

      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const settings = (await pluginStore.get({ key: 'settings' })) || {};
      const strictBinding = settings.otp_strict_binding !== false;

      let boundToken = null;
      if (strictBinding) {
        boundToken = await magicLinkService.validateBindingForChallenge(
          magicLinkToken,
          normalizedEmail,
          'otp'
        );
        if (!boundToken) {
          strapi.log.warn(
            `[OTP] Binding rejected for ${normalizedEmail} from ${ctx.request.ip} (verify)`
          );
          return ctx.badRequest(GENERIC_FAILURE);
        }
      }

      const verification = await otpService.verifyOTP(normalizedEmail, code, otpSettings.type);
      if (!verification.valid) {
        return ctx.badRequest(GENERIC_FAILURE);
      }

      const users = await strapi.documents('plugin::users-permissions.user').findMany({
        filters: { email: normalizedEmail },
        limit: 1,
      });
      const user = users && users[0];

      if (!user || user.blocked) {
        return ctx.badRequest(GENERIC_FAILURE);
      }

      // Deactivate the magic-link token so it cannot be reused after OTP.
      if (boundToken) {
        await magicLinkService.deactivateToken(boundToken);
      }

      const tokenContext = boundToken?.context ?? {};
      const sanitizedContext = sanitizeContext(tokenContext);

      const jwtService = strapi.plugin('users-permissions').service('jwt');
      // resolveJwt tolerates both sync-string and Promise return shapes so
      // the controller stays consistent with auth.js (login / MFA / TOTP).
      const jwt = await resolveJwt(jwtService.issue({ id: user.id, context: sanitizedContext }));

      if (settings.store_login_info) {
        await magicLinkService.storeLoginInfo?.({
          userId: user.id,
          email: user.email,
          ipAddress: ctx.request.ip,
          userAgent: ctx.request.headers['user-agent'],
          loginMethod: 'magic-link-otp',
          success: true,
        }).catch(() => {});
      }

      return ctx.send({
        jwt,
        user: { id: user.id, username: user.username, email: user.email },
        context: sanitizedContext,
      });
    } catch (error) {
      strapi.log.error('Error verifying OTP:', error);
      return ctx.badRequest('Failed to verify OTP code');
    }
  },

  /**
   * Resends a new OTP code after the resend cooldown has elapsed.
   * Also subject to strict binding, IP + email rate-limits, and the
   * single-active-code invalidation policy enforced by createOTP.
   *
   * @route POST /api/magic-link/otp/resend
   */
  async resend(ctx) {
    try {
      const { email: normalizedEmail, magicLinkToken } = parseBody(
        otpResendSchema,
        ctx.request.body
      );

      const otpService = strapi.plugin('magic-link').service('otp');
      const otpSettings = await otpService.getOTPSettings();

      if (!otpSettings.enabled) {
        return ctx.badRequest('OTP is not enabled');
      }

      const rlFail = await enforceOtpRateLimits(ctx, normalizedEmail, 'resend');
      if (rlFail) return ctx.tooManyRequests(rlFail.message);

      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const settings = (await pluginStore.get({ key: 'settings' })) || {};
      const strictBinding = settings.otp_strict_binding !== false;

      if (strictBinding) {
        // UX: distinguish between "client forgot to send the binding
        // token" (a legitimate frontend bug that deserves a clear 400)
        // and "token is present but invalid" (an enumeration-sensitive
        // failure that must look identical to success). Without this
        // split the resend endpoint used to silently pretend success
        // while the user waited forever for an email that was never
        // going to be generated.
        if (!magicLinkToken) {
          return ctx.badRequest(
            'magicLinkToken is required for OTP resend. Call /magic-link/login first and pass the returned loginToken as magicLinkToken.'
          );
        }

        const magicLink = strapi.plugin('magic-link').service('magic-link');
        const boundToken = await magicLink.validateBindingForChallenge(
          magicLinkToken,
          normalizedEmail,
          'otp'
        );
        if (!boundToken) {
          strapi.log.warn(
            `[OTP] Binding rejected for ${normalizedEmail} from ${ctx.request.ip} (resend)`
          );
          return ctx.send({ success: true, message: GENERIC_OTP_RESPONSE });
        }
      }

      // Resend cooldown check — based on the newest unused code (or any code
      // if all are already invalidated by createOTP's policy).
      const lastCodes = await strapi.documents('plugin::magic-link.otp-code').findMany({
        filters: { email: normalizedEmail, type: otpSettings.type },
        sort: [{ createdAt: 'desc' }],
        limit: 1,
      });

      if (lastCodes && lastCodes.length > 0) {
        const lastCreated = new Date(lastCodes[0].createdAt);
        const secondsSinceLastSend = (Date.now() - lastCreated.getTime()) / 1000;
        if (secondsSinceLastSend < otpSettings.resendCooldown) {
          const waitTime = Math.ceil(otpSettings.resendCooldown - secondsSinceLastSend);
          return ctx.tooManyRequests(`Please wait ${waitTime} seconds before requesting a new code`);
        }
      }

      // createOTP invalidates all prior unused codes before creating the new one,
      // so no explicit "mark old as used" loop is needed here.
      const otpEntry = await otpService.createOTP(normalizedEmail, otpSettings.type, {
        magicLinkToken,
        expirySeconds: otpSettings.expiry,
        codeLength: otpSettings.length,
        ipAddress: ctx.request.ip,
        userAgent: ctx.request.headers['user-agent'],
      });

      if (otpSettings.type === 'email') {
        await otpService.sendOTPEmail(normalizedEmail, otpEntry.code, {
          subject: 'Your New Verification Code',
          expiryMinutes: Math.floor(otpSettings.expiry / 60),
        });
      } else if (otpSettings.type === 'sms') {
        const users = await strapi.documents('plugin::users-permissions.user').findMany({
          filters: { email: normalizedEmail },
          limit: 1,
        });
        const user = users && users[0];
        if (user?.phoneNumber) {
          await otpService.sendOTPSMS(user.phoneNumber, otpEntry.code);
        }
      }

      return ctx.send({
        success: true,
        message: 'New OTP code sent successfully',
        expiresIn: otpSettings.expiry,
      });
    } catch (error) {
      strapi.log.error('Error resending OTP:', error);
      return ctx.badRequest('Failed to resend OTP code');
    }
  },

  /**
   * List all OTP codes (Admin)
   */
  async listCodes(ctx) {
    try {
      const { page = 1, pageSize = 10, email, type } = ctx.query;

      const filters = {};
      if (email) filters.email = { $containsi: email };
      if (type) filters.type = type;

      const codes = await strapi.documents('plugin::magic-link.otp-code').findMany({
        filters,
        sort: [{ createdAt: 'desc' }],
        offset: (page - 1) * pageSize,
        limit: Math.min(parseInt(pageSize, 10) || 10, 100),
      });

      const total = await strapi.documents('plugin::magic-link.otp-code').count({ filters });

      ctx.send({
        codes,
        pagination: {
          page: parseInt(page, 10),
          pageSize: parseInt(pageSize, 10),
          total,
          pageCount: Math.ceil(total / pageSize),
        },
      });
    } catch (error) {
      strapi.log.error('Error listing OTP codes:', error);
      return ctx.badRequest('Failed to list OTP codes');
    }
  },

  /**
   * Delete OTP code (Admin)
   */
  async deleteCode(ctx) {
    try {
      const { id } = ctx.params;
      await strapi.documents('plugin::magic-link.otp-code').delete({ documentId: id });
      ctx.send({ success: true, message: 'OTP code deleted successfully' });
    } catch (error) {
      strapi.log.error('Error deleting OTP code:', error);
      return ctx.badRequest('Failed to delete OTP code');
    }
  },

  /**
   * Cleanup expired OTP codes (Admin)
   */
  async cleanup(ctx) {
    try {
      const otpService = strapi.plugin('magic-link').service('otp');
      await otpService.cleanupExpiredCodes();
      ctx.send({ success: true, message: 'Expired OTP codes cleaned up successfully' });
    } catch (error) {
      strapi.log.error('Error cleaning up OTP codes:', error);
      return ctx.badRequest('Failed to cleanup OTP codes');
    }
  },

  /**
   * Setup TOTP for current user (Admin).
   * SECURITY: The plaintext secret is returned once here so the user can
   * scan the QR code or paste it into their authenticator. We return it
   * under a single key (`secret`) and instruct the client NOT to log it.
   * The DB stores only the AES-256-GCM-encrypted form.
   */
  async setupTOTP(ctx) {
    try {
      const licenseGuard = strapi.plugin('magic-link').service('license-guard');
      const hasFeature = await licenseGuard.hasFeature('otp-totp');

      if (!hasFeature) {
        return ctx.forbidden('TOTP feature requires Advanced or Enterprise license');
      }

      const { email, id: userId } = ctx.state.user;
      const otpService = strapi.plugin('magic-link').service('otp');
      const setupData = await otpService.setupTOTP(userId, email);

      ctx.send({ success: true, data: setupData });
    } catch (error) {
      strapi.log.error('Error setting up TOTP:', error);
      return ctx.badRequest('Failed to setup TOTP');
    }
  },

  /**
   * Verify TOTP code (Admin)
   */
  async verifyTOTP(ctx) {
    try {
      const { token } = parseBody(totpTokenOnlySchema, ctx.request.body);

      const { id: userId } = ctx.state.user;
      const otpService = strapi.plugin('magic-link').service('otp');
      const result = await otpService.verifyTOTP(userId, token, true);

      if (result.valid) {
        ctx.send({
          success: true,
          enabled: result.enabled,
          message: 'TOTP code verified successfully',
        });
      } else {
        ctx.send({ success: false, error: result.error, message: result.message });
      }
    } catch (error) {
      strapi.log.error('Error verifying TOTP:', error);
      return ctx.badRequest('Failed to verify TOTP');
    }
  },

  /**
   * Disable TOTP for current user (Admin)
   */
  async disableTOTP(ctx) {
    try {
      const { id: userId } = ctx.state.user;
      const otpService = strapi.plugin('magic-link').service('otp');
      const success = await otpService.disableTOTP(userId);

      if (success) {
        ctx.send({ success: true, message: 'TOTP disabled successfully' });
      } else {
        ctx.send({ success: false, message: 'TOTP was not enabled or does not exist' });
      }
    } catch (error) {
      strapi.log.error('Error disabling TOTP:', error);
      return ctx.badRequest('Failed to disable TOTP');
    }
  },

  /**
   * Get TOTP status for current user (Admin)
   */
  async getTOTPStatus(ctx) {
    try {
      const { id: userId } = ctx.state.user;
      const otpService = strapi.plugin('magic-link').service('otp');
      const status = await otpService.getTOTPStatus(userId);
      ctx.send({ success: true, data: status });
    } catch (error) {
      strapi.log.error('Error getting TOTP status:', error);
      return ctx.badRequest('Failed to get TOTP status');
    }
  },

  /**
   * Generate backup codes (Admin - Enterprise feature)
   */
  async generateBackupCodes(ctx) {
    try {
      const licenseGuard = strapi.plugin('magic-link').service('license-guard');
      const hasFeature = await licenseGuard.hasFeature('otp-backup-codes');

      if (!hasFeature) {
        return ctx.forbidden('Backup codes feature requires Enterprise license');
      }

      const { id: userId } = ctx.state.user;
      const otpService = strapi.plugin('magic-link').service('otp');
      const backupCodes = await otpService.generateBackupCodes(userId);

      ctx.send({
        success: true,
        codes: backupCodes,
        message: 'Backup codes generated. Store them securely!',
      });
    } catch (error) {
      strapi.log.error('Error generating backup codes:', error);
      return ctx.badRequest(error.message || 'Failed to generate backup codes');
    }
  },
};
