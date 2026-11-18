'use strict';

/**
 * Oldest Strapi release this plugin works on. Strapi 5.50.0 added
 * `revokeSessionById` to the users-permissions session manager, which every
 * single-session revocation uses; on 5.24.2 and 5.49.0 a revocation in
 * refresh mode answers 500 and the refresh family stays valid (measured with
 * tests/host/strapi-host.test.cjs). Keep in sync with the `@strapi/strapi`
 * and `@strapi/plugin-users-permissions` peer ranges and the CI floor job.
 */
const MIN_STRAPI_VERSION = '5.50.0';

/**
 * Parses a plain `major.minor.patch` version (pre-release suffix ignored).
 *
 * @param {unknown} version - Version string.
 * @returns {number[]|null} `[major, minor, patch]`, or null when not a version.
 */
const parseVersion = (version) => {
  if (typeof version !== 'string') return null;
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
};

/**
 * Tells whether a Strapi version is inside `^MIN_STRAPI_VERSION` (same major,
 * not older than the floor).
 *
 * @param {unknown} version - Running Strapi version (`info.strapi`).
 * @returns {boolean|null} true or false, or null when the version is unknown.
 */
const isSupportedStrapiVersion = (version) => {
  const current = parseVersion(version);
  if (!current) return null;
  const floor = parseVersion(MIN_STRAPI_VERSION);
  if (current[0] !== floor[0]) return false;
  for (let i = 1; i < 3; i += 1) {
    if (current[i] !== floor[i]) return current[i] > floor[i];
  }
  return true;
};

/**
 * Logs one error at start-up when the running Strapi is older than the floor.
 * It does not stop Strapi; the message names the required version and what
 * fails. Logs only the version numbers, nothing else from the config.
 *
 * @param {object} strapi - Strapi instance (reads `info.strapi`).
 * @returns {boolean|null} The result of `isSupportedStrapiVersion`.
 * @sideeffect Writes one error log line on an unsupported version.
 */
const checkStrapiVersion = (strapi) => {
  const version = strapi?.config?.get?.('info.strapi');
  const supported = isSupportedStrapiVersion(version);
  if (supported === false) {
    strapi.log.error(
      `[magic-link] Strapi ${version} is not supported: Magic Link requires Strapi ${MIN_STRAPI_VERSION} or later (users-permissions session manager revokeSessionById). Upgrade Strapi; revoking a session in refresh mode fails on this version.`
    );
  }
  return supported;
};

module.exports = { MIN_STRAPI_VERSION, isSupportedStrapiVersion, checkStrapiVersion };
