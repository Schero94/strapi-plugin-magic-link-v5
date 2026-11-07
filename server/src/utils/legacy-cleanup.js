'use strict';

/**
 * One-time removal of data that earlier releases stored and 7.0.0 no longer
 * uses.
 *
 * Releases up to 6.2.x kept an optional registration key and the time it was
 * last checked in the plugin store (`licenseKey`, `lastValidated`). 7.0.0
 * has no such feature and makes no outbound calls, so the values are
 * deleted at startup. The step is idempotent: once the keys are gone, it only
 * reads them.
 */

const { withClusterLock } = require('./cluster');

/** Plugin-store keys written by 6.x and earlier, removed in 7.0.0. */
const LEGACY_KEYS = Object.freeze(['licenseKey', 'lastValidated']);

/**
 * Deletes the legacy plugin-store keys if they are present. Runs under one
 * cluster-wide lock, so several processes starting at once delete each key
 * only once. Never logs the stored values.
 *
 * @param {object} strapi - Strapi instance.
 * @returns {Promise<number>} Number of keys deleted.
 * @throws {Error} When the store or the lock fails (bootstrap logs it).
 * @sideeffect Deletes rows from `strapi_core_store_settings`.
 */
const removeLegacyRegistrationKeys = (strapi) =>
  withClusterLock(strapi, 'migration:legacy-keys', async () => {
    const store = strapi.store({ type: 'plugin', name: 'magic-link' });
    let removed = 0;
    for (const key of LEGACY_KEYS) {
      const value = await store.get({ key });
      if (value === undefined || value === null) continue;
      await store.delete({ key });
      removed += 1;
    }
    if (removed > 0) {
      strapi.log.info(`[magic-link] Removed ${removed} unused plugin-store key(s) from 6.x`);
    }
    return removed;
  });

module.exports = { LEGACY_KEYS, removeLegacyRegistrationKeys };
