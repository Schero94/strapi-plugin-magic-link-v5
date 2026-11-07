'use strict';

/**
 * OTP controller: e-mail OTP second factor (public), OTP code management
 * (admin) and the admin user's own authenticator (admin).
 *
 * Security properties of the public endpoints:
 *  - Zod validation of every request body before any service call.
 *  - Rate limits per IP and per e-mail (hashed limiter keys).
 *  - Strict binding (default): /otp/send, /otp/verify and /otp/resend need
 *    the loginToken of a pending server-side `otp` challenge started by
 *    /magic-link/login. The unbound legacy flow (otp_strict_binding=false)
 *    is refused whenever an MFA mode is active, so it can never replace
 *    the authenticator.
 *  - Generic answers for unknown users, wrong codes and foreign bindings.
 *  - Sessions are issued through utils/login-session.js like every other
 *    login path (session record, configured lifetime, refresh mode).
 *
 * Admin authenticator routes are namespaced to the admin principal
 * (`admin:<id>`), so they can never touch an end user's enrolment.
 */

const crypto = require('node:crypto');
const {
  otpSendSchema,
  otpVerifySchema,
  otpResendSchema,
  totpTokenOnlySchema,
  adminTotpSetupSchema,
  otpCodesQuerySchema,
  parseBody,
} = require('./validation');
const { resolveMfaMode } = require('../utils/mfa-mode');
const { filterContext } = require('../utils/context-policy');
const { issueLoginSession, setNoStoreHeaders } = require('../utils/login-session');
const i18n = require('../utils/i18n');
const { claimUnconfirmedAccount } = require('../utils/account-claim');
const { requiredChallenge, challengeSatisfiesPolicy } = require('../utils/challenge-policy');
const { normalizeBackupCode } = require('../utils/totp');

const OTP_UID = 'plugin::magic-link.otp-code';
const USER_UID = 'plugin::users-permissions.user';
const GENERIC_FAILURE = 'Invalid or expired verification code';
const GENERIC_OTP_RESPONSE = 'If the request is valid, a verification code will be sent.';
const ADMIN_PAGE_SIZE_LIMIT = 100;

const plugin = () => strapi.plugin('magic-link');

/**
 * Query Engine filter for a derived OTP state, matching the admin badges:
 * used codes are "used" even after expiry; unused ones are active or expired.
 *
 * @param {'active'|'expired'|'used'} status - Derived state.
 * @param {Date} now - Reference time.
 * @returns {object} Where clause.
 */
const otpStatusWhere = (status, now) => {
  if (status === 'used') return { used: true };
  return { used: false, expiresAt: status === 'active' ? { $gt: now } : { $lt: now } };
};

/**
 * Hashes a limiter key so e-mail addresses are not kept in clear.
 *
 * @param {string} scope - Key scope.
 * @param {string} value - Value.
 * @returns {string} Key.
 */
const limiterKey = (scope, value) =>
  `${scope}:${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32)}`;

/**
 * Applies IP and e-mail rate limits. Returns a denial or null.
 *
 * @param {object} ctx - Koa context.
 * @param {string} email - Lower-cased e-mail.
 * @param {string} scope - 'send' | 'verify' | 'resend'.
 * @returns {Promise<{message: string}|null>}
 */
const enforceOtpRateLimits = async (ctx, email, scope) => {
  const rateLimiter = plugin().service('rate-limiter');
  for (const key of [
    `ip:${scope}:${ctx.request.ip}`,
    email ? limiterKey(`email:${scope}`, email) : null,
  ]) {
    if (!key) continue;
    const check = await rateLimiter.checkRateLimit(key, 'otp');
    if (!check?.allowed) {
      const retryAfter = Number.isFinite(check?.retryAfter) ? check.retryAfter : 60;
      ctx.set('Retry-After', String(retryAfter));
      return { message: `Too many requests. Please try again in ${retryAfter} seconds.` };
    }
  }
  return null;
};

/**
 * Counts one code check against the always-on `verify` limiter (also active
 * when public rate limiting is disabled). Returns a denial or null.
 *
 * @param {object} ctx - Koa context.
 * @param {string} subject - Account key (hashed e-mail or principal key).
 * @returns {Promise<{message: string}|null>}
 */
const enforceVerificationLimit = async (ctx, subject) => {
  const check = await plugin()
    .service('rate-limiter')
    .checkRateLimit(`verify:${subject}`, 'verify');
  if (check?.allowed) return null;
  const retryAfter = Number.isFinite(check?.retryAfter) ? check.retryAfter : 60;
  ctx.set('Retry-After', String(retryAfter));
  return { message: `Too many attempts. Please try again in ${retryAfter} seconds.` };
};

/**
 * Reads plugin settings.
 *
 * @returns {Promise<object>} Settings.
 */
const readSettings = async () =>
  (await strapi.store({ type: 'plugin', name: 'magic-link' }).get({ key: 'settings' })) || {};

/**
 * Whether the unbound legacy OTP flow may run: only with strict binding
 * explicitly disabled and no MFA mode active (AUTH-05).
 *
 * @param {object} settings - Settings.
 * @returns {'strict'|'legacy'|'refused'} Mode.
 */
const bindingMode = (settings) => {
  if (settings.otp_strict_binding !== false) return 'strict';
  return resolveMfaMode(settings) === 'disabled' ? 'legacy' : 'refused';
};

const minutesOf = (seconds) => Math.max(1, Math.ceil(Number(seconds) / 60));

const deliveryFailed = (ctx) => {
  ctx.status = 503;
  ctx.body = {
    success: false,
    error: { code: 'OTP_EMAIL_FAILED', message: 'The code could not be sent.' },
  };
  return ctx.body;
};

/**
 * Returns the admin principal of the request.
 *
 * @param {object} ctx - Koa context.
 * @returns {{type: 'admin', id: number}} Principal.
 */
const adminPrincipal = (ctx) => ({ type: 'admin', id: ctx.state.user.id });

/**
 * Verifies a code from the admin's current authenticator: a TOTP code, or a
 * backup code when the input has the backup-code shape.
 *
 * @param {object} otpService - OTP service.
 * @param {object} principal - Principal.
 * @param {string} token - Submitted code.
 * @returns {Promise<{valid: boolean}>}
 */
const verifyCurrentFactor = (otpService, principal, token) =>
  normalizeBackupCode(token)
    ? otpService.verifySecondFactor(principal, { backupCode: token })
    : otpService.verifySecondFactor(principal, { totpCode: token });

/**
 * Strips stored hashes and bindings from an OTP code row for the admin list.
 *
 * @param {object} row - Row.
 * @returns {object} Display fields.
 */
const toAdminRow = (row) => ({
  id: row.id,
  documentId: row.documentId,
  email: row.email,
  type: row.type,
  used: row.used,
  attempts: row.attempts,
  expiresAt: row.expiresAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  bound: Boolean(row.magicLinkToken),
  metadata: row.metadata
    ? { ipAddress: row.metadata.ipAddress || null, userAgent: row.metadata.userAgent || null }
    : null,
});

module.exports = {
  /**
   * Sends a new e-mail OTP for a pending login challenge.
   *
   * @route POST /api/magic-link/otp/send
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async send(ctx) {
    setNoStoreHeaders(ctx);
    const { email, magicLinkToken } = parseBody(otpSendSchema, ctx.request.body);
    try {
      const otpService = plugin().service('otp');
      const otpSettings = await otpService.getOTPSettings();
      if (!otpSettings.enabled) return ctx.badRequest('OTP is not enabled');

      const rateLimited = await enforceOtpRateLimits(ctx, email, 'send');
      if (rateLimited) return ctx.tooManyRequests(rateLimited.message);

      const settings = await readSettings();
      const mode = bindingMode(settings);
      if (mode === 'refused')
        return ctx.badRequest('magicLinkToken is required while MFA is active');

      let boundToken = null;
      if (mode === 'strict') {
        // A missing token is a frontend bug and gets a clear 400; a wrong
        // token gets the generic answer (no enumeration).
        if (!magicLinkToken) {
          return ctx.badRequest(
            'magicLinkToken is required. Call /magic-link/login first and pass the returned loginToken as magicLinkToken.'
          );
        }
        boundToken = await plugin()
          .service('magic-link')
          .validateBindingForChallenge(magicLinkToken, email, 'otp');
        if (!boundToken) {
          strapi.log.warn('[magic-link] OTP send: challenge binding rejected');
          return ctx.send({ success: true, message: GENERIC_OTP_RESPONSE });
        }
      }

      const otpEntry = await otpService.createOTP(email, 'email', {
        magicLinkToken: boundToken?.token || null,
        expirySeconds: otpSettings.expiry,
        codeLength: otpSettings.length,
        ipAddress: ctx.request.ip,
        userAgent: ctx.request.headers?.['user-agent'],
      });

      try {
        await otpService.sendOTPEmail(email, otpEntry.code, {
          locale: i18n.getLocaleFromContext(ctx),
          expiryMinutes: minutesOf(otpSettings.expiry),
        });
      } catch {
        strapi.log.error('[magic-link] OTP e-mail delivery failed');
        return deliveryFailed(ctx);
      }

      return ctx.send({
        success: true,
        message: 'OTP code sent successfully',
        expiresIn: otpSettings.expiry,
        type: 'email',
      });
    } catch {
      strapi.log.error('[magic-link] OTP send request failed');
      return ctx.badRequest('Failed to send OTP code');
    }
  },

  /**
   * Verifies an e-mail OTP and completes the login.
   *
   * @route POST /api/magic-link/otp/verify
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async verify(ctx) {
    setNoStoreHeaders(ctx);
    const { email, code, magicLinkToken } = parseBody(otpVerifySchema, ctx.request.body);
    try {
      const otpService = plugin().service('otp');
      const magicLinkService = plugin().service('magic-link');
      const otpSettings = await otpService.getOTPSettings();
      if (!otpSettings.enabled) return ctx.badRequest('OTP is not enabled');

      const rateLimited =
        (await enforceOtpRateLimits(ctx, email, 'verify')) ||
        (await enforceVerificationLimit(ctx, limiterKey('otp-verify', email)));
      if (rateLimited) return ctx.tooManyRequests(rateLimited.message);

      const settings = await readSettings();
      const mode = bindingMode(settings);
      if (mode === 'refused') return ctx.badRequest(GENERIC_FAILURE);

      let boundToken = null;
      if (mode === 'strict') {
        boundToken = await magicLinkService.validateBindingForChallenge(
          magicLinkToken,
          email,
          'otp'
        );
        if (!boundToken) {
          strapi.log.warn('[magic-link] OTP verify: challenge binding rejected');
          return ctx.badRequest(GENERIC_FAILURE);
        }
      }

      const verification = await otpService.verifyOTP(
        email,
        code,
        'email',
        boundToken?.token || null
      );
      if (!verification.valid) return ctx.badRequest(GENERIC_FAILURE);

      const users = await strapi.documents(USER_UID).findMany({ filters: { email }, limit: 1 });
      const user = users && users[0];
      if (!user || user.blocked) return ctx.badRequest(GENERIC_FAILURE);
      if (
        boundToken?.challenge?.userDocumentId &&
        boundToken.challenge.userDocumentId !== user.documentId
      ) {
        return ctx.badRequest(GENERIC_FAILURE);
      }

      // Re-check the CURRENT policy: an authenticator enrolled after the
      // challenge started, or MFA switched to required, means an e-mail code
      // no longer completes this login (re-opening the link starts the
      // required challenge).
      const required = await requiredChallenge(otpService, settings, user.id);
      if (!challengeSatisfiesPolicy('otp', required)) return ctx.badRequest(GENERIC_FAILURE);

      if (boundToken) {
        const consumed = await magicLinkService.consumeChallenge(boundToken, 'otp', {
          userAgent: ctx.request.headers?.['user-agent'],
          ipAddress: ctx.request.ip,
        });
        if (!consumed) return ctx.badRequest(GENERIC_FAILURE);
      }

      // The code was delivered to the mailbox. An unconfirmed account is
      // claimed: earlier sessions end and a foreign password is invalidated.
      await claimUnconfirmedAccount(strapi, user);

      const body = await issueLoginSession(strapi, ctx, {
        user,
        settings,
        context: boundToken ? filterContext(boundToken.context, settings) : {},
        source: boundToken ? 'Magic Link + Email OTP' : 'Email OTP',
        extras: { otpVerified: true },
      });
      return ctx.send(body);
    } catch {
      strapi.log.error('[magic-link] OTP verification request failed');
      return ctx.badRequest('Failed to verify OTP code');
    }
  },

  /**
   * Sends a new code after the resend cooldown.
   *
   * @route POST /api/magic-link/otp/resend
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async resend(ctx) {
    setNoStoreHeaders(ctx);
    const { email, magicLinkToken } = parseBody(otpResendSchema, ctx.request.body);
    try {
      const otpService = plugin().service('otp');
      const otpSettings = await otpService.getOTPSettings();
      if (!otpSettings.enabled) return ctx.badRequest('OTP is not enabled');

      const rateLimited = await enforceOtpRateLimits(ctx, email, 'resend');
      if (rateLimited) return ctx.tooManyRequests(rateLimited.message);

      const settings = await readSettings();
      const mode = bindingMode(settings);
      if (mode === 'refused')
        return ctx.badRequest('magicLinkToken is required while MFA is active');

      let boundToken = null;
      if (mode === 'strict') {
        if (!magicLinkToken) {
          return ctx.badRequest(
            'magicLinkToken is required for OTP resend. Call /magic-link/login first and pass the returned loginToken as magicLinkToken.'
          );
        }
        boundToken = await plugin()
          .service('magic-link')
          .validateBindingForChallenge(magicLinkToken, email, 'otp');
        if (!boundToken) {
          strapi.log.warn('[magic-link] OTP resend: challenge binding rejected');
          return ctx.send({ success: true, message: GENERIC_OTP_RESPONSE });
        }
      }

      const lastCodes = await strapi.db.query(OTP_UID).findMany({
        where: { email, type: 'email' },
        orderBy: { createdAt: 'desc' },
        limit: 1,
      });
      if (lastCodes && lastCodes.length > 0) {
        const secondsSinceLastSend =
          (Date.now() - new Date(lastCodes[0].createdAt).getTime()) / 1000;
        if (secondsSinceLastSend < otpSettings.resendCooldown) {
          const waitTime = Math.ceil(otpSettings.resendCooldown - secondsSinceLastSend);
          ctx.set('Retry-After', String(waitTime));
          return ctx.tooManyRequests(
            `Please wait ${waitTime} seconds before requesting a new code`
          );
        }
      }

      const otpEntry = await otpService.createOTP(email, 'email', {
        magicLinkToken: boundToken?.token || null,
        expirySeconds: otpSettings.expiry,
        codeLength: otpSettings.length,
        ipAddress: ctx.request.ip,
        userAgent: ctx.request.headers?.['user-agent'],
      });

      try {
        await otpService.sendOTPEmail(email, otpEntry.code, {
          locale: i18n.getLocaleFromContext(ctx),
          expiryMinutes: minutesOf(otpSettings.expiry),
        });
      } catch {
        strapi.log.error('[magic-link] OTP resend delivery failed');
        return deliveryFailed(ctx);
      }

      return ctx.send({
        success: true,
        message: 'New OTP code sent successfully',
        expiresIn: otpSettings.expiry,
      });
    } catch {
      strapi.log.error('[magic-link] OTP resend request failed');
      return ctx.badRequest('Failed to resend OTP code');
    }
  },

  // ───────────────────────────── Admin: OTP codes ─────────────────────────────

  /**
   * Lists OTP codes with server-side filters and pagination. Hashes and
   * bindings are never returned.
   *
   * @route GET /magic-link/otp/codes
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async listCodes(ctx) {
    const query = parseBody(otpCodesQuerySchema, ctx.query || {});
    const pageSize = Math.min(query.pageSize, ADMIN_PAGE_SIZE_LIMIT);
    const now = new Date();
    const where = {};
    if (query.email) where.email = { $containsi: query.email };
    if (query.type) where.type = query.type;
    if (query.status) Object.assign(where, otpStatusWhere(query.status, now));
    const count = (filter) => strapi.db.query(OTP_UID).count({ where: filter });

    try {
      const [rows, total, all, active, expired, used] = await Promise.all([
        strapi.db.query(OTP_UID).findMany({
          where,
          orderBy: { createdAt: 'desc' },
          offset: (query.page - 1) * pageSize,
          limit: pageSize,
        }),
        count(where),
        // Stat cards count every code, independent of search and filters.
        count({}),
        count(otpStatusWhere('active', now)),
        count(otpStatusWhere('expired', now)),
        count(otpStatusWhere('used', now)),
      ]);

      return ctx.send({
        codes: (rows || []).map(toAdminRow),
        stats: { total: all, active, expired, used },
        pagination: {
          page: query.page,
          pageSize,
          total,
          pageCount: Math.ceil(total / pageSize),
          truncated: query.pageSize > pageSize,
        },
      });
    } catch {
      strapi.log.error('[magic-link] Admin OTP list request failed');
      return ctx.badRequest('Failed to list OTP codes');
    }
  },

  /**
   * Deletes one OTP code by documentId (or by numeric id, as older admin
   * builds send it).
   *
   * @route DELETE /magic-link/otp/codes/:id
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async deleteCode(ctx) {
    const raw = String(ctx.params?.id || '');
    if (!/^[A-Za-z0-9]{1,64}$/.test(raw)) return ctx.badRequest('Invalid OTP code id');
    try {
      const where = /^\d+$/.test(raw) ? { id: Number(raw) } : { documentId: raw };
      const result = await strapi.db.query(OTP_UID).deleteMany({ where });
      if (!result?.count) return ctx.notFound('OTP code not found');
      return ctx.send({ success: true, message: 'OTP code deleted successfully' });
    } catch {
      strapi.log.error('[magic-link] Admin OTP delete request failed');
      return ctx.badRequest('Failed to delete OTP code');
    }
  },

  /**
   * Deletes expired OTP codes.
   *
   * @route POST /magic-link/otp/cleanup
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async cleanup(ctx) {
    try {
      const deleted = await plugin().service('otp').cleanupExpiredCodes();
      return ctx.send({
        success: true,
        deleted,
        message: 'Expired OTP codes cleaned up successfully',
      });
    } catch {
      strapi.log.error('[magic-link] Admin OTP cleanup request failed');
      return ctx.badRequest('Failed to cleanup OTP codes');
    }
  },

  /**
   * Number of end users (users-permissions) with an active authenticator.
   * The Settings page uses it to warn before MFA becomes `required`.
   *
   * @route GET /magic-link/totp/enrollment-summary
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async enrollmentSummary(ctx) {
    try {
      const enrolled = await strapi.db.query('plugin::magic-link.totp-config').count({
        where: { principalType: 'users-permissions', enabled: true },
      });
      return ctx.send({ data: { enrolled, enrollmentDuringLogin: true } });
    } catch {
      strapi.log.error('[magic-link] TOTP enrolment summary request failed');
      return ctx.badRequest('Failed to load the enrolment summary');
    }
  },

  // ─────────────────── Admin: the admin user's own authenticator ───────────────────

  /**
   * Starts (re-)enrolment of the admin user's own authenticator. With an
   * active authenticator, `token` (a current code) is required.
   *
   * @route POST /magic-link/otp/totp/setup
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async setupTOTP(ctx) {
    setNoStoreHeaders(ctx);
    const { token } = parseBody(adminTotpSetupSchema, ctx.request.body);
    try {
      const otpService = plugin().service('otp');
      const principal = adminPrincipal(ctx);
      const limited = await enforceVerificationLimit(ctx, `admin:${principal.id}`);
      if (limited) return ctx.tooManyRequests(limited.message);
      const status = await otpService.getTOTPStatus(principal);
      if (status.enabled) {
        const check = token
          ? await verifyCurrentFactor(otpService, principal, token)
          : { valid: false };
        if (!check.valid) return ctx.forbidden('A current authenticator code is required');
      }
      const { binding: _binding, ...data } = await otpService.beginSetup(
        principal,
        ctx.state.user.email,
        {
          origin: 'admin',
        }
      );
      return ctx.send({ success: true, data });
    } catch {
      strapi.log.error('[magic-link] Admin TOTP setup request failed');
      return ctx.badRequest('Failed to setup TOTP');
    }
  },

  /**
   * Confirms a pending enrolment (returns backup codes once) or checks a
   * code of the active authenticator.
   *
   * @route POST /magic-link/otp/totp/verify
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async verifyTOTP(ctx) {
    setNoStoreHeaders(ctx);
    const { token } = parseBody(totpTokenOnlySchema, ctx.request.body);
    try {
      const otpService = plugin().service('otp');
      const principal = adminPrincipal(ctx);
      const limited = await enforceVerificationLimit(ctx, `admin:${principal.id}`);
      if (limited) return ctx.tooManyRequests(limited.message);
      const status = await otpService.getTOTPStatus(principal);
      const result = status.pendingSetup
        ? await otpService.confirmSetup(principal, token, { origin: 'admin' })
        : await otpService.verifyTOTP(principal, token);

      if (!result.valid) {
        return ctx.send({ success: false, error: result.error, message: result.message });
      }
      return ctx.send({
        success: true,
        enabled: true,
        ...(result.backupCodes ? { backupCodes: result.backupCodes } : {}),
        message: 'TOTP code verified successfully',
      });
    } catch {
      strapi.log.error('[magic-link] Admin TOTP verification request failed');
      return ctx.badRequest('Failed to verify TOTP');
    }
  },

  /**
   * Removes the admin user's authenticator after a current TOTP or backup code.
   *
   * @route POST /magic-link/otp/totp/disable
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async disableTOTP(ctx) {
    setNoStoreHeaders(ctx);
    const { token } = parseBody(totpTokenOnlySchema, ctx.request.body);
    try {
      const otpService = plugin().service('otp');
      const principal = adminPrincipal(ctx);
      const limited = await enforceVerificationLimit(ctx, `admin:${principal.id}`);
      if (limited) return ctx.tooManyRequests(limited.message);
      const status = await otpService.getTOTPStatus(principal);
      if (status.enabled) {
        const check = await verifyCurrentFactor(otpService, principal, token);
        if (!check.valid) return ctx.forbidden('A current authenticator code is required');
      }
      const removed = await otpService.disableTOTP(principal);
      return ctx.send(
        removed
          ? { success: true, message: 'TOTP disabled successfully' }
          : { success: false, message: 'TOTP was not enabled or does not exist' }
      );
    } catch {
      strapi.log.error('[magic-link] Admin TOTP disable request failed');
      return ctx.badRequest('Failed to disable TOTP');
    }
  },

  /**
   * Returns the admin user's authenticator status.
   *
   * @route GET /magic-link/otp/totp/status
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async getTOTPStatus(ctx) {
    setNoStoreHeaders(ctx);
    try {
      const status = await plugin().service('otp').getTOTPStatus(adminPrincipal(ctx));
      return ctx.send({ success: true, data: status });
    } catch {
      strapi.log.error('[magic-link] Admin TOTP status request failed');
      return ctx.badRequest('Failed to get TOTP status');
    }
  },

  /**
   * Replaces the admin user's backup codes after a current TOTP code.
   *
   * @route POST /magic-link/otp/totp/backup-codes
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async generateBackupCodes(ctx) {
    setNoStoreHeaders(ctx);
    const { token } = parseBody(totpTokenOnlySchema, ctx.request.body);
    try {
      const otpService = plugin().service('otp');
      const principal = adminPrincipal(ctx);
      const limited = await enforceVerificationLimit(ctx, `admin:${principal.id}`);
      if (limited) return ctx.tooManyRequests(limited.message);
      const check = await otpService.verifyTOTP(principal, token);
      if (!check.valid) return ctx.forbidden('A current authenticator code is required');
      const codes = await otpService.regenerateBackupCodes(principal);
      return ctx.send({
        success: true,
        codes,
        message: 'Backup codes generated. Store them securely!',
      });
    } catch {
      strapi.log.error('[magic-link] Admin TOTP backup-code request failed');
      return ctx.badRequest('Failed to generate backup codes');
    }
  },
};
