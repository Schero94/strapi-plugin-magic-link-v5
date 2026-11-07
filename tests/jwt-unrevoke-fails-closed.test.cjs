'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const cryptoUtils = require('../server/src/utils/crypto');
const jwtController = require('../server/src/controllers/jwt');

test('unrevoke does not report success or clear session state when blocklist removal fails', async () => {
  const originalStrapi = global.strapi;
  const tokenHash = cryptoUtils.hashJwt('synthetic.audit.jwt');
  const session = {
    id: 'synthetic-session',
    userId: 'synthetic-user',
    jwtTokenHash: tokenHash,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    isRevoked: true,
    revokedAt: new Date().toISOString(),
    revokeReason: 'synthetic audit',
  };
  const storedSessions = { sessions: [session] };
  const writes = [];
  const logs = [];
  let response;

  global.strapi = {
    store: () => ({
      get: async ({ key }) => (key === 'jwt_sessions' ? structuredClone(storedSessions) : undefined),
      set: async ({ key }) => { writes.push(key); },
    }),
    plugin: () => ({
      service: () => ({
        unblockJwtTokenByHash: async () => { throw new Error('synthetic blocklist storage failure'); },
      }),
    }),
    log: {
      warn() {},
      error(...entries) { logs.push(entries.join(' ')); },
    },
  };

  try {
    const ctx = {
      request: { body: { sessionId: session.id } },
      send(payload) { response = payload; return payload; },
      badRequest(message) { throw new Error(message); },
      throw(status, error) {
        const failure = new Error(String(error || status));
        failure.status = status;
        throw failure;
      },
    };

    await assert.rejects(
      jwtController.unrevokeToken(ctx),
      (error) => error.status === 500 && error.message === 'Failed to update JWT revocation status',
    );
    assert.equal(response, undefined);
    assert.deepEqual(storedSessions.sessions[0], session);
    assert.deepEqual(writes, []);
    assert.ok(logs.every((entry) => !entry.includes('synthetic blocklist storage failure')));
  } finally {
    if (originalStrapi === undefined) delete global.strapi;
    else global.strapi = originalStrapi;
  }
});

test('unrevoke clears the stored session only after the blocklist service succeeds', async () => {
  const originalStrapi = global.strapi;
  const tokenHash = cryptoUtils.hashJwt('synthetic.audit.jwt.success');
  const storedSessions = {
    sessions: [{
      id: 'synthetic-session',
      userId: 'synthetic-user',
      jwtTokenHash: tokenHash,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      isRevoked: true,
      revokedAt: new Date().toISOString(),
      revokeReason: 'synthetic audit',
    }],
  };
  let unblockArgs;
  let persisted;
  let response;

  global.strapi = {
    store: () => ({
      get: async ({ key }) => (key === 'jwt_sessions' ? structuredClone(storedSessions) : undefined),
      set: async ({ key, value }) => { if (key === 'jwt_sessions') persisted = value; },
    }),
    plugin: () => ({
      service: () => ({
        unblockJwtTokenByHash: async (...args) => { unblockArgs = args; return { success: true }; },
      }),
    }),
    log: { info() {}, warn() {}, error() {} },
  };

  try {
    const ctx = {
      request: { body: { sessionId: 'synthetic-session' } },
      send(payload) { response = payload; return payload; },
      badRequest(message) { throw new Error(message); },
      throw(status, error) { throw new Error(String(error || status)); },
    };

    await jwtController.unrevokeToken(ctx);

    assert.deepEqual(unblockArgs, [tokenHash, 'synthetic-user']);
    assert.equal(persisted.sessions[0].isRevoked, false);
    assert.equal(persisted.sessions[0].revokedAt, null);
    assert.equal(persisted.sessions[0].revokeReason, null);
    assert.equal(response.success, true);
  } finally {
    if (originalStrapi === undefined) delete global.strapi;
    else global.strapi = originalStrapi;
  }
});
