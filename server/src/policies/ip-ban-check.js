'use strict';

const { errors } = require('@strapi/utils');
const { normalizeIpAddress } = require('../utils/ip-address');

/**
 * Blocks public authentication requests from banned IP addresses. A missing
 * request address or a block-list storage failure denies the request rather
 * than silently bypassing the ban.
 *
 * Strapi turns a `false` policy result into a generic "Policy Failed" error,
 * so this policy throws a `PolicyError` (403) with a stable `details.code`:
 * - IP_ADDRESS_BLOCKED for a banned address,
 * - IP_BAN_CHECK_UNAVAILABLE when the check cannot run.
 * It must be a PolicyError: Strapi 5.61's authorize middleware
 * (@strapi/core dist/services/server/compose-endpoint.js) wraps the policies
 * and answers any other ForbiddenError with a bare "Forbidden" without
 * details. See the Strapi docs on error handling (PolicyError).
 *
 * The request address comes from Koa (`ctx.request.ip`); behind a reverse
 * proxy configure `server.proxy` (`koa: true` plus `maxIpsCount`) so clients
 * cannot spoof it with X-Forwarded-For.
 *
 * @param {object} policyContext - Strapi request context.
 * @param {object} _config - Policy configuration, unused.
 * @param {{ strapi: object }} dependencies - Strapi policy dependencies.
 * @returns {Promise<boolean>} True when the public route may continue.
 * @throws {errors.PolicyError} When the request is refused.
 */
module.exports = async (policyContext, _config, { strapi }) => {
  const unavailable = () =>
    new errors.PolicyError('Authentication is temporarily unavailable.', {
      code: 'IP_BAN_CHECK_UNAVAILABLE',
    });

  const ipAddress = normalizeIpAddress(policyContext.request?.ip);
  if (!ipAddress) throw unavailable();

  let isBanned;
  try {
    const magicLink = strapi.plugin('magic-link').service('magic-link');
    isBanned = await magicLink.isIPBanned(ipAddress);
  } catch {
    strapi.log.error('[magic-link] IP ban check failed');
    throw unavailable();
  }

  if (isBanned) {
    throw new errors.PolicyError('This request cannot be completed.', {
      code: 'IP_ADDRESS_BLOCKED',
    });
  }
  return true;
};
