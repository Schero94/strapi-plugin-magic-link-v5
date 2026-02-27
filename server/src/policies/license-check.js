'use strict';

const { errors } = require('@strapi/utils');
const { PolicyError } = errors;

/**
 * License Check Policy
 * Verifies that a valid license exists before allowing API access.
 * Uses Strapi v5 PolicyError for specific error messages (403).
 */
module.exports = async (policyContext, config, { strapi }) => {
  try {
    const licenseGuard = strapi.plugin('magic-link').service('license-guard');

    const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
    const licenseKey = await pluginStore.get({ key: 'licenseKey' });

    if (!licenseKey) {
      strapi.log.warn('[ACCESS-DENIED] No license key found');
      throw new PolicyError('No license found. Please activate the plugin first.', {
        policy: 'license-check',
        errCode: 'LICENSE_MISSING',
      });
    }

    const verification = await licenseGuard.verifyLicense(licenseKey, true);

    if (!verification.valid) {
      strapi.log.warn('[ACCESS-DENIED] Invalid license');
      throw new PolicyError('Invalid or expired license.', {
        policy: 'license-check',
        errCode: 'LICENSE_INVALID',
      });
    }

    const license = await licenseGuard.getLicenseByKey(licenseKey);

    if (!license) {
      strapi.log.warn('[ACCESS-DENIED] License not found in database');
      throw new PolicyError('License not found. Please contact support.', {
        policy: 'license-check',
        errCode: 'LICENSE_NOT_FOUND',
      });
    }

    if (!license.isActive) {
      strapi.log.warn('[ACCESS-DENIED] License is inactive');
      throw new PolicyError('License is inactive. Please activate your license.', {
        policy: 'license-check',
        errCode: 'LICENSE_INACTIVE',
      });
    }

    if (license.isExpired) {
      strapi.log.warn('[ACCESS-DENIED] License has expired');
      throw new PolicyError('License has expired. Please renew your license.', {
        policy: 'license-check',
        errCode: 'LICENSE_EXPIRED',
      });
    }

    return true;
  } catch (error) {
    if (error instanceof PolicyError) {
      throw error;
    }
    strapi.log.error('Error checking license:', error);
    throw new PolicyError('Error verifying license. Please try again.', {
      policy: 'license-check',
      errCode: 'LICENSE_CHECK_ERROR',
    });
  }
};

