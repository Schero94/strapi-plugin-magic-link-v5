'use strict';

/**
 * POST /api/magic-link/delivery-webhooks/:provider
 * (sendgrid | mailgun | ses | postmark)
 *
 * Public route authenticated by the provider (signature, SNS certificate or
 * Basic auth); see services/delivery-feedback.js. Responses carry no detail.
 * The raw body is captured in register() by utils/webhook-raw-body.js.
 */

const UNPARSED_BODY = Symbol.for('unparsedBody');

/** @param {any} ctx @returns {Buffer|undefined} */
const rawBodyOf = (ctx) => {
  if (Buffer.isBuffer(ctx.state?.magicLinkWebhookRaw)) return ctx.state.magicLinkWebhookRaw;
  const unparsed = ctx.request?.body?.[UNPARSED_BODY];
  return typeof unparsed === 'string' ? Buffer.from(unparsed, 'utf8') : undefined;
};

module.exports = {
  /** @param {import('koa').Context} ctx */
  async receive(ctx) {
    let status;
    try {
      const result = await strapi
        .plugin('magic-link')
        .service('delivery-feedback')
        .handleWebhook({
          provider: String(ctx.params.provider || ''),
          rawBody: rawBodyOf(ctx),
          headers: ctx.request.headers || {},
          ip: ctx.request.ip,
        });
      status = result.status;
    } catch {
      strapi.log.error('[magic-link] Delivery webhook could not be processed');
      status = 500;
    }
    ctx.status = status;
    ctx.body = { received: status === 200 };
  },
};
