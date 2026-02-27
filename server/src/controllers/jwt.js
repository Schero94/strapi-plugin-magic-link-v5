'use strict';

const cryptoUtils = require('../utils/crypto');

/**
 * JWT controller for managing JWT sessions and token revocation
 */
module.exports = {
  /**
   * Returns all stored JWT sessions with safe display data
   * @param {Object} ctx - Koa context
   */
  async getSessions(ctx) {
    try {
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const storedData = (await pluginStore.get({ key: 'jwt_sessions' })) || { sessions: [] };
      const jwtSessions = storedData.sessions || [];
      const now = new Date();

      const sessions = jwtSessions.map(session => {
        let tokenDisplay = 'N/A';
        if (session.jwtTokenHash && typeof session.jwtTokenHash === 'string') {
          tokenDisplay = `[hash] ${session.jwtTokenHash.substring(0, 12)}...`;
        } else if (session.jwtToken && typeof session.jwtToken === 'string' && session.jwtToken.length > 0) {
          tokenDisplay = session.jwtToken.substring(0, 30) + '...';
        }

        return {
          id: session.id,
          userId: session.userId,
          username: session.username,
          email: session.userEmail,
          token: tokenDisplay,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent || 'Unknown',
          source: session.source || 'Magic Link Login',
          revoked: session.isRevoked,
          isExpired: new Date(session.expiresAt) < now,
        };
      });

      ctx.send(sessions);
    } catch (error) {
      strapi.log.error('Error fetching JWT sessions:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * Revokes a JWT session by sessionId or token
   * @param {Object} ctx - Koa context
   */
  async revokeToken(ctx) {
    try {
      const { token, sessionId } = ctx.request.body;

      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const storedData = (await pluginStore.get({ key: 'jwt_sessions' })) || { sessions: [] };
      let jwtSessions = storedData.sessions || [];

      if (sessionId) {
        const sessionIndex = jwtSessions.findIndex(s => s.id === sessionId);
        if (sessionIndex === -1) {
          return ctx.badRequest('Session not found');
        }

        jwtSessions[sessionIndex].isRevoked = true;
        jwtSessions[sessionIndex].revokedAt = new Date().toISOString();
        jwtSessions[sessionIndex].revokeReason = 'Manually revoked from admin UI';

        const session = jwtSessions[sessionIndex];
        const magicLink = strapi.plugin('magic-link').service('magic-link');
        const hashToBlock = session.jwtTokenHash || (session.jwtToken ? cryptoUtils.hashJwt(session.jwtToken) : null);

        if (hashToBlock) {
          await magicLink.blockJwtTokenByHash(hashToBlock, session.userId, 'Manually revoked from admin UI');
        }

        await pluginStore.set({ key: 'jwt_sessions', value: { sessions: jwtSessions } });
        return ctx.send({ success: true, message: 'JWT session revoked successfully' });
      }

      if (token) {
        const magicLink = strapi.plugin('magic-link').service('magic-link');
        await magicLink.blockJwtToken(token, ctx.request.body.userId || 'unknown', 'Manually revoked from admin UI');

        const tokenHash = cryptoUtils.hashJwt(token);
        jwtSessions = jwtSessions.map(session => {
          const sessionHash = session.jwtTokenHash || (session.jwtToken ? cryptoUtils.hashJwt(session.jwtToken) : null);
          if (sessionHash === tokenHash) {
            return {
              ...session,
              isRevoked: true,
              revokedAt: new Date().toISOString(),
              revokeReason: 'Manually revoked from admin UI via token',
            };
          }
          return session;
        });

        await pluginStore.set({ key: 'jwt_sessions', value: { sessions: jwtSessions } });
        return ctx.send({ success: true, message: 'Session revoked successfully.' });
      }

      return ctx.badRequest('Token or sessionId is required');
    } catch (error) {
      strapi.log.error('Error revoking JWT token:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * Unrevokes a JWT session by sessionId
   * @param {Object} ctx - Koa context
   */
  async unrevokeToken(ctx) {
    try {
      const { sessionId, userId } = ctx.request.body;

      if (!sessionId) {
        return ctx.badRequest('Session ID is required');
      }

      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const storedData = (await pluginStore.get({ key: 'jwt_sessions' })) || { sessions: [] };
      const jwtSessions = storedData.sessions || [];

      const sessionIndex = jwtSessions.findIndex(s => s.id === sessionId);
      if (sessionIndex === -1) {
        return ctx.badRequest('Session not found');
      }

      if (new Date(jwtSessions[sessionIndex].expiresAt) < new Date()) {
        return ctx.badRequest('Cannot unrevoke an expired session');
      }

      jwtSessions[sessionIndex].isRevoked = false;
      jwtSessions[sessionIndex].revokedAt = null;
      jwtSessions[sessionIndex].revokeReason = null;

      const session = jwtSessions[sessionIndex];
      const magicLink = strapi.plugin('magic-link').service('magic-link');
      const hashToUnblock = session.jwtTokenHash || (session.jwtToken ? cryptoUtils.hashJwt(session.jwtToken) : null);

      if (hashToUnblock) {
        try {
          await magicLink.unblockJwtTokenByHash(hashToUnblock, userId || session.userId);
        } catch (err) {
          strapi.log.warn('Could not unblock JWT token from blacklist:', err.message);
        }
      }

      await pluginStore.set({ key: 'jwt_sessions', value: { sessions: jwtSessions } });
      return ctx.send({ success: true, message: 'JWT session unrevoked successfully' });
    } catch (error) {
      strapi.log.error('Error unrevoking JWT token:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * Cleans up expired sessions by marking them as revoked
   * @param {Object} ctx - Koa context
   */
  async cleanupSessions(ctx) {
    try {
      const now = new Date();
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const storedData = (await pluginStore.get({ key: 'jwt_sessions' })) || { sessions: [] };
      let jwtSessions = storedData.sessions || [];

      let cleanedCount = 0;
      jwtSessions = jwtSessions.map(session => {
        if (new Date(session.expiresAt) < now && !session.isRevoked) {
          cleanedCount++;
          return {
            ...session,
            isRevoked: true,
            revokedAt: now.toISOString(),
            revokeReason: 'Automatically expired',
          };
        }
        return session;
      });

      await pluginStore.set({ key: 'jwt_sessions', value: { sessions: jwtSessions } });
      ctx.send({
        success: true,
        count: cleanedCount,
        message: `${cleanedCount} expired sessions cleaned up.`,
      });
    } catch (error) {
      strapi.log.error('Error cleaning up sessions:', error);
      ctx.throw(500, error);
    }
  },
};
