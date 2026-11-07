'use strict';

/**
 * Timers started in bootstrap() and cleared in destroy(), plus the admin
 * RBAC action definitions and their 5.x migration.
 */

const timers = new WeakMap();

/**
 * Remembers a timer for a Strapi instance so destroy() can clear it.
 *
 * @param {object} strapi - Strapi instance.
 * @param {NodeJS.Timeout} timer - Timer handle.
 * @returns {NodeJS.Timeout} The same handle.
 */
const trackTimer = (strapi, timer) => {
  if (!timers.has(strapi)) timers.set(strapi, new Set());
  timers.get(strapi).add(timer);
  // Background jobs must not keep the process alive on shutdown.
  if (typeof timer?.unref === 'function') timer.unref();
  return timer;
};

/**
 * Clears every tracked timer of a Strapi instance.
 *
 * @param {object} strapi - Strapi instance.
 * @returns {number} Number of cleared timers.
 */
const clearTrackedTimers = (strapi) => {
  const set = timers.get(strapi);
  if (!set) return 0;
  for (const timer of set) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  const count = set.size;
  set.clear();
  return count;
};

/**
 * Runs an async job once after `delayMs`; errors go to `onError`, never to
 * an unhandled rejection.
 *
 * @param {object} strapi - Strapi instance.
 * @param {number} delayMs - Delay.
 * @param {() => Promise<void>} job - Work.
 * @param {() => void} onError - Error handler (must not throw).
 * @returns {NodeJS.Timeout} Timer.
 */
const runLater = (strapi, delayMs, job, onError) =>
  trackTimer(
    strapi,
    setTimeout(() => {
      Promise.resolve()
        .then(job)
        .catch(() => onError());
    }, delayMs)
  );

/**
 * Runs an async job every `intervalMs`; errors go to `onError`.
 *
 * @param {object} strapi - Strapi instance.
 * @param {number} intervalMs - Interval.
 * @param {() => Promise<void>} job - Work.
 * @param {() => void} onError - Error handler (must not throw).
 * @returns {NodeJS.Timeout} Timer.
 */
const runEvery = (strapi, intervalMs, job, onError) =>
  trackTimer(
    strapi,
    setInterval(() => {
      Promise.resolve()
        .then(job)
        .catch(() => onError());
    }, intervalMs)
  );

/**
 * Admin RBAC actions (6.0.0). Every action needs `subCategory`, otherwise
 * the Strapi 5 role editor does not render its checkbox.
 */
const RBAC_ACTIONS = Object.freeze([
  {
    section: 'plugins',
    displayName: 'Read',
    uid: 'read',
    subCategory: 'General',
    pluginName: 'magic-link',
  },
  {
    section: 'plugins',
    displayName: 'Manage',
    uid: 'manage',
    subCategory: 'General',
    pluginName: 'magic-link',
  },
  {
    section: 'plugins',
    displayName: 'Issue login links without e-mail (impersonation)',
    uid: 'tokens.issue',
    subCategory: 'Tokens',
    pluginName: 'magic-link',
  },
  {
    section: 'plugins',
    displayName: 'Read',
    uid: 'settings.read',
    subCategory: 'Settings',
    pluginName: 'magic-link',
  },
  {
    section: 'plugins',
    displayName: 'Edit',
    uid: 'settings.update',
    subCategory: 'Settings',
    pluginName: 'magic-link',
  },
  {
    section: 'plugins',
    displayName: 'Security (link targets, templates, account and MFA rules)',
    uid: 'settings.security',
    subCategory: 'Settings',
    pluginName: 'magic-link',
  },
]);

const LEGACY_ACCESS_ACTION = 'plugin::magic-link.access';
const MIGRATED_ACTIONS = ['plugin::magic-link.read', 'plugin::magic-link.manage'];

/**
 * Grants `read` and `manage` to every admin role that still holds the 5.x
 * `plugin::magic-link.access` permission, then removes the old rows. 5.x
 * `access` covered both viewing and changing data, so this keeps those roles
 * working. `tokens.issue` (direct login links) is never granted
 * automatically. If Strapi already removed the unknown action, there is
 * nothing to migrate and roles have to be updated by hand (see CHANGELOG).
 *
 * @param {object} strapi - Strapi instance.
 * @returns {Promise<{roles: number}>} Number of migrated roles.
 */
const migrateLegacyAccessPermission = async (strapi) => {
  const permissionQuery = strapi.db.query('admin::permission');
  const legacy = await permissionQuery.findMany({
    where: { action: LEGACY_ACCESS_ACTION },
    populate: ['role', 'apiToken'],
  });
  if (!legacy || legacy.length === 0) return { roles: 0 };

  // Owners are admin roles or (admin) API tokens.
  const owners = new Map();
  for (const permission of legacy) {
    if (permission.role?.id != null)
      owners.set(`role:${permission.role.id}`, { role: permission.role.id });
    else if (permission.apiToken?.id != null)
      owners.set(`token:${permission.apiToken.id}`, { apiToken: permission.apiToken.id });
  }

  for (const owner of owners.values()) {
    const ownerWhere =
      owner.role != null ? { role: { id: owner.role } } : { apiToken: { id: owner.apiToken } };
    const existing = await permissionQuery.findMany({
      where: { action: { $in: MIGRATED_ACTIONS }, ...ownerWhere },
    });
    const have = new Set((existing || []).map((permission) => permission.action));
    for (const action of MIGRATED_ACTIONS) {
      if (!have.has(action)) {
        await permissionQuery.create({
          data: {
            action,
            actionParameters: {},
            subject: null,
            properties: {},
            conditions: [],
            ...owner,
          },
        });
      }
    }
  }
  await permissionQuery.deleteMany({ where: { action: LEGACY_ACCESS_ACTION } });
  return { roles: owners.size };
};

/**
 * Warns when Strapi trusts proxy headers without limiting how many
 * X-Forwarded-For entries it reads: then clients can choose their own IP for
 * rate limits and IP bans.
 *
 * @param {object} strapi - Strapi instance.
 * @returns {boolean} Whether a warning was logged.
 */
const warnOnUnsafeProxyConfig = (strapi) => {
  const proxyEnabled = Boolean(strapi.config?.get?.('server.proxy.koa'));
  const maxIpsCount = Number(strapi.config?.get?.('server.proxy.maxIpsCount', 0));
  if (proxyEnabled && !(maxIpsCount > 0)) {
    strapi.log.warn(
      '[magic-link] server.proxy.koa is enabled without server.proxy.maxIpsCount: clients can spoof their IP ' +
        'via X-Forwarded-For, which weakens rate limits and IP bans. Set maxIpsCount to the number of trusted proxies.'
    );
    return true;
  }
  return false;
};

module.exports = {
  RBAC_ACTIONS,
  LEGACY_ACCESS_ACTION,
  clearTrackedTimers,
  migrateLegacyAccessPermission,
  runEvery,
  runLater,
  trackTimer,
  warnOnUnsafeProxyConfig,
};
