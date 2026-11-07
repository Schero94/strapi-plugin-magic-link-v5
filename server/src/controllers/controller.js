'use strict';

const {
  settingsUpdateSchema,
  adminResetSchema,
  parseBody,
  SETTINGS_KEYS,
} = require('./validation');
const { errors } = require('@strapi/utils');
const { normalizeMfaSettings, resolveMfaMode } = require('../utils/mfa-mode');
const { createDefaultSettings } = require('../utils/default-settings');
const { updateStoreKey, withClusterLock } = require('../utils/cluster');
const { deleteAllSessions } = require('../utils/jwt-session-store');

const SECURITY_ACTION = 'plugin::magic-link.settings.security';

/**
 * Settings that can redirect login links (and with them the login token),
 * hand a link to someone else, or change who may log in and with which
 * factors. Changing any of them needs `plugin::magic-link.settings.security`
 * in addition to `settings.update`; resending them unchanged does not.
 */
const SECURITY_SETTING_KEYS = Object.freeze([
  // Where the login link (and token) goes.
  'confirmationUrl',
  'callback_url',
  'frontend_url',
  'frontend_login_path',
  'login_path',
  'passwordlessCompatibility',
  // Templates can embed {{CODE}} / {{LOGIN_URL}} in any URL.
  'message_html',
  'message_text',
  'use_email_designer',
  'email_designer_template_id',
  'emailDesignerCompatibility',
  'use_magic_mail',
  'magic_mail_template_id',
  'magic_mail_template_reference_id',
  // Who can log in, how long a link and a session live.
  'enabled',
  'createUserIfNotExists',
  'user_creation_strategy',
  'allow_magic_links_on_public_registration',
  'verify_email',
  'stays_valid',
  'expire_period',
  'token_length',
  'use_jwt_token',
  'jwt_token_expires_in',
  'context_whitelist',
  'context_blacklist',
  // Second factors.
  'mfa_mode',
  'mfa_require_totp',
  'totp_as_primary_auth',
  'otp_enabled',
  'otp_strict_binding',
  // Code strength and brute-force limits: weakening them is as good as
  // switching a factor off (security review 2026-11-07).
  'otp_length',
  'otp_expiry',
  'otp_max_attempts',
  'otp_resend_cooldown',
  'totp_algorithm',
  'totp_digits',
  'totp_period',
  'rate_limit_enabled',
  'rate_limit_max_attempts',
  'rate_limit_window_minutes',
  'rate_limit_login_max_attempts',
  'rate_limit_login_window_minutes',
  'rate_limit_login_block_minutes',
  // Who the login mail claims to come from and where replies go.
  'from_name',
  'from_email',
  'response_email',
]);

/** URL settings checked against the server-side `allowedLinkOrigins`. */
const LINK_URL_KEYS = Object.freeze(['confirmationUrl', 'frontend_url', 'callback_url']);

/**
 * Whether the admin holds an RBAC action.
 *
 * @param {object} ctx - Koa context.
 * @param {string} action - Action uid.
 * @returns {boolean} True when allowed.
 */
const can = (ctx, action) => {
  try {
    return ctx?.state?.userAbility?.can?.(action) === true;
  } catch {
    return false;
  }
};

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

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
 * Second-factor settings that a reset keeps unless the caller sends
 * `resetSecurity: true`: resetting them would silently switch MFA off (or
 * change which factor users must present).
 */
const MFA_SETTING_KEYS = Object.freeze([
  'mfa_mode',
  'mfa_require_totp',
  'totp_as_primary_auth',
  'otp_enabled',
]);

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

/**
 * Server-side checks for a settings update, before anything is written:
 * - security settings that would change need `settings.security`
 *   (403, key `settings.security.forbidden`),
 * - changed link URLs must use an origin from the server config
 *   `allowedLinkOrigins` when that list is set (400).
 * Values are compared in their effective, normalised form, so the admin UI
 * can send the whole form back unchanged.
 *
 * @param {object} ctx - Koa context.
 * @param {object} existing - Stored settings.
 * @param {object} patch - Validated patch.
 * @throws {errors.ForbiddenError|errors.ValidationError} When refused.
 */
const assertSettingsChangeAllowed = (ctx, existing, patch) => {
  const defaults = createDefaultSettings();
  const before = toResponseSettings({ ...defaults, ...existing });
  const after = toResponseSettings(
    normalizeMfaSettings({ ...defaults, ...existing, ...patch }, patch)
  );
  const changed = (key) => !sameValue(before[key], after[key]);

  const securityChanges = SECURITY_SETTING_KEYS.filter(changed);
  if (securityChanges.length > 0 && !can(ctx, SECURITY_ACTION)) {
    // PolicyError, not ForbiddenError: Strapi's authorize middleware replaces
    // any other ForbiddenError with a bare "Forbidden" and drops `details`,
    // so the admin UI could not name the fields (Strapi 5 error-handling docs).
    throw new errors.PolicyError(
      'Changing login link targets, templates, account or MFA rules requires the "Settings: Security" permission',
      { key: 'settings.security.forbidden', fields: securityChanges }
    );
  }

  const configured = strapi.config?.get?.('plugin::magic-link.allowedLinkOrigins', []);
  const allowedOrigins = Array.isArray(configured) ? configured : [];
  if (allowedOrigins.length === 0) return;
  const outside = LINK_URL_KEYS.filter((key) => {
    if (!changed(key) || !after[key]) return false;
    try {
      return !allowedOrigins.includes(new URL(after[key]).origin);
    } catch {
      return true;
    }
  });
  if (outside.length > 0) {
    throw new errors.ValidationError('Login link URLs must use an allowed origin', {
      key: 'settings.linkOrigin.notAllowed',
      fields: outside,
    });
  }
};

/**
 * Refuses switching MFA to `required` while no end user has an active
 * authenticator, unless the request sets `acknowledgeNoEnrolledUsers: true`.
 * With nobody enrolled, every user has to enrol during the next login
 * (`requiresTOTPSetup`); a frontend without that step would lock everyone
 * out, so the switch must be deliberate. The admin UI blocks the option in
 * the same situation.
 *
 * @param {object} existing - Stored settings.
 * @param {object} patch - Validated patch.
 * @param {boolean} acknowledged - Explicit acknowledgement from the request.
 * @returns {Promise<void>}
 * @throws {errors.ValidationError} Key `settings.mfa.noEnrolledUsers`.
 */
const assertMfaRequirementSafe = async (existing, patch, acknowledged) => {
  const defaults = createDefaultSettings();
  const before = resolveMfaMode(normalizeMfaSettings({ ...defaults, ...existing }));
  const after = resolveMfaMode(normalizeMfaSettings({ ...defaults, ...existing, ...patch }, patch));
  if (after !== 'required' || before === 'required' || acknowledged) return;
  const enrolled = await strapi.db.query('plugin::magic-link.totp-config').count({
    where: { principalType: 'users-permissions', enabled: true },
  });
  if (Number(enrolled) > 0) return;
  throw new errors.ValidationError(
    'No user has an authenticator yet. Send acknowledgeNoEnrolledUsers: true to require it anyway',
    { key: 'settings.mfa.noEnrolledUsers', fields: ['mfa_mode'] }
  );
};

/**
 * Reads `acknowledgeNoEnrolledUsers` from the raw body (top level or inside
 * the `settings` envelope). It is not a setting and is never stored.
 *
 * @param {unknown} body - Raw request body.
 * @returns {boolean} True when explicitly acknowledged.
 */
const isNoEnrolmentAcknowledged = (body) =>
  body?.acknowledgeNoEnrolledUsers === true || body?.settings?.acknowledgeNoEnrolledUsers === true;

module.exports = {
  SECURITY_SETTING_KEYS,

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
    const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });

    // The patch is merged into the settings read under the cluster-wide
    // settings lock (utils/cluster.js), so two admins saving different fields
    // on different processes, or a replica's startup migration, never undo
    // each other's change. Permission and MFA checks see the same settings
    // that are written.
    let writeFailed = false;
    let processedBody;
    try {
      processedBody = await withClusterLock(strapi, 'store:settings', async () => {
        const existingSettings = (await pluginStore.get({ key: 'settings' })) || {};
        assertSettingsChangeAllowed(ctx, existingSettings, settingsPatch);
        await assertMfaRequirementSafe(
          existingSettings,
          settingsPatch,
          isNoEnrolmentAcknowledged(ctx.request.body)
        );
        const next = normalizeBooleans(
          pickKnownSettings(
            normalizeMfaSettings({ ...existingSettings, ...settingsPatch }, settingsPatch)
          )
        );
        if (next.store_login_info === undefined) next.store_login_info = true;
        try {
          await pluginStore.set({ key: 'settings', value: next });
        } catch (error) {
          writeFailed = true;
          throw error;
        }
        return next;
      });
    } catch (error) {
      if (!writeFailed) throw error;
      strapi.log.error('[magic-link] Settings could not be saved');
      return ctx.throw(500, 'Failed to save settings');
    }

    try {
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
   * JWT session records and IP bans. Requires `{ confirm: 'RESET' }` and the
   * `settings.security` action: the reset removes IP bans and resets link
   * targets, templates, sender and code rules, so a role with only
   * `settings.update` may not run it. Active JWT revocations are kept, so a
   * revoked token never becomes valid again through a reset, and the MFA
   * settings are kept unless `resetSecurity: true` is sent.
   *
   * @param {object} ctx - Strapi Koa context.
   * @throws {errors.PolicyError} Without `settings.security`.
   */
  async resetData(ctx) {
    const { resetSecurity } = parseBody(adminResetSchema, ctx.request?.body);
    if (!can(ctx, SECURITY_ACTION)) {
      // PolicyError keeps message and details in the 403 response (see above).
      throw new errors.PolicyError(
        'Resetting Magic Link data requires the "Settings: Security" permission',
        { key: 'settings.security.forbidden', fields: [] }
      );
    }
    try {
      const kept = new Set(resetSecurity ? [] : MFA_SETTING_KEYS);
      await updateStoreKey(strapi, 'settings', (current) => {
        const defaults = createDefaultSettings();
        for (const key of kept) {
          if (current?.[key] !== undefined) defaults[key] = current[key];
        }
        return { value: defaults };
      });

      const deleted = await strapi.db.query('plugin::magic-link.token').deleteMany({ where: {} });
      await deleteAllSessions(strapi);
      // A list left by a release before 6.2 that was not migrated yet.
      await withClusterLock(strapi, 'store:jwt_sessions', () =>
        strapi.store({ type: 'plugin', name: 'magic-link' }).delete({ key: 'jwt_sessions' })
      );
      await updateStoreKey(strapi, 'banned_ips', () => ({ value: { ips: [] } }));

      const rateLimiter = strapi.plugin('magic-link')?.service?.('rate-limiter');
      if (typeof rateLimiter?.reloadSettings === 'function') {
        await rateLimiter.reloadSettings();
      }

      strapi.log.warn(
        `[magic-link] Data reset by admin ${ctx.state?.user?.id ?? 'unknown'} (${deleted?.count || 0} token(s) deleted, MFA settings ${resetSecurity ? 'reset' : 'kept'})`
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
