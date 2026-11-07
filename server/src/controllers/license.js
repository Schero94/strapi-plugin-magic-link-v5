'use strict';

const { maskLicenseKey } = require('../services/license-guard');
const { licenseStoreKeySchema, parseBody } = require('./validation');

const SETTINGS_UPDATE_ACTION = 'plugin::magic-link.settings.update';

/**
 * Whether the caller may see the full key and the license holder's data.
 *
 * @param {object} ctx - Koa context.
 * @returns {boolean} True for admins with settings.update.
 */
const canSeeLicenseSecrets = (ctx) => {
  try {
    return ctx?.state?.userAbility?.can?.(SETTINGS_UPDATE_ACTION) === true;
  } catch {
    return false;
  }
};

/**
 * License controller. The plugin works without a key; the License page is
 * informational. Settings readers see a masked key and the status; admins
 * with settings.update also see the full key and the holder's name/e-mail.
 */
module.exports = {
  /**
   * Returns the license status.
   *
   * @route GET /magic-link/license/status (settings.read)
   * @returns {{ success: true, valid: boolean, hasKey: boolean, lookup: string, data: object|null }}
   */
  async getStatus(ctx) {
    try {
      const licenseGuard = strapi.plugin('magic-link').service('license-guard');
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });

      if (!licenseKey) {
        return ctx.send({
          success: true,
          valid: true,
          hasKey: false,
          lookup: 'none',
          data: null,
          message: 'Plugin is active. License key activation is optional.',
        });
      }

      const { status, license } = await licenseGuard.lookupLicense(licenseKey);
      const showSecrets = canSeeLicenseSecrets(ctx);

      return ctx.send({
        success: true,
        // A failed or disabled lookup never marks the plugin invalid.
        valid: status === 'ok' ? license?.isActive !== false && license?.isExpired !== true : true,
        hasKey: true,
        lookup: status,
        data: {
          licenseKeyMasked: maskLicenseKey(licenseKey),
          ...(showSecrets ? { licenseKey } : {}),
          ...(showSecrets && license
            ? {
                email: license.email || null,
                firstName: license.firstName || null,
                lastName: license.lastName || null,
              }
            : {}),
          isActive: license?.isActive ?? true,
          isExpired: license?.isExpired ?? false,
          expiresAt: license?.expiresAt || null,
          maxDevices: license?.maxDevices || 1,
          currentDevices: license?.currentDevices || 0,
        },
      });
    } catch {
      strapi.log.error('[magic-link] License status request failed');
      return ctx.throw(500, 'Error getting license status');
    }
  },

  /**
   * Stores an existing license key after verifying it with the license
   * server (only the key is sent). When the server is unreachable or remote
   * lookups are disabled the key is stored unverified.
   *
   * @route POST /magic-link/license/store-key (settings.update)
   */
  async storeKey(ctx) {
    const { licenseKey, email } = parseBody(licenseStoreKeySchema, ctx.request.body);

    try {
      const licenseGuard = strapi.plugin('magic-link').service('license-guard');
      const verification = await licenseGuard.verifyLicense(licenseKey);

      if (!verification.valid) {
        if (verification.networkError || verification.disabled) {
          await licenseGuard.storeLicenseKey(licenseKey);
          strapi.log.warn('[magic-link] License key stored without verification');
          return ctx.send({
            success: true,
            verified: false,
            message: 'License key stored without verification.',
            data: { licenseKeyMasked: maskLicenseKey(licenseKey) },
          });
        }
        strapi.log.warn('[magic-link] Invalid license key submitted');
        return ctx.badRequest('Invalid or expired license key');
      }

      const holderEmail = verification.data?.email;
      if (typeof holderEmail === 'string' && holderEmail.toLowerCase() !== email) {
        strapi.log.warn('[magic-link] License key e-mail mismatch');
        return ctx.badRequest('Email address does not match this license key');
      }

      await licenseGuard.storeLicenseKey(licenseKey);
      strapi.log.info(
        `[magic-link] License key stored by admin ${ctx.state?.user?.id ?? 'unknown'}`
      );
      return ctx.send({
        success: true,
        verified: true,
        message: 'License key validated and activated successfully',
        data: { licenseKeyMasked: maskLicenseKey(licenseKey) },
      });
    } catch {
      strapi.log.error('[magic-link] License-key validation request failed');
      return ctx.throw(500, 'Error validating license key');
    }
  },
};
