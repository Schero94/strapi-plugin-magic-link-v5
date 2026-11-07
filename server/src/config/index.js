'use strict';

/**
 * Server-side plugin configuration (config/plugins.js):
 *
 *   'magic-link': {
 *     config: {
 *       // Optional allow-list of origins that login links may point at
 *       // (confirmationUrl, frontend_url, callback_url). Empty = any https
 *       // URL (http only for localhost). Admins cannot change this list.
 *       allowedLinkOrigins: ['https://app.example.test'],
 *     },
 *   },
 *
 * Docs checked (2026-11-07): docs.strapi.io/cms/plugins-development/server-configuration
 * (default + validator, deep merge, read via strapi.config.get('plugin::<name>.<key>')).
 */
module.exports = {
  default: { allowedLinkOrigins: [] },
  validator(config) {
    const origins = config?.allowedLinkOrigins;
    if (origins === undefined) return;
    if (!Array.isArray(origins)) {
      throw new Error('magic-link: allowedLinkOrigins must be an array of origins');
    }
    for (const origin of origins) {
      let parsed;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error('magic-link: allowedLinkOrigins contains an invalid URL');
      }
      if (parsed.origin !== origin) {
        throw new Error(
          'magic-link: allowedLinkOrigins entries must be bare origins such as https://app.example.test'
        );
      }
    }
  },
};
