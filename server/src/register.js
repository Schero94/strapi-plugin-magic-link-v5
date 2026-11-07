'use strict';

const { createWebhookRawBodyMiddleware } = require('./utils/webhook-raw-body');

/**
 * Register phase. Global middlewares are added in bootstrap(), which runs
 * after Strapi's own middlewares (errors, security, CORS, logger) are set up,
 * so plugin responses get the standard error envelope and security headers.
 *
 * Exception: delivery webhooks are verified over the exact request bytes, so
 * their raw body must be read before Strapi's body parser (registered after
 * this phase). The middleware only touches POST requests below
 * `<rest prefix>/magic-link/delivery-webhooks/`.
 *
 * @param {{ strapi: object }} deps
 */
module.exports = ({ strapi }) => {
  const raw = strapi.config?.get?.('api.rest.prefix', '/api');
  const prefix =
    typeof raw === 'string' && /^\/?[A-Za-z0-9._~\-/]*$/.test(raw.trim())
      ? `/${raw.trim().replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '')
      : '/api';
  strapi.server.use(
    createWebhookRawBodyMiddleware({ pathPrefix: `${prefix}/magic-link/delivery-webhooks/` })
  );
};
