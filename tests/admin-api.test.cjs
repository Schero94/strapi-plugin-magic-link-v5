'use strict';

/**
 * Behavioural tests for the admin API: token issuing (impersonation guard),
 * token actions, JWT session revocation, the session store, IP keys, the rate
 * limiter, settings validation, license store-key and lifecycle helpers.
 * All data is synthetic; no network, mail or database is used.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const { errors } = require('@strapi/utils');

const { ipRateLimitKey, normalizeIpAddress } = require('../server/src/utils/ip-address');
const createRateLimiter = require('../server/src/services/rate-limiter');
const { normalizeLimiterIdentifier } = require('../server/src/services/rate-limiter');
const sessionStore = require('../server/src/utils/jwt-session-store');
const cryptoUtils = require('../server/src/utils/crypto');
const { createSessionTable } = require('./helpers/session-table.cjs');
const {
  settingsUpdateSchema,
  parseBody,
  licenseStoreKeySchema,
} = require('../server/src/controllers/validation');
const lifecycle = require('../server/src/utils/lifecycle');

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

const withGlobalStrapi = async (strapi, fn) => {
  const original = global.strapi;
  global.strapi = strapi;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete global.strapi;
    else global.strapi = original;
  }
};

/** In-memory plugin store keyed by `key`. */
const createStore = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    store: () => ({
      get: async ({ key }) => (values.has(key) ? structuredClone(values.get(key)) : undefined),
      set: async ({ key, value }) => {
        await new Promise((resolve) => setImmediate(resolve));
        values.set(key, structuredClone(value));
      },
      delete: async ({ key }) => values.delete(key),
    }),
  };
};

// ─────────────────────── IP addresses ───────────────────────

test('IPv4-mapped IPv6 addresses normalise to IPv4 and IPv6 rate-limit keys use the /64', () => {
  assert.equal(normalizeIpAddress('::ffff:198.51.100.7'), '198.51.100.7');
  assert.equal(normalizeIpAddress('2001:DB8::1'), '2001:db8::1');
  assert.equal(normalizeIpAddress('not-an-ip'), null);

  assert.equal(ipRateLimitKey('198.51.100.7'), '198.51.100.7');
  assert.equal(ipRateLimitKey('::ffff:198.51.100.7'), '198.51.100.7');
  assert.equal(ipRateLimitKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(ipRateLimitKey('2001:db8:1:2:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
  assert.equal(ipRateLimitKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipRateLimitKey('garbage'), 'unknown');

  assert.equal(
    normalizeLimiterIdentifier('ip:totp-setup:2001:db8:1:2::5'),
    'ip:totp-setup:2001:db8:1:2::/64'
  );
  assert.equal(normalizeLimiterIdentifier('::ffff:198.51.100.7'), '198.51.100.7');
  assert.equal(normalizeLimiterIdentifier('user:totp:7'), 'user:totp:7');
});

// ─────────────────────── Rate limiter ───────────────────────

const limiterFor = (settings, config = {}) => {
  let current = settings;
  const service = createRateLimiter({
    strapi: {
      store: () => ({ get: async () => current }),
      config: { get: (key, fallback) => (key in config ? config[key] : fallback) },
      log: silentLog,
    },
  });
  return {
    service,
    setSettings: (next) => {
      current = next;
    },
  };
};

test('rotating IPv6 addresses inside one /64 shares one rate-limit bucket', async () => {
  const { service } = limiterFor({
    rate_limit_enabled: true,
    rate_limit_max_attempts: 2,
    rate_limit_window_minutes: 5,
  });

  assert.equal((await service.checkRateLimit('2001:db8:5:6::1', 'ip')).allowed, true);
  assert.equal((await service.checkRateLimit('2001:db8:5:6::2', 'ip')).allowed, true);
  assert.equal((await service.checkRateLimit('2001:db8:5:6:abcd::9', 'ip')).allowed, false);
  assert.equal(
    (await service.checkRateLimit('2001:db8:5:7::1', 'ip')).allowed,
    true,
    'another /64 is separate'
  );
});

test('saving unrelated settings keeps counters; changed limits rebuild the limiters', async () => {
  const { service, setSettings } = limiterFor({
    rate_limit_enabled: true,
    rate_limit_max_attempts: 1,
    rate_limit_window_minutes: 5,
  });

  assert.equal((await service.checkRateLimit('198.51.100.1', 'ip')).allowed, true);
  assert.equal((await service.checkRateLimit('198.51.100.1', 'ip')).allowed, false);

  setSettings({
    rate_limit_enabled: true,
    rate_limit_max_attempts: 1,
    rate_limit_window_minutes: 5,
    from_name: 'x',
  });
  await service.reloadSettings();
  assert.equal(
    (await service.checkRateLimit('198.51.100.1', 'ip')).allowed,
    false,
    'counter survives a save'
  );

  setSettings({
    rate_limit_enabled: true,
    rate_limit_max_attempts: 3,
    rate_limit_window_minutes: 5,
  });
  await service.reloadSettings();
  assert.equal(
    (await service.checkRateLimit('198.51.100.1', 'ip')).allowed,
    true,
    'new limits apply'
  );
});

test('rate-limit stats report real rejections and admin limits stay on when public limits are off', async () => {
  const { service } = limiterFor({
    rate_limit_enabled: true,
    rate_limit_max_attempts: 1,
    rate_limit_window_minutes: 5,
  });
  await service.checkRateLimit('198.51.100.2', 'email');
  await service.checkRateLimit('198.51.100.2', 'email');
  const stats = await service.getStats();
  assert.equal(stats.blocked, 1);
  assert.equal(stats.blockedByType.email, 1);
  assert.equal(stats.backend, 'in-memory (rate-limiter-flexible)');

  const disabled = limiterFor({ rate_limit_enabled: false }).service;
  assert.equal((await disabled.checkRateLimit('198.51.100.3', 'ip')).allowed, true);
  let lastAdmin;
  for (let i = 0; i < 61; i += 1) lastAdmin = await disabled.checkRateLimit('admin:1', 'admin');
  assert.equal(lastAdmin.allowed, false, 'admin token creation is limited per admin');
});

test('the rate limiter fails closed when its settings cannot be read', async () => {
  const service = createRateLimiter({
    strapi: {
      store: () => ({
        get: async () => {
          throw new Error('db down');
        },
      }),
      log: silentLog,
    },
  });
  assert.deepEqual(await service.checkRateLimit('198.51.100.4', 'ip'), {
    allowed: false,
    retryAfter: 60,
  });
});

// ─────────────────────── JWT session store ───────────────────────

const futureIso = (ms = 60_000) => new Date(Date.now() + ms).toISOString();

/**
 * Strapi double with the session table and the in-memory plugin store.
 *
 * @param {Array<object>} [records] - Rows to seed (6.1 record shape).
 * @param {object} [initialStore] - Plugin-store values.
 * @returns {{strapi: object, table: object, values: Map}} Handles.
 */
const tableStrapi = (records = [], initialStore = {}) => {
  const table = createSessionTable();
  table.seed(records);
  const { store, values } = createStore(initialStore);
  return { strapi: { store, db: { query: () => table.query }, log: silentLog }, table, values };
};

test('logins insert one row each, without a lock or a read, and none is lost', async () => {
  const { strapi, table } = tableStrapi();

  const written = await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      sessionStore.appendJwtSession(strapi, {
        id: `s${index}`,
        userId: index,
        jwtTokenHash: `h${index}`,
        expiresAt: futureIso(),
        mfaVerified: true,
      })
    )
  );

  assert.deepEqual(new Set(written), new Set([true]));
  assert.equal(table.rows.length, 25);
  // One INSERT per login and nothing else: no list read, no rewrite.
  assert.deepEqual(new Set(table.calls), new Set(['create']));
  assert.equal(table.calls.length, 25);
  const record = table.records().find((session) => session.id === 's3');
  assert.equal(record.userId, 3, 'numeric user ids keep their type');
  assert.equal(record.mfaVerified, true, 'login extras are kept');
  assert.equal(record.isRevoked, false);
});

test('a failed session insert is logged and never blocks the login', async () => {
  const errorsLogged = [];
  const strapi = {
    db: {
      query: () => ({
        create: async () => {
          throw new Error('synthetic insert failure');
        },
      }),
    },
    log: { ...silentLog, error: (message) => errorsLogged.push(message) },
  };
  assert.equal(
    await sessionStore.appendJwtSession(strapi, { id: 'x', expiresAt: futureIso() }),
    false
  );
  assert.deepEqual(errorsLogged, ['[magic-link] Failed to persist JWT session record']);
});

test('the legacy session list moves into rows once, without plaintext JWTs or expired records', async () => {
  const legacyJwt = 'synthetic.legacy.jwt';
  const legacy = {
    sessions: [
      { id: 'legacy', userId: 4, jwtToken: legacyJwt, expiresAt: futureIso() },
      {
        id: 'old',
        jwtTokenHash: 'x',
        expiresAt: new Date(Date.now() - sessionStore.RETENTION_MS - 1000).toISOString(),
      },
      {
        id: 'revoked',
        userId: 5,
        jwtTokenHash: 'h-revoked',
        expiresAt: futureIso(),
        isRevoked: true,
        revokeReason: 'synthetic',
        revokedBy: 42,
      },
      // Already moved by an earlier, interrupted run.
      { id: 'present', userId: 6, jwtTokenHash: 'h-present', expiresAt: futureIso() },
    ],
  };
  const { strapi, table, values } = tableStrapi(
    [{ id: 'present', userId: 6, jwtTokenHash: 'h-present', expiresAt: futureIso() }],
    { jwt_sessions: legacy }
  );

  assert.deepEqual(await sessionStore.migrateLegacySessions(strapi), { migrated: 2, skipped: 1 });
  assert.equal(values.has('jwt_sessions'), false, 'the legacy key is deleted');
  const records = table.records();
  assert.deepEqual(records.map((session) => session.id).sort(), ['legacy', 'present', 'revoked']);
  const migrated = records.find((session) => session.id === 'legacy');
  assert.equal(migrated.jwtTokenHash, cryptoUtils.hashJwt(legacyJwt));
  assert.equal(JSON.stringify(table.rows).includes(legacyJwt), false);
  const revoked = records.find((session) => session.id === 'revoked');
  assert.equal(revoked.isRevoked, true);
  assert.ok(revoked.revokedAt);
  assert.equal(revoked.revokedBy, 42);

  // A second start finds nothing to do.
  assert.deepEqual(await sessionStore.migrateLegacySessions(strapi), { migrated: 0, skipped: 0 });
  assert.equal(table.rows.length, 3);
});

test('retention and the size cap are indexed deletes of the oldest rows', async () => {
  const expired = new Date(Date.now() - sessionStore.RETENTION_MS - 1000).toISOString();
  const { strapi, table } = tableStrapi([
    { id: 'gone', jwtTokenHash: 'g', expiresAt: expired },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `keep${index}`,
      jwtTokenHash: `k${index}`,
      expiresAt: futureIso(),
    })),
  ]);

  assert.deepEqual(await sessionStore.pruneSessions(strapi, { maxSessions: 3 }), {
    expired: 1,
    capped: 2,
  });
  assert.deepEqual(
    table.records().map((session) => session.id),
    ['keep2', 'keep3', 'keep4']
  );
  assert.deepEqual(await sessionStore.pruneSessions(strapi, { maxSessions: 3 }), {
    expired: 0,
    capped: 0,
  });
});

test('a revocation is a conditional update that keeps the first revocation', async () => {
  const { strapi, table } = tableStrapi([
    { id: 'a', userId: 1, jwtTokenHash: 'ha', expiresAt: futureIso() },
    { id: 'b', userId: 1, jwtTokenHash: 'hb', expiresAt: futureIso() },
  ]);

  const first = await Promise.all([
    sessionStore.markSessionsRevoked(strapi, { sessionId: 'a' }, { reason: 'one', revokedBy: 1 }),
    sessionStore.markSessionsRevoked(strapi, { sessionId: 'a' }, { reason: 'two', revokedBy: 2 }),
  ]);
  assert.deepEqual(first.sort(), [0, 1], 'only one of two parallel revocations changes the row');
  const [a, b] = table.records();
  assert.equal(a.isRevoked, true);
  assert.equal(b.isRevoked, false, 'other rows are untouched');

  assert.equal(await sessionStore.markSessionRestored(strapi, 'a', 7), 1);
  assert.equal(await sessionStore.markSessionRestored(strapi, 'a', 7), 0);
  assert.equal(table.records()[0].restoredBy, 7);
});

// ─────────────────────── JWT controller ───────────────────────

const jwtController = require('../server/src/controllers/jwt');

const jwtStrapi = (sessions, magicLink) => {
  const { strapi, table } = tableStrapi(sessions);
  return {
    table,
    strapi: { ...strapi, plugin: () => ({ service: () => magicLink }) },
  };
};

const ctxFor = (body, adminId = 42) => ({
  request: { body },
  state: { user: { id: adminId } },
  send(payload) {
    this.response = payload;
    return payload;
  },
  notFound(message) {
    this.response = { status: 404, message };
    return this.response;
  },
  badRequest(message) {
    this.response = { status: 400, message };
    return this.response;
  },
  throw(status, message) {
    const error = new Error(String(message || status));
    error.status = status;
    throw error;
  },
});

test('revoking a session blocks its hash until the token expiry and records the acting admin', async () => {
  const expiresAt = futureIso(3_600_000);
  const calls = [];
  const magicLink = {
    blockJwtTokenByHash: async (...args) => {
      calls.push(args);
      return { success: true };
    },
  };
  const { strapi, table } = jwtStrapi(
    [{ id: 's1', userId: 9, jwtTokenHash: 'hash-1', expiresAt }],
    magicLink
  );

  await withGlobalStrapi(strapi, async () => {
    const ctx = ctxFor({ sessionId: 's1', userId: 'attacker-chosen' });
    await jwtController.revokeToken(ctx);
    assert.equal(ctx.response.success, true);
  });

  assert.deepEqual(calls, [['hash-1', 9, 'Manually revoked from admin UI', { expiresAt }]]);
  const [stored] = table.records();
  assert.equal(stored.isRevoked, true);
  assert.equal(stored.revokedBy, 42);
});

test('revoking by raw token ignores a client-supplied user id', async () => {
  const jwt = 'synthetic.header.payload';
  const calls = [];
  const magicLink = {
    blockJwtToken: async (...args) => {
      calls.push(args);
      return { success: true };
    },
  };
  const { strapi, table } = jwtStrapi(
    [{ id: 's2', userId: 11, jwtTokenHash: cryptoUtils.hashJwt(jwt), expiresAt: futureIso() }],
    magicLink
  );

  await withGlobalStrapi(strapi, () =>
    jwtController.revokeToken(ctxFor({ token: jwt, userId: 999 }))
  );

  assert.equal(calls[0][1], 11);
  assert.equal(table.records()[0].isRevoked, true);
});

test('revocation is not shown as done when the blocklist write fails', async () => {
  const magicLink = {
    blockJwtTokenByHash: async () => {
      throw new Error('store down');
    },
  };
  const { strapi, table } = jwtStrapi(
    [{ id: 's3', userId: 1, jwtTokenHash: 'h', expiresAt: futureIso() }],
    magicLink
  );

  await withGlobalStrapi(strapi, async () => {
    await assert.rejects(
      jwtController.revokeToken(ctxFor({ sessionId: 's3' })),
      (error) => error.status === 500
    );
  });
  assert.notEqual(table.records()[0].isRevoked, true);
});

test('revoke requires exactly one of sessionId or token', async () => {
  await withGlobalStrapi(jwtStrapi([], {}).strapi, async () => {
    await assert.rejects(jwtController.revokeToken(ctxFor({})), errors.ValidationError);
    await assert.rejects(
      jwtController.revokeToken(ctxFor({ sessionId: 'a', token: 'b.c.d.e.f.g' })),
      errors.ValidationError
    );
  });
});

test('refresh-mode sessions cannot be restored after revocation', async () => {
  let unblocked = false;
  const magicLink = {
    unblockJwtTokenByHash: async () => {
      unblocked = true;
    },
  };
  const { strapi } = jwtStrapi(
    [
      {
        id: 's4',
        userId: 1,
        jwtTokenHash: 'h',
        upSessionId: 'up-1',
        isRevoked: true,
        expiresAt: futureIso(),
      },
    ],
    magicLink
  );

  await withGlobalStrapi(strapi, async () => {
    const ctx = ctxFor({ sessionId: 's4' });
    await jwtController.unrevokeToken(ctx);
    assert.equal(ctx.response.status, 400);
  });
  assert.equal(unblocked, false);
});

test('parallel revocations of different sessions are both persisted', async () => {
  const magicLink = { blockJwtTokenByHash: async () => ({ success: true }) };
  const { strapi, table } = jwtStrapi(
    [
      { id: 'a', userId: 1, jwtTokenHash: 'ha', expiresAt: futureIso() },
      { id: 'b', userId: 2, jwtTokenHash: 'hb', expiresAt: futureIso() },
    ],
    magicLink
  );

  await withGlobalStrapi(strapi, () =>
    Promise.all([
      jwtController.revokeToken(ctxFor({ sessionId: 'a' })),
      jwtController.revokeToken(ctxFor({ sessionId: 'b' })),
    ])
  );

  assert.deepEqual(
    table.records().map((session) => session.isRevoked),
    [true, true]
  );
});

test('the session list never returns plaintext JWTs', async () => {
  const legacyJwt = 'synthetic.legacy.visible';
  const { strapi } = jwtStrapi(
    [{ id: 'l', userId: 1, jwtToken: legacyJwt, expiresAt: futureIso() }],
    {}
  );
  await withGlobalStrapi(strapi, async () => {
    const ctx = ctxFor({});
    await jwtController.getSessions(ctx);
    assert.equal(JSON.stringify(ctx.response).includes(legacyJwt), false);
    assert.match(ctx.response[0].token, /^\[hash\] /);
  });
});

test('the session list pages, filters and counts from the table', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const { strapi } = jwtStrapi(
    [
      { id: 'u1-active', userId: 1, jwtTokenHash: 'h1', expiresAt: futureIso() },
      { id: 'u1-revoked', userId: 1, jwtTokenHash: 'h2', expiresAt: futureIso(), isRevoked: true },
      { id: 'u2-expired', userId: 2, jwtTokenHash: 'h3', expiresAt: past },
      { id: 'u2-active', userId: 2, jwtTokenHash: 'h4', expiresAt: futureIso() },
    ],
    {}
  );
  const list = async (query) => {
    const headers = {};
    const ctx = { ...ctxFor({}), query, set: (key, value) => (headers[key] = value) };
    await jwtController.getSessions(ctx);
    return { ids: ctx.response.map((session) => session.id), total: headers['X-Total-Count'] };
  };

  await withGlobalStrapi(strapi, async () => {
    assert.deepEqual(await list({}), {
      ids: ['u2-active', 'u2-expired', 'u1-revoked', 'u1-active'],
      total: '4',
    });
    assert.deepEqual(await list({ page: '2', pageSize: '3' }), { ids: ['u1-active'], total: '4' });
    assert.deepEqual(await list({ status: 'active' }), {
      ids: ['u2-active', 'u1-active'],
      total: '2',
    });
    assert.deepEqual(await list({ status: 'revoked' }), { ids: ['u1-revoked'], total: '1' });
    assert.deepEqual(await list({ status: 'expired' }), { ids: ['u2-expired'], total: '1' });
    assert.deepEqual(await list({ userId: '1' }), {
      ids: ['u1-revoked', 'u1-active'],
      total: '2',
    });
    await assert.rejects(list({ pageSize: '5000' }), errors.ValidationError);
    await assert.rejects(list({ sort: 'id' }), errors.ValidationError);
  });
});

// ─────────────────────── Token controller ───────────────────────

const tokensController = require('../server/src/controllers/tokens');

/**
 * Builds a strapi mock for tokens.create / token actions.
 */
const tokenStrapi = ({ settings = {}, users = [], sendFails = false, tokenRow } = {}) => {
  const logs = [];
  const updates = [];
  const sent = [];
  const limiterKeys = [];
  const created = [];
  const magicLink = {
    settings: async () => settings,
    findOrCreateUser: async (email) => ({
      user: { id: 99, email, username: 'new', blocked: false },
      created: true,
    }),
    createToken: async (email, context) => {
      created.push({ email, context });
      return {
        id: 5,
        documentId: 'doc5',
        email,
        context,
        expires_at: new Date(Date.now() + 3600_000),
        token: 'PLAINTEXT-SYNTHETIC-TOKEN-VALUE-0001',
        _plaintextToken: 'PLAINTEXT-SYNTHETIC-TOKEN-VALUE-0001',
      };
    },
    sendLoginLink: async (token) => {
      if (sendFails) throw new Error('smtp down');
      sent.push(token);
      return token;
    },
  };
  const limiter = {
    checkRateLimit: async (key, type) => {
      limiterKeys.push([key, type]);
      return { allowed: true, retryAfter: 0 };
    },
  };
  const { store } = createStore({ banned_ips: { ips: ['203.0.113.9'] } });
  const strapi = {
    store,
    config: {
      get: (key, fallback) => (key === 'server.url' ? 'https://api.example.test' : fallback),
    },
    plugin: () => ({ service: (name) => (name === 'rate-limiter' ? limiter : magicLink) }),
    db: {
      query: (uid) => ({
        findMany: async () => (uid === 'plugin::users-permissions.user' ? users : []),
        findOne: async () => tokenRow || null,
        update: async ({ where, data }) => {
          updates.push({ where, data });
          return { ...(tokenRow || {}), ...data };
        },
        delete: async () => ({}),
        count: async () => 0,
      }),
    },
    log: Object.fromEntries(
      ['debug', 'info', 'warn', 'error'].map((level) => [
        level,
        (message) => logs.push(String(message)),
      ])
    ),
  };
  return { strapi, logs, updates, sent, limiterKeys, created };
};

const adminCtx = ({ body, params, canIssue = false } = {}) => ({
  request: { body },
  params,
  query: {},
  state: {
    user: { id: 3 },
    userAbility: { can: (action) => canIssue && action === 'plugin::magic-link.tokens.issue' },
  },
  headers: {},
  set(name, value) {
    this.headers[name] = value;
  },
  send(payload) {
    this.response = payload;
    return payload;
  },
  notFound(message) {
    return { status: 404, message };
  },
  badRequest(message) {
    return { status: 400, message };
  },
  throw(status, message) {
    const error = new Error(String(message || status));
    error.status = status;
    throw error;
  },
});

const existingUser = { id: 1, email: 'user@example.test', username: 'user', blocked: false };

test('returning a login link without e-mail requires the tokens.issue permission', async () => {
  const mock = tokenStrapi({ users: [existingUser] });
  await withGlobalStrapi(mock.strapi, async () => {
    await assert.rejects(
      tokensController.create(
        adminCtx({ body: { email: 'user@example.test', send_email: false } })
      ),
      (error) => {
        // Strapi 5.61's authorize middleware replaces any other ForbiddenError
        // with a bare "Forbidden" and drops `details`; PolicyError passes.
        assert.ok(error instanceof errors.PolicyError);
        assert.equal(error.details.key, 'tokens.issue.forbidden');
        return true;
      }
    );
  });
  assert.equal(mock.created.length, 0, 'no token is created');
});

test('an admin with tokens.issue gets the link once, and the audit log names no e-mail or token', async () => {
  const mock = tokenStrapi({ users: [existingUser] });
  const ctx = adminCtx({
    body: { email: 'USER@example.test', send_email: false, ttl: 2 },
    canIssue: true,
  });
  const result = await withGlobalStrapi(mock.strapi, () => tokensController.create(ctx));

  assert.equal(result.token, 'PLAINTEXT-SYNTHETIC-TOKEN-VALUE-0001');
  assert.ok(
    result.loginUrl.startsWith('https://api.example.test/api/magic-link/login?loginToken=')
  );
  assert.equal(result.sent, false);
  assert.equal(ctx.headers['Cache-Control'], 'no-store');
  assert.equal(mock.created[0].email, 'user@example.test');
  const ttlUpdate = mock.updates.find((entry) => entry.data.expires_at);
  const hours = (new Date(ttlUpdate.data.expires_at).getTime() - Date.now()) / 3600_000;
  assert.ok(hours > 1.9 && hours <= 2, 'ttl hours are applied');
  const logText = mock.logs.join('\n');
  assert.match(logText, /Admin 3 issued login token doc5 \(delivery: direct\)/);
  assert.equal(logText.includes('user@example.test'), false);
  assert.equal(logText.includes('PLAINTEXT-SYNTHETIC'), false);
  assert.deepEqual(
    mock.limiterKeys,
    [['admin:3', 'admin']],
    'admin creation uses its own bucket, not the public IP bucket'
  );
});

test('e-mailed admin links never return the plaintext token', async () => {
  const mock = tokenStrapi({ users: [existingUser] });
  const result = await withGlobalStrapi(mock.strapi, () =>
    tokensController.create(
      adminCtx({ body: { email: 'user@example.test', context: '{"redirectTo":"/app"}' } })
    )
  );

  assert.equal(result.sent, true);
  assert.equal(result.token, undefined);
  assert.equal(result.loginUrl, undefined);
  assert.equal(JSON.stringify(result).includes('PLAINTEXT-SYNTHETIC'), false);
  assert.equal(mock.sent.length, 1);
  assert.deepEqual(
    mock.created[0].context,
    { redirectTo: '/app' },
    'JSON-string context from 5.x clients is parsed'
  );
});

test('a failed admin e-mail deactivates the new token and reports 503', async () => {
  const mock = tokenStrapi({ users: [existingUser], sendFails: true });
  await withGlobalStrapi(mock.strapi, async () => {
    await assert.rejects(
      tokensController.create(adminCtx({ body: { email: 'user@example.test' } })),
      (error) => error.status === 503
    );
  });
  assert.ok(mock.updates.some((entry) => entry.data.is_active === false));
});

test('admin token creation validates input and respects user auto-creation', async () => {
  const noUser = tokenStrapi({ settings: { createUserIfNotExists: false } });
  await withGlobalStrapi(noUser.strapi, async () => {
    const result = await tokensController.create(adminCtx({ body: { email: 'new@example.test' } }));
    assert.equal(result.status, 400);
    await assert.rejects(
      tokensController.create(adminCtx({ body: { email: { $ne: '' } } })),
      errors.ValidationError
    );
    await assert.rejects(
      tokensController.create(
        adminCtx({ body: { email: 'user@example.test', context: { requiresTOTP: false } } })
      ),
      errors.ValidationError
    );
    await assert.rejects(
      tokensController.create(adminCtx({ body: { email: 'user@example.test', ttl: 0 } })),
      errors.ValidationError
    );
    await assert.rejects(
      tokensController.create(adminCtx({ body: { email: 'user@example.test', ttl: 721 } })),
      errors.ValidationError
    );
  });

  const blocked = tokenStrapi({ users: [{ ...existingUser, blocked: true }] });
  await withGlobalStrapi(blocked.strapi, async () => {
    const result = await tokensController.create(
      adminCtx({ body: { email: 'user@example.test' } })
    );
    assert.equal(result.status, 400);
  });
});

test('token list responses never include the hash, salt, lookup prefix or challenge', async () => {
  const row = {
    id: 1,
    documentId: 'd1',
    email: 'user@example.test',
    token: 'HASH',
    token_salt: 'SALT',
    token_prefix: 'PREFIX12',
    challenge: { type: 'totp' },
    is_active: 1,
    is_used: 0,
    expires_at: futureIso(),
  };
  const strapi = {
    db: { query: () => ({ findMany: async () => [row], count: async () => 1 }) },
    log: silentLog,
  };
  const result = await withGlobalStrapi(strapi, () => tokensController.find(adminCtx({})));
  const text = JSON.stringify(result);
  for (const secret of ['HASH', 'SALT', 'PREFIX12', 'totp'])
    assert.equal(text.includes(secret), false, secret);
  assert.equal(result.data[0].is_active, true);
  assert.equal(result.meta.pagination.total, 1);
});

test('activate refuses used, expired, completed and banned-IP links', async () => {
  const base = {
    id: 7,
    documentId: 'd7',
    is_active: false,
    is_used: false,
    expires_at: futureIso(),
  };
  const cases = [
    [{ ...base, is_used: true }, /single-use/],
    [{ ...base, expires_at: new Date(Date.now() - 1000).toISOString() }, /Expired/],
    [{ ...base, challenge: { verifiedAt: new Date().toISOString() } }, /completed/],
    [{ ...base, ip_address: '::ffff:203.0.113.9' }, /banned/],
  ];
  for (const [tokenRow, pattern] of cases) {
    const mock = tokenStrapi({ tokenRow });
    const result = await withGlobalStrapi(mock.strapi, () =>
      tokensController.activate(adminCtx({ params: { id: 'd7' } }))
    );
    assert.equal(result.status, 400);
    assert.match(result.message, pattern);
    assert.equal(mock.updates.length, 0);
  }

  const ok = tokenStrapi({ tokenRow: base });
  const ctx = adminCtx({ params: { id: 'd7' } });
  await withGlobalStrapi(ok.strapi, () => tokensController.activate(ctx));
  assert.equal(ok.updates[0].data.is_active, true);
});

test('extend accepts 1-365 days and rejects zero, negative and used single-use links', async () => {
  const tokenRow = {
    id: 8,
    documentId: 'd8',
    is_active: true,
    is_used: false,
    expires_at: futureIso(),
  };
  const mock = tokenStrapi({ tokenRow });
  await withGlobalStrapi(mock.strapi, async () => {
    for (const days of [0, -3, 366, 'abc']) {
      await assert.rejects(
        tokensController.extend(adminCtx({ params: { id: 'd8' }, body: { days } })),
        errors.ValidationError,
        String(days)
      );
    }
    const ctx = adminCtx({ params: { id: 'd8' }, body: { days: 2 } });
    await tokensController.extend(ctx);
    assert.equal(ctx.response.data.extendedBy, '2 days');
  });

  const used = tokenStrapi({ tokenRow: { ...tokenRow, is_used: true } });
  await withGlobalStrapi(used.strapi, async () => {
    const result = await tokensController.extend(
      adminCtx({ params: { id: 'd8' }, body: { days: 2 } })
    );
    assert.equal(result.status, 400);
  });
});

test('token id parameters reject operator and path payloads', async () => {
  const mock = tokenStrapi({});
  await withGlobalStrapi(mock.strapi, async () => {
    await assert.rejects(
      tokensController.block(adminCtx({ params: { id: '../x' } })),
      errors.ValidationError
    );
    await assert.rejects(tokensController.delete(adminCtx({ params: {} })), errors.ValidationError);
  });
});

// ─────────────────────── Settings and license validation ───────────────────────

test('settings URL fields only accept https (http only for localhost) without credentials', () => {
  const parse = (body) => parseBody(settingsUpdateSchema, body);
  assert.deepEqual(parse({ frontend_url: 'https://app.example.test' }), {
    frontend_url: 'https://app.example.test',
  });
  assert.deepEqual(parse({ confirmationUrl: 'http://localhost:3000/login' }), {
    confirmationUrl: 'http://localhost:3000/login',
  });
  for (const value of [
    'http://evil.example',
    'javascript:alert(1)',
    'https://user:pw@example.test',
    'ftp://example.test',
  ]) {
    assert.throws(() => parse({ confirmationUrl: value }), errors.ValidationError, value);
    assert.throws(() => parse({ frontend_url: value }), errors.ValidationError, value);
  }
});

test('settings updates drop unknown keys and keep known ones', () => {
  const parsed = parseBody(settingsUpdateSchema, {
    settings: { create_new_user: true, otp_length: 6, whatever: 1 },
  });
  assert.deepEqual(parsed, { otp_length: 6 });
});

test('license store-key rejects malformed keys before any network call', () => {
  assert.throws(
    () => parseBody(licenseStoreKeySchema, { licenseKey: '../../x?y', email: 'a@example.test' }),
    errors.ValidationError
  );
  assert.deepEqual(
    parseBody(licenseStoreKeySchema, { licenseKey: 'ABCD-1234-EFGH', email: 'A@Example.test' }),
    {
      licenseKey: 'ABCD-1234-EFGH',
      email: 'a@example.test',
    }
  );
});

// ─────────────────────── Lifecycle ───────────────────────

test('RBAC actions are read, manage, tokens.issue and settings read/update/security, all with a subCategory', () => {
  assert.deepEqual(
    lifecycle.RBAC_ACTIONS.map((action) => action.uid),
    ['read', 'manage', 'tokens.issue', 'settings.read', 'settings.update', 'settings.security']
  );
  assert.ok(
    lifecycle.RBAC_ACTIONS.every(
      (action) => action.subCategory && action.pluginName === 'magic-link'
    )
  );
});

test('roles with the 5.x access permission get read + manage, never tokens.issue', async () => {
  const rows = [
    { id: 1, action: 'plugin::magic-link.access', role: { id: 10 } },
    { id: 2, action: 'plugin::magic-link.access', role: { id: 11 } },
    { id: 3, action: 'plugin::magic-link.read', role: { id: 11 } },
  ];
  const created = [];
  let deletedWhere;
  const strapi = {
    db: {
      query: () => ({
        findMany: async ({ where }) => {
          if (where.action === 'plugin::magic-link.access')
            return rows.filter((row) => row.action === where.action);
          return rows.filter(
            (row) => where.action.$in.includes(row.action) && row.role?.id === where.role.id
          );
        },
        create: async ({ data }) => {
          created.push(data);
          return data;
        },
        deleteMany: async ({ where }) => {
          deletedWhere = where;
          return { count: 2 };
        },
      }),
    },
  };

  const result = await lifecycle.migrateLegacyAccessPermission(strapi);

  assert.equal(result.roles, 2);
  assert.deepEqual(created.map((data) => `${data.role}:${data.action}`).sort(), [
    '10:plugin::magic-link.manage',
    '10:plugin::magic-link.read',
    '11:plugin::magic-link.manage',
  ]);
  assert.deepEqual(deletedWhere, { action: 'plugin::magic-link.access' });
  assert.ok(created.every((data) => data.action !== 'plugin::magic-link.tokens.issue'));
});

test('destroy clears every background timer started by bootstrap', async () => {
  const strapi = { log: silentLog, plugin: () => ({ service: () => ({ cleanup() {} }) }) };
  let ran = 0;
  lifecycle.runLater(
    strapi,
    20,
    async () => {
      ran += 1;
    },
    () => {}
  );
  lifecycle.runEvery(
    strapi,
    20,
    async () => {
      ran += 1;
    },
    () => {}
  );

  require('../server/src/destroy')({ strapi });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(ran, 0);
});

test('failing background jobs are handled instead of becoming unhandled rejections', async () => {
  const strapi = { log: silentLog };
  let handled = false;
  lifecycle.runLater(
    strapi,
    1,
    async () => {
      throw new Error('synthetic job failure');
    },
    () => {
      handled = true;
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(handled, true);
  lifecycle.clearTrackedTimers(strapi);
});

test('a proxy configuration that trusts any X-Forwarded-For entry is reported', () => {
  const warnings = [];
  const make = (values) => ({
    config: { get: (key, fallback) => (key in values ? values[key] : fallback) },
    log: { warn: (message) => warnings.push(message) },
  });
  assert.equal(lifecycle.warnOnUnsafeProxyConfig(make({ 'server.proxy.koa': true })), true);
  assert.equal(
    lifecycle.warnOnUnsafeProxyConfig(
      make({ 'server.proxy.koa': true, 'server.proxy.maxIpsCount': 1 })
    ),
    false
  );
  assert.equal(lifecycle.warnOnUnsafeProxyConfig(make({})), false);
  assert.equal(warnings.length, 1);
});
