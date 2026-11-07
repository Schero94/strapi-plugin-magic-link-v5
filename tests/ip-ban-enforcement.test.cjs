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

test('IP-ban policy denies a banned address with a PolicyError, so Strapi keeps its message and details.code', async () => {
  const { errors } = require('@strapi/utils');
  const policy = require('../server/src/policies/ip-ban-check');
  const ctx = { request: { ip: '::ffff:192.0.2.25' }, response: { status: 200, body: null } };
  let checked;
  const strapi = {
    plugin: () => ({
      service: () => ({
        isIPBanned: async (ip) => {
          checked = ip;
          return true;
        },
      }),
    }),
    log: { error() {} },
  };

  await assert.rejects(policy(ctx, {}, { strapi }), (error) => {
    // Strapi 5.61's authorize middleware wraps the policies and replaces any
    // ForbiddenError that is not a PolicyError with a bare "Forbidden".
    assert.ok(error instanceof errors.PolicyError);
    assert.equal(error.message, 'This request cannot be completed.');
    assert.equal(error.details.code, 'IP_ADDRESS_BLOCKED');
    assert.equal(JSON.stringify(error).includes('192.0.2.25'), false);
    return true;
  });
  assert.equal(checked, '192.0.2.25', 'IPv4-mapped request addresses are checked in IPv4 form');
});

test('IP-ban policy fails closed when the address or block-list storage cannot be checked', async () => {
  const { errors } = require('@strapi/utils');
  const policy = require('../server/src/policies/ip-ban-check');
  const logged = [];
  const strapi = {
    plugin: () => ({
      service: () => ({
        isIPBanned: async () => {
          throw new Error('store details');
        },
      }),
    }),
    log: { error: (message) => logged.push(message) },
  };
  const isUnavailable = (error) => {
    assert.ok(error instanceof errors.PolicyError);
    assert.equal(error.details.code, 'IP_BAN_CHECK_UNAVAILABLE');
    assert.equal(error.message.includes('store details'), false);
    return true;
  };

  await assert.rejects(policy({ request: { ip: '192.0.2.25' } }, {}, { strapi }), isUnavailable);
  await assert.rejects(policy({ request: {} }, {}, { strapi }), isUnavailable);
  assert.ok(logged.length > 0);
  assert.ok(logged.every((entry) => !entry.includes('store details')));
});

test('IP-ban service matches an IPv4 ban against the IPv4-mapped IPv6 request form', async () => {
  const service = createMagicLinkService({
    strapi: {
      store: () => ({ get: async () => ({ ips: ['192.0.2.25'] }) }),
      log: { error() {} },
    },
  });

  assert.equal(await service.isIPBanned('::ffff:192.0.2.25'), true);
  assert.equal(await service.isIPBanned('::ffff:192.0.2.26'), false);
});

test('IP-ban service propagates storage failures for the route policy to deny safely', async () => {
  const service = createMagicLinkService({
    strapi: {
      store: () => ({
        get: async () => {
          throw new Error('private storage details');
        },
      }),
      log: { error() {} },
    },
  });

  await assert.rejects(service.isIPBanned('192.0.2.25'), /IP ban status could not be checked/);
});

test('IP-ban service matches equivalent IPv6 spellings and the same /64', async () => {
  const service = createMagicLinkService({
    strapi: {
      store: () => ({
        get: async () => ({ ips: ['2001:0db8:0:0:0:0:0:1', '192.0.2.25'] }),
      }),
      log: { error() {} },
    },
  });

  assert.equal(await service.isIPBanned('2001:db8::1'), true);
  // IPv6 bans match per /64 like the rate limits (utils/ip-address.js ipBanKey).
  assert.equal(await service.isIPBanned('2001:db8::2'), true);
  assert.equal(await service.isIPBanned('2001:db8:0:1::1'), false);
  assert.equal(await service.isIPBanned('192.0.2.25'), true);
});
