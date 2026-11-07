import * as strapiAdmin from '@strapi/strapi/admin';
import pluginPermissions from '../permissions';

const PLUGIN_CAPABILITIES = [...pluginPermissions.read, ...pluginPermissions.manage];
const SETTINGS_CAPABILITIES = [
  ...pluginPermissions.settingsRead,
  ...pluginPermissions.settingsUpdate,
];

/**
 * Action uids the admin holds without conditions.
 *
 * @param {unknown} permissions - useAuth permissions
 * @returns {Set<string>}
 */
const grantedActions = (permissions) =>
  new Set(
    (Array.isArray(permissions) ? permissions : [])
      .filter(
        (permission) =>
          typeof permission?.action === 'string' &&
          (!Array.isArray(permission.conditions) || permission.conditions.length === 0)
      )
      .map((permission) => permission.action)
  );

/**
 * Pure capability mapping (exported for tests).
 *
 * Every capability is false while either check is loading or failed, so write
 * controls never flash in and a failed permission request fails closed.
 *
 * @param {{allowedActions?: Record<string, boolean>, isLoading?: boolean, error?: unknown}} plugin
 *   result of useRBAC([read, manage]) -> canRead, canManage
 * @param {{allowedActions?: Record<string, boolean>, isLoading?: boolean, error?: unknown}} settings
 *   result of useRBAC([settings.read, settings.update]) -> canRead, canUpdate
 * @param {{permissions?: Array<{action: string, conditions?: unknown[]}>, isLoading?: boolean}} [auth]
 *   the signed-in admin's permissions from useAuth. Strapi 5.61 useRBAC checks
 *   once and only re-checks when the requested permissions change; after a
 *   full page load it can run while the admin permissions are still loading,
 *   settle with nothing allowed and never correct itself (Super Admins saw
 *   "no permissions" on reload). Unconditioned grants from the loaded
 *   permissions therefore count as allowed; conditioned ones stay with useRBAC.
 */
export const resolveCapabilities = (plugin = {}, settings = {}, auth = {}) => {
  const isLoading = Boolean(plugin.isLoading || settings.isLoading || auth.isLoading);
  const error = plugin.error ?? settings.error;
  const settled = !isLoading && !error;
  const granted = grantedActions(auth.permissions);
  const allowed = (result, key, uid) =>
    settled && (result.allowedActions?.[key] === true || granted.has(uid));

  // Each flag mirrors exactly one server action. Roles get read + manage
  // together for full access; manage alone does not imply read.
  const canRead = allowed(plugin, 'canRead', 'plugin::magic-link.read');
  const canManage = allowed(plugin, 'canManage', 'plugin::magic-link.manage');
  const canReadSettings = allowed(settings, 'canRead', 'plugin::magic-link.settings.read');
  const canUpdateSettings = allowed(settings, 'canUpdate', 'plugin::magic-link.settings.update');

  return {
    canRead,
    canManage,
    canReadSettings,
    canUpdateSettings,
    isReadOnly: canRead && !canManage,
    isSettingsReadOnly: canReadSettings && !canUpdateSettings,
    isLoading,
    error,
  };
};

/**
 * The signed-in admin's permissions and loading state from Strapi's auth
 * context. Resolved once at module load, so the hook order never changes;
 * test stubs without `useAuth` get an empty result.
 *
 * @returns {{permissions?: unknown[], isLoading?: boolean}}
 */
const useAdminPermissions =
  typeof strapiAdmin.useAuth === 'function'
    ? () => {
        const permissions = strapiAdmin.useAuth('MagicLinkRBAC', (state) => state.permissions);
        const isLoading = strapiAdmin.useAuth('MagicLinkRBAC', (state) => state.isLoading);
        return { permissions, isLoading };
      }
    : () => EMPTY_AUTH;

const EMPTY_AUTH = Object.freeze({});

/**
 * Single source of truth for Magic Link UI gating.
 *
 *   const { canRead, canManage, canReadSettings, canUpdateSettings, isLoading, error } =
 *     useMagicLinkRBAC();
 *
 * The API routes stay authoritative; this hook only keeps unavailable controls
 * out of the UI. `useRBAC` names keys after the last uid segment, so
 * `read`/`settings.read` would collide in one call; they are checked in two.
 *
 * @returns {ReturnType<typeof resolveCapabilities> & {permissions: typeof pluginPermissions}}
 */
export const useMagicLinkRBAC = () => {
  const plugin = strapiAdmin.useRBAC(PLUGIN_CAPABILITIES) ?? {};
  const settings = strapiAdmin.useRBAC(SETTINGS_CAPABILITIES) ?? {};
  const auth = useAdminPermissions();
  return { ...resolveCapabilities(plugin, settings, auth), permissions: pluginPermissions };
};

export default useMagicLinkRBAC;
