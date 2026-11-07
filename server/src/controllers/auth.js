'use strict';

/**
 * Public authentication controller: send-link, link login (GET and POST),
 * Magic Link + TOTP and TOTP-only login.
 *
 * Security model:
 * - E-mail is the only delivery channel.
 * - Second-factor state is kept in the server-only `challenge` attribute of
 *   the token. Client context can neither start nor skip a challenge.
 * - TOTP takes precedence over e-mail OTP: a user with an enabled
 *   authenticator always gets the TOTP challenge (the link click already
 *   proves e-mail ownership), so enabling OTP can never weaken MFA.
 * - Required MFA without an authenticator starts a `totp-setup` challenge:
 *   the user enrols through /totp/enroll and /totp/enroll/confirm
 *   (controllers/totp.js) before any session is issued.
 * - Tokens are consumed with conditional updates (single use is atomic).
 * - Sessions are issued through utils/login-session.js, which honours the
 *   users-permissions jwtManagement mode and sanitizes the user.
 */

const crypto = require('node:crypto');
const i18n = require('../utils/i18n');
const { normalizeEmail } = require('../utils/email');
const { resolveMfaMode } = require('../utils/mfa-mode');
const { filterContext } = require('../utils/context-policy');
const { issueLoginSession, setNoStoreHeaders } = require('../utils/login-session');
const {
  sendLinkSchema,
  loginExchangeSchema,
  mfaVerifyTotpSchema,
  loginWithTotpSchema,
  parseBody,
} = require('./validation');

const USER_UID = 'plugin::users-permissions.user';

const plugin = () => strapi.plugin('magic-link');

/**
 * Applies a rate-limit check and writes a 429 response when exceeded.
 *
 * @param {object} ctx - Koa context.
 * @param {string} key - Limiter key.
 * @param {string} type - Limiter type.
 * @returns {Promise<boolean>} True when the request may continue.
 */
const allowRequest = async (ctx, key, type) => {
  const check = await plugin().service('rate-limiter').checkRateLimit(key, type);
  if (check?.allowed) return true;
  const retryAfter = Number.isFinite(check?.retryAfter) ? check.retryAfter : 60;
  ctx.set('Retry-After', String(retryAfter));
  i18n.sendError(ctx, 'rate.limit.exceeded', 429, {}, { retryAfter });
  return false;
};

/**
 * Hashes a value for use as a rate-limiter key, so login tokens and e-mail
 * addresses are never kept in clear in limiter memory.
 *
 * @param {string} scope - Key scope.
 * @param {string} value - Value to hash.
 * @returns {string} Limiter key.
 */
const limiterKey = (scope, value) =>
  `${scope}:${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32)}`;

/**
 * Finds a users-permissions user by normalised e-mail.
 *
 * @param {string} email - E-mail address.
 * @returns {Promise<object|null>} User or null.
 */
const findUserByEmail = async (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const users = await strapi
    .documents(USER_UID)
    .findMany({ filters: { email: normalized }, limit: 1 });
  return (users && users[0]) || null;
};

/**
 * Marks a user as confirmed. Only called after a magic link was used, which
 * proves ownership of the e-mail address.
 *
 * @param {object} user - User entity.
 * @returns {Promise<void>}
 */
const confirmUser = async (user) => {
  if (user.confirmed) return;
  await strapi.plugin('users-permissions').service('user').edit(user.id, { confirmed: true });
  user.confirmed = true;
};

const requestInfoOf = (ctx) => ({
  userAgent: ctx.request?.header?.['user-agent'],
  ipAddress: ctx.request?.ip,
});

/**
 * Decides which second factor a login needs.
 *
 * @param {object} settings - Plugin settings.
 * @param {object} user - User entity.
 * @returns {Promise<'totp'|'otp'|'setup-required'|null>} Required challenge.
 */
const resolveChallenge = async (settings, user) => {
  const mfaMode = resolveMfaMode(settings);
  if (mfaMode !== 'disabled') {
    const status = await plugin().service('otp').getTOTPStatus(user.id);
    const totpEnabled = Boolean(status?.configured && status?.enabled);
    if (totpEnabled) return 'totp';
    if (mfaMode === 'required') return 'setup-required';
  }
  if (settings.otp_enabled === true) return 'otp';
  return null;
};

/**
 * Creates and mails an e-mail OTP for a pending challenge.
 *
 * @param {object} ctx - Koa context.
 * @param {object} token - Token record.
 * @param {object} settings - Plugin settings.
 * @returns {Promise<boolean>} Whether the code was sent (else a 503 was written).
 */
const sendChallengeOtp = async (ctx, token, settings) => {
  const otpService = plugin().service('otp');
  const expirySeconds = Number.isFinite(settings.otp_expiry) ? settings.otp_expiry : 300;
  const otpEntry = await otpService.createOTP(token.email, 'email', {
    magicLinkToken: token.token,
    expirySeconds,
    codeLength: settings.otp_length || 6,
    ipAddress: ctx.request.ip,
    userAgent: ctx.request.header?.['user-agent'],
  });

  try {
    await otpService.sendOTPEmail(token.email, otpEntry.code, {
      subject: 'Your Verification Code',
      expiryMinutes: Math.max(1, Math.round(expirySeconds / 60)),
    });
    return true;
  } catch {
    strapi.log.error('[magic-link] OTP e-mail delivery failed');
    i18n.sendError(
      ctx,
      'otp.deliveryFailed',
      503,
      {},
      {
        code: 'OTP_EMAIL_FAILED',
        resendEndpoint: '/api/magic-link/otp/resend',
      }
    );
    return false;
  }
};

const otpChallengeResponse = (token, loginToken, settings) => ({
  requiresOTP: true,
  message: 'OTP verification required',
  email: token.email,
  loginToken,
  expiresIn: Number.isFinite(settings.otp_expiry) ? settings.otp_expiry : 300,
});

const totpChallengeResponse = (token, loginToken) => ({
  requiresTOTP: true,
  message: 'TOTP verification required for MFA',
  email: token.email,
  loginToken,
});

const totpSetupChallengeResponse = (token, loginToken) => ({
  requiresTOTPSetup: true,
  message: 'Set up an authenticator app to continue',
  email: token.email,
  loginToken,
  enrollEndpoint: '/api/magic-link/totp/enroll',
});

/**
 * Reads the login token from a POST body (preferred) or the legacy GET query.
 *
 * @param {object} ctx - Koa context.
 * @returns {string|null} Login token.
 */
const readLoginToken = (ctx) => {
  if (String(ctx.method || '').toUpperCase() === 'POST') {
    return parseBody(loginExchangeSchema, ctx.request.body).loginToken;
  }
  const value = ctx.query?.loginToken;
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null;
};

module.exports = {
  /**
   * Exchanges a magic-link token for a session, or starts the required
   * second-factor challenge.
   *
   * POST /api/magic-link/login { loginToken } is the recommended call from a
   * frontend landing page. GET /api/magic-link/login?loginToken=... is kept
   * for compatibility (the token then appears in access logs).
   *
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async login(ctx) {
    setNoStoreHeaders(ctx);
    const loginToken = readLoginToken(ctx);
    if (!loginToken) {
      return i18n.sendError(ctx, 'token.invalid', 400);
    }

    if (!(await allowRequest(ctx, ctx.request.ip, 'login'))) return undefined;

    const magicLink = plugin().service('magic-link');
    const token = await magicLink.fetchToken(loginToken);
    if (!token) {
      return i18n.sendError(ctx, 'token.invalid', 400);
    }

    const pendingChallenge =
      token.challenge && !token.challenge.verifiedAt ? token.challenge : null;
    const isValid = pendingChallenge
      ? await magicLink.isTokenValid({ ...token, is_used: false })
      : await magicLink.isTokenValid(token);
    if (!isValid) {
      await magicLink.deactivateToken(token);
      return i18n.sendError(ctx, 'token.invalid', 400);
    }

    const settings = (await magicLink.settings()) || {};
    const user = await findUserByEmail(token.email);
    if (!user) {
      await magicLink.deactivateToken(token);
      return i18n.sendError(ctx, 'token.invalid', 400);
    }
    if (user.blocked) {
      await magicLink.deactivateToken(token);
      return i18n.sendError(ctx, 'blocked.user', 403);
    }

    // A started challenge is never skipped. Repeated opens (mail scanners,
    // double clicks) answer with the same challenge without new side effects
    // while the e-mail OTP is still valid.
    if (pendingChallenge) {
      if (pendingChallenge.type === 'totp') {
        return ctx.send(totpChallengeResponse(token, loginToken));
      }
      if (pendingChallenge.type === 'totp-setup') {
        return ctx.send(totpSetupChallengeResponse(token, loginToken));
      }
      const expirySeconds = Number.isFinite(settings.otp_expiry) ? settings.otp_expiry : 300;
      const sentAt = new Date(pendingChallenge.otpSentAt || 0).getTime();
      if (Number.isFinite(sentAt) && Date.now() - sentAt < expirySeconds * 1000) {
        return ctx.send(otpChallengeResponse(token, loginToken, settings));
      }
      const restarted = await magicLink.startChallenge(token, {
        ...pendingChallenge,
        otpSentAt: new Date().toISOString(),
      });
      if (!restarted) return i18n.sendError(ctx, 'token.invalid', 400);
      if (!(await sendChallengeOtp(ctx, token, settings))) return undefined;
      return ctx.send(otpChallengeResponse(token, loginToken, settings));
    }

    const challenge = await resolveChallenge(settings, user);

    if (challenge === 'setup-required') {
      // The link click proves the mailbox; the user enrols an authenticator
      // before any session exists (controllers/totp.js enroll*).
      const started = await magicLink.startChallenge(token, {
        type: 'totp-setup',
        userId: user.id,
        userDocumentId: user.documentId,
      });
      if (!started) return i18n.sendError(ctx, 'token.invalid', 400);
      return ctx.send(totpSetupChallengeResponse(token, loginToken));
    }

    if (challenge === 'totp') {
      const started = await magicLink.startChallenge(token, {
        type: 'totp',
        userId: user.id,
        userDocumentId: user.documentId,
      });
      if (!started) return i18n.sendError(ctx, 'token.invalid', 400);
      return ctx.send(totpChallengeResponse(token, loginToken));
    }

    if (challenge === 'otp') {
      const started = await magicLink.startChallenge(token, {
        type: 'otp',
        userId: user.id,
        userDocumentId: user.documentId,
        otpSentAt: new Date().toISOString(),
      });
      if (!started) return i18n.sendError(ctx, 'token.invalid', 400);
      if (!(await sendChallengeOtp(ctx, token, settings))) return undefined;
      return ctx.send(otpChallengeResponse(token, loginToken, settings));
    }

    const consumed = await magicLink.consumeLoginToken(token, requestInfoOf(ctx));
    if (!consumed) {
      return i18n.sendError(ctx, 'token.invalid', 400);
    }

    await confirmUser(user);
    const body = await issueLoginSession(strapi, ctx, {
      user,
      settings,
      context: filterContext(token.context, settings),
      source: 'Magic Link Login',
    });
    return ctx.send(body);
  },

  /**
   * Requests a magic link by e-mail. The response is identical for known,
   * unknown, blocked and unconfirmed addresses and is sent before any user
   * lookup or mail delivery happens, so neither status nor timing reveals
   * whether an account exists.
   *
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async sendLink(ctx) {
    const params = parseBody(sendLinkSchema, ctx.request.body);

    if (!(await allowRequest(ctx, ctx.request.ip, 'ip'))) return undefined;
    if (!(await allowRequest(ctx, params.email, 'email'))) return undefined;

    const magicLink = plugin().service('magic-link');
    Promise.resolve()
      .then(() =>
        magicLink.requestLoginLink({
          email: params.email,
          username: params.username,
          context: params.context || {},
        })
      )
      .then((outcome) => {
        if (outcome !== 'sent')
          strapi.log.debug(`[magic-link] send-link finished without mail: ${outcome}`);
      })
      .catch(() => {
        strapi.log.error('[magic-link] send-link processing failed');
      });

    return ctx.send({
      email: params.email,
      username: params.username || null,
      sent: true,
      delivery: 'email',
    });
  },

  /**
   * Completes a Magic Link + TOTP challenge started by login().
   *
   * @route POST /api/magic-link/verify-mfa-totp
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async verifyMFATOTP(ctx) {
    setNoStoreHeaders(ctx);
    const { loginToken, totpCode, backupCode } = parseBody(mfaVerifyTotpSchema, ctx.request.body);

    if (!(await allowRequest(ctx, ctx.request.ip, 'otp'))) return undefined;
    if (!(await allowRequest(ctx, limiterKey('totp-challenge', loginToken), 'otp')))
      return undefined;

    const magicLink = plugin().service('magic-link');
    const otpService = plugin().service('otp');

    const token = await magicLink.fetchToken(loginToken);
    const challenge = token?.challenge;
    if (!token || challenge?.type !== 'totp' || challenge.verifiedAt) {
      return i18n.sendError(ctx, 'challenge.invalid', 400);
    }
    if (!(await magicLink.isTokenValid({ ...token, is_used: false }))) {
      await magicLink.deactivateToken(token);
      return i18n.sendError(ctx, 'challenge.invalid', 400);
    }

    // The user comes from the server-side challenge and must still own the
    // token's e-mail address.
    const user = challenge.userDocumentId
      ? await strapi.documents(USER_UID).findOne({ documentId: challenge.userDocumentId })
      : null;
    if (
      !user ||
      String(user.id) !== String(challenge.userId) ||
      normalizeEmail(user.email) !== normalizeEmail(token.email)
    ) {
      await magicLink.deactivateToken(token);
      return i18n.sendError(ctx, 'challenge.invalid', 400);
    }
    if (user.blocked) {
      await magicLink.deactivateToken(token);
      return i18n.sendError(ctx, 'blocked.user', 403);
    }

    const status = await otpService.getTOTPStatus(user.id);
    if (!status?.configured || !status?.enabled) {
      return i18n.sendError(ctx, 'challenge.invalid', 400);
    }

    // A backup code is the recovery path when the authenticator is lost.
    const verification = await otpService.verifySecondFactor(user.id, { totpCode, backupCode });
    if (!verification?.valid) {
      return i18n.sendError(ctx, 'mfa.invalidCode', 400);
    }

    const consumed = await magicLink.consumeChallenge(token, 'totp', requestInfoOf(ctx));
    if (!consumed) {
      return i18n.sendError(ctx, 'challenge.invalid', 400);
    }

    await confirmUser(user);
    const settings = (await magicLink.settings()) || {};
    const body = await issueLoginSession(strapi, ctx, {
      user,
      settings,
      context: filterContext(token.context, settings),
      source:
        verification.method === 'backup-code'
          ? 'Magic Link + backup code (MFA)'
          : 'Magic Link + TOTP (MFA)',
      claims: { mfaVerified: true },
      extras: {
        mfaVerified: true,
        ...(verification.method === 'backup-code'
          ? { backupCodesRemaining: verification.remaining }
          : {}),
      },
    });
    return ctx.send(body);
  },

  /**
   * Passwordless login with e-mail + TOTP code (primary factor). Answers
   * with one generic error for unknown users, blocked users, missing
   * enrollment and wrong codes.
   *
   * @route POST /api/magic-link/login-totp
   * @param {object} ctx - Koa context.
   * @returns {Promise<void>}
   */
  async loginWithTOTP(ctx) {
    setNoStoreHeaders(ctx);
    const { email, totpCode } = parseBody(loginWithTotpSchema, ctx.request.body);

    // Per IP, per (account, IP) pair and a looser per-account budget: one
    // client cannot lock a victim out with a handful of requests, and many
    // clients together still cannot brute-force one account (AUTH-26).
    if (!(await allowRequest(ctx, ctx.request.ip, 'login'))) return undefined;
    if (!(await allowRequest(ctx, limiterKey('totp-login', `${email}|${ctx.request.ip}`), 'otp')))
      return undefined;
    if (!(await allowRequest(ctx, limiterKey('totp-login-account', email), 'login')))
      return undefined;

    const magicLink = plugin().service('magic-link');
    const otpService = plugin().service('otp');
    const settings = (await magicLink.settings()) || {};
    if (!settings.totp_as_primary_auth) {
      return i18n.sendError(ctx, 'totp.loginDisabled', 403);
    }

    const user = await findUserByEmail(email);
    const status = user && !user.blocked ? await otpService.getTOTPStatus(user.id) : null;
    if (!user || user.blocked || !status?.configured || !status?.enabled) {
      // Same work as a real verification, so timing does not reveal accounts.
      await otpService.simulateVerification?.(totpCode);
      return i18n.sendError(ctx, 'credentials.invalid', 400);
    }

    // TOTP does not prove e-mail ownership: never confirm here, and respect
    // the users-permissions "email confirmation" setting like /auth/local.
    if (!user.confirmed) {
      const advanced = await magicLink.userSettings();
      if (advanced?.email_confirmation) {
        return i18n.sendError(ctx, 'credentials.invalid', 400);
      }
    }

    const verification = await otpService.verifyTOTP(user.id, totpCode);
    if (!verification?.valid) {
      return i18n.sendError(ctx, 'credentials.invalid', 400);
    }

    const body = await issueLoginSession(strapi, ctx, {
      user,
      settings,
      context: {},
      source: 'TOTP Login (Primary)',
      claims: { totpLogin: true },
      extras: { loginMethod: 'totp' },
    });
    return ctx.send(body);
  },
};
