'use strict';

/**
 * License Controller for Magic Link Plugin
 *
 * Marketplace refactor (Strategy B):
 * - The plugin always reports `valid: true` regardless of whether a
 *   license key is stored. The key is preserved as cosmetic / branding
 *   metadata only — it does not gate any feature.
 * - `autoCreate`, `createAndActivate`, and `storeKey` keep working so the
 *   admin UI activation form remains useful, but they no longer start a
 *   periodic ping or write to a `strapi.licenseGuard` global.
 * - `ping` is repurposed to a manual refresh that re-verifies once.
 */

module.exports = {
  /**
   * Returns the current license status. Always reports the plugin as
   * usable; `hasKey` indicates whether the admin has activated a key.
   *
   * @route GET /magic-link/license/status
   * @returns {{ success: true, valid: true, hasKey: boolean, data: object|null }}
   */
  async getStatus(ctx) {
    try {
      const licenseGuard = strapi.plugin('magic-link').service('license-guard');
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });

      if (!licenseKey) {
        return ctx.send({
          success: true,
          valid: true, // plugin is always usable in the marketplace build
          hasKey: false,
          data: null,
          message: 'Plugin is active. License key activation is optional.',
        });
      }

      // Best-effort lookup of upstream details for display only.
      // Failures here do NOT degrade the plugin.
      const license = await licenseGuard.getLicenseByKey(licenseKey);

      return ctx.send({
        success: true,
        valid: true,
        hasKey: true,
        data: {
          licenseKey,
          email: license?.email || null,
          firstName: license?.firstName || null,
          lastName: license?.lastName || null,
          isActive: license?.isActive ?? true,
          isExpired: license?.isExpired ?? false,
          expiresAt: license?.expiresAt || null,
          deviceName: license?.deviceName || null,
          deviceId: license?.deviceId || null,
          ipAddress: license?.ipAddress || null,
          maxDevices: license?.maxDevices || 1,
          currentDevices: license?.currentDevices || 0,
        },
      });
    } catch (error) {
      strapi.log.error('Error getting license status:', error);
      return ctx.badRequest('Error getting license status');
    }
  },

  /**
   * Auto-create a license using the currently logged-in admin user's
   * data. Best-effort: a remote failure simply leaves the install
   * un-keyed, the plugin keeps working.
   *
   * @route POST /magic-link/license/auto-create
   */
  async autoCreate(ctx) {
    try {
      const adminUser = ctx.state.user;
      if (!adminUser) {
        return ctx.unauthorized('No admin user logged in');
      }

      const licenseGuard = strapi.plugin('magic-link').service('license-guard');
      const license = await licenseGuard.createLicense({
        email: adminUser.email,
        firstName: adminUser.firstname || 'Admin',
        lastName: adminUser.lastname || 'User',
      });

      if (!license) {
        return ctx.badRequest('License server unreachable. The plugin keeps working without a key.');
      }

      await licenseGuard.storeLicenseKey(license.licenseKey);

      return ctx.send({
        success: true,
        message: 'License automatically created and activated',
        data: license,
      });
    } catch (error) {
      strapi.log.error('Error auto-creating license:', error);
      return ctx.badRequest('Error creating license');
    }
  },

  /**
   * Create and activate a new license with explicit user details.
   *
   * @route POST /magic-link/license/create
   */
  async createAndActivate(ctx) {
    try {
      const { email, firstName, lastName } = ctx.request.body || {};

      if (!email || !firstName || !lastName) {
        return ctx.badRequest('Email, firstName, and lastName are required');
      }

      const licenseGuard = strapi.plugin('magic-link').service('license-guard');
      const license = await licenseGuard.createLicense({ email, firstName, lastName });

      if (!license) {
        return ctx.badRequest('License server unreachable. The plugin keeps working without a key.');
      }

      await licenseGuard.storeLicenseKey(license.licenseKey);

      return ctx.send({
        success: true,
        message: 'License created and activated successfully',
        data: license,
      });
    } catch (error) {
      strapi.log.error('Error creating license:', error);
      return ctx.badRequest('Error creating license');
    }
  },

  /**
   * Manual refresh: re-verifies the stored license once and returns the
   * latest details. Replaces the periodic-ping endpoint that used to run
   * every 15 minutes — admins can call this on demand from the UI to
   * pull updated info.
   *
   * @route POST /magic-link/license/ping
   */
  async ping(ctx) {
    try {
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });

      if (!licenseKey) {
        return ctx.badRequest('No license key found');
      }

      const licenseGuard = strapi.plugin('magic-link').service('license-guard');
      const verification = await licenseGuard.verifyLicense(licenseKey);

      return ctx.send({
        success: true,
        message: verification.valid
          ? 'License refreshed successfully'
          : 'License key could not be verified, but the plugin keeps working.',
        data: verification.data,
      });
    } catch (error) {
      strapi.log.error('Error refreshing license:', error);
      return ctx.badRequest('Error refreshing license');
    }
  },

  /**
   * Store and validate an existing license key.
   *
   * @route POST /magic-link/license/store-key
   */
  async storeKey(ctx) {
    try {
      const { licenseKey, email } = ctx.request.body || {};

      if (!licenseKey || !licenseKey.trim()) {
        return ctx.badRequest('License key is required');
      }
      if (!email || !email.trim()) {
        return ctx.badRequest('Email address is required');
      }

      const trimmedKey = licenseKey.trim();
      const trimmedEmail = email.trim().toLowerCase();
      const licenseGuard = strapi.plugin('magic-link').service('license-guard');

      const verification = await licenseGuard.verifyLicense(trimmedKey);

      if (!verification.valid) {
        // Network errors during verify still let the user proceed —
        // the plugin works without a key, so a flaky license server
        // shouldn't block activation outright. A definitive rejection
        // (server reachable + said "no") still blocks.
        if (verification.networkError) {
          strapi.log.warn(
            `[WARNING] License server unreachable during activation. Storing key anyway: ${trimmedKey.substring(0, 8)}...`
          );
          await licenseGuard.storeLicenseKey(trimmedKey);
          return ctx.send({
            success: true,
            message: 'License key stored (license server was unreachable; will retry on the next manual refresh).',
            data: { licenseKey: trimmedKey, email: trimmedEmail },
          });
        }
        strapi.log.warn(`[WARNING] Invalid license key: ${trimmedKey.substring(0, 8)}...`);
        return ctx.badRequest('Invalid or expired license key');
      }

      const license = await licenseGuard.getLicenseByKey(trimmedKey);

      if (!license) {
        strapi.log.warn(`[WARNING] License not found: ${trimmedKey.substring(0, 8)}...`);
        return ctx.badRequest('License not found');
      }

      if (license.email && license.email.toLowerCase() !== trimmedEmail) {
        strapi.log.warn(
          `[WARNING] Email mismatch for license key: ${trimmedKey.substring(0, 8)}... (attempted: ${trimmedEmail})`
        );
        return ctx.badRequest('Email address does not match this license key');
      }

      await licenseGuard.storeLicenseKey(trimmedKey);

      strapi.log.info(
        `[SUCCESS] License key validated and stored: ${trimmedKey.substring(0, 8)}... (email: ${trimmedEmail})`
      );

      return ctx.send({
        success: true,
        message: 'License key validated and activated successfully',
        data: verification.data,
      });
    } catch (error) {
      strapi.log.error('Error storing license key:', error);
      return ctx.badRequest('Error validating license key');
    }
  },
};
