'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const createMagicLinkService = require('../server/src/services/magic-link');
const bootstrap = require('../server/src/bootstrap');

const logger = { debug() {}, info() {}, warn() {}, error() {} };

test('JWT blocklist read failures do not become an unblocked-token result', async () => {
  const logs = [];
  const service = createMagicLinkService({
    strapi: {
      store: () => ({ get: async () => { throw new Error('private store detail'); } }),
      log: { ...logger, error: (...parts) => logs.push(parts.map(String).join(' ')) },
    },
  });

  await assert.rejects(
    service.isJwtTokenBlocked('synthetic-local-jwt'),
    /revocation status/i,
  );
  assert.equal(logs.join('\n').includes('private store detail'), false);
});

test('JWT blocklist removal failures do not log private store details', async () => {
  const logs = [];
  const service = createMagicLinkService({
    strapi: {
      store: () => ({
        get: async () => ({ tokens: [{ tokenHash: 'synthetic-hash', userId: 'synthetic-user' }] }),
        set: async () => { throw new Error('private store detail'); },
      }),
      log: { ...logger, error: (...parts) => logs.push(parts.map(String).join(' ')) },
    },
  });

  await assert.rejects(
    service.unblockJwtTokenByHash('synthetic-hash', 'synthetic-user'),
    /failed to unblock jwt token/i,
  );
  assert.equal(logs.join('\n').includes('private store detail'), false);
});

test('JWT middleware fails closed when revocation status cannot be verified', async () => {
  const timeouts = { setTimeout: global.setTimeout, setInterval: global.setInterval };
  const logs = [];
  const middlewares = [];
  let nextCalled = false;

  global.setTimeout = () => 0;
  global.setInterval = () => 0;
  try {
    await bootstrap({ strapi: {
      config: { get: (_key, fallback) => fallback },
      store: () => ({ get: async ({ key }) => key === 'settings' ? { store_login_info: true } : null }),
      admin: { services: { permission: { actionProvider: { registerMany: async () => {} } } } },
      server: { use(handler) { middlewares.push(handler); } },
      plugin(name) {
        assert.equal(name, 'magic-link');
        return {
          service(serviceName) {
            if (serviceName === 'magic-link') {
              return { isJwtTokenBlocked: async () => { throw new Error('private store detail'); } };
            }
            return { cleanupExpired: async () => {}, cleanupExpiredCodes: async () => {}, initialize: async () => {} };
          },
        };
      },
      log: { ...logger, error: (...parts) => logs.push(parts.map(String).join(' ')) },
    } });

    const ctx = {
      path: '/api/articles',
      request: { header: { authorization: 'bearer synthetic-local-jwt' } },
    };

    // The revocation middleware is registered first.
    await middlewares[0](ctx, async () => { nextCalled = true; });
    assert.equal(ctx.status, 503);
    assert.match(ctx.body.error.message, /verify.*revocation/i);
    assert.equal(JSON.stringify(ctx.body).includes('private store detail'), false);
    assert.equal(nextCalled, false, 'an unverifiable token must not reach downstream authentication');
    assert.equal(logs.join('\n').includes('private store detail'), false);
  } finally {
    global.setTimeout = timeouts.setTimeout;
    global.setInterval = timeouts.setInterval;
  }
});
