'use strict';

/**
 * Independent adversarial re-attack (2026-11-07) of the hardened branch.
 * Each test reproduces one confirmed finding as a hostile client or as a
 * low-privilege admin. Synthetic data only: example.test addresses,
 * 203.0.113.x addresses, fake JWT strings, no network except a loopback Koa
 * server, no real mail.
 *
 * Installed sources checked: @koa/router 12.0.2 (Strapi 5.61 routers are
 * created with default options, `sensitive: false`), @strapi/core 5.61
 * dist/services/server/api.js and routing.js, rate-limiter-flexible 11.
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const Koa = require('koa');
const Router = require('@koa/router');

const { useTestSecrets } = require('./helpers/mfa-strapi.cjs');
const { createSessionTable } = require('./helpers/session-table.cjs');

useTestSecrets();

const {
  createJwtRevocationMiddleware,
  isContentApiPath,
} = require('../server/src/middlewares/jwt-revocation');
const createRateLimiter = require('../server/src/services/rate-limiter');
const settingsController = require('../server/src/controllers/controller');
const jwtController = require('../server/src/controllers/jwt');
const rateLimitController = require('../server/src/controllers/rate-limit');
const { CLAIM_REASON } = require('../server/src/utils/account-claim');
const { createDefaultSettings } = require('../server/src/utils/default-settings');

const REVOKED_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6N30.revoked-synthetic-signature';
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

// ─────────── HIGH: revocation bypass through a case-variant path ───────────

/**
 * Strapi double whose revocation service blocks exactly REVOKED_JWT.
 *
 * @returns {object} Strapi double.
 */
const revocationStrapi = () => ({
  config: { get: (_key, fallback) => fallback },
  log: silentLog,
  plugin: () => ({
    service: () => ({ isJwtTokenBlocked: async (token) => token === REVOKED_JWT }),
  }),
});

/**
 * Sends one GET request to a loopback server.
 *
 * @param {number} port - Server port.
 * @param {string} path - Raw request path.
 * @returns {Promise<{status: number, body: string}>} Response.
 */
const get = (port, path) =>
  new Promise((resolve, reject) => {
    http
      .get(
        { host: '127.0.0.1', port, path, headers: { authorization: `Bearer ${REVOKED_JWT}` } },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        }
      )
      .on('error', reject);
  });

test('a revoked JWT is rejected on case-variant Content API paths that the router still serves', async (t) => {
  // Same router setup as @strapi/core 5.61 createAPI: new Router({ prefix }).
  const app = new Koa();
  app.use(createJwtRevocationMiddleware({ strapi: revocationStrapi() }));
  const api = new Router({ prefix: '/api' });
  api.get('/users/me', (ctx) => {
    ctx.body = 'protected-data';
  });
  app.use(api.routes());
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const { port } = server.address();

  for (const path of ['/api/users/me', '/API/users/me', '/Api/users/me', '/aPI/users/me/']) {
    const response = await get(port, path);
    assert.equal(response.status, 401, `${path} must be checked`);
    assert.equal(response.body.includes('protected-data'), false, `${path} must not leak data`);
  }
});

test('the Content API path check ignores case like the routers; admin paths stay skipped', () => {
  const strapi = revocationStrapi();
  for (const path of ['/API', '/API/users/me', '/Api/x', '/GRAPHQL', '/GraphQL/x']) {
    assert.equal(isContentApiPath(strapi, path), true, path);
  }
  for (const path of ['/ADMIN/users/me', '/Admin', '/content-manager/x', '/magic-link/tokens']) {
    assert.equal(isContentApiPath(strapi, path), false, path);
  }
  const custom = {
    config: {
      get: (key, fallback) => (key === 'api.rest.prefix' ? '/V1/Rest' : fallback),
    },
  };
  assert.equal(isContentApiPath(custom, '/v1/rest/users/me'), true);
  assert.equal(isContentApiPath(custom, '/V1/REST/users/me'), true);
});

// ─────── MEDIUM: low-privilege admin resets the always-on code limiter ───────

/**
 * Rate limiter backed by a mutable settings object.
 *
 * @param {object} settings - Stored plugin settings (mutated by the test).
 * @returns {object} Rate-limiter service.
 */
const limiterWith = (settings) =>
  createRateLimiter({
    strapi: {
      store: () => ({ get: async () => settings }),
      config: { get: () => undefined },
      log: silentLog,
    },
  });

const exhaustVerify = async (service, key) => {
  for (let i = 0; i < createRateLimiter.VERIFY_LIMIT.points; i += 1) {
    assert.equal((await service.checkRateLimit(key, 'verify')).allowed, true);
  }
  assert.equal((await service.checkRateLimit(key, 'verify')).allowed, false);
};

test('the admin rate-limit reset does not clear the always-on code-check limiter', async () => {
  const service = limiterWith({ rate_limit_enabled: true, rate_limit_max_attempts: 1 });
  const key = 'verify:up:7';
  await exhaustVerify(service, key);
  assert.equal((await service.checkRateLimit('203.0.113.7', 'ip')).allowed, true);
  assert.equal((await service.checkRateLimit('203.0.113.7', 'ip')).allowed, false);

  await service.resetAll();

  assert.equal(
    (await service.checkRateLimit(key, 'verify')).allowed,
    false,
    'code guessing must stay blocked after an admin reset'
  );
  assert.equal(
    (await service.checkRateLimit('203.0.113.7', 'ip')).allowed,
    true,
    'the public limiters are still reset'
  );
});

test('changing the public rate-limit values does not clear the code-check limiter', async () => {
  const settings = { rate_limit_enabled: true, rate_limit_max_attempts: 5 };
  const service = limiterWith(settings);
  const key = 'verify:totp-login:synthetic';
  await exhaustVerify(service, key);

  for (const value of [6, 7, 8]) {
    settings.rate_limit_max_attempts = value;
    await service.reloadSettings();
    assert.equal((await service.checkRateLimit(key, 'verify')).allowed, false, `after ${value}`);
  }
});

// ─────── MEDIUM: settings.update alone weakens code and rate-limit rules ───────

/**
 * Global Strapi double for the settings controller.
 *
 * @param {object} [stored] - Stored settings overrides.
 * @returns {{values: Map}} Store contents.
 */
const settingsEnv = (stored = {}) => {
  const values = new Map([['settings', { ...createDefaultSettings(), ...stored }]]);
  global.strapi = {
    store: () => ({
      get: async ({ key }) => values.get(key),
      set: async ({ key, value }) => values.set(key, value),
      delete: async ({ key }) => values.delete(key),
    }),
    config: { get: (_key, fallback) => fallback },
    db: { query: () => ({ deleteMany: async () => ({ count: 0 }) }) },
    plugin: () => undefined,
    log: silentLog,
  };
  return { values };
};

const UPDATE = 'plugin::magic-link.settings.update';
const SECURITY = 'plugin::magic-link.settings.security';

const adminCtx = (body, actions = [UPDATE]) => ({
  state: { user: { id: 3 }, userAbility: { can: (action) => actions.includes(action) } },
  request: { body },
  send(payload) {
    this.response = payload;
    return payload;
  },
  throw(status, error) {
    throw error || new Error(String(status));
  },
});

test('settings.update alone cannot weaken e-mail codes, TOTP parameters or rate limits', async (t) => {
  const weakening = {
    otp_length: 4,
    otp_expiry: 86_400,
    otp_max_attempts: 20,
    otp_resend_cooldown: 0,
    totp_digits: 8,
    totp_period: 300,
    totp_algorithm: 'SHA512',
    rate_limit_enabled: false,
    rate_limit_max_attempts: 1_000,
    rate_limit_window_minutes: 1,
    rate_limit_login_max_attempts: 1_000,
    rate_limit_login_window_minutes: 1,
    rate_limit_login_block_minutes: 1,
  };
  for (const [key, value] of Object.entries(weakening)) {
    await t.test(key, async () => {
      const { values } = settingsEnv();
      const before = JSON.stringify(values.get('settings'));
      await assert.rejects(
        settingsController.updateSettings(adminCtx({ [key]: value })),
        (error) => {
          // PolicyError keeps message and details in Strapi's 403 response.
          assert.equal(error.name, 'PolicyError');
          assert.equal(error.details.key, 'settings.security.forbidden');
          assert.ok(error.details.fields.includes(key));
          return true;
        }
      );
      assert.equal(JSON.stringify(values.get('settings')), before, 'nothing was written');
    });
  }

  await t.test('settings.security may change them', async () => {
    const { values } = settingsEnv();
    await settingsController.updateSettings(
      adminCtx({ otp_length: 8, rate_limit_max_attempts: 3 }, [UPDATE, SECURITY])
    );
    assert.equal(values.get('settings').otp_length, 8);
    assert.equal(values.get('settings').rate_limit_max_attempts, 3);
  });

  await t.test('unchanged values still pass for settings.update', async () => {
    const { values } = settingsEnv();
    const defaults = createDefaultSettings();
    await settingsController.updateSettings(
      adminCtx({
        otp_length: defaults.otp_length,
        rate_limit_enabled: defaults.rate_limit_enabled,
        // Sender identity is a security setting since the 2026-11-07 follow-up.
        object: 'Sign in to Example Shop',
      })
    );
    assert.equal(values.get('settings').object, 'Sign in to Example Shop');
  });
});

test('a data reset needs settings.security; a security admin resets everything but MFA', async () => {
  const hardened = {
    frontend_url: 'https://app.example.test',
    createUserIfNotExists: false,
    verify_email: true,
    context_whitelist: ['locale'],
    rate_limit_max_attempts: 2,
    otp_max_attempts: 1,
    mfa_mode: 'required',
    mfa_require_totp: true,
    from_name: 'Example Shop',
  };
  const { values } = settingsEnv(hardened);
  const before = JSON.stringify(values.get('settings'));

  // The reset deletes tokens, sessions and IP bans (2026-11-07 follow-up).
  await assert.rejects(
    settingsController.resetData(adminCtx({ confirm: 'RESET' })),
    (error) => error.name === 'PolicyError' && error.details.key === 'settings.security.forbidden'
  );
  assert.equal(JSON.stringify(values.get('settings')), before, 'nothing was reset');

  // A security admin still resets them (MFA kept unless resetSecurity).
  settingsEnv(hardened);
  const securityCtx = adminCtx({ confirm: 'RESET' }, [UPDATE, SECURITY]);
  await settingsController.resetData(securityCtx);
  const reset = global.strapi.store().get({ key: 'settings' });
  const resetSettings = await reset;
  assert.equal(resetSettings.frontend_url, '');
  assert.equal(resetSettings.createUserIfNotExists, createDefaultSettings().createUserIfNotExists);
  assert.equal(resetSettings.mfa_mode, 'required');
});

// ─────── LOW: restoring a session that an account claim ended ───────

test('a session ended by an account claim cannot be restored', async () => {
  const sessions = [
    {
      id: 'session_claimed',
      userId: 7,
      jwtTokenHash: 'synthetic-hash',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      isRevoked: true,
      revokeReason: CLAIM_REASON,
    },
  ];
  const table = createSessionTable();
  table.seed(sessions);
  let unblocked = 0;
  global.strapi = {
    db: { query: () => table.query },
    plugin: () => ({
      service: () => ({
        unblockJwtTokenByHash: async () => {
          unblocked += 1;
        },
      }),
    }),
    log: silentLog,
  };
  const ctx = {
    state: { user: { id: 3 } },
    request: { body: { sessionId: 'session_claimed' } },
    badRequest(message) {
      this.status = 400;
      this.message = message;
      return message;
    },
    notFound() {
      this.status = 404;
    },
    send(payload) {
      this.response = payload;
    },
    throw(status) {
      throw new Error(String(status));
    },
  };

  await jwtController.unrevokeToken(ctx);

  assert.equal(ctx.status, 400);
  assert.match(ctx.message, /account claim/);
  assert.equal(unblocked, 0, 'the block stays in place');
});

// ─────── LOW: limiter errors in admin logs and responses ───────

test('rate-limit admin errors are neither logged nor returned with their details', async (t) => {
  const secret = 'redis://user:synthetic-password@203.0.113.9:6379';
  for (const action of ['getStats', 'cleanup', 'reset']) {
    await t.test(action, async () => {
      const logs = [];
      global.strapi = {
        plugin: () => ({
          service: () => {
            const fail = async () => {
              throw new Error(secret);
            };
            return { getStats: fail, cleanupExpired: fail, resetAll: fail };
          },
        }),
        log: {
          error: (...args) => logs.push(args.map(String).join(' ')),
        },
      };
      let thrown;
      const ctx = {
        send() {},
        badRequest() {},
        throw(status, message) {
          thrown = { status, message };
          throw new Error('thrown');
        },
      };
      await assert.rejects(rateLimitController[action](ctx));
      assert.equal(thrown.status, 500);
      assert.equal(String(thrown.message).includes('synthetic-password'), false);
      assert.equal(logs.join('\n').includes('synthetic-password'), false);
    });
  }
});
