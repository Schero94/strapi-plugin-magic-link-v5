import { useRBAC } from '@strapi/strapi/admin';
import pluginPermissions from '../permissions';

const PLUGIN_CAPABILITIES = [...pluginPermissions.read, ...pluginPermissions.manage];
const SETTINGS_CAPABILITIES = [...pluginPermissions.settingsRead, ...pluginPermissions.settingsUpdate];

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
 */
export const resolveCapabilities = (plugin = {}, settings = {}) => {
  const isLoading = Boolean(plugin.isLoading || settings.isLoading);
  const error = plugin.error ?? settings.error;
  const settled = !isLoading && !error;
  const allowed = (result, key) => settled && result.allowedActions?.[key] === true;

  // Each flag mirrors exactly one server action. Roles get read + manage
  // together for full access; manage alone does not imply read.
  const canRead = allowed(plugin, 'canRead');
  const canManage = allowed(plugin, 'canManage');
  const canReadSettings = allowed(settings, 'canRead');
  const canUpdateSettings = allowed(settings, 'canUpdate');

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
  const plugin = useRBAC(PLUGIN_CAPABILITIES) ?? {};
  const settings = useRBAC(SETTINGS_CAPABILITIES) ?? {};
  return { ...resolveCapabilities(plugin, settings), permissions: pluginPermissions };
};

export default useMagicLinkRBAC;
