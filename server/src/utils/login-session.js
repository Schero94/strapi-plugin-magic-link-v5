'use strict';

/**
 * Single place where Magic Link turns a verified user into a session.
 *
 * Every login path (magic link, magic link + TOTP, TOTP-only and email OTP)
 * should call `issueLoginSession` so that all of them:
 *  - honour users-permissions `jwtManagement` ('legacy-support' or 'refresh'),
 *    issuing refresh + access tokens through the users-permissions session
 *    manager exactly like the native /api/auth/local login,
 *  - honour the plugin `jwt_token_expires_in` lifetime in legacy mode,
 *  - honour `use_jwt_token: false` without minting an unused token,
 *  - sanitize the user with Strapi's content-API sanitizer,
 *  - record a session entry whose expiry equals the real token expiry.
 *
 * Docs checked (2026-11-07): docs.strapi.io/cms/features/users-permissions
 * (jwtManagement, sessions.*, x-strapi-refresh-cookie) and the installed
 * @strapi/plugin-users-permissions 5.61 dist/server/controllers/auth.js
 * (sendRefreshAuthResponse) and @strapi/core 5.61 services/session-manager.js.
 */

const crypto = require('node:crypto');
// Not destructured: see the bundling note in controllers/validation.js.
const strapiUtils = require('@strapi/utils');
const { appendJwtSession } = require('./jwt-session-store');
const cryptoUtils = require('./crypto');
const createId = require('./id');

const USER_UID = 'plugin::users-permissions.user';
const DEFAULT_SESSION_DAYS = 30;
const EXPIRES_IN_PATTERN = /^(\d{1,6})([smhd])$/;

/**
 * Reads the users-permissions JWT management mode.
 *
 * @param {object} strapi - Strapi instance.
 * @returns {'legacy-support'|'refresh'} The configured mode.
 */
const getJwtManagementMode = (strapi) =>
  strapi?.config?.get?.('plugin::users-permissions.jwtManagement', 'legacy-support') === 'refresh'
    ? 'refresh'
    : 'legacy-support';

/**
 * Returns the configured plugin JWT lifetime when it is a valid
 * jsonwebtoken `expiresIn` value, otherwise undefined.
 *
 * @param {object} settings - Plugin settings.
 * @returns {string|undefined} e.g. '30d', '12h'.
 */
const getConfiguredExpiresIn = (settings) => {
  const value = settings?.jwt_token_expires_in;
  if (typeof value !== 'string') return undefined;
  const match = EXPIRES_IN_PATTERN.exec(value.trim());
  if (!match || Number(match[1]) <= 0) return undefined;
  return value.trim();
};

/**
 * Reads the `exp` claim of a JWT without verifying it. Only used for tokens
 * the plugin itself just issued.
 *
 * @param {string} token - JWT.
 * @returns {Date|null} Expiry date or null.
 */
const decodeJwtExpiry = (token) => {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!Number.isFinite(payload?.exp)) return null;
    return new Date(payload.exp * 1000);
  } catch {
    return null;
  }
};

/**
 * Sanitizes a users-permissions user for a content-API response, using the
 * same sanitizer as the users-permissions auth controller. Falls back to a
 * minimal allow-listed shape when the sanitizer is unavailable.
 *
 * @param {object} strapi - Strapi instance.
 * @param {object} ctx - Koa context.
 * @param {object} user - User entity.
 * @returns {Promise<object>} Sanitized user.
 */
const sanitizeUser = async (strapi, ctx, user) => {
  const sanitizeOutput = strapi?.contentAPI?.sanitize?.output;
  const model = typeof strapi?.getModel === 'function' ? strapi.getModel(USER_UID) : null;
  if (typeof sanitizeOutput === 'function' && model) {
    return sanitizeOutput(user, model, { auth: ctx?.state?.auth });
  }
  const { id, documentId, username, email, provider, confirmed, blocked, createdAt, updatedAt } = user || {};
  return { id, documentId, username, email, provider, confirmed, blocked, createdAt, updatedAt };
};

/**
 * Reads an optional client device id from the request body (same contract
 * as users-permissions /auth/local).
 *
 * @param {object} ctx - Koa context.
 * @returns {string|undefined} Device id.
 */
const extractDeviceId = (ctx) => {
  const deviceId = ctx?.request?.body?.deviceId;
  return typeof deviceId === 'string' && deviceId.length > 0 && deviceId.length <= 255 ? deviceId : undefined;
};

/**
 * Builds the session metadata like users-permissions does, when the installed
 * @strapi/utils provides the helper.
 *
 * @param {object} ctx - Koa context.
 * @returns {object|undefined} Metadata.
 */
const buildMetadata = (ctx) => {
  // buildSessionMetadata exists in @strapi/utils 5.x releases with
  // refresh-mode session metadata; older peers simply get no metadata.
  if (typeof strapiUtils.buildSessionMetadata !== 'function') return undefined;
  return strapiUtils.buildSessionMetadata({ userAgent: ctx?.request?.headers?.['user-agent'] });
};

/**
 * Issues refresh + access tokens through the users-permissions session
 * manager and sets the refresh cookie when the project or request asks for it.
 *
 * @param {object} strapi - Strapi instance.
 * @param {object} ctx - Koa context.
 * @param {object} user - User entity.
 * @returns {Promise<{jwt: string, refreshToken?: string, upSessionId: string, expiresAt: Date|null}>}
 */
const issueRefreshSession = async (strapi, ctx, user) => {
  const sessionManager = strapi.sessionManager('users-permissions');
  const metadata = buildMetadata(ctx);
  const refresh = await sessionManager.generateRefreshToken(
    String(user.id),
    extractDeviceId(ctx) || crypto.randomUUID(),
    { type: 'refresh', ...(metadata ? { metadata } : {}) }
  );
  const access = await sessionManager.generateAccessToken(refresh.token);
  if (!access || 'error' in access) {
    throw new Error('Failed to generate access token');
  }

  const upSessions = strapi.config.get('plugin::users-permissions.sessions') || {};
  const requestHttpOnly = ctx?.request?.header?.['x-strapi-refresh-cookie'] === 'httpOnly';
  const result = {
    jwt: access.token,
    upSessionId: refresh.sessionId,
    expiresAt: decodeJwtExpiry(access.token),
    refreshExpiresAt: refresh.absoluteExpiresAt,
  };

  if ((upSessions.httpOnly || requestHttpOnly) && ctx?.cookies?.set) {
    const isProduction = process.env.NODE_ENV === 'production';
    ctx.cookies.set(upSessions.cookie?.name || 'strapi_up_refresh', refresh.token, {
      httpOnly: true,
      secure: typeof upSessions.cookie?.secure === 'boolean' ? upSessions.cookie.secure : isProduction,
      sameSite: upSessions.cookie?.sameSite ?? 'lax',
      path: upSessions.cookie?.path ?? '/',
      domain: upSessions.cookie?.domain,
      maxAge: upSessions.cookie?.maxAge,
      overwrite: true,
    });
  } else {
    result.refreshToken = refresh.token;
  }

  return result;
};

/**
 * Issues a legacy users-permissions JWT with the configured plugin lifetime.
 *
 * @param {object} strapi - Strapi instance.
 * @param {object} user - User entity.
 * @param {object} payload - Additional claims.
 * @param {object} settings - Plugin settings.
 * @returns {Promise<{jwt: string, expiresAt: Date|null}>}
 */
const issueLegacyJwt = async (strapi, user, payload, settings) => {
  const jwtService = strapi.plugin('users-permissions').service('jwt');
  const expiresIn = getConfiguredExpiresIn(settings);
  const jwt = await jwtService.issue({ ...payload, id: user.id }, expiresIn ? { expiresIn } : {});
  return { jwt, expiresAt: decodeJwtExpiry(jwt) };
};

/**
 * Creates the login session and returns the response body.
 *
 * @param {object} strapi - Strapi instance.
 * @param {object} ctx - Koa context.
 * @param {object} params
 * @param {object} params.user - Verified, non-blocked user.
 * @param {object} params.settings - Plugin settings.
 * @param {object} [params.context] - Already filtered token context.
 * @param {string} params.source - Session source label.
 * @param {object} [params.claims] - Extra JWT claims (legacy mode only).
 * @param {object} [params.extras] - Extra response and session fields.
 * @returns {Promise<object>} Response body.
 */
const issueLoginSession = async (strapi, ctx, { user, settings, context = {}, source, claims = {}, extras = {} }) => {
  const sanitizedUser = await sanitizeUser(strapi, ctx, user);
  const base = { user: sanitizedUser, context, ...extras };

  // Never mint a token that is thrown away (and, in refresh mode, would leave
  // an unusable session row behind).
  if (settings?.use_jwt_token === false) {
    return { ...base, jwtIssued: false };
  }

  const mode = getJwtManagementMode(strapi);
  const issued =
    mode === 'refresh'
      ? await issueRefreshSession(strapi, ctx, user)
      : await issueLegacyJwt(strapi, user, { context, ...claims }, settings);

  const expiresAt =
    issued.expiresAt || new Date(Date.now() + DEFAULT_SESSION_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date().toISOString();

  await appendJwtSession(strapi, {
    id: `session_${Date.now()}_${createId(12)}`,
    userId: user.id,
    userDocumentId: user.documentId,
    userEmail: user.email,
    username: user.username || (user.email ? user.email.split('@')[0] : 'user'),
    jwtTokenHash: cryptoUtils.hashJwt(issued.jwt),
    jwtManagement: mode,
    ...(issued.upSessionId ? { upSessionId: issued.upSessionId } : {}),
    createdAt: now,
    expiresAt: expiresAt.toISOString(),
    isRevoked: false,
    ipAddress: ctx?.request?.ip,
    userAgent: ctx?.request?.header?.['user-agent'],
    source,
    lastUsedAt: now,
    context,
    ...extras,
  });

  const body = { jwt: issued.jwt, ...base, expires_at: expiresAt.toISOString() };
  if (issued.refreshToken) body.refreshToken = issued.refreshToken;
  return body;
};

/**
 * Sets response headers that keep login responses and the token-bearing
 * request out of caches and Referer headers.
 *
 * @param {object} ctx - Koa context.
 */
const setNoStoreHeaders = (ctx) => {
  if (typeof ctx?.set !== 'function') return;
  ctx.set('Cache-Control', 'no-store');
  ctx.set('Pragma', 'no-cache');
  ctx.set('Referrer-Policy', 'no-referrer');
};

module.exports = {
  decodeJwtExpiry,
  getConfiguredExpiresIn,
  getJwtManagementMode,
  issueLoginSession,
  sanitizeUser,
  setNoStoreHeaders,
};
