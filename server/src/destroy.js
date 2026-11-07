'use strict';

const { clearTrackedTimers, runTrackedCleanups } = require('./utils/lifecycle');

/**
 * Destroy phase: stops every background job started in bootstrap() and
 * drops cached license lookups, so a Strapi reload (or test harness) leaves
 * no timers behind.
 *
 * @param {{ strapi: object }} deps - Strapi instance.
 */
module.exports = ({ strapi }) => {
  clearTrackedTimers(strapi);
  runTrackedCleanups(strapi);
  try {
    strapi.plugin('magic-link')?.service('license-guard')?.cleanup?.();
  } catch {
    strapi.log.debug('[magic-link] license-guard cleanup skipped');
  }
};
