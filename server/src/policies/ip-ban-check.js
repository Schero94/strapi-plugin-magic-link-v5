'use strict';

const { normalizeIpAddress } = require('../utils/ip-address');

const setPolicyError = (policyContext, status, name, code, message) => {
  policyContext.response.status = status;
  policyContext.response.body = {
    data: null,
    error: {
      status,
      name,
      message,
      details: { code },
    },
  };
};

/**
 * Blocks public authentication requests from banned IP addresses. A missing
 * request address or a block-list storage failure denies the request rather
 * than silently bypassing the ban.
 *
 * @param {object} policyContext - Strapi request context.
 * @param {object} _config - Policy configuration, unused.
 * @param {{ strapi: object }} dependencies - Strapi policy dependencies.
 * @returns {Promise<boolean>} Whether the public route may continue.
 */
module.exports = async (policyContext, _config, { strapi }) => {
  const ipAddress = normalizeIpAddress(policyContext.request?.ip);
  if (!ipAddress) {
    setPolicyError(
      policyContext,
      503,
      'ServiceUnavailableError',
      'IP_BAN_CHECK_UNAVAILABLE',
      'Authentication is temporarily unavailable.'
    );
    return false;
  }

  try {
    const magicLink = strapi.plugin('magic-link').service('magic-link');
    const isBanned = await magicLink.isIPBanned(ipAddress);
    if (!isBanned) return true;

    setPolicyError(
      policyContext,
      403,
      'ForbiddenError',
      'IP_ADDRESS_BLOCKED',
      'This request cannot be completed.'
    );
    return false;
  } catch {
    strapi.log.error('[Magic-Link] IP ban check failed');
    setPolicyError(
      policyContext,
      503,
      'ServiceUnavailableError',
      'IP_BAN_CHECK_UNAVAILABLE',
      'Authentication is temporarily unavailable.'
    );
    return false;
  }
};
