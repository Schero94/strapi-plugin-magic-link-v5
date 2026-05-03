'use strict';

module.exports = ({ strapi }) => {
  // license-guard.cleanup() is a no-op in the marketplace build (no
  // ping interval to clear). We still call it so any future hook on the
  // service runs at shutdown.
  try {
    const licenseGuardService = strapi.plugin('magic-link')?.service('license-guard');
    if (licenseGuardService && typeof licenseGuardService.cleanup === 'function') {
      licenseGuardService.cleanup();
    }
  } catch (error) {
    strapi.log.debug('[magic-link] license-guard cleanup warning:', error.message);
  }
};
