'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const contentRoutes = require('../server/src/routes/content-api').routes;
const createMagicLinkService = require('../server/src/services/magic-link');

const ipBanPolicyName = 'plugin::magic-link.ip-ban-check';

test('every public authentication route applies the IP-ban policy', () => {
  for (const route of contentRoutes) {
    assert.ok(route.config.policies.includes(ipBanPolicyName), `${route.method} ${route.path}`);
  }
});

test('IP-ban policy allows a valid address when the service confirms it is not banned', async () => {
  const policy = require('../server/src/policies/ip-ban-check');
  const ctx = { request: { ip: '192.0.2.25' }, response: { status: 200, body: null } };
  const strapi = {
    plugin: () => ({ service: () => ({ isIPBanned: async () => false }) }),
    log: { error() {} },
  };

  assert.equal(await policy(ctx, {}, { strapi }), true);
  assert.equal(ctx.response.status, 200);
});

test('IP-ban policy denies a banned address without returning the address', async () => {
  const policy = require('../server/src/policies/ip-ban-check');
  const ctx = { request: { ip: '192.0.2.25' }, response: { status: 200, body: null } };
  const strapi = {
    plugin: () => ({ service: () => ({ isIPBanned: async () => true }) }),
    log: { error() {} },
  };

  assert.equal(await policy(ctx, {}, { strapi }), false);
  assert.equal(ctx.response.status, 403);
  assert.equal(JSON.stringify(ctx.response.body).includes('192.0.2.25'), false);
});

test('IP-ban policy fails closed when the address or block-list storage cannot be checked', async () => {
  const policy = require('../server/src/policies/ip-ban-check');
  const errors = [];
  const strapi = {
    plugin: () => ({ service: () => ({ isIPBanned: async () => { throw new Error('store details'); } }) }),
    log: { error: (message) => errors.push(message) },
  };
  const storeErrorContext = { request: { ip: '192.0.2.25' }, response: { status: 200, body: null } };
  const missingIpContext = { request: {}, response: { status: 200, body: null } };

  assert.equal(await policy(storeErrorContext, {}, { strapi }), false);
  assert.equal(storeErrorContext.response.status, 503);
  assert.equal(JSON.stringify(storeErrorContext.response.body).includes('store details'), false);
  assert.equal(await policy(missingIpContext, {}, { strapi }), false);
  assert.equal(missingIpContext.response.status, 503);
  assert.ok(errors.length > 0);
});

test('IP-ban service propagates storage failures for the route policy to deny safely', async () => {
  const service = createMagicLinkService({
    strapi: {
      store: () => ({ get: async () => { throw new Error('private storage details'); } }),
      log: { error() {} },
    },
  });

  await assert.rejects(service.isIPBanned('192.0.2.25'), /IP ban status could not be checked/);
});

test('IP-ban service matches equivalent IPv6 spellings using canonical addresses', async () => {
  const service = createMagicLinkService({
    strapi: {
      store: () => ({
        get: async () => ({ ips: ['2001:0db8:0:0:0:0:0:1', '192.0.2.25'] }),
      }),
      log: { error() {} },
    },
  });

  assert.equal(await service.isIPBanned('2001:db8::1'), true);
  assert.equal(await service.isIPBanned('2001:db8::2'), false);
  assert.equal(await service.isIPBanned('192.0.2.25'), true);
});
