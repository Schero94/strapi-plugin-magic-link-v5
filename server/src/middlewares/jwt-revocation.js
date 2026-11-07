'use strict';

/**
 * Global middleware that rejects users-permissions JWTs revoked from the
 * Magic Link admin panel.
 *
 * The Authorization header is parsed exactly like users-permissions
 * `jwt.getToken()` (split on whitespace, case-insensitive scheme, exactly two
 * parts), so `bearer <jwt>` or `Bearer  <jwt>` cannot skip the check while
 * users-permissions still accepts the token.
 *
 * Admin panel requests (`/admin/...`) carry admin JWTs, which this plugin
 * never issues or revokes; they are skipped so a store problem can never lock
 * administrators out. Every other request (REST, GraphQL, custom routes) is
 * checked and fails closed with 503 when the revocation state is unknown.
 */

/**
 * Extracts the bearer token like users-permissions does.
 *
 * @param {unknown} header - Authorization header value.
 * @returns {string|null} The token or null.
 */
const parseBearerToken = (header) => {
  if (typeof header !== 'string') return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) return null;
  return parts[1];
};

/**
 * Returns true for admin panel API paths.
 *
 * @param {string} path - Request path.
 * @returns {boolean} Whether the path belongs to the admin API.
 */
const isAdminPath = (path) => path === '/admin' || String(path || '').startsWith('/admin/');

/**
 * Creates the revocation middleware.
 *
 * @param {{ strapi: object }} deps - Strapi instance.
 * @returns {Function} Koa middleware.
 */
const createJwtRevocationMiddleware =
  ({ strapi }) =>
  async (ctx, next) => {
    const jwtToken = parseBearerToken(ctx.request?.header?.authorization);
    if (!jwtToken || isAdminPath(ctx.path)) {
      return next();
    }

    let isBlocked;
    try {
      const magicLink = strapi.plugin('magic-link')?.service?.('magic-link');
      if (!magicLink || typeof magicLink.isJwtTokenBlocked !== 'function') {
        throw new Error('JWT revocation service is unavailable');
      }
      isBlocked = await magicLink.isJwtTokenBlocked(jwtToken);
    } catch {
      // Never log the token or store errors; never accept a token whose
      // revocation state is unknown.
      strapi.log.error('[magic-link] JWT revocation status check failed');
      ctx.status = 503;
      ctx.body = {
        data: null,
        error: {
          status: 503,
          name: 'ServiceUnavailableError',
          message: 'Unable to verify JWT revocation status',
          details: {},
        },
      };
      return undefined;
    }

    if (isBlocked) {
      ctx.status = 401;
      ctx.body = {
        data: null,
        error: {
          status: 401,
          name: 'UnauthorizedError',
          message: 'This token has been revoked',
          details: {},
        },
      };
      return undefined;
    }

    return next();
  };

module.exports = { createJwtRevocationMiddleware, isAdminPath, parseBearerToken };
