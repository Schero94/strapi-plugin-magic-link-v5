'use strict';

/**
 * Register phase. Global middlewares are added in bootstrap(), which runs
 * after Strapi's own middlewares (errors, security, CORS, logger) are set up,
 * so plugin responses get the standard error envelope and security headers.
 */
module.exports = () => {};
