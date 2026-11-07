'use strict';

/**
 * Several Strapi processes on one database (Railway replicas, pm2 cluster):
 * cluster lock per dialect, store dedupe, shared rate-limit backend, reset
 * epoch, TOTP attempt counter, challenge compare-and-set, OTP invalidation,
 * conditional delivery feedback and the account-claim lock. Synthetic data
 * only. The real multi-process run is tests/cluster/run.cjs.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const { createMfaStrapi, createTable, useTestSecrets } = require('./helpers/mfa-strapi.cjs');

useTestSecrets();

const cluster = require('../server/src/utils/cluster');
const {
  dedupeStoreKeys,
  mergeBlocklists,
  mergeSessions,
} = require('../server/src/utils/store-dedupe');
const createRateLimiter = require('../server/src/services/rate-limiter');
const createOtpService = require('../server/src/services/otp');
const { FACTOR_ATTEMPT_LIMIT } = require('../server/src/services/otp');
const createMagicLinkService = require('../server/src/services/magic-link');
const createDeliveryFeedback = require('../server/src/services/delivery-feedback');
const { claimUnconfirmedAccount } = require('../server/src/utils/account-claim');
const cryptoUtils = require('../server/src/utils/crypto');
const totpUtils = require('../server/src/utils/totp');

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Fake database with a dialect: records raw SQL and runs transactions
 * through an AsyncLocalStorage-free flag (enough for the lock code paths).
 *
 * @param {'postgres'|'mysql'|'sqlite'} client - Dialect.
 * @param {{getLock?: number}} [options] - GET_LOCK result for MySQL.
 * @returns {{db: object, raw: Array<[string, any[]]>}} Fake db and recorded SQL.
 */
const fakeDb = (client, { getLock = 1 } = {}) => {
  const raw = [];
  let depth = 0;
  let current = null;
  const record = async (sql, bindings = []) => {
    raw.push([sql, bindings]);
    if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: getLock }]];
    return [];
  };
  const db = {
    dialect: { client },
    inTransaction: () => depth > 0,
    // knex instance: dedicated connections for MySQL named locks.
    connection: {
      client: {
        acquireConnection: async () => ({ id: raw.length }),
        releaseConnection: () => raw.push(['release-connection', []]),
      },
      raw: (sql, bindings) => ({ connection: () => record(sql, bindings) }),
    },
    async transaction(cb) {
      const outermost = depth === 0;
      if (outermost) current = { raw: record };
      depth += 1;
      try {
        return await cb({ trx: current });
      } finally {
        depth -= 1;
        if (outermost) raw.push(['COMMIT', []]);
      }
    },
  };
  return { db, raw };
};

test('cluster lock: PostgreSQL takes a transaction-scoped advisory lock with a timeout', async () => {
  const { db, raw } = fakeDb('postgres');
  const result = await cluster.withClusterLock({ db }, 'store:settings', async (trx) => {
    assert.ok(trx, 'the critical section gets the transaction');
    return 'done';
  });
  assert.equal(result, 'done');
  assert.match(raw[0][0], /^SET LOCAL lock_timeout = \d+$/);
  assert.equal(raw[1][0], 'SELECT pg_advisory_xact_lock(?, ?)');
  assert.equal(raw[1][1].length, 2);
  assert.ok(raw[1][1].every((key) => Number.isInteger(key) && Math.abs(key) < 2 ** 31));
  assert.equal(raw[1][1][1], cluster.pgKeyOf('store:settings'));
  assert.notEqual(cluster.pgKeyOf('store:settings'), cluster.pgKeyOf('store:banned_ips'));
});

test('cluster lock: MySQL holds GET_LOCK until after COMMIT and fails on a timeout', async () => {
  const { db, raw } = fakeDb('mysql');
  const strapi = { db };
  await cluster.withClusterLock(strapi, 'outer', async () => {
    raw.push(['fn-outer', []]);
    await cluster.withClusterLock(strapi, 'inner', async () => raw.push(['fn-inner', []]));
  });
  const outer = cluster.mysqlLockName('outer');
  assert.ok(outer.length <= 64, 'MySQL lock names are limited to 64 characters');
  const sequence = raw
    .filter(([sql]) => sql !== 'release-connection')
    .map(([sql, bindings]) =>
      sql.startsWith('SELECT GET_LOCK')
        ? `get:${bindings[0] === outer ? 'outer' : 'inner'}`
        : sql.startsWith('SELECT RELEASE_LOCK')
          ? `release:${bindings[0] === outer ? 'outer' : 'inner'}`
          : sql
    );
  assert.deepEqual(sequence, [
    'get:outer',
    'fn-outer',
    'get:inner',
    'fn-inner',
    'COMMIT',
    'release:inner',
    'release:outer',
  ]);
  assert.equal(raw.filter(([sql]) => sql === 'release-connection').length, 2);
  assert.equal(
    raw.find(([sql]) => sql.startsWith('SELECT GET_LOCK'))[1][1],
    30,
    'default wait 30 s'
  );

  const busy = fakeDb('mysql', { getLock: 0 });
  let ran = false;
  await assert.rejects(
    cluster.withClusterLock({ db: busy.db }, 'store:settings', async () => {
      ran = true;
    }),
    /Cluster lock timeout/
  );
  assert.equal(ran, false, 'the critical section never runs without the lock');
  assert.deepEqual(busy.raw.at(-1), ['release-connection', []]);
});

test('cluster lock: SQLite takes the write lock with the first statement', async () => {
  const { db, raw } = fakeDb('sqlite');
  await cluster.withClusterLock({ db }, 'store:settings', async () => undefined);
  assert.equal(raw[0][0], 'UPDATE strapi_core_store_settings SET id = id WHERE 1 = 0');
});

test('cluster lock: calls are serialised per name and nested calls do not deadlock', async () => {
  const { db } = fakeDb('sqlite');
  const strapi = { db };
  const order = [];
  const slow = cluster.withClusterLock(strapi, 'a', async () => {
    order.push('a1-start');
    // A nested lock of another name inside a held lock joins the transaction.
    await cluster.withClusterLock(strapi, 'b', async () => order.push('b-nested'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push('a1-end');
  });
  const next = cluster.withClusterLock(strapi, 'a', async () => order.push('a2'));
  await Promise.all([slow, next]);
  assert.deepEqual(order, ['a1-start', 'b-nested', 'a1-end', 'a2']);
});

test('cluster lock: without a database the in-process queue still serialises', async () => {
  const strapi = {};
  let value = 0;
  await Promise.all(
    Array.from({ length: 20 }, () =>
      cluster.withClusterLock(strapi, 'counter', async () => {
        const read = value;
        await new Promise((resolve) => setImmediate(resolve));
        value = read + 1;
      })
    )
  );
  assert.equal(value, 20);
  assert.equal(cluster.dialectOf(strapi), null);
});

test('leases: only the holder runs a job until the lease expires', async () => {
  const { db } = fakeDb('postgres');
  const values = {};
  const strapi = {
    db,
    store: () => ({
      get: async ({ key }) => values[key],
      set: async ({ key, value }) => {
        values[key] = value;
      },
    }),
  };
  const first = await cluster.runExclusiveJob(strapi, 'job', 60_000, async () => 'ran');
  assert.deepEqual(first, { ran: true, result: 'ran' });

  values.lease_job = { owner: 'other-process', expiresAt: Date.now() + 60_000 };
  assert.deepEqual(await cluster.runExclusiveJob(strapi, 'job', 60_000, async () => 'x'), {
    ran: false,
  });

  values.lease_job = { owner: 'other-process', expiresAt: Date.now() - 1 };
  assert.equal((await cluster.runExclusiveJob(strapi, 'job', 60_000, async () => 'y')).ran, true);
  assert.equal(values.lease_job.owner, cluster.PROCESS_ID);
});

test('store dedupe merges duplicated list keys and keeps the oldest row of other keys', async () => {
  const later = new Date(Date.now() + 7200_000).toISOString();
  const sooner = new Date(Date.now() + 3600_000).toISOString();
  const coreStore = createTable([
    {
      id: 1,
      key: 'plugin_magic-link_blocked_jwt_tokens',
      type: 'object',
      environment: null,
      tag: null,
      value: JSON.stringify({ tokens: [{ tokenHash: 'a', expiresAt: sooner }] }),
    },
    {
      id: 2,
      key: 'plugin_magic-link_blocked_jwt_tokens',
      type: 'object',
      environment: null,
      tag: null,
      value: JSON.stringify({
        tokens: [
          { tokenHash: 'a', expiresAt: later },
          { tokenHash: 'b', expiresAt: sooner },
        ],
      }),
    },
    {
      id: 3,
      key: 'plugin_magic-link_settings',
      type: 'object',
      environment: null,
      tag: null,
      value: JSON.stringify({ first: true }),
    },
    {
      id: 4,
      key: 'plugin_magic-link_settings',
      type: 'object',
      environment: null,
      tag: null,
      value: JSON.stringify({ first: false }),
    },
  ]);
  // The table double knows $startsWith only through matches(); emulate it.
  const api = {
    ...coreStore.api,
    findMany: async (params) => {
      if (params.where?.key?.$startsWith) {
        const prefix = params.where.key.$startsWith;
        return coreStore.rows.filter((row) => row.key.startsWith(prefix));
      }
      return coreStore.api.findMany(params);
    },
  };
  const removed = await dedupeStoreKeys({ db: { query: () => api } });
  assert.equal(removed, 2);
  assert.deepEqual(
    coreStore.rows.map((row) => row.id),
    [1, 3]
  );
  const merged = JSON.parse(coreStore.rows[0].value).tokens;
  assert.deepEqual(merged.map((entry) => entry.tokenHash).sort(), ['a', 'b']);
  assert.equal(merged.find((entry) => entry.tokenHash === 'a').expiresAt, later);
  assert.deepEqual(JSON.parse(coreStore.rows[1].value), { first: true });

  assert.equal(
    mergeBlocklists([
      { tokens: [{ tokenHash: 'p', permanent: true, expiresAt: null }] },
      { tokens: [{ tokenHash: 'p', expiresAt: later }] },
    ]).tokens[0].permanent,
    true,
    'a permanent block stays permanent'
  );
  assert.equal(
    mergeSessions([
      { sessions: [{ id: 's', isRevoked: false }] },
      { sessions: [{ id: 's', isRevoked: true }] },
    ]).sessions[0].isRevoked,
    true,
    'a revoked copy wins'
  );
});

test('rate limiter: memory without a database, shared database store by default with one', () => {
  const memory = createRateLimiter({
    strapi: { store: () => ({ get: async () => ({}) }), log: silent },
  });
  return memory.getStats().then(async (stats) => {
    assert.equal(stats.backend, 'in-memory (rate-limiter-flexible)');
    assert.equal(stats.statsScope, 'process');

    const { db } = fakeDb('postgres');
    const shared = createRateLimiter({
      strapi: {
        db,
        store: () => ({ get: async () => ({}) }),
        config: { get: () => undefined },
        log: silent,
      },
    });
    assert.match((await shared.getStats()).backend, /^database: postgres, shared by all processes/);

    const optOut = createRateLimiter({
      strapi: {
        db,
        store: () => ({ get: async () => ({}) }),
        config: {
          get: (key) => (key === 'plugin::magic-link.rateLimit.store' ? 'memory' : undefined),
        },
        log: silent,
      },
    });
    assert.equal((await optOut.getStats()).backend, 'in-memory (rate-limiter-flexible)');
  });
});

test('rate limiter: one-time markers detect replays; reset keeps the verify budget', async () => {
  const service = createRateLimiter({
    strapi: {
      store: () => ({ get: async () => ({ rate_limit_max_attempts: 1 }) }),
      log: silent,
    },
  });
  assert.equal(await service.markOnce('replay:sendgrid:evt-1'), true);
  assert.equal(await service.markOnce('replay:sendgrid:evt-1'), false);
  assert.equal(await service.markOnce('replay:sendgrid:evt-2'), true);

  assert.equal((await service.checkRateLimit('198.51.100.7', 'ip')).allowed, true);
  assert.equal((await service.checkRateLimit('198.51.100.7', 'ip')).allowed, false);
  for (let i = 0; i < 10; i += 1) await service.checkRateLimit('verify:up:9', 'verify');
  await service.resetAll();
  assert.equal((await service.checkRateLimit('198.51.100.7', 'ip')).allowed, true);
  assert.equal(
    (await service.checkRateLimit('verify:up:9', 'verify')).allowed,
    false,
    'the code-check budget survives a reset'
  );
});

test('TOTP: a database attempt counter locks the factor after the limit on any process', async () => {
  const secret = totpUtils.generateSecret();
  const { strapi, tables } = createMfaStrapi({
    totpConfigs: [
      {
        id: 1,
        principalType: 'users-permissions',
        principalKey: 'up:5',
        userId: 5,
        email: 'mfa@example.test',
        secret: cryptoUtils.encrypt(secret),
        enabled: true,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        revision: 0,
        backupCodes: [],
        backupCodesVersion: totpUtils.BACKUP_HASH_VERSION,
      },
    ],
  });
  // Two service instances stand for two processes sharing one table.
  const processA = createOtpService({ strapi });
  const processB = createOtpService({ strapi });
  for (let i = 0; i < FACTOR_ATTEMPT_LIMIT.attempts; i += 1) {
    const service = i % 2 === 0 ? processA : processB;
    assert.equal((await service.verifyTOTP(5, '000000')).valid, false);
  }
  const row = tables['plugin::magic-link.totp-config'].rows[0];
  assert.ok(new Date(row.lockedUntil).getTime() > Date.now(), 'the enrolment is locked');

  const code = await totpUtils.generateCode({
    secret,
    totp: { algorithm: 'SHA1', digits: 6, period: 30 },
  });
  assert.equal((await processA.verifyTOTP(5, code)).valid, false, 'even a valid code is refused');
  assert.equal((await processB.consumeBackupCode(5, 'AAAA-BBBB-CCCC')).valid, false);

  row.lockedUntil = new Date(Date.now() - 1000);
  assert.equal((await processB.verifyTOTP(5, code)).valid, true, 'usable again after the lock');
  assert.equal(row.failedAttempts, 0, 'a success clears the counter');
});

test('TOTP: parallel guesses are all counted (compare-and-set retries)', async () => {
  const { strapi, tables } = createMfaStrapi({
    totpConfigs: [
      {
        id: 1,
        principalType: 'users-permissions',
        principalKey: 'up:6',
        userId: 6,
        email: 'mfa6@example.test',
        secret: cryptoUtils.encrypt(totpUtils.generateSecret()),
        enabled: true,
        revision: 0,
      },
    ],
  });
  const service = createOtpService({ strapi });
  await Promise.all(Array.from({ length: 6 }, () => service.verifyTOTP(6, '000000')));
  assert.equal(tables['plugin::magic-link.totp-config'].rows[0].failedAttempts, 6);
});

test('e-mail OTP: a code created in parallel leaves only the newest one valid', async () => {
  const { strapi, tables } = createMfaStrapi();
  const service = createOtpService({ strapi });
  // Simulate the interleaving: process B inserted a code after process A
  // invalidated, then A inserts its own code.
  tables['plugin::magic-link.otp-code'].rows.push({
    id: 1,
    email: 'race@example.test',
    type: 'email',
    used: false,
    attempts: 0,
    code: cryptoUtils.hashOTP('111111'),
    expiresAt: new Date(Date.now() + 60_000),
  });
  tables['plugin::magic-link.otp-code'].nextId = 2;
  const originalUpdateMany = tables['plugin::magic-link.otp-code'].api.updateMany;
  let first = true;
  tables['plugin::magic-link.otp-code'].api.updateMany = async (params) => {
    // The up-front invalidation runs before B's insert in this interleaving.
    if (first && !params.where.id) {
      first = false;
      return { count: 0 };
    }
    return originalUpdateMany(params);
  };
  const entry = await service.createOTP('race@example.test', 'email');
  const valid = tables['plugin::magic-link.otp-code'].rows.filter((row) => !row.used);
  assert.deepEqual(
    valid.map((row) => row.id),
    [entry.id]
  );
});

test('challenge start is a compare-and-set: only one parallel opener wins', async () => {
  const rows = [
    {
      id: 1,
      is_active: true,
      expires_at: new Date(Date.now() + 60_000),
      challenge: null,
    },
  ];
  const matchesRow = (row, where) =>
    Object.entries(where).every(([key, condition]) => {
      if (condition && typeof condition === 'object' && '$gt' in condition) {
        return new Date(row[key]).getTime() > new Date(condition.$gt).getTime();
      }
      if (condition === null) return row[key] === null || row[key] === undefined;
      return row[key] === condition;
    });
  const strapi = {
    log: silent,
    store: () => ({ get: async () => ({}) }),
    db: {
      query: () => ({
        updateMany: async ({ where, data }) => {
          const hit = rows.filter((row) => matchesRow(row, where));
          hit.forEach((row) => Object.assign(row, data));
          return { count: hit.length };
        },
      }),
    },
  };
  const service = createMagicLinkService({ strapi });
  // Both processes read the token before either started the challenge.
  const snapshot = { ...rows[0] };
  const results = await Promise.all([
    service.startChallenge({ ...snapshot }, { type: 'otp', userId: 1, otpSentAt: 'a' }),
    service.startChallenge({ ...snapshot }, { type: 'otp', userId: 1, otpSentAt: 'b' }),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(rows[0].challenge_revision, 1);
});

test('delivery feedback: a complaint never overwrites a bounce written by another process', async () => {
  const tokens = [
    { id: 1, documentId: 'tok-1', delivery_status: 'sent', delivery_message_id: 'm1' },
  ];
  const strapi = {
    log: silent,
    config: { get: (_key, fallback) => fallback },
    plugin: () => null,
    db: {
      query: () => ({
        // Stale read: both handlers saw `sent`.
        findMany: async () => tokens.map((token) => ({ ...token, delivery_status: 'sent' })),
        updateMany: async ({ where, data }) => {
          const hit = tokens.filter(
            (token) =>
              token.id === where.id && where.delivery_status.$in.includes(token.delivery_status)
          );
          hit.forEach((token) => Object.assign(token, data));
          return { count: hit.length };
        },
      }),
    },
  };
  global.strapi = strapi;
  const service = createDeliveryFeedback({ strapi });
  assert.equal(await service.applyFeedback({ provider: 'x', messageId: 'm1', kind: 'bounced' }), 1);
  assert.equal(
    await service.applyFeedback({ provider: 'x', messageId: 'm1', kind: 'complained' }),
    0
  );
  assert.equal(tokens[0].delivery_status, 'bounced');
});

test('account claim: a second claim on another process sees the claim and revokes nothing', async () => {
  const { db } = fakeDb('sqlite');
  let confirmed = false;
  let revocations = 0;
  let edits = 0;
  const strapi = {
    db: {
      ...db,
      query: () => ({ findOne: async () => ({ confirmed }) }),
    },
    log: silent,
    plugin: (name) =>
      name === 'magic-link'
        ? {
            service: () => ({
              revokeUserSessions: async () => {
                revocations += 1;
              },
            }),
          }
        : {
            service: () => ({
              edit: async () => {
                edits += 1;
                confirmed = true;
              },
            }),
          },
  };
  // Both requests loaded the user while it was unconfirmed.
  const [a, b] = await Promise.all([
    claimUnconfirmedAccount(strapi, { id: 3, confirmed: false }),
    claimUnconfirmedAccount(strapi, { id: 3, confirmed: false }),
  ]);
  assert.deepEqual([a, b].sort(), [false, true]);
  assert.equal(revocations, 1, 'sessions are ended once, not again after the first login');
  assert.equal(edits, 1);
});
