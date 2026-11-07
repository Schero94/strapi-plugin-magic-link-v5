'use strict';

/**
 * Adversarial re-attack (2026-11-07) of the JWT session table (one row per
 * login instead of the locked `jwt_sessions` list). Each test reproduces one
 * confirmed finding against the real store, service and controller code
 * with in-memory doubles of the session table and the plugin store.
 * Synthetic data only: example.test addresses, fake JWT strings.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const cryptoUtils = require('../server/src/utils/crypto');
const createMagicLinkService = require('../server/src/services/magic-link');
const jwtController = require('../server/src/controllers/jwt');
const register = require('../server/src/register');
const contentTypes = require('../server/src/content-types');
const { CLAIM_REASON } = require('../server/src/utils/account-claim');
const { LEGACY_STORE_KEY } = require('../server/src/utils/jwt-session-store');
const { createSessionTable } = require('./helpers/session-table.cjs');

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Strapi double with the real magic-link service, a session table double
 * and an in-memory plugin store.
 *
 * @param {object} [options]
 * @param {object} [options.store] - Initial plugin-store values.
 * @returns {{strapi: object, table: object, values: Map, service: object}} Handles.
 */
const createEnv = ({ store = {} } = {}) => {
  const table = createSessionTable();
  const values = new Map(Object.entries(store));
  const strapi = {
    log: silentLog,
    config: { get: (_key, fallback) => fallback },
    db: { query: () => table.query },
    store: () => ({
      get: async ({ key }) => (values.has(key) ? structuredClone(values.get(key)) : null),
      set: async ({ key, value }) => {
        values.set(key, structuredClone(value));
      },
      delete: async ({ key }) => {
        values.delete(key);
      },
    }),
  };
  const service = createMagicLinkService({ strapi });
  strapi.plugin = () => ({ service: () => service });
  return { strapi, table, values, service };
};

/**
 * Admin request context double for the JWT controller.
 *
 * @param {object} body - Request body.
 * @returns {object} Koa context double.
 */
const adminCtx = (body) => ({
  state: { user: { id: 3 } },
  request: { body },
  query: {},
  set() {},
  send(payload) {
    this.status = 200;
    this.body = payload;
  },
  badRequest(message) {
    this.status = 400;
    this.message = message;
  },
  notFound() {
    this.status = 404;
  },
  throw(status) {
    const error = new Error(String(status));
    error.status = status;
    throw error;
  },
});

/**
 * Runs `fn` with `global.strapi` set.
 *
 * @param {object} strapi - Strapi double.
 * @param {() => Promise<void>} fn - Work.
 * @returns {Promise<void>}
 */
const withGlobal = async (strapi, fn) => {
  const original = global.strapi;
  global.strapi = strapi;
  try {
    await fn();
  } finally {
    if (original === undefined) delete global.strapi;
    else global.strapi = original;
  }
};

const record = (id, jwt, extra = {}) => ({
  id,
  userId: 7,
  userEmail: 'claimed@example.test',
  jwtTokenHash: cryptoUtils.hashJwt(jwt),
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  isRevoked: false,
  ...extra,
});

test('an account claim cannot be undone by restoring an earlier manual revocation', async () => {
  const jwt = 'synthetic.claimed.jwt';
  const { strapi, table, service } = createEnv();
  table.seed([record('session_manual_then_claim', jwt)]);

  await withGlobal(strapi, async () => {
    // 1. An admin revokes the session manually.
    const revokeCtx = adminCtx({ sessionId: 'session_manual_then_claim' });
    await jwtController.revokeToken(revokeCtx);
    assert.equal(revokeCtx.status, 200);

    // 2. The mailbox owner claims the unconfirmed account: every session of
    //    the user must stay ended for good.
    await service.revokeUserSessions(7, CLAIM_REASON);
    assert.equal(await service.isJwtTokenBlocked(jwt), true);

    // 3. An admin (or a stale admin tab) restores the manual revocation.
    const restoreCtx = adminCtx({ sessionId: 'session_manual_then_claim' });
    await jwtController.unrevokeToken(restoreCtx);
  });

  assert.equal(await service.isJwtTokenBlocked(jwt), true, 'the claimed JWT stays revoked');
  assert.equal(table.records()[0].isRevoked, true, 'the row still shows the session as ended');
});

test('restoring a session that is not revoked never lifts a block on its JWT', async () => {
  const jwt = 'synthetic.blocked.but.active.jwt';
  const { strapi, table, service } = createEnv();
  table.seed([record('session_active_row', jwt)]);
  // The block was written, the row update did not happen (failed or still
  // running on another process).
  await service.blockJwtTokenByHash(cryptoUtils.hashJwt(jwt), 7, 'Manually revoked from admin UI');

  await withGlobal(strapi, async () => {
    await jwtController.unrevokeToken(adminCtx({ sessionId: 'session_active_row' }));
  });

  assert.equal(await service.isJwtTokenBlocked(jwt), true);
});

test('an account claim also ends sessions still waiting in the pre-6.2 list', async () => {
  // A replica of the previous release is still serving during a rolling
  // deploy (or the start-up migration failed): its logins land in the old
  // plugin-store list, not in the table.
  const jwt = 'synthetic.legacy.list.jwt';
  const { strapi, table, values, service } = createEnv({
    store: { [LEGACY_STORE_KEY]: { sessions: [record('session_legacy_only', jwt)] } },
  });

  await withGlobal(strapi, async () => {
    const result = await service.revokeUserSessions(7, CLAIM_REASON);
    assert.equal(result.revoked, 1);
  });

  assert.equal(await service.isJwtTokenBlocked(jwt), true, 'the legacy JWT is blocked');
  assert.equal(values.has(LEGACY_STORE_KEY), false, 'the list was moved into the table');
  assert.equal(table.records()[0].revokeReason, CLAIM_REASON);
});

test('the admin list shows sessions still waiting in the pre-6.2 list', async () => {
  const { strapi, values } = createEnv({
    store: {
      [LEGACY_STORE_KEY]: {
        sessions: [record('session_legacy_listed', 'synthetic.legacy.listed.jwt')],
      },
    },
  });
  const ctx = adminCtx({});
  await withGlobal(strapi, () => jwtController.getSessions(ctx));
  assert.deepEqual(
    ctx.body.map((row) => row.id),
    ['session_legacy_listed']
  );
  assert.equal(values.has(LEGACY_STORE_KEY), false);
});

test('GraphQL Shadow CRUD is disabled for every Magic Link content type', () => {
  const disabled = [];
  const strapi = {
    config: { get: (_key, fallback) => fallback },
    server: { use() {} },
    log: silentLog,
    plugin: (name) =>
      name === 'graphql'
        ? {
            service: (service) => {
              assert.equal(service, 'extension');
              return { shadowCRUD: (uid) => ({ disable: () => disabled.push(uid) }) };
            },
          }
        : undefined,
  };
  register({ strapi });
  assert.deepEqual(
    disabled.sort(),
    Object.keys(contentTypes)
      .map((name) => `plugin::magic-link.${name}`)
      .sort()
  );
});

test('register works without the GraphQL plugin', () => {
  const strapi = {
    config: { get: (_key, fallback) => fallback },
    server: { use() {} },
    log: silentLog,
    plugin: () => undefined,
  };
  assert.doesNotThrow(() => register({ strapi }));
});

test('a claim block written while the restore runs is kept and the restore is refused', async () => {
  // Race: the row still shows the manual revocation, but an account claim
  // on another process has already blocked the JWT for good.
  const jwt = 'synthetic.claim.race.jwt';
  const { strapi, table, service } = createEnv();
  table.seed([
    record('session_claim_race', jwt, {
      isRevoked: true,
      revokedAt: new Date().toISOString(),
      revokeReason: 'Manually revoked from admin UI',
    }),
  ]);
  await service.blockJwtTokenByHash(cryptoUtils.hashJwt(jwt), 7, 'Manually revoked from admin UI');
  await service.addBlocklistEntries([
    {
      tokenHash: cryptoUtils.hashJwt(jwt),
      userId: 7,
      reason: CLAIM_REASON,
      noRestore: true,
      blockedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
  ]);

  const ctx = adminCtx({ sessionId: 'session_claim_race' });
  await withGlobal(strapi, () => jwtController.unrevokeToken(ctx));

  assert.equal(ctx.status, 400);
  assert.match(ctx.message, /account claim/);
  assert.equal(await service.isJwtTokenBlocked(jwt), true);
  assert.equal(table.records()[0].isRevoked, true, 'the row is not shown as restored');
});
