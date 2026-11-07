/**
 * Magic Link admin RBAC actions (6.0.0).
 *
 * The server registers these actions in bootstrap and enforces them on every
 * admin route. The admin UI only hides or disables controls.
 *
 * | Key            | Action uid                         | Grants                                               |
 * |----------------|------------------------------------|------------------------------------------------------|
 * | read           | plugin::magic-link.read            | View tokens, OTP codes, JWT sessions and IP bans     |
 * | manage         | plugin::magic-link.manage          | Create, block, extend and delete tokens, revoke      |
 * |                |                                    | sessions, ban and unban IPs, delete OTP codes, clean |
 * | settingsRead   | plugin::magic-link.settings.read   | View the Settings and License pages                  |
 * | settingsUpdate | plugin::magic-link.settings.update | Save settings, reset rate limits, change the license |
 * | settingsSecurity | plugin::magic-link.settings.security | Change link targets, templates, account and MFA  |
 * |                |                                    | rules (server-enforced in addition to update)        |
 *
 * `useRBAC` derives the `allowedActions` keys from the last uid segment, so
 * `read` and `settings.read` both become `canRead`. Check them in separate
 * `useRBAC` calls. `useMagicLinkRBAC()` in hooks/useMagicLinkRBAC.js does that.
 */
const action = (uid) => Object.freeze({ action: `plugin::magic-link.${uid}`, subject: null });

const read = Object.freeze([action('read')]);
const manage = Object.freeze([action('manage')]);
const settingsRead = Object.freeze([action('settings.read')]);
const settingsUpdate = Object.freeze([action('settings.update')]);
const settingsSecurity = Object.freeze([action('settings.security')]);

const pluginPermissions = Object.freeze({
  read,
  manage,
  settingsRead,
  settingsUpdate,
  settingsSecurity,
  /**
   * Menu link and Tokens page. Every view lists data first, so it needs
   * `read`. Grant `read` together with `manage` for full access.
   */
  main: read,

  // Deprecated aliases so the views keep compiling while they migrate.
  // The 5.x action plugin::magic-link.access does not exist in 6.0.0.
  /** @deprecated use `main` */
  access: read,
  /** @deprecated use `settingsRead` */
  accessSettings: settingsRead,
  /** @deprecated use `settingsRead` */
  readSettings: settingsRead,
  /** @deprecated use `settingsUpdate` */
  updateSettings: settingsUpdate,
});

export default pluginPermissions;
