'use strict';

/**
 * Plugin Store wrapper for magic-link.
 *
 * Thin convenience layer around strapi.store() so other services and
 * controllers can read/write plugin settings without repeating the
 * boilerplate. Previously lived at server/services/store.js (legacy path);
 * moved into server/src/services/ as part of the v5 layout consolidation.
 */
module.exports = ({ strapi }) => ({
  /**
   * Reads the `settings` blob from the plugin store.
   * @returns {Promise<object|undefined>}
   */
  async get() {
    const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
    return pluginStore.get({ key: 'settings' });
  },

  /**
   * Writes the `settings` blob to the plugin store.
   * @param {object} settings
   * @returns {Promise<void>}
   */
  async set(settings) {
    const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
    return pluginStore.set({ key: 'settings', value: settings });
  },
});
