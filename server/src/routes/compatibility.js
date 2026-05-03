'use strict';

/**
 * Compatibility Routes for strapi-plugin-passwordless migration
 * 
 * These routes provide backwards compatibility for users migrating from
 * strapi-plugin-passwordless (https://github.com/kucherenko/strapi-plugin-passwordless)
 * 
 * Enable via Settings: "Passwordless Compatibility Mode"
 * 
 * Original passwordless routes:
 * - POST /api/passwordless/send-link → POST /api/magic-link/send-link
 * - GET /api/passwordless/login → GET /api/magic-link/login
 */

module.exports = {
  type: 'content-api',
  routes: [
    // Passwordless compatibility: Login with token
    {
      method: 'GET',
      path: '/passwordless/login',
      handler: 'auth.login',
      config: {
        auth: false,
        policies: ['plugin::magic-link.compatibility-check'],
        description: 'Compatibility route for strapi-plugin-passwordless',
      },
    },
    // Passwordless compatibility: Send magic link
    {
      method: 'POST',
      path: '/passwordless/send-link',
      handler: 'auth.sendLink',
      config: {
        auth: false,
        policies: ['plugin::magic-link.compatibility-check'],
        description: 'Compatibility route for strapi-plugin-passwordless',
      },
    },
  ],
};

