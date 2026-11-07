'use strict';

const { createWebhookRawBodyMiddleware } = require('./utils/webhook-raw-body');
const contentTypes = require('./content-types');

/**
 * The GraphQL plugin (when installed) generates queries and mutations for
 * every content type, plugin ones included (Shadow CRUD); a full-access API
 * token could then read e-mails, IPs and hashes of login tokens and JWT
 * sessions, or change and delete session rows. These types are internal
 * and served only by the plugin's own routes, so Shadow CRUD is disabled
 * for all of them (docs.strapi.io/cms/plugins/graphql, "Disabling
 * operations in the Shadow CRUD").
 *
 * @param {object} strapi - Strapi instance.
 */
const disableGraphqlShadowCrud = (strapi) => {
  const graphql = typeof strapi.plugin === 'function' ? strapi.plugin('graphql') : null;
  if (!graphql) return;
  const extension = graphql.service('extension');
  for (const name of Object.keys(contentTypes)) {
    extension.shadowCRUD(`plugin::magic-link.${name}`).disable();
  }
};

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
  disableGraphqlShadowCrud(strapi);
};
