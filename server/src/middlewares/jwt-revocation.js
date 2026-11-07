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
 * Only Content API requests are checked: REST under `api.rest.prefix`
 * (default `/api`) and the GraphQL endpoint (`plugin::graphql.endpoint`,
 * default `/graphql`), which is where users-permissions JWTs are accepted.
 * Admin API requests (`/admin/...` and plugin admin routes such as
 * `/content-manager/...` or `/magic-link/...`, which Strapi 5 mounts without
 * a prefix) carry admin JWTs that this plugin never issues or revokes; they
 * are skipped, so a store problem can never lock administrators out and the
 * admin panel never pays for a blocklist lookup. Checked requests fail
 * closed with 503 when the revocation state is unknown.
 *
 * Paths are compared case-insensitively: Strapi 5.61 mounts its routers with
 * @koa/router 12 defaults (`sensitive: false`), so `/API/users/me` reaches
 * the same Content API route as `/api/users/me` and must be checked too.
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
const isAdminPath = (path) => {
  const value = String(path || '').toLowerCase();
  return value === '/admin' || value.startsWith('/admin/');
};

/**
 * Normalises a configured path prefix ('/api/' -> '/api', 'api' -> '/api').
 *
 * @param {unknown} value - Configured prefix.
 * @param {string} fallback - Default prefix.
 * @returns {string} Prefix with a leading and without a trailing slash.
 */
const toPrefix = (value, fallback) => {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return (withSlash.replace(/\/+$/, '') || fallback).toLowerCase();
};

/**
 * Returns true when a path belongs to the Content API (REST or GraphQL),
 * the only place where users-permissions JWTs are accepted. The comparison
 * ignores case like the Strapi routers do.
 *
 * @param {object} strapi - Strapi instance.
 * @param {string} path - Request path.
 * @returns {boolean} Whether the request must pass the revocation check.
 */
const isContentApiPath = (strapi, path) => {
  // Routers match case-insensitively, so the check must too.
  const value = String(path || '').toLowerCase();
  if (isAdminPath(value)) return false;
  const get = (key, fallback) => {
    try {
      return strapi?.config?.get?.(key, fallback) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const prefixes = [
    toPrefix(get('api.rest.prefix', '/api'), '/api'),
    toPrefix(get('plugin::graphql.endpoint', '/graphql'), '/graphql'),
  ];
  return prefixes.some((prefix) => value === prefix || value.startsWith(`${prefix}/`));
};

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
    if (!jwtToken || !isContentApiPath(strapi, ctx.path)) {
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

module.exports = {
  createJwtRevocationMiddleware,
  isAdminPath,
  isContentApiPath,
  parseBearerToken,
};
