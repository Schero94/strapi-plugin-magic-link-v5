'use strict';

const { errors } = require('@strapi/utils');
const { normalizeEmail } = require('../utils/email');
const { normalizeIpAddress, ipBanKey } = require('../utils/ip-address');
const { buildLoginUrl } = require('../utils/login-url');
const { updateStoreKey } = require('../utils/cluster');
const {
  adminTokenCreateSchema,
  adminTokenExtendSchema,
  adminTokenListQuerySchema,
  ipBanSchema,
  parseBody,
  tokenIdSchema,
} = require('./validation');

const TOKEN_UID = 'plugin::magic-link.token';
const USER_UID = 'plugin::users-permissions.user';
/** Issuing a login link that is returned to the admin instead of e-mailed. */
const ISSUE_ACTION = 'plugin::magic-link.tokens.issue';
const DEFAULT_LIST_SIZE = 1000;
const BANNED_IPS_KEY = 'banned_ips';

/**
 * Read-modify-write of the IP block list under a cluster-wide database lock
 * (utils/cluster.js), so bans and unbans on different processes never
 * overwrite each other.
 *
 * @param {(ips: string[]) => {ips?: string[], result?: any}} mutator - Change.
 * @returns {Promise<any>} The mutator's result.
 */
const updateBannedIps = (mutator) =>
  updateStoreKey(strapi, BANNED_IPS_KEY, (stored) => {
    const ips = stored?.ips ?? [];
    if (!Array.isArray(ips)) throw new Error('Invalid IP block-list data');
    const outcome = mutator(ips);
    return { value: outcome.ips ? { ips: outcome.ips } : undefined, result: outcome.result };
  });

const pluginStore = () => strapi.store({ type: 'plugin', name: 'magic-link' });
const magicLinkService = () => strapi.plugin('magic-link').service('magic-link');

/**
 * Admin id of the caller for audit logs.
 *
 * @param {object} ctx - Koa context.
 * @returns {number|string} Admin id or 'unknown'.
 */
const actorId = (ctx) => ctx?.state?.user?.id ?? 'unknown';

/**
 * Whether the calling admin holds an RBAC action.
 *
 * @param {object} ctx - Koa context.
 * @param {string} action - Action uid.
 * @returns {boolean} Whether the action is granted.
 */
const can = (ctx, action) => {
  try {
    return ctx?.state?.userAbility?.can?.(action) === true;
  } catch {
    return false;
  }
};

/**
 * Token fields that are safe to show in the admin. The hash, salt, lookup
 * prefix (8 characters of the plaintext link), challenge state and provider
 * message id never leave the server.
 *
 * @param {object} token - Stored token row.
 * @returns {object} Display token.
 */
const toAdminToken = (token) => ({
  id: token.id,
  documentId: token.documentId,
  email: token.email,
  expires_at: token.expires_at,
  is_active: Boolean(token.is_active),
  is_used: Boolean(token.is_used),
  used_at: token.used_at || null,
  last_used_at: token.last_used_at || null,
  ip_address: token.ip_address || null,
  user_agent: token.user_agent || null,
  context: token.context && typeof token.context === 'object' ? token.context : {},
  // Login e-mail outcome (utils/delivery-status.js). The provider message id
  // stays on the server; it is only used to match bounce notifications.
  delivery_status: token.delivery_status || null,
  delivery_channel: token.delivery_channel || null,
  delivery_reason: token.delivery_reason || null,
  delivery_updated_at: token.delivery_updated_at || null,
  createdAt: token.createdAt,
  updatedAt: token.updatedAt,
});

/**
 * Loads a token by documentId or numeric id from a validated route param.
 *
 * @param {object} ctx - Koa context.
 * @returns {Promise<object|null>} Token row.
 */
const findTokenByParam = async (ctx) => {
  const id = parseBody(tokenIdSchema, ctx.params?.id);
  const where = /^\d+$/.test(id)
    ? { $or: [{ documentId: id }, { id: Number(id) }] }
    : { documentId: id };
  return strapi.db.query(TOKEN_UID).findOne({ where });
};

/**
 * Reads the stored IP block list.
 *
 * @returns {Promise<string[]>} Stored addresses.
 */
const readBannedIps = async () => {
  const stored = (await pluginStore().get({ key: BANNED_IPS_KEY })) || { ips: [] };
  if (!Array.isArray(stored.ips)) throw new Error('Invalid IP block-list data');
  return stored.ips;
};

/**
 * Admin token controller. Every route is protected by `admin::hasPermissions`
 * (see routes/admin.js); token creation additionally checks
 * `plugin::magic-link.tokens.issue` before it hands a login link to the admin.
 */
module.exports = {
  /**
   * Lists tokens, newest first. Optional `page`/`pageSize` paginate on the
   * server; without them the newest 1000 tokens are returned.
   * @param {object} ctx - Koa context
   */
  async find(ctx) {
    const query = parseBody(adminTokenListQuerySchema, ctx.query || {});
    const pageSize = query.pageSize || DEFAULT_LIST_SIZE;
    const page = query.page || 1;
    try {
      const [rows, total] = await Promise.all([
        strapi.db.query(TOKEN_UID).findMany({
          orderBy: { createdAt: 'desc' },
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        strapi.db.query(TOKEN_UID).count(),
      ]);
      return {
        data: (rows || []).map(toAdminToken),
        meta: {
          pagination: {
            page,
            pageSize,
            total,
            pageCount: Math.max(1, Math.ceil(total / pageSize)),
          },
        },
      };
    } catch {
      strapi.log.error('[magic-link] Token list could not be loaded');
      return ctx.throw(500, 'Failed to load tokens');
    }
  },

  /**
   * Creates a login token for a users-permissions user.
   *
   * - `send_email: true` (default): the link is e-mailed through the same
   *   renderer and providers as the public send-link; the response never
   *   contains the plaintext token.
   * - `send_email: false`: the link is returned once to the admin. That is
   *   an impersonation capability and needs `plugin::magic-link.tokens.issue`.
   *
   * Missing users are only created when `createUserIfNotExists` is on; they
   * start unconfirmed like public sign-ups. Each issue is audit-logged with
   * the acting admin and the token id (no e-mail, no token).
   *
   * @param {object} ctx - Koa context
   */
  async create(ctx) {
    const body = parseBody(adminTokenCreateSchema, ctx.request.body);
    const sendEmail = body.send_email !== false;

    if (!sendEmail && !can(ctx, ISSUE_ACTION)) {
      // PolicyError, not ForbiddenError: Strapi's authorize middleware answers
      // any other ForbiddenError with a bare "Forbidden" and drops `details`.
      throw new errors.PolicyError(
        'Returning a login link without e-mail requires the "Issue login links" permission',
        {
          key: 'tokens.issue.forbidden',
        }
      );
    }

    const limiter = strapi.plugin('magic-link').service('rate-limiter');
    const check = await limiter.checkRateLimit(`admin:${actorId(ctx)}`, 'admin');
    if (!check.allowed) {
      ctx.set?.('Retry-After', String(check.retryAfter));
      throw new errors.RateLimitError(
        `Too many token requests. Try again in ${check.retryAfter} seconds.`,
        {
          retryAfter: check.retryAfter,
        }
      );
    }

    const magicLink = magicLinkService();
    const settings = (await magicLink.settings()) || {};
    const email = normalizeEmail(body.email);

    const users = await strapi.db.query(USER_UID).findMany({ where: { email }, limit: 1 });
    let user = users && users[0] ? users[0] : null;
    if (!user) {
      if (settings.createUserIfNotExists !== true) {
        return ctx.badRequest('User does not exist and automatic user creation is disabled');
      }
      // Looked up again and created under the cluster-wide user-creation lock
      // (services/magic-link.js findOrCreateUser): parallel requests for one
      // new address, on one or several processes, create a single account.
      let created;
      try {
        ({ user, created } = await magicLink.findOrCreateUser(email));
      } catch {
        strapi.log.error('[magic-link] Admin token: user could not be created');
        return ctx.badRequest(
          'The user could not be created (check the users-permissions default role)'
        );
      }
      if (created) {
        strapi.log.info(
          `[magic-link] Admin ${actorId(ctx)} created users-permissions user ${user.id} for a login link`
        );
      }
    }
    if (user.blocked) {
      return ctx.badRequest('This user is blocked');
    }

    let token;
    try {
      token = await magicLink.createToken(user.email, body.context || {});
      if (body.ttl) {
        const expiresAt = new Date(Date.now() + body.ttl * 3600 * 1000);
        await strapi.db
          .query(TOKEN_UID)
          .update({ where: { id: token.id }, data: { expires_at: expiresAt } });
        token.expires_at = expiresAt;
      }
    } catch {
      strapi.log.error('[magic-link] Admin token could not be created');
      return ctx.throw(500, 'Failed to create token');
    }

    const response = {
      id: token.id,
      documentId: token.documentId,
      email: token.email,
      expires_at: new Date(token.expires_at).toISOString(),
      is_active: true,
      is_used: false,
      context: token.context || {},
      sent: false,
    };

    if (sendEmail) {
      try {
        await magicLink.sendLoginLink(token, { username: user.username });
      } catch {
        await strapi.db
          .query(TOKEN_UID)
          .update({ where: { id: token.id }, data: { is_active: false } });
        strapi.log.error('[magic-link] Admin token e-mail could not be sent; token deactivated');
        return ctx.throw(503, 'The login e-mail could not be sent');
      }
      response.sent = true;
      strapi.log.info(
        `[magic-link] Admin ${actorId(ctx)} issued login token ${token.documentId} (delivery: email)`
      );
      return response;
    }

    response.token = token._plaintextToken;
    response.loginUrl = buildLoginUrl(settings, token._plaintextToken, strapi).loginUrl;
    strapi.log.warn(
      `[magic-link] Admin ${actorId(ctx)} issued login token ${token.documentId} (delivery: direct)`
    );
    ctx.set?.('Cache-Control', 'no-store');
    return response;
  },

  /**
   * Blocks (deactivates) a token.
   * @param {object} ctx - Koa context
   */
  async block(ctx) {
    const token = await findTokenByParam(ctx);
    if (!token) return ctx.notFound('Token not found');

    const updated = await strapi.db
      .query(TOKEN_UID)
      .update({ where: { id: token.id }, data: { is_active: false } });
    strapi.log.info(`[magic-link] Admin ${actorId(ctx)} blocked token ${token.documentId}`);
    return ctx.send({ data: { ...toAdminToken(updated), message: 'Token successfully blocked' } });
  },

  /**
   * Deletes a token.
   * @param {object} ctx - Koa context
   */
  async delete(ctx) {
    const token = await findTokenByParam(ctx);
    if (!token) return ctx.notFound('Token not found');

    await strapi.db.query(TOKEN_UID).delete({ where: { id: token.id } });
    strapi.log.info(`[magic-link] Admin ${actorId(ctx)} deleted token ${token.documentId}`);
    return ctx.send({ success: true, message: 'Token successfully deleted' });
  },

  /**
   * Re-activates a blocked token. Refused for used single-use links, links
   * whose second-factor challenge was completed, expired links and links
   * last used from a banned IP address.
   * @param {object} ctx - Koa context
   */
  async activate(ctx) {
    const token = await findTokenByParam(ctx);
    if (!token) return ctx.notFound('Token not found');

    const settings = (await magicLinkService().settings()) || {};
    if (token.is_used && settings.stays_valid !== true) {
      return ctx.badRequest('A used single-use link cannot be activated again');
    }
    if (token.challenge?.verifiedAt) {
      return ctx.badRequest('This link already completed a login');
    }
    if (new Date(token.expires_at).getTime() <= Date.now()) {
      return ctx.badRequest('Expired links cannot be activated; extend the link first');
    }
    const lastIp = normalizeIpAddress(token.ip_address);
    if (lastIp) {
      const lastKey = ipBanKey(lastIp);
      const banned = (await readBannedIps()).some((ip) => ipBanKey(ip) === lastKey);
      if (banned) return ctx.badRequest('This link was used from a banned IP address');
    }

    const updated = await strapi.db
      .query(TOKEN_UID)
      .update({ where: { id: token.id }, data: { is_active: true } });
    strapi.log.info(`[magic-link] Admin ${actorId(ctx)} activated token ${token.documentId}`);
    return ctx.send({
      data: { ...toAdminToken(updated), message: 'Token successfully activated' },
    });
  },

  /**
   * Extends a token by 1-365 days (from now when it already expired).
   * @param {object} ctx - Koa context
   */
  async extend(ctx) {
    const { days } = parseBody(adminTokenExtendSchema, ctx.request.body || {});
    const token = await findTokenByParam(ctx);
    if (!token) return ctx.notFound('Token not found');

    const settings = (await magicLinkService().settings()) || {};
    if (token.is_used && settings.stays_valid !== true) {
      return ctx.badRequest('A used single-use link cannot be extended');
    }

    const current = new Date(token.expires_at).getTime();
    const base = Number.isFinite(current) && current > Date.now() ? current : Date.now();
    const newExpiryDate = new Date(base + days * 24 * 60 * 60 * 1000);

    const updated = await strapi.db.query(TOKEN_UID).update({
      where: { id: token.id },
      data: { expires_at: newExpiryDate },
    });
    strapi.log.info(
      `[magic-link] Admin ${actorId(ctx)} extended token ${token.documentId} by ${days} day(s)`
    );
    return ctx.send({
      data: {
        ...toAdminToken(updated),
        expiresAt: newExpiryDate.toISOString(),
        extendedBy: `${days} days`,
        message: `Token validity extended by ${days} days`,
      },
    });
  },

  /**
   * Adds a canonical IP address to the block list and deactivates tokens
   * last used from it (including the IPv4-mapped IPv6 form). Bans match
   * like the rate limits (utils/ip-address.js ipBanKey): IPv4 exactly,
   * IPv6 per /64, so an IPv6 ban covers the whole /64 network.
   * @param {object} ctx - Koa context
   */
  async banIP(ctx) {
    const { data } = parseBody(ipBanSchema, ctx.request.body);
    const ipAddress = normalizeIpAddress(data.ip);
    if (!ipAddress) {
      return ctx.badRequest('A valid IPv4 or IPv6 address is required');
    }

    try {
      const banKey = ipBanKey(ipAddress);
      const added = await updateBannedIps((ips) =>
        ips.some((existingIp) => ipBanKey(existingIp) === banKey)
          ? { result: false }
          : { ips: [...ips, ipAddress], result: true }
      );

      if (added) {
        const variants = ipAddress.includes(':') ? [ipAddress] : [ipAddress, `::ffff:${ipAddress}`];
        const result = await strapi.db.query(TOKEN_UID).updateMany({
          where: { ip_address: { $in: variants }, is_active: true },
          data: { is_active: false },
        });
        strapi.log.info(
          `[magic-link] Admin ${actorId(ctx)} banned an IP address (${result?.count || 0} token(s) deactivated)`
        );
      }
      return { success: true, message: `IP ${ipAddress} has been banned` };
    } catch {
      strapi.log.error('[magic-link] IP ban failed');
      return ctx.throw(500, 'Failed to ban IP address');
    }
  },

  /**
   * Returns the IP block list.
   * @param {object} ctx - Koa context
   */
  async getBannedIPs(ctx) {
    try {
      return { ips: await readBannedIps() };
    } catch {
      strapi.log.error('[magic-link] IP block list could not be loaded');
      return ctx.throw(500, 'Failed to load banned IP addresses');
    }
  },

  /**
   * Removes the ban that covers an address: every stored entry with the
   * same ban key (the exact IPv4 address, or any address of the IPv6 /64).
   * @param {object} ctx - Koa context
   */
  async unbanIP(ctx) {
    const { data } = parseBody(ipBanSchema, ctx.request.body);
    const ipAddress = normalizeIpAddress(data.ip);
    if (!ipAddress) {
      return ctx.badRequest('A valid IPv4 or IPv6 address is required');
    }

    try {
      const banKey = ipBanKey(ipAddress);
      await updateBannedIps((ips) => ({
        ips: ips.filter((existingIp) => ipBanKey(existingIp) !== banKey),
      }));
      strapi.log.info(`[magic-link] Admin ${actorId(ctx)} removed an IP ban`);
      return { success: true, message: `IP ${ipAddress} has been unbanned` };
    } catch {
      strapi.log.error('[magic-link] IP unban failed');
      return ctx.throw(500, 'Failed to unban IP address');
    }
  },
};
