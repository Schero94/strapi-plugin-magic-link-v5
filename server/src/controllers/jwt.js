'use strict';

const cryptoUtils = require('../utils/crypto');
const {
  expireSessions,
  findSessionByHash,
  findSessionById,
  listSessions,
  markSessionRestored,
  markSessionsRevoked,
  migrateLegacySessionsIfPresent,
} = require('../utils/jwt-session-store');
const {
  jwtRevokeSchema,
  jwtSessionsQuerySchema,
  jwtUnrevokeSchema,
  parseBody,
} = require('./validation');
const { CLAIM_REASON } = require('../utils/account-claim');

const REVOKE_REASON = 'Manually revoked from admin UI';

/** Error messages of unrevokeToken per restore block reason (unchanged wording). */
const RESTORE_BLOCK_MESSAGES = Object.freeze({
  expired: 'Cannot unrevoke an expired session',
  refreshMode: 'Refresh-mode sessions cannot be restored; the user has to log in again',
  accountClaim:
    'Sessions ended by an account claim cannot be restored; the user has to log in again',
});

/**
 * Admin id of the caller, recorded on revocations for the audit trail.
 *
 * @param {object} ctx - Koa context.
 * @returns {number|string|null} Admin user id.
 */
const actorId = (ctx) => ctx?.state?.user?.id ?? null;

/**
 * Why a stored session cannot be restored, checked in the same order as
 * unrevokeToken: expired sessions, refresh-mode sessions (users-permissions
 * deletes the session row on revocation, so there is nothing to restore) and
 * sessions ended by an account claim. `null` means restoring is allowed.
 *
 * @param {object} session - Stored record.
 * @param {Date} now - Current time.
 * @returns {'expired'|'refreshMode'|'accountClaim'|null} Block reason.
 */
const getRestoreBlock = (session, now) => {
  if (new Date(session.expiresAt) < now) return 'expired';
  if (session.upSessionId) return 'refreshMode';
  if (session.revokeReason === CLAIM_REASON) return 'accountClaim';
  return null;
};

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
  restoreBlock: getRestoreBlock(session, now),
});

/**
 * JWT controller: lists plugin-issued sessions and revokes or restores them.
 * Each change is a conditional UPDATE of the affected rows (no list lock),
 * and the blocklist entry is written before the session is shown as revoked.
 */
module.exports = {
  /**
   * Returns stored JWT sessions with safe display data, newest first.
   * Without query parameters the newest 1000 records are returned (the
   * response shape of 6.1). Optional `page`, `pageSize`, `status` and
   * `userId` are served from the table indexes; the total is sent in the
   * `X-Total-Count` header, the body stays an array.
   *
   * @param {object} ctx - Koa context
   */
  async getSessions(ctx) {
    const query = parseBody(jwtSessionsQuerySchema, ctx.query || {});
    try {
      // Records a previous-release replica wrote during a rolling deploy.
      await migrateLegacySessionsIfPresent(strapi);
    } catch {
      strapi.log.warn('[magic-link] Pre-6.2 JWT session records could not be moved yet');
    }
    try {
      const now = new Date();
      const { results, total } = await listSessions(strapi, query);
      if (typeof ctx.set === 'function') ctx.set('X-Total-Count', String(total));
      ctx.send(results.map((session) => toDisplaySession(session, now)));
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
        const session = await findSessionById(strapi, sessionId);
        if (!session) return ctx.notFound('Session not found');

        if (session.jwtTokenHash) {
          await magicLink.blockJwtTokenByHash(session.jwtTokenHash, session.userId, REVOKE_REASON, {
            expiresAt: session.expiresAt,
          });
        }

        await markSessionsRevoked(
          strapi,
          { sessionId: session.id },
          { reason: REVOKE_REASON, revokedBy }
        );
        strapi.log.info(
          `[magic-link] Admin ${revokedBy ?? 'unknown'} revoked JWT session ${sessionId}`
        );
        return ctx.send({ success: true, message: 'JWT session revoked successfully' });
      }

      const tokenHash = cryptoUtils.hashJwt(token);
      const owner = await findSessionByHash(strapi, tokenHash);
      await magicLink.blockJwtToken(token, owner?.userId ?? 'unknown', REVOKE_REASON);

      await markSessionsRevoked(
        strapi,
        { jwtTokenHash: tokenHash },
        { reason: `${REVOKE_REASON} via token`, revokedBy }
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
      const session = await findSessionById(strapi, sessionId);
      if (!session) return ctx.notFound('Session not found');

      // Sessions ended because the mailbox owner claimed an unconfirmed
      // account may belong to whoever registered the address first.
      const restoreBlock = getRestoreBlock(session, new Date());
      if (restoreBlock) return ctx.badRequest(RESTORE_BLOCK_MESSAGES[restoreBlock]);

      // Nothing to restore. A block on the JWT of a row that is not marked
      // revoked (row update failed or still running elsewhere) stays.
      if (!session.isRevoked) {
        return ctx.send({ success: true, message: 'JWT session unrevoked successfully' });
      }

      if (session.jwtTokenHash) {
        const magicLink = strapi.plugin('magic-link').service('magic-link');
        const unblocked = await magicLink.unblockJwtTokenByHash(
          session.jwtTokenHash,
          session.userId
        );
        // An account claim ended this JWT after the manual revocation.
        if (unblocked?.kept > 0) return ctx.badRequest(RESTORE_BLOCK_MESSAGES.accountClaim);
      }

      await markSessionRestored(strapi, session.id, actorId(ctx));
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
   * Marks expired sessions as ended (one indexed UPDATE). Records past the
   * retention period are deleted by the periodic cleanup job.
   * @param {object} ctx - Koa context
   */
  async cleanupSessions(ctx) {
    try {
      const cleanedCount = await expireSessions(strapi, new Date());
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
