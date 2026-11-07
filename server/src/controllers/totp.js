'use strict';

/**
 * End-user authenticator (TOTP) management on the Content API.
 *
 * Two entry points:
 *
 * 1. Enrolment during login (public routes, proof = the magic link):
 *    when MFA is `required` and the user has no authenticator, /login
 *    answers `{ requiresTOTPSetup: true, loginToken }` and starts a server
 *    challenge of type `totp-setup`. The frontend then calls
 *    POST /totp/enroll { loginToken } and POST /totp/enroll/confirm
 *    { loginToken, totpCode }, which activates the authenticator, consumes
 *    the link and returns the session plus backup codes.
 *
 * 2. Self-service for logged-in users (users-permissions JWT; grant the
 *    actions to the Authenticated role): GET /totp/status, POST /totp/setup,
 *    POST /totp/confirm, POST /totp/disable, POST /totp/backup-codes.
 *    Setup needs a fresh e-mail code in addition to the JWT, re-setup and
 *    backup-code regeneration need a current TOTP code, disabling needs a
 *    current TOTP or backup code. A stolen JWT alone cannot add, replace or
 *    remove a second factor.
 *
 * The principal is always the users-permissions user (`up:<id>`), never an
 * admin user.
 */

const crypto = require('node:crypto');
const i18n = require('../utils/i18n');
const { normalizeEmail } = require('../utils/email');
const { resolveMfaMode } = require('../utils/mfa-mode');
const { filterContext } = require('../utils/context-policy');
const { issueLoginSession, setNoStoreHeaders } = require('../utils/login-session');
const {
  totpEnrollStartSchema,
  totpEnrollConfirmSchema,
  totpSetupSchema,
  totpConfirmSchema,
  totpDisableSchema,
  totpBackupCodesSchema,
  parseBody,
} = require('./validation');

const USER_UID = 'plugin::users-permissions.user';
const EMAIL_CODE_TTL_SECONDS = 15 * 60;

const plugin = () => strapi.plugin('magic-link');

const limiterKey = (scope, value) =>
  `${scope}:${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32)}`;

/**
 * Applies rate limits and writes a 429 when one is exceeded.
 *
 * @param {object} ctx - Koa context.
 * @param {string[]} keys - Limiter keys ('otp' limiter).
 * @returns {Promise<boolean>} True when the request may continue.
 */
const allow = async (ctx, keys) => {
  const limiter = plugin().service('rate-limiter');
  for (const key of keys) {
    const check = await limiter.checkRateLimit(key, 'otp');
    if (!check?.allowed) {
      const retryAfter = Number.isFinite(check?.retryAfter) ? check.retryAfter : 60;
      ctx.set('Retry-After', String(retryAfter));
      i18n.sendError(ctx, 'rate.limit.exceeded', 429, {}, { retryAfter });
      return false;
    }
  }
  return true;
};

/**
 * Returns the authenticated users-permissions user, or writes a 401.
 *
 * @param {object} ctx - Koa context.
 * @returns {object|null} User.
 */
const requireUser = (ctx) => {
  const user = ctx.state?.user;
  const strategy = ctx.state?.auth?.strategy?.name;
  if (!user?.id || !user.email || (strategy && strategy !== 'users-permissions')) {
    i18n.sendError(ctx, 'auth.required', 401);
    return null;
  }
  return user;
};

/**
 * Loads and checks a login token carrying a pending `totp-setup` challenge.
 *
 * @param {string} loginToken - Plaintext login token.
 * @returns {Promise<{token: object, user: object}|null>} Token and its user.
 */
const loadEnrollmentChallenge = async (loginToken) => {
  const magicLink = plugin().service('magic-link');
  const token = await magicLink.fetchToken(loginToken);
  const challenge = token?.challenge;
  if (!token || challenge?.type !== 'totp-setup' || challenge.verifiedAt) return null;
  if (!(await magicLink.isTokenValid({ ...token, is_used: false }))) return null;

  const user = challenge.userDocumentId
    ? await strapi.documents(USER_UID).findOne({ documentId: challenge.userDocumentId })
    : null;
  if (
    !user ||
    user.blocked ||
    String(user.id) !== String(challenge.userId) ||
    normalizeEmail(user.email) !== normalizeEmail(token.email)
  ) {
    return null;
  }
  return { token, user };
};

/**
 * Public part of the setup data (the binding stays on the server).
 *
 * @param {object} setup - beginSetup() result.
 * @returns {object} Response data.
 */
const publicSetup = ({ binding: _binding, ...data }) => data;

module.exports = {
  /**
   * Starts authenticator enrolment for a login that requires MFA.
   *
   * @route POST /api/magic-link/totp/enroll
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async enroll(ctx) {
    setNoStoreHeaders(ctx);
    const { loginToken } = parseBody(totpEnrollStartSchema, ctx.request.body);
    if (
      !(await allow(ctx, [
        `ip:totp-enroll:${ctx.request.ip}`,
        limiterKey('totp-enroll', loginToken),
      ]))
    ) {
      return undefined;
    }

    const loaded = await loadEnrollmentChallenge(loginToken);
    if (!loaded) return i18n.sendError(ctx, 'challenge.invalid', 400);

    const otpService = plugin().service('otp');
    const status = await otpService.getTOTPStatus(loaded.user.id);
    if (status.enabled) return i18n.sendError(ctx, 'totp.alreadyEnrolled', 409);

    const setup = await otpService.beginSetup(loaded.user.id, loaded.user.email, {
      origin: 'login',
    });
    return ctx.send({ data: publicSetup(setup) });
  },

  /**
   * Activates the authenticator enrolled during login and completes the login.
   *
   * @route POST /api/magic-link/totp/enroll/confirm
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async enrollConfirm(ctx) {
    setNoStoreHeaders(ctx);
    const { loginToken, totpCode } = parseBody(totpEnrollConfirmSchema, ctx.request.body);
    if (
      !(await allow(ctx, [
        `ip:totp-enroll:${ctx.request.ip}`,
        limiterKey('totp-enroll-confirm', loginToken),
      ]))
    ) {
      return undefined;
    }

    const loaded = await loadEnrollmentChallenge(loginToken);
    if (!loaded) return i18n.sendError(ctx, 'challenge.invalid', 400);
    const { token, user } = loaded;

    const otpService = plugin().service('otp');
    const result = await otpService.confirmSetup(user.id, totpCode, { origin: 'login' });
    if (!result.valid) {
      return result.error === 'totp_not_setup'
        ? i18n.sendError(ctx, 'totp.noPendingSetup', 400)
        : i18n.sendError(ctx, 'mfa.invalidCode', 400);
    }

    const magicLink = plugin().service('magic-link');
    const consumed = await magicLink.consumeChallenge(token, 'totp-setup', {
      ipAddress: ctx.request.ip,
      userAgent: ctx.request.header?.['user-agent'],
    });
    if (!consumed) return i18n.sendError(ctx, 'challenge.invalid', 400);

    // The magic link proved ownership of the address.
    if (!user.confirmed) {
      await strapi.plugin('users-permissions').service('user').edit(user.id, { confirmed: true });
      user.confirmed = true;
    }

    const settings = (await magicLink.settings()) || {};
    const body = await issueLoginSession(strapi, ctx, {
      user,
      settings,
      context: filterContext(token.context, settings),
      source: 'Magic Link + TOTP enrolment',
      claims: { mfaVerified: true },
      extras: { mfaVerified: true },
    });
    // Backup codes are added after the session record was written, so they
    // never end up in the session store.
    return ctx.send({ ...body, backupCodes: result.backupCodes });
  },

  /**
   * Returns the authenticator status of the logged-in user.
   *
   * @route GET /api/magic-link/totp/status
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async status(ctx) {
    const user = requireUser(ctx);
    if (!user) return undefined;
    const status = await plugin().service('otp').getTOTPStatus(user.id);
    const settings = (await plugin().service('magic-link').settings()) || {};
    return ctx.send({
      data: {
        ...status,
        mfaMode: resolveMfaMode(settings),
      },
    });
  },

  /**
   * Starts (re-)enrolment for the logged-in user. Sends an e-mail code that
   * /totp/confirm needs. With an active authenticator, `totpCode` (a
   * current code) is required as well.
   *
   * @route POST /api/magic-link/totp/setup
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async setup(ctx) {
    setNoStoreHeaders(ctx);
    const { totpCode } = parseBody(totpSetupSchema, ctx.request.body);
    const user = requireUser(ctx);
    if (!user) return undefined;
    if (!(await allow(ctx, [`ip:totp-setup:${ctx.request.ip}`, `user:totp-setup:${user.id}`])))
      return undefined;

    const otpService = plugin().service('otp');
    const status = await otpService.getTOTPStatus(user.id);
    if (status.enabled) {
      const check = totpCode ? await otpService.verifyTOTP(user.id, totpCode) : { valid: false };
      if (!check.valid) return i18n.sendError(ctx, 'totp.currentCodeRequired', 403);
    }

    const setup = await otpService.beginSetup(user.id, user.email, {
      origin: 'account',
      requireEmailProof: true,
    });
    const otpSettings = await otpService.getOTPSettings();
    const entry = await otpService.createOTP(user.email, 'totp-setup', {
      magicLinkToken: setup.binding,
      expirySeconds: EMAIL_CODE_TTL_SECONDS,
      codeLength: otpSettings.length,
      ipAddress: ctx.request.ip,
      userAgent: ctx.request.header?.['user-agent'],
    });
    try {
      await otpService.sendOTPEmail(user.email, entry.code, {
        subject: 'Confirm your authenticator app',
        intro: 'Enter this code to confirm the new authenticator app for your account:',
        expiryMinutes: EMAIL_CODE_TTL_SECONDS / 60,
      });
    } catch {
      strapi.log.error('[magic-link] Authenticator setup e-mail delivery failed');
      return i18n.sendError(ctx, 'otp.deliveryFailed', 503);
    }

    return ctx.send({ data: { ...publicSetup(setup), emailCodeSent: true } });
  },

  /**
   * Activates the staged authenticator with a code from the app and the
   * e-mailed code. Returns backup codes once.
   *
   * @route POST /api/magic-link/totp/confirm
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async confirm(ctx) {
    setNoStoreHeaders(ctx);
    const { totpCode, emailCode } = parseBody(totpConfirmSchema, ctx.request.body);
    const user = requireUser(ctx);
    if (!user) return undefined;
    if (!(await allow(ctx, [`ip:totp-confirm:${ctx.request.ip}`, `user:totp-confirm:${user.id}`])))
      return undefined;

    const result = await plugin()
      .service('otp')
      .confirmSetup(user.id, totpCode, {
        origin: 'account',
        emailProof: { email: user.email, code: emailCode },
      });
    if (!result.valid) {
      if (result.error === 'totp_not_setup') return i18n.sendError(ctx, 'totp.noPendingSetup', 400);
      if (result.error === 'invalid_email_code' || result.error === 'email_proof_required') {
        return i18n.sendError(ctx, 'totp.invalidEmailCode', 400);
      }
      return i18n.sendError(ctx, 'mfa.invalidCode', 400);
    }
    return ctx.send({ data: { enabled: true, backupCodes: result.backupCodes } });
  },

  /**
   * Removes the authenticator after a current TOTP or backup code.
   *
   * @route POST /api/magic-link/totp/disable
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async disable(ctx) {
    const { totpCode, backupCode } = parseBody(totpDisableSchema, ctx.request.body);
    const user = requireUser(ctx);
    if (!user) return undefined;
    if (!(await allow(ctx, [`ip:totp-disable:${ctx.request.ip}`, `user:totp-disable:${user.id}`])))
      return undefined;

    const otpService = plugin().service('otp');
    const status = await otpService.getTOTPStatus(user.id);
    if (!status.enabled) return i18n.sendError(ctx, 'totp.notEnrolled', 400);
    const check = await otpService.verifySecondFactor(user.id, { totpCode, backupCode });
    if (!check.valid) return i18n.sendError(ctx, 'mfa.invalidCode', 400);

    await otpService.disableTOTP(user.id);
    return ctx.send({ data: { enabled: false } });
  },

  /**
   * Replaces the backup codes after a current TOTP code.
   *
   * @route POST /api/magic-link/totp/backup-codes
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async backupCodes(ctx) {
    setNoStoreHeaders(ctx);
    const { totpCode } = parseBody(totpBackupCodesSchema, ctx.request.body);
    const user = requireUser(ctx);
    if (!user) return undefined;
    if (!(await allow(ctx, [`ip:totp-backup:${ctx.request.ip}`, `user:totp-backup:${user.id}`])))
      return undefined;

    const otpService = plugin().service('otp');
    const status = await otpService.getTOTPStatus(user.id);
    if (!status.enabled) return i18n.sendError(ctx, 'totp.notEnrolled', 400);
    const check = await otpService.verifyTOTP(user.id, totpCode);
    if (!check.valid) return i18n.sendError(ctx, 'mfa.invalidCode', 400);

    const codes = await otpService.regenerateBackupCodes(user.id);
    return ctx.send({ data: { backupCodes: codes } });
  },
};
