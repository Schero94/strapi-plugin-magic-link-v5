'use strict';

/**
 * Adversarial security review, open items: behavioural tests written before
 * the fixes (refresh-family revocation, access tokens after a refresh,
 * pre-account hijacking, settings.security RBAC, legacy non-expiring JWTs,
 * MFA policy changes during a pending challenge, IPv6 /64 bans, no-store
 * headers and localised built-in mails). Synthetic data only: example.test
 * addresses, 203.0.113.x / 2001:db8::/32 addresses, no network, no real mail.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const { useTestSecrets } = require('./helpers/mfa-strapi.cjs');

useTestSecrets();

const auth = require('../server/src/controllers/auth');
const jwtController = require('../server/src/controllers/jwt');
const otpController = require('../server/src/controllers/otp');
const totpController = require('../server/src/controllers/totp');
const settingsController = require('../server/src/controllers/controller');
const createMagicLinkService = require('../server/src/services/magic-link');
const createOtpService = require('../server/src/services/otp');
const lifecycle = require('../server/src/utils/lifecycle');
const cryptoUtils = require('../server/src/utils/crypto');
const { createDefaultSettings } = require('../server/src/utils/default-settings');
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
 * Session manager double with the semantics of @strapi/core 5.61
 * dist/services/session-manager.js (OriginSessionManager): rotation creates
 * a child with a new sessionId and the same deviceId and marks the parent
 * `rotated`; revokeSessionById deletes exactly one record;
 * invalidateRefreshToken(userId, deviceId) deletes every record of that
 * user (and device when given); isSessionActive only checks existence and
 * the idle expiry (not the status).
 *
 * @returns {object} Session manager plus its records.
 */
const createRotatingSessionManager = () => {
  const records = new Map();
  const calls = { isSessionActive: 0, invalidate: [] };
  let counter = 0;
  const create = (userId, deviceId, parent) => {
    counter += 1;
    const sessionId = `sid-${counter}`;
    records.set(sessionId, { userId, deviceId, sessionId, status: 'active', childId: null });
    if (parent) Object.assign(records.get(parent), { status: 'rotated', childId: sessionId });
    return sessionId;
  };
  const access = (record) =>
    fakeJwt({ userId: String(record.userId), sessionId: record.sessionId, type: 'access' }, '10m');
  return {
    records,
    calls,
    generateRefreshToken: async (userId, deviceId) => {
      const sessionId = create(userId, deviceId);
      return {
        token: `refresh:${sessionId}`,
        sessionId,
        absoluteExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
    },
    generateAccessToken: async (refreshToken) => {
      const record = records.get(refreshToken.split(':')[1]);
      if (!record || record.status !== 'active') return { error: 'invalid_refresh_token' };
      return { token: access(record) };
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
      calls.invalidate.push({ userId, deviceId });
      for (const [id, record] of records) {
        if (record.userId === userId && (!deviceId || record.deviceId === deviceId)) {
          records.delete(id);
        }
      }
    },
    isSessionActive: async (sessionId) => {
      calls.isSessionActive += 1;
      return records.has(sessionId);
    },
  };
};

/**
 * Logs USER in through the magic link in refresh mode.
 *
 * @param {object} env - createLoginCoreStrapi() result.
 * @param {object} [body] - Extra login body fields (deviceId).
 * @returns {Promise<object>} Login response body.
 */
const refreshLogin = async (env, body = {}) => {
  const token = await env.magicLinkService.createToken(USER.email);
  const ctx = createCtx({ method: 'POST', body: { loginToken: token._plaintextToken, ...body } });
  await auth.login(ctx);
  assert.ok(ctx.body?.jwt, 'login succeeded');
  return ctx.body;
};

const refreshEnv = () => {
  const env = createLoginCoreStrapi({ users: [USER] });
  env.setConfig('plugin::users-permissions.jwtManagement', 'refresh');
  const manager = createRotatingSessionManager();
  env.strapi.sessionManager = () => manager;
  return { ...env, manager };
};

const runMiddleware = async (strapi, token, path = '/api/users/me') => {
  const ctx = { path, request: { header: { authorization: `Bearer ${token}` } } };
  let reachedNext = false;
  await createJwtRevocationMiddleware({ strapi })(ctx, async () => {
    reachedNext = true;
  });
  return { ctx, reachedNext };
};

const revokeRecord = async (sessionRecordId) => {
  const ctx = createCtx({ method: 'POST', body: { sessionId: sessionRecordId } });
  ctx.notFound = () => assert.fail('session must exist');
  ctx.throw = (status) => assert.fail(`revoke failed with ${status}`);
  await jwtController.revokeToken(ctx);
  assert.equal(ctx.body.success, true);
};

// ─────────────── HIGH: refresh family revocation ───────────────

test('refresh mode: revocation ends every rotated token of the family but no other device', async () => {
  const env = refreshEnv();
  const { manager, state } = env;
  const first = await refreshLogin(env);
  const other = await refreshLogin(env, { deviceId: 'device-other' });

  const rotated = await manager.rotateRefreshToken(first.refreshToken);
  const rotatedTwice = await manager.rotateRefreshToken(rotated.token);
  assert.ok(rotatedTwice.token);

  await revokeRecord(state.stores['magic-link'].jwt_sessions.sessions[0].id);

  assert.ok('error' in (await manager.generateAccessToken(rotatedTwice.token)));
  assert.ok('error' in (await manager.rotateRefreshToken(rotatedTwice.token)));
  const sibling = await manager.generateAccessToken(other.refreshToken);
  assert.ok(sibling.token, 'a login on another device stays valid');
  assert.ok(
    manager.calls.invalidate.every((call) => call.deviceId),
    'revocation never wipes all devices of the user'
  );
});

test('refresh mode: access tokens minted from rotated children are rejected after revocation', async () => {
  const env = refreshEnv();
  const { manager, state, strapi } = env;
  const first = await refreshLogin(env);
  const rotated = await manager.rotateRefreshToken(first.refreshToken);
  const { token: childAccess } = await manager.generateAccessToken(rotated.token);

  // Before revocation the child access token passes.
  assert.equal((await runMiddleware(strapi, childAccess)).reachedNext, true);

  await revokeRecord(state.stores['magic-link'].jwt_sessions.sessions[0].id);

  const { ctx, reachedNext } = await runMiddleware(strapi, childAccess);
  assert.equal(reachedNext, false, 'child access token of a revoked family is accepted');
  assert.equal(ctx.status, 401);
});

test('refresh mode: the session check only runs for users with a revoked family', async () => {
  const env = refreshEnv();
  const { manager, strapi } = env;
  const login = await refreshLogin(env);

  const before = manager.calls.isSessionActive;
  const { reachedNext } = await runMiddleware(strapi, login.jwt);
  assert.equal(reachedNext, true);
  assert.equal(manager.calls.isSessionActive, before, 'no per-request lookup without revocations');
});

test('refresh mode: an unknown session state fails closed on the Content API only', async () => {
  const env = refreshEnv();
  const { manager, state, strapi } = env;
  const first = await refreshLogin(env);
  const second = await refreshLogin(env, { deviceId: 'device-b' });
  await revokeRecord(state.stores['magic-link'].jwt_sessions.sessions[0].id);

  manager.isSessionActive = async () => {
    throw new Error('session table unavailable');
  };
  const api = await runMiddleware(strapi, second.jwt);
  assert.equal(api.reachedNext, false);
  assert.equal(api.ctx.status, 503);

  const admin = await runMiddleware(strapi, first.jwt, '/content-manager/init');
  assert.equal(admin.reachedNext, true, 'admin routes are never answered with 503');
  const adminApi = await runMiddleware(strapi, first.jwt, '/admin/users/me');
  assert.equal(adminApi.reachedNext, true);
});

// ─────────────── LOW: legacy non-expiring JWTs ───────────────

test('legacy mode: revoking a JWT without exp claim never lapses', async () => {
  const env = createLoginCoreStrapi({ users: [USER] });
  // users-permissions configured without expiresIn: the JWT has no exp.
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const nonExpiring = `${b64({ alg: 'HS256' })}.${b64({ id: USER.id, iat: 1 })}.sig-legacy`;
  const original = env.strapi.plugin.bind(env.strapi);
  env.strapi.plugin = (name) =>
    name === 'users-permissions'
      ? {
          service: (key) =>
            key === 'jwt' ? { issue: () => nonExpiring } : original(name).service(key),
        }
      : original(name);

  const token = await env.magicLinkService.createToken(USER.email);
  const ctx = createCtx({ method: 'POST', body: { loginToken: token._plaintextToken } });
  await auth.login(ctx);
  assert.equal(ctx.body.jwt, nonExpiring);
  const record = env.state.stores['magic-link'].jwt_sessions.sessions[0];
  await revokeRecord(record.id);

  const realNow = Date.now;
  Date.now = () => realNow() + 3 * 365 * 24 * 60 * 60 * 1000;
  try {
    const fresh = createMagicLinkService({ strapi: env.strapi });
    assert.equal(await fresh.isJwtTokenBlocked(nonExpiring), true, 'revocation lapsed');
  } finally {
    Date.now = realNow;
  }

  // The raw-token path keeps a non-expiring token blocked as well.
  const other = `${b64({ alg: 'HS256' })}.${b64({ id: 99 })}.sig-other`;
  await env.magicLinkService.blockJwtToken(other, 99, 'test');
  const entry = env.state.stores['magic-link'].blocked_jwt_tokens.tokens.find(
    (candidate) => candidate.tokenHash === cryptoUtils.hashJwt(other)
  );
  assert.equal(entry.permanent, true);
});

// ─────────────── MEDIUM: pre-account hijacking ───────────────

test('pre-account hijacking: claiming an unconfirmed account clears the foreign password and ends sessions', async (t) => {
  for (const mode of ['legacy-support', 'refresh']) {
    await t.test(mode, async () => {
      const preRegistered = {
        ...USER,
        confirmed: false,
        password: 'attacker-chosen-hash',
        resetPasswordToken: 'attacker-reset',
      };
      const env = createLoginCoreStrapi({
        users: [preRegistered],
        advanced: { default_role: 'authenticated', allow_register: true, email_confirmation: true },
      });
      env.setConfig('plugin::users-permissions.jwtManagement', mode);
      const manager = createRotatingSessionManager();
      // A refresh family that existed before the owner claimed the account.
      await manager.generateRefreshToken(String(USER.id), 'attacker-device');
      if (mode === 'refresh') env.strapi.sessionManager = () => manager;
      // A plugin session issued before the claim (legacy audit record).
      const oldJwt = fakeJwt({ id: USER.id }, '2h');
      env.state.stores['magic-link'].jwt_sessions = {
        sessions: [
          {
            id: 'session_old',
            userId: USER.id,
            jwtTokenHash: cryptoUtils.hashJwt(oldJwt),
            jwtManagement: 'legacy-support',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7200000).toISOString(),
            isRevoked: false,
          },
        ],
      };

      const token = await env.magicLinkService.createToken(USER.email);
      const ctx = createCtx({ method: 'POST', body: { loginToken: token._plaintextToken } });
      await auth.login(ctx);
      assert.ok(ctx.body.jwt, 'the mailbox owner is logged in');

      const user = env.state.users[0];
      assert.equal(user.confirmed, true);
      assert.equal(user.password, null, 'the foreign password stays usable');
      assert.equal(user.resetPasswordToken, null);
      assert.equal(await env.magicLinkService.isJwtTokenBlocked(oldJwt), true);
      if (mode === 'refresh') {
        assert.ok(
          manager.calls.invalidate.some(
            (call) => call.userId === String(USER.id) && call.deviceId === undefined
          ),
          'existing refresh families of the account are ended'
        );
        assert.equal(
          [...manager.records.values()].some((record) => record.deviceId === 'attacker-device'),
          false
        );
      }
      const current = env.state.stores['magic-link'].jwt_sessions.sessions.find(
        (record) => record.jwtTokenHash === cryptoUtils.hashJwt(ctx.body.jwt)
      );
      assert.ok(current && !current.isRevoked, 'the new session stays valid');
      assert.equal(await env.magicLinkService.isJwtTokenBlocked(ctx.body.jwt), false);
    });
  }
});

test('pre-account hijacking: confirmed accounts keep their password', async () => {
  const env = createLoginCoreStrapi({ users: [{ ...USER, password: 'owner-hash' }] });
  const token = await env.magicLinkService.createToken(USER.email);
  const ctx = createCtx({ method: 'POST', body: { loginToken: token._plaintextToken } });
  await auth.login(ctx);
  assert.equal(env.state.users[0].password, 'owner-hash');
  assert.deepEqual(env.state.edits, []);
});

// ─────────────── MEDIUM: settings.security ───────────────

const settingsEnv = (stored = {}) => {
  const values = new Map([['settings', { ...createDefaultSettings(), ...stored }]]);
  const logs = [];
  global.strapi = {
    store: () => ({
      get: async ({ key }) => values.get(key),
      set: async ({ key, value }) => values.set(key, value),
      delete: async ({ key }) => values.delete(key),
    }),
    config: { get: (_key, fallback) => fallback },
    db: { query: () => ({ deleteMany: async () => ({ count: 0 }) }) },
    plugin: () => undefined,
    log: Object.fromEntries(
      ['info', 'warn', 'error', 'debug'].map((level) => [level, (msg) => logs.push(msg)])
    ),
  };
  return { values, logs };
};

const adminCtx = (body, actions = ['plugin::magic-link.settings.update']) => ({
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

test('settings.security is a registered RBAC action with a subCategory', () => {
  const action = lifecycle.RBAC_ACTIONS.find((candidate) => candidate.uid === 'settings.security');
  assert.ok(action, 'settings.security is registered');
  assert.equal(action.subCategory, 'Settings');
  assert.equal(action.pluginName, 'magic-link');
});

test('settings.update alone cannot redirect login links or weaken identity rules', async (t) => {
  const changes = {
    frontend_url: 'https://attacker.example.test',
    confirmationUrl: 'https://attacker.example.test/login',
    message_html: '<a href="https://attacker.example.test/?t={{CODE}}">x</a>',
    createUserIfNotExists: false,
    mfa_mode: 'optional',
    otp_strict_binding: false,
    jwt_token_expires_in: '365d',
    context_whitelist: ['role'],
  };
  for (const [key, value] of Object.entries(changes)) {
    await t.test(key, async () => {
      const { values } = settingsEnv();
      const before = JSON.stringify(values.get('settings'));
      await assert.rejects(settingsController.updateSettings(adminCtx({ [key]: value })), {
        name: 'ForbiddenError',
      });
      assert.equal(JSON.stringify(values.get('settings')), before, 'nothing was written');
    });
  }
});

test('settings.update keeps working for unchanged security fields and harmless fields', async () => {
  const { values } = settingsEnv();
  // The admin UI sends back the whole form it received.
  const readCtx = adminCtx(undefined, ['plugin::magic-link.settings.read']);
  global.strapi.config = { get: (_key, fallback) => fallback };
  await settingsController.getSettings(readCtx);
  const form = { ...readCtx.response.settings, from_name: 'Example Shop', otp_length: 8 };

  await settingsController.updateSettings(adminCtx(form));
  assert.equal(values.get('settings').from_name, 'Example Shop');
  assert.equal(values.get('settings').otp_length, 8);
});

test('settings.security may change security fields; URLs must match allowedLinkOrigins when set', async () => {
  const both = ['plugin::magic-link.settings.update', 'plugin::magic-link.settings.security'];
  const { values } = settingsEnv();
  await settingsController.updateSettings(
    adminCtx({ frontend_url: 'https://app.example.test', mfa_mode: 'required' }, both)
  );
  assert.equal(values.get('settings').frontend_url, 'https://app.example.test');
  assert.equal(values.get('settings').mfa_mode, 'required');

  global.strapi.config = {
    get: (key, fallback) =>
      key === 'plugin::magic-link.allowedLinkOrigins' ? ['https://app.example.test'] : fallback,
  };
  await assert.rejects(
    settingsController.updateSettings(
      adminCtx({ confirmationUrl: 'https://attacker.example.test/login' }, both)
    ),
    { name: 'ValidationError' }
  );
  await settingsController.updateSettings(
    adminCtx({ confirmationUrl: 'https://app.example.test/auth/login' }, both)
  );
  assert.equal(values.get('settings').confirmationUrl, 'https://app.example.test/auth/login');
});

test('resetting the MFA settings needs settings.security', async () => {
  settingsEnv({ mfa_mode: 'required', mfa_require_totp: true });
  await assert.rejects(
    settingsController.resetData(adminCtx({ confirm: 'RESET', resetSecurity: true })),
    { name: 'ForbiddenError' }
  );
});

// ─────────────── LOW: MFA policy re-check at completion ───────────────

test('a pending e-mail OTP challenge is upgraded when MFA became required meanwhile', async () => {
  const env = createLoginCoreStrapi({ users: [USER], settings: { otp_enabled: true } });
  const token = await env.magicLinkService.createToken(USER.email);
  const first = createCtx({ method: 'POST', body: { loginToken: token._plaintextToken } });
  await auth.login(first);
  assert.equal(first.body.requiresOTP, true);

  env.state.stores['magic-link'].settings.mfa_mode = 'required';
  const again = createCtx({ method: 'POST', body: { loginToken: token._plaintextToken } });
  await auth.login(again);
  assert.equal(again.body.requiresTOTPSetup, true, 'the weaker challenge is still served');
  assert.equal(env.state.tokens[0].challenge.type, 'totp-setup');
});

test('OTP verification refuses to complete a challenge that the current MFA policy no longer allows', async () => {
  const env = createLoginCoreStrapi({ users: [USER], settings: { otp_enabled: true } });
  const token = await env.magicLinkService.createToken(USER.email);
  const login = createCtx({ method: 'POST', body: { loginToken: token._plaintextToken } });
  await auth.login(login);
  assert.equal(login.body.requiresOTP, true);

  env.state.stores['magic-link'].settings.mfa_mode = 'required';
  const base = env.strapi.plugin.bind(env.strapi);
  env.strapi.plugin = (name) => {
    if (name !== 'magic-link') return base(name);
    return {
      service: (key) => {
        const service = base(name).service(key);
        if (key !== 'otp') return service;
        return {
          ...service,
          getOTPSettings: async () => ({ enabled: true, expiry: 300, length: 6 }),
          verifyOTP: async () => ({ valid: true }),
        };
      },
    };
  };
  const ctx = createCtx({
    method: 'POST',
    body: { email: USER.email, code: '654321', magicLinkToken: token._plaintextToken },
  });
  ctx.badRequest = (message) => {
    ctx.status = 400;
    ctx.body = { error: message };
  };
  ctx.tooManyRequests = () => assert.fail('not rate limited');
  await otpController.verify(ctx);
  assert.equal(ctx.status, 400);
  assert.equal(ctx.body.jwt, undefined, 'a session was issued below the current MFA policy');
  assert.equal(env.state.tokens[0].is_used, false, 'the link stays usable for the new challenge');
});

// ─────────────── LOW: IPv6 bans per /64 ───────────────

test('IPv6 bans cover the same /64 that rate limits use', async () => {
  const service = createMagicLinkService({
    strapi: {
      store: () => ({ get: async () => ({ ips: ['2001:db8:0:5::1', '203.0.113.7'] }) }),
      log: { error() {} },
    },
  });
  assert.equal(await service.isIPBanned('2001:db8:0:5::1'), true);
  assert.equal(await service.isIPBanned('2001:db8:0:5:ffff::42'), true, 'same /64 is banned');
  assert.equal(await service.isIPBanned('2001:db8:0:6::1'), false, 'other /64 is not');
  assert.equal(await service.isIPBanned('203.0.113.7'), true);
  assert.equal(await service.isIPBanned('203.0.113.8'), false, 'IPv4 stays exact');
});

// ─────────────── LOW: Cache-Control on every auth response ───────────────

test('every TOTP, OTP and login endpoint answers with Cache-Control: no-store', async (t) => {
  const env = createLoginCoreStrapi({ users: [USER] });
  const asUser = (body) => {
    const ctx = createCtx({ method: 'POST', body });
    ctx.state = { user: { ...USER }, auth: { strategy: { name: 'users-permissions' } } };
    ctx.badRequest = () => {};
    ctx.tooManyRequests = () => {};
    return ctx;
  };
  const base = env.strapi.plugin.bind(env.strapi);
  env.strapi.plugin = (name) =>
    name !== 'magic-link'
      ? base(name)
      : {
          service: (key) =>
            key === 'otp'
              ? {
                  ...base(name).service('otp'),
                  getOTPSettings: async () => ({ enabled: false }),
                  getTOTPStatus: async () => ({ configured: false, enabled: false }),
                }
              : base(name).service(key),
        };
  let seen;
  const capture = (body) => {
    seen = asUser(body);
    return seen;
  };
  const handlers = {
    'totp.status': () => totpController.status(capture()),
    'totp.disable': () => totpController.disable(capture({ totpCode: '123456' })),
    'otp.send': () => otpController.send(capture({ email: USER.email })),
    'otp.resend': () => otpController.resend(capture({ email: USER.email })),
    'auth.sendLink': () => auth.sendLink(capture({ email: USER.email })),
  };
  for (const [name, run] of Object.entries(handlers)) {
    await t.test(name, async () => {
      await run();
      assert.equal(seen.responseHeaders['Cache-Control'], 'no-store', name);
    });
  }
});

// ─────────────── FUN-27: localised built-in mails ───────────────

test('built-in OTP and welcome mails are translated for every supported locale', async (t) => {
  const expected = {
    de: 'Bestätigungscode',
    en: 'verification code',
    es: 'código de verificación',
    fr: 'code de vérification',
    pt: 'código de verificação',
  };
  for (const [locale, phrase] of Object.entries(expected)) {
    await t.test(locale, async () => {
      const mails = [];
      const strapi = {
        store: () => ({ get: async () => ({}) }),
        config: { get: (_key, fallback) => fallback },
        plugin: (name) =>
          name === 'email' ? { service: () => ({ send: async (mail) => mails.push(mail) }) } : null,
        log: { info() {}, warn() {}, error() {}, debug() {} },
      };
      const otp = createOtpService({ strapi });
      await otp.sendOTPEmail('person@example.test', '123456', { expiryMinutes: 5, locale });
      assert.match(mails[0].subject.toLowerCase(), new RegExp(phrase.toLowerCase()));
      assert.match(mails[0].text, /123456/);

      const magicLink = createMagicLinkService({ strapi });
      await magicLink.sendWelcomeEmail(
        { email: 'person@example.test', username: 'person' },
        { from_name: 'Example' },
        locale
      );
      assert.match(mails[1].subject, /Example/);
      if (locale !== 'en') assert.notEqual(mails[1].subject, 'Welcome to Example');
      assert.match(mails[1].text, /person/);
    });
  }
});
