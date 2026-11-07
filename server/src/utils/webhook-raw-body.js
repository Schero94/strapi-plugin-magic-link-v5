'use strict';

/**
 * Captures the raw request body of delivery-webhook requests before Strapi's
 * global body parser runs. Signature checks (SendGrid) are computed over the
 * exact bytes, which a re-serialised JSON body would not reproduce.
 *
 * Mounted with `strapi.server.use()` during `register`, so it runs before the
 * `strapi::body` middleware (registered later, when Strapi bootstraps). It is
 * the only plugin middleware that runs that early; it touches nothing but
 * POST requests below the delivery-webhook prefix. After
 * reading, the content type is replaced by a private one so koa-body leaves
 * the already consumed stream alone; the route handler parses the buffer.
 */

const DEFAULT_LIMIT_BYTES = 512 * 1024;
const RAW_BODY_CONTENT_TYPE = 'application/x-magic-link-webhook';

/**
 * @param {import('stream').Readable} stream
 * @param {number} limit
 * @returns {Promise<Buffer|null>} body, or null when it exceeds `limit`
 */
function readLimited(stream, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (value, error) => {
      if (done) return;
      done = true;
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        if (typeof stream.resume === 'function') stream.resume();
        finish(null);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(Buffer.concat(chunks));
    const onError = (error) => finish(null, error);
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}

/**
 * @param {{pathPrefix: string, limit?: number}} options
 *   `pathPrefix` is the full URL prefix, e.g. `/api/magic-link/delivery-webhooks/`.
 * @returns {(ctx: any, next: () => Promise<void>) => Promise<void>}
 */
function createWebhookRawBodyMiddleware({ pathPrefix, limit = DEFAULT_LIMIT_BYTES }) {
  return async (ctx, next) => {
    if (ctx.method !== 'POST' || typeof ctx.path !== 'string' || !ctx.path.startsWith(pathPrefix)) {
      return next();
    }
    const declared = Number(ctx.get?.('content-length'));
    if (Number.isFinite(declared) && declared > limit) {
      ctx.status = 413;
      ctx.body = '';
      return undefined;
    }
    const raw = await readLimited(ctx.req, limit);
    if (raw === null) {
      ctx.status = 413;
      ctx.body = '';
      return undefined;
    }
    ctx.state.magicLinkWebhookRaw = raw;
    ctx.req.headers['content-type'] = RAW_BODY_CONTENT_TYPE;
    return next();
  };
}

module.exports = {
  createWebhookRawBodyMiddleware,
  readLimited,
  DEFAULT_LIMIT_BYTES,
  RAW_BODY_CONTENT_TYPE,
};
