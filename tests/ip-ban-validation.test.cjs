'use strict';

const assert = require('node:assert/strict');
const { isIP } = require('node:net');
const test = require('node:test');

const tokensController = require('../server/src/controllers/tokens');

test('admin IP validation accepts valid IPv4 and IPv6 forms and rejects malformed addresses', async () => {
  const { isValidIpAddress, normalizeIpAddress: normalizeAdminIpAddress } =
    await import('../admin/src/utils/ipAddress.mjs');
  const {
    normalizeIpAddress: normalizeServerIpAddress,
  } = require('../server/src/utils/ip-address');
  const values = [
    '192.0.2.25',
    '0.0.0.0',
    '255.255.255.255',
    '999.999.999.999',
    '01.2.3.4',
    '::1',
    '2001:db8::1',
    '2001:db8:0:0:0:0:0:1',
    '::ffff:192.0.2.25',
    'fe80::1%en0',
    '2001:db8:::1',
    '2001:db8::gggg',
    '192.0.2.25%en0',
  ];

  for (const value of values) {
    assert.equal(isValidIpAddress(value), isIP(value) !== 0, value);
  }
  assert.equal(isValidIpAddress(' 192.0.2.25 '), true);
  assert.equal(isValidIpAddress(' 999.999.999.999 '), false);
  assert.equal(normalizeAdminIpAddress(' 2001:0db8:0:0:0:0:0:1 '), '2001:db8::1');
  assert.equal(normalizeServerIpAddress('2001:0db8:0:0:0:0:0:1'), '2001:db8::1');
  assert.equal(normalizeAdminIpAddress('::ffff:192.0.2.25'), '::ffff:c000:219');
  // The server folds IPv4-mapped IPv6 into IPv4, so an IPv4 ban also matches
  // dual-stack request addresses (::ffff:a.b.c.d).
  assert.equal(normalizeServerIpAddress('::ffff:192.0.2.25'), '192.0.2.25');
  assert.equal(normalizeServerIpAddress('::FFFF:C000:0219'), '192.0.2.25');
});

test('banIP rejects malformed addresses before storage writes or token queries', async () => {
  let writes = 0;
  let tokenLookups = 0;
  global.strapi = {
    store: () => ({
      get: async () => ({ ips: [] }),
      set: async () => {
        writes += 1;
      },
    }),
    db: {
      query: () => ({
        updateMany: async () => {
          tokenLookups += 1;
          return { count: 0 };
        },
      }),
    },
    log: { error() {}, info() {} },
  };

  const ctx = {
    request: { body: { data: { ip: '999.999.999.999' } } },
    badRequest(message) {
      return { status: 400, message };
    },
    throw(status, error) {
      throw error || new Error(String(status));
    },
  };

  try {
    const result = await tokensController.banIP(ctx);
    assert.equal(result.status, 400);
    assert.equal(writes, 0);
    assert.equal(tokenLookups, 0);
  } finally {
    delete global.strapi;
  }
});

test('banIP trims a valid IPv4 address before storing and looking up matching tokens', async () => {
  const writes = [];
  const lookups = [];
  global.strapi = {
    store: () => ({
      get: async () => ({ ips: [] }),
      set: async ({ value }) => {
        writes.push(value);
      },
    }),
    db: {
      query: () => ({
        updateMany: async ({ where }) => {
          lookups.push(where);
          return { count: 0 };
        },
      }),
    },
    log: { error() {}, info() {} },
  };

  const ctx = {
    request: { body: { data: { ip: ' 192.0.2.25 ' } } },
    badRequest(message) {
      return { status: 400, message };
    },
    throw(status, error) {
      throw error || new Error(String(status));
    },
  };

  try {
    const result = await tokensController.banIP(ctx);
    assert.equal(result.success, true);
    assert.deepEqual(writes, [{ ips: ['192.0.2.25'] }]);
    assert.deepEqual(lookups, [
      { ip_address: { $in: ['192.0.2.25', '::ffff:192.0.2.25'] }, is_active: true },
    ]);
  } finally {
    delete global.strapi;
  }
});

test('unbanIP rejects malformed addresses before reading or writing the block list', async () => {
  let reads = 0;
  let writes = 0;
  global.strapi = {
    store: () => ({
      get: async () => {
        reads += 1;
        return { ips: [] };
      },
      set: async () => {
        writes += 1;
      },
    }),
    log: { error() {}, info() {} },
  };
  const ctx = {
    request: { body: { data: { ip: 'not-an-ip' } } },
    badRequest(message) {
      return { status: 400, message };
    },
    throw(status, error) {
      throw error || new Error(String(status));
    },
  };

  try {
    const result = await tokensController.unbanIP(ctx);
    assert.equal(result.status, 400);
    assert.equal(reads, 0);
    assert.equal(writes, 0);
  } finally {
    delete global.strapi;
  }
});

test('banIP does not duplicate an IPv6 ban stored in a different valid form', async () => {
  let writes = 0;
  let tokenLookups = 0;
  global.strapi = {
    store: () => ({
      get: async () => ({ ips: ['2001:0db8:0:0:0:0:0:1'] }),
      set: async () => {
        writes += 1;
      },
    }),
    db: {
      query: () => ({
        updateMany: async () => {
          tokenLookups += 1;
          return { count: 0 };
        },
      }),
    },
    log: { error() {}, info() {} },
  };
  const ctx = {
    request: { body: { data: { ip: '2001:db8::1' } } },
    badRequest(message) {
      return { status: 400, message };
    },
    throw(status, error) {
      throw error || new Error(String(status));
    },
  };

  try {
    const result = await tokensController.banIP(ctx);
    assert.equal(result.success, true);
    assert.equal(writes, 0);
    assert.equal(tokenLookups, 0);
  } finally {
    delete global.strapi;
  }
});

test('unbanIP removes equivalent IPv6 spellings from the stored list', async () => {
  let persisted;
  global.strapi = {
    store: () => ({
      get: async () => ({ ips: ['2001:0db8:0:0:0:0:0:1', '192.0.2.25'] }),
      set: async ({ value }) => {
        persisted = value;
      },
    }),
    log: { error() {}, info() {} },
  };
  const ctx = {
    request: { body: { data: { ip: '2001:db8::1' } } },
    badRequest(message) {
      return { status: 400, message };
    },
    throw(status, error) {
      throw error || new Error(String(status));
    },
  };

  try {
    const result = await tokensController.unbanIP(ctx);
    assert.equal(result.success, true);
    assert.deepEqual(persisted.ips, ['192.0.2.25']);
  } finally {
    delete global.strapi;
  }
});

test('admin ban form disables malformed IPs and shows the inline validation message', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.join(__dirname, '../admin/src/pages/Tokens/IPBans.jsx'),
    'utf8'
  );

  assert.ok(source.includes('disabled={!normalizedNewIP}'));
  assert.ok(source.includes("'ipban.modal.invalidIP'"));
});
