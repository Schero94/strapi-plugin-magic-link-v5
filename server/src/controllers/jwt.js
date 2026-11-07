'use strict';

const cryptoUtils = require('../utils/crypto');
const { readJwtSessions, updateJwtSessions, cleanSessions } = require('../utils/jwt-session-store');
const { jwtRevokeSchema, jwtUnrevokeSchema, parseBody } = require('./validation');
const { CLAIM_REASON } = require('../utils/account-claim');

const REVOKE_REASON = 'Manually revoked from admin UI';

/**
 * Admin id of the caller, recorded on revocations for the audit trail.
 *
 * @param {object} ctx - Koa context.
 * @returns {number|string|null} Admin user id.
 */
const actorId = (ctx) => ctx?.state?.user?.id ?? null;

/**
 * Shapes a stored session for the admin list. Only a hash prefix is shown;
 * plaintext JWTs are never stored or returned.
 *
 * @param {object} session - Stored record.
 * @param {Date} now - Current time.
 * @returns {object} Display record.
 */
const toDisplaySession = (session, now) => ({
  id: session.id,
  userId: session.userId,
  userDocumentId: session.userDocumentId,
  username: session.username,
  email: session.userEmail,
  token: session.jwtTokenHash
    ? `[hash] ${String(session.jwtTokenHash).substring(0, 12)}...`
    : 'N/A',
  createdAt: session.createdAt,
  expiresAt: session.expiresAt,
  ipAddress: session.ipAddress,
  userAgent: session.userAgent || 'Unknown',
  source: session.source || 'Magic Link Login',
  jwtManagement: session.jwtManagement || 'legacy-support',
  revoked: Boolean(session.isRevoked),
  revokedAt: session.revokedAt || null,
  revokedBy: session.revokedBy ?? null,
  isExpired: new Date(session.expiresAt) < now,
});

/**
 * JWT controller: lists plugin-issued sessions and revokes or restores them.
 * Every change goes through the serialised session store, and the blocklist
 * entry is written before the session is shown as revoked.
 */
module.exports = {
  /**
   * Returns all stored JWT sessions with safe display data.
   * @param {object} ctx - Koa context
   */
  async getSessions(ctx) {
    try {
      const now = new Date();
      const sessions = cleanSessions(await readJwtSessions(strapi));
      ctx.send(sessions.map((session) => toDisplaySession(session, now)));
    } catch {
      strapi.log.error('[magic-link] JWT sessions could not be loaded');
      ctx.throw(500, 'Failed to load JWT sessions');
    }
  },

  /**
   * Revokes a JWT session by `sessionId`, or a raw JWT by `token`. The JWT
   * hash is blocked until the token expires and, in refresh mode, the
   * users-permissions session is revoked as well. A client-supplied user id
   * is never trusted.
   * @param {object} ctx - Koa context
   */
  async revokeToken(ctx) {
    const { token, sessionId } = parseBody(jwtRevokeSchema, ctx.request.body);
    const magicLink = strapi.plugin('magic-link').service('magic-link');
    const revokedBy = actorId(ctx);

    try {
      if (sessionId) {
        const sessions = await readJwtSessions(strapi);
        const session = sessions.find((candidate) => candidate.id === sessionId);
        if (!session) return ctx.notFound('Session not found');

        const hashToBlock =
          session.jwtTokenHash ||
          (typeof session.jwtToken === 'string' ? cryptoUtils.hashJwt(session.jwtToken) : null);
        if (hashToBlock) {
          await magicLink.blockJwtTokenByHash(hashToBlock, session.userId, REVOKE_REASON, {
            expiresAt: session.expiresAt,
          });
        }

        await updateJwtSessions(strapi, (list) =>
          list.map((candidate) =>
            candidate.id === sessionId
              ? {
                  ...candidate,
                  isRevoked: true,
                  revokedAt: new Date().toISOString(),
                  revokeReason: REVOKE_REASON,
                  revokedBy,
                }
              : candidate
          )
        );
        strapi.log.info(
          `[magic-link] Admin ${revokedBy ?? 'unknown'} revoked JWT session ${sessionId}`
        );
        return ctx.send({ success: true, message: 'JWT session revoked successfully' });
      }

      const tokenHash = cryptoUtils.hashJwt(token);
      const sessions = await readJwtSessions(strapi);
      const owner = sessions.find((candidate) => candidate.jwtTokenHash === tokenHash);
      await magicLink.blockJwtToken(token, owner?.userId ?? 'unknown', REVOKE_REASON);

      await updateJwtSessions(strapi, (list) =>
        list.map((candidate) =>
          candidate.jwtTokenHash === tokenHash
            ? {
                ...candidate,
                isRevoked: true,
                revokedAt: new Date().toISOString(),
                revokeReason: `${REVOKE_REASON} via token`,
                revokedBy,
              }
            : candidate
        )
      );
      strapi.log.info(`[magic-link] Admin ${revokedBy ?? 'unknown'} revoked a JWT`);
      return ctx.send({ success: true, message: 'Session revoked successfully.' });
    } catch {
      strapi.log.error('[magic-link] JWT revocation failed');
      return ctx.throw(500, 'Failed to revoke JWT session');
    }
  },

  /**
   * Removes a session's JWT block only after blocklist storage accepts the
   * change. Refresh-mode sessions cannot be restored, because the
   * users-permissions session behind them was deleted on revocation, and
   * neither can sessions ended by an account claim (pre-account hijacking
   * defence, utils/account-claim.js).
   *
   * @param {import('koa').Context} ctx - Authenticated admin request context
   * @returns {Promise<void>} Sends the updated session or throws on storage failure
   */
  async unrevokeToken(ctx) {
    const { sessionId } = parseBody(jwtUnrevokeSchema, ctx.request.body);

    try {
      const sessions = await readJwtSessions(strapi);
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (!session) return ctx.notFound('Session not found');

      if (new Date(session.expiresAt) < new Date()) {
        return ctx.badRequest('Cannot unrevoke an expired session');
      }
      if (session.upSessionId) {
        return ctx.badRequest(
          'Refresh-mode sessions cannot be restored; the user has to log in again'
        );
      }
      // Sessions ended because the mailbox owner claimed an unconfirmed
      // account may belong to whoever registered the address first.
      if (session.revokeReason === CLAIM_REASON) {
        return ctx.badRequest(
          'Sessions ended by an account claim cannot be restored; the user has to log in again'
        );
      }

      const hashToUnblock =
        session.jwtTokenHash ||
        (typeof session.jwtToken === 'string' ? cryptoUtils.hashJwt(session.jwtToken) : null);
      if (hashToUnblock) {
        const magicLink = strapi.plugin('magic-link').service('magic-link');
        await magicLink.unblockJwtTokenByHash(hashToUnblock, session.userId);
      }

      await updateJwtSessions(strapi, (list) =>
        list.map((candidate) =>
          candidate.id === sessionId
            ? {
                ...candidate,
                isRevoked: false,
                revokedAt: null,
                revokeReason: null,
                revokedBy: null,
                restoredBy: actorId(ctx),
              }
            : candidate
        )
      );
      strapi.log.info(
        `[magic-link] Admin ${actorId(ctx) ?? 'unknown'} restored JWT session ${sessionId}`
      );
      return ctx.send({ success: true, message: 'JWT session unrevoked successfully' });
    } catch {
      strapi.log.error('[magic-link] Error unrevoking JWT token');
      return ctx.throw(500, 'Failed to update JWT revocation status');
    }
  },

  /**
   * Marks expired sessions as ended and drops records past the retention
   * period.
   * @param {object} ctx - Koa context
   */
  async cleanupSessions(ctx) {
    try {
      const now = new Date();
      const cleanedCount = await updateJwtSessions(strapi, (list) => {
        let count = 0;
        const sessions = list.map((session) => {
          if (new Date(session.expiresAt) < now && !session.isRevoked) {
            count += 1;
            return {
              ...session,
              isRevoked: true,
              revokedAt: now.toISOString(),
              revokeReason: 'Automatically expired',
            };
          }
          return session;
        });
        return { sessions, result: count };
      });

      ctx.send({
        success: true,
        count: cleanedCount,
        message: `${cleanedCount} expired sessions cleaned up.`,
      });
    } catch {
      strapi.log.error('[magic-link] Session cleanup failed');
      ctx.throw(500, 'Failed to clean up sessions');
    }
  },
};
