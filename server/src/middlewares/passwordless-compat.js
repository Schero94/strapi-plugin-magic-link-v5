'use strict';

/**
 * Passwordless compatibility middleware.
 *
 * When the `passwordlessCompatibility` setting is on, requests to
 *   <prefix>/passwordless/send-link  and  <prefix>/passwordless/login
 * are rewritten to the Magic Link routes, so clients migrating from
 * strapi-plugin-passwordless keep working. <prefix> is the configured
 * `api.rest.prefix` (default '/api').
 *
 * When the setting is off, the request is passed on untouched, so another
 * installed plugin can still serve the path. Registered from bootstrap(),
 * i.e. after Strapi's global middlewares (errors, security, CORS, logger).
 */

const ROUTES = ['send-link', 'login'];

module.exports = (_config, { strapi }) => {
  return async (ctx, next) => {
    const prefix = String(strapi.config?.get?.('api.rest.prefix', '/api') || '/api').replace(
      /\/+$/,
      ''
    );
    const compatBase = `${prefix}/passwordless/`;
    const path = ctx.path || '';

    if (!path.startsWith(compatBase)) {
      return next();
    }

    const action = path.slice(compatBase.length).replace(/\/+$/, '');
    if (!ROUTES.includes(action)) {
      return next();
    }

    const settings = await strapi
      .store({ type: 'plugin', name: 'magic-link' })
      .get({ key: 'settings' });
    if (!settings?.passwordlessCompatibility) {
      return next();
    }

    // Only the path changes; Koa keeps the query string (ctx.path setter).
    ctx.path = `${prefix}/magic-link/${action}`;
    return next();
  };
};
