'use strict';

const { settingsUpdateSchema, parseBody, SETTINGS_KEYS } = require('./validation');
const { normalizeMfaSettings } = require('../utils/mfa-mode');
const { createDefaultSettings } = require('../utils/default-settings');

const BOOLEAN_FIELDS = [
  'enabled',
  'createUserIfNotExists',
  'stays_valid',
  'verify_email',
  'welcome_email',
  'use_jwt_token',
  'allow_magic_links_on_public_registration',
  'store_login_info',
  'use_email_designer',
  'use_magic_mail',
  'otp_enabled',
  'otp_strict_binding',
  'mfa_require_totp',
  'totp_as_primary_auth',
  'rate_limit_enabled',
  'passwordlessCompatibility',
];

const KNOWN_KEYS = new Set(SETTINGS_KEYS);

/**
 * Keeps only the settings keys of the 6.0 contract. Legacy keys (provider
 * credentials, `create_new_user`, `remember_me`, ...) are neither returned
 * nor written back.
 *
 * @param {object} settings - Stored or merged settings.
 * @returns {object} Settings with known keys only.
 */
const pickKnownSettings = (settings) =>
  Object.fromEntries(Object.entries(settings || {}).filter(([key]) => KNOWN_KEYS.has(key)));

/**
 * Normalises booleans that older admin builds or SQLite stored as strings or 0/1.
 *
 * @param {object} settings - Settings object (mutated copy).
 * @returns {object} The same object.
 */
const normalizeBooleans = (settings) => {
  for (const field of BOOLEAN_FIELDS) {
    if (!(field in settings)) continue;
    const value = settings[field];
    if (typeof value === 'string') settings[field] = value === 'true';
    else if (value && typeof value === 'object' && value.type === 'boolean')
      settings[field] = Boolean(value.value);
    else settings[field] = Boolean(value);
  }
  return settings;
};

/**
 * Settings as returned to the admin UI.
 *
 * @param {object} stored - Stored settings.
 * @returns {object} Safe, normalised settings.
 */
const toResponseSettings = (stored) => {
  const settings = normalizeBooleans(pickKnownSettings(normalizeMfaSettings(stored || {})));
  if (settings.store_login_info === undefined) settings.store_login_info = true;
  if (settings.use_email_designer === undefined) settings.use_email_designer = false;
  if (settings.email_designer_template_id === undefined) settings.email_designer_template_id = '';
  if (
    settings.login_path === '/passwordless-login' ||
    settings.login_path === '/api/magic-link/login'
  ) {
    settings.login_path = '/magic-link/login';
  }
  return settings;
};

module.exports = {
  /**
   * Returns normalized plugin settings and integration availability metadata.
   * Legacy required-TOTP settings are exposed in their effective canonical form.
   *
   * @param {object} ctx - Strapi Koa context.
   * @returns {Promise<void>}
   */
  async getSettings(ctx) {
    try {
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const settings = await pluginStore.get({ key: 'settings' });

      let emailProviderConfigured = false;
      let emailProviderName = null;
      try {
        if (strapi.plugin('email')) {
          emailProviderConfigured = true;
          const emailConfig = strapi.config.get('plugin::email');
          emailProviderName =
            typeof emailConfig?.provider === 'string' ? emailConfig.provider : 'configured';
        }
      } catch {
        emailProviderConfigured = false;
      }

      ctx.send({
        settings: toResponseSettings(settings),
        emailDesignerInstalled: Boolean(strapi.plugin('email-designer-5')),
        magicMailInstalled: Boolean(strapi.plugin('magic-mail')),
        emailProviderConfigured,
        emailProviderName,
      });
    } catch {
      strapi.log.error('[magic-link] Settings could not be loaded');
      ctx.throw(500, 'Failed to load settings');
    }
  },

  /**
   * Validates and persists a partial settings update without dropping other
   * known values. Unknown and legacy keys are discarded. The legacy TOTP flag
   * and the current mode are normalized before the settings are returned.
   * Nothing from the settings object is logged.
   *
   * @param {object} ctx - Strapi Koa context.
   * @returns {Promise<void>}
   * @throws {import('@strapi/utils').errors.ValidationError} For invalid fields.
   */
  async updateSettings(ctx) {
    const settingsPatch = parseBody(settingsUpdateSchema, ctx.request.body);

    try {
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const existingSettings = (await pluginStore.get({ key: 'settings' })) || {};
      const processedBody = normalizeBooleans(
        pickKnownSettings(
          normalizeMfaSettings({ ...existingSettings, ...settingsPatch }, settingsPatch)
        )
      );
      if (processedBody.store_login_info === undefined) processedBody.store_login_info = true;

      await pluginStore.set({ key: 'settings', value: processedBody });

      const rateLimiter = strapi.plugin('magic-link')?.service?.('rate-limiter');
      if (typeof rateLimiter?.reloadSettings === 'function') {
        await rateLimiter.reloadSettings();
      }

      strapi.log.info(
        `[magic-link] Settings updated by admin ${ctx.state?.user?.id ?? 'unknown'}: ${Object.keys(settingsPatch).sort().join(', ')}`
      );
      ctx.send({ settings: toResponseSettings(processedBody) });
    } catch {
      strapi.log.error('[magic-link] Settings could not be saved');
      ctx.throw(500, 'Failed to save settings');
    }
  },

  /**
   * Resets settings to the install defaults and deletes login tokens, the
   * session audit list and IP bans. Active JWT revocations are kept, so a
   * revoked token never becomes valid again through a reset.
   *
   * @param {object} ctx - Strapi Koa context.
   */
  async resetData(ctx) {
    try {
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      await pluginStore.set({ key: 'settings', value: createDefaultSettings() });

      const deleted = await strapi.db.query('plugin::magic-link.token').deleteMany({ where: {} });
      await pluginStore.delete({ key: 'jwt_sessions' });
      await pluginStore.set({ key: 'banned_ips', value: { ips: [] } });

      const rateLimiter = strapi.plugin('magic-link')?.service?.('rate-limiter');
      if (typeof rateLimiter?.reloadSettings === 'function') {
        await rateLimiter.reloadSettings();
      }

      strapi.log.warn(
        `[magic-link] Data reset by admin ${ctx.state?.user?.id ?? 'unknown'} (${deleted?.count || 0} token(s) deleted)`
      );
      ctx.send({
        success: true,
        deletedTokens: deleted?.count || 0,
        message: 'Magic Link data was reset. Revoked JWTs stay blocked until they expire.',
      });
    } catch {
      strapi.log.error('[magic-link] Data reset failed');
      ctx.throw(500, 'Failed to reset Magic Link data');
    }
  },
};
