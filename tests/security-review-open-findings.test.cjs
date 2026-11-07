'use strict';

/**
 * Adversarial security review (6.0.0 branch): reproductions of findings that
 * live outside server/src/utils and still need a fix in services,
 * controllers or middlewares. Each test asserts the SECURE behaviour and is
 * marked `todo`, so it reports the gap without failing `npm test`. Remove
 * the `todo` option when the fix lands. Synthetic data only.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const { useTestSecrets } = require('./helpers/mfa-strapi.cjs');

useTestSecrets();

const auth = require('../server/src/controllers/auth');
const jwtController = require('../server/src/controllers/jwt');
const createRateLimiter = require('../server/src/services/rate-limiter');
const { createJwtRevocationMiddleware } = require('../server/src/middlewares/jwt-revocation');
const { createLoginCoreStrapi, createCtx, fakeJwt } = require('./helpers/login-core-strapi.cjs');

const USER = {
  id: 7,
  documentId: 'user-doc',
  email: 'user@example.test',
  username: 'user',
  confirmed: true,
  blocked: false,
};

/**
 * Session manager double with the refresh-token family semantics of
 * @strapi/core 5.61 dist/services/session-manager.js: rotation creates a
 * child session with a new sessionId (same deviceId) and marks the parent
 * `rotated`; revokeSessionById deletes exactly one record;
 * invalidateRefreshToken(userId, deviceId) deletes every record of the
 * device; access tokens are validated without a session lookup.
 *
 * @returns {object} Session manager plus the backing records.
 */
const createRotatingSessionManager = () => {
  const records = new Map();
  let counter = 0;
  const create = (userId, deviceId, parent) => {
    counter += 1;
    const sessionId = `sid-${counter}`;
    records.set(sessionId, { userId, deviceId, sessionId, status: 'active', childId: null });
    if (parent) Object.assign(records.get(parent), { status: 'rotated', childId: sessionId });
    return sessionId;
  };
  const manager = {
    records,
    generateRefreshToken: async (userId, deviceId) => {
      const sessionId = create(userId, deviceId);
      return {
        token: `refresh:${sessionId}`,
        sessionId,
        absoluteExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
    },
    generateAccessToken: async (refreshToken) => {
      const sessionId = refreshToken.split(':')[1];
      const record = records.get(sessionId);
      if (!record || record.status !== 'active') return { error: 'invalid_refresh_token' };
      return { token: fakeJwt({ userId: record.userId, sessionId, type: 'access' }, '30m') };
    },
    rotateRefreshToken: async (refreshToken) => {
      const sessionId = refreshToken.split(':')[1];
      const record = records.get(sessionId);
      if (!record || record.status !== 'active') return { error: 'invalid_refresh_token' };
      const child = create(record.userId, record.deviceId, sessionId);
      return { token: `refresh:${child}`, sessionId: child };
    },
    revokeSessionById: async (userId, sessionId) => {
      const record = records.get(sessionId);
      if (!record || record.userId !== userId) return false;
      records.delete(sessionId);
      return true;
    },
    invalidateRefreshToken: async (userId, deviceId) => {
      for (const [id, record] of records) {
        if (record.userId === userId && (!deviceId || record.deviceId === deviceId)) {
          records.delete(id);
        }
      }
    },
  };
  return manager;
};

test(
  'refresh mode: revoking a plugin session after a token refresh ends the refresh family',
  {
    todo: 'services/magic-link.js revokeUpSession revokes only the root sessionId; rotated children stay valid',
  },
  async () => {
    const { strapi, magicLinkService, state, setConfig } = createLoginCoreStrapi({
      users: [USER],
    });
    setConfig('plugin::users-permissions.jwtManagement', 'refresh');
    const manager = createRotatingSessionManager();
    strapi.sessionManager = () => manager;

    const token = await magicLinkService.createToken(USER.email);
    const loginCtx = createCtx({ method: 'POST', body: { loginToken: token._plaintextToken } });
    await auth.login(loginCtx);
    const stolenRefresh = loginCtx.body.refreshToken;
    assert.ok(stolenRefresh);

    // The attacker who stole the refresh token rotates it once (POST /api/auth/refresh).
    const rotated = await manager.rotateRefreshToken(stolenRefresh);
    assert.ok(rotated.token);

    // The admin revokes the session in the Magic Link panel.
    const sessionId = state.stores['magic-link'].jwt_sessions.sessions[0].id;
    const revokeCtx = createCtx({ method: 'POST', body: { sessionId } });
    revokeCtx.notFound = () => assert.fail('session must exist');
    await jwtController.revokeToken(revokeCtx);
    assert.equal(revokeCtx.body.success, true);

    // Secure expectation: the rotated refresh token can no longer mint access tokens.
    const access = await manager.generateAccessToken(rotated.token);
    assert.ok(
      'error' in access,
      'rotated refresh token still mints access tokens after revocation'
    );
  }
);

test(
  'refresh mode: access tokens minted after a refresh are rejected once the session is revoked',
  {
    todo: 'middlewares/jwt-revocation.js only blocks the first access token hash; it should reject access tokens whose users-permissions session (payload.sessionId) is no longer active',
  },
  async () => {
    const { strapi, magicLinkService, state, setConfig } = createLoginCoreStrapi({
      users: [USER],
    });
    setConfig('plugin::users-permissions.jwtManagement', 'refresh');
    const manager = createRotatingSessionManager();
    strapi.sessionManager = () => manager;
    manager.isSessionActive = async (id) => manager.records.has(id);

    const token = await magicLinkService.createToken(USER.email);
    const loginCtx = createCtx({ method: 'POST', body: { loginToken: token._plaintextToken } });
    await auth.login(loginCtx);
    const rotated = await manager.rotateRefreshToken(loginCtx.body.refreshToken);
    const { token: secondAccess } = await manager.generateAccessToken(rotated.token);

    await magicLinkService.blockJwtTokenByHash(
      state.stores['magic-link'].jwt_sessions.sessions[0].jwtTokenHash,
      USER.id,
      'test'
    );
    // Even if the family were deleted, the second access token is not in the blocklist.
    for (const id of [...manager.records.keys()]) manager.records.delete(id);

    const middleware = createJwtRevocationMiddleware({ strapi });
    const ctx = {
      path: '/api/users/me',
      request: { header: { authorization: `Bearer ${secondAccess}` } },
    };
    let reachedNext = false;
    await middleware(ctx, async () => {
      reachedNext = true;
    });
    assert.equal(reachedNext, false, 'access token of a revoked session is accepted');
  }
);

// Fixed in 5ba821e (always-on `verify` limiter); kept as a regression guard.
test('second-factor verification stays throttled when public rate limits are disabled', async () => {
  const settings = { rate_limit_enabled: false };
  const strapi = {
    store: () => ({ get: async () => settings }),
    config: { get: () => undefined },
    log: { warn() {}, error() {}, info() {}, debug() {} },
  };
  const limiter = createRateLimiter({ strapi });
  let allowed = 0;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const check = await limiter.checkRateLimit('totp-login-account:synthetic', 'verify');
    if (check.allowed) allowed += 1;
  }
  assert.ok(allowed <= 10, `${allowed}/200 TOTP guesses for one account were allowed`);
});

test(
  'magic-link login does not hand over a pre-registered, unconfirmed account with a foreign password',
  {
    todo: 'controllers/auth.js confirmUser marks an unconfirmed local account confirmed without invalidating the password an attacker may have set at /auth/local/register (pre-account hijacking)',
  },
  async () => {
    const preRegistered = { ...USER, confirmed: false, password: 'attacker-chosen-hash' };
    const { magicLinkService, state } = createLoginCoreStrapi({
      users: [preRegistered],
      advanced: { default_role: 'authenticated', allow_register: true, email_confirmation: true },
    });
    const token = await magicLinkService.createToken(USER.email);
    const ctx = createCtx({ query: { loginToken: token._plaintextToken } });
    await auth.login(ctx);

    const user = state.users[0];
    const handedOver = user.confirmed === true && user.password === 'attacker-chosen-hash';
    assert.equal(handedOver, false, 'account confirmed while the foreign password stays valid');
  }
);

test(
  'revocation middleware never locks admins out of plugin admin routes',
  {
    todo: 'middlewares/jwt-revocation.js skips only /admin/*; Strapi 5 serves plugin admin APIs at /<plugin>/... (e.g. /content-manager, /magic-link), so a store failure answers 503 to admin requests',
  },
  async () => {
    const strapi = {
      plugin: () => ({
        service: () => ({
          isJwtTokenBlocked: async () => {
            throw new Error('store down');
          },
        }),
      }),
      log: { error() {} },
    };
    const middleware = createJwtRevocationMiddleware({ strapi });
    const ctx = {
      path: '/content-manager/init',
      request: { header: { authorization: 'Bearer synthetic.admin.jwt' } },
    };
    let reachedNext = false;
    await middleware(ctx, async () => {
      reachedNext = true;
    });
    assert.equal(reachedNext, true, `admin request answered ${ctx.status}`);
  }
);
