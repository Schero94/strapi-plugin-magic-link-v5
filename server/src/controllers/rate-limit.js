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
    } catch (error) {
      strapi.log.error('Error getting rate limit stats:', error);
      ctx.throw(500, error);
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
    } catch (error) {
      strapi.log.error('Error cleaning up rate limits:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * Reset all rate limits
   */
  async reset(ctx) {
    try {
      const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
      await rateLimiter.resetAll();

      ctx.send({
        success: true,
        message: 'All rate limits have been reset',
      });
    } catch (error) {
      strapi.log.error('Error resetting rate limits:', error);
      ctx.throw(500, error);
    }
  },
};
