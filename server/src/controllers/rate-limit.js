'use strict';

/**
 * Rate Limit Controller
 */

module.exports = {
  /**
   * Get rate limit statistics
   */
  async getStats(ctx) {
    try {
      const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
      const stats = await rateLimiter.getStats();

      if (!stats) {
        return ctx.badRequest('Failed to get rate limit stats');
      }

      ctx.send({
        success: true,
        data: stats,
      });
    } catch {
      // Limiter errors can carry store connection details: never log or
      // return them.
      strapi.log.error('[magic-link] Rate-limit statistics could not be loaded');
      ctx.throw(500, 'Failed to get rate limit stats');
    }
  },

  /**
   * Cleanup expired rate limit entries
   */
  async cleanup(ctx) {
    try {
      const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
      const result = await rateLimiter.cleanupExpired();

      ctx.send({
        success: true,
        message: `Cleaned up ${result.cleaned} expired entries`,
        data: result,
      });
    } catch {
      strapi.log.error('[magic-link] Rate-limit cleanup failed');
      ctx.throw(500, 'Failed to clean up rate limits');
    }
  },

  /**
   * Resets the public rate-limit counters. The always-on code-check and
   * admin limiters are kept (services/rate-limiter.js resetAll).
   */
  async reset(ctx) {
    try {
      const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
      await rateLimiter.resetAll();

      ctx.send({
        success: true,
        message: 'All rate limits have been reset',
      });
    } catch {
      strapi.log.error('[magic-link] Rate-limit reset failed');
      ctx.throw(500, 'Failed to reset rate limits');
    }
  },
};
