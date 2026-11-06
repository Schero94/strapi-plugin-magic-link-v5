'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const auth = require('../server/src/controllers/auth');
const otpController = require('../server/src/controllers/otp');
const createOtpService = require('../server/src/services/otp');
const createMagicLinkService = require('../server/src/services/magic-link');
const cryptoUtils = require('../server/src/utils/crypto');
const speakeasy = require('speakeasy');

const makeContext = (body) => ({
  request: {
    body,
    ip: '127.0.0.1',
    headers: { 'user-agent': 'local-test' },
    header: { 'user-agent': 'local-test' },
  },
  set() {},
  send(payload) {
    this.response = payload;
    return payload;
  },
  badRequest(message) {
    this.status = 400;
    this.response = { error: message };
    return this.response;
  },
  tooManyRequests(message) {
    this.status = 429;
    this.response = { error: message };
    return this.response;
  },
});

test('OTP verification searches only the exact login-token binding', async () => {
  const records = [{
    documentId: 'otp-for-another-login',
    email: 'person@example.test',
    type: 'email',
    used: false,
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
    magicLinkToken: 'hash-for-another-login',
    code: cryptoUtils.hashOTP('731204'),
  }];
  let lookup;
  const store = { get: async () => ({ otp_max_attempts: 3 }) };
  const strapi = {
    store: () => store,
    log: { info() {}, warn() {}, error() {}, debug() {} },
    documents(uid) {
      assert.equal(uid, 'plugin::magic-link.otp-code');
      return {
        findMany: async (query) => {
          lookup = query;
          return records.filter((entry) => {
            const filters = query.filters;
            return entry.email === filters.email
              && entry.type === filters.type
              && entry.used === filters.used
              && entry.expiresAt > filters.expiresAt.$gt
              && entry.magicLinkToken === filters.magicLinkToken;
          });
        },
        update: async () => assert.fail('a foreign login OTP must not be consumed'),
      };
    },
  };
  const service = createOtpService({ strapi });

  const result = await service.verifyOTP(
    'person@example.test',
    '731204',
    'email',
    'hash-for-this-login'
  );

  assert.equal(lookup.filters.magicLinkToken, 'hash-for-this-login');
  assert.equal(result.valid, false);
});

test('OTP code consumption is atomic and a lost race does not verify the code', async () => {
  const record = {
    id: 24,
    documentId: 'otp-doc',
    email: 'person@example.test',
    type: 'email',
    used: false,
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
    magicLinkToken: 'stored-token-hash',
    code: cryptoUtils.hashOTP('731204'),
  };
  let consumeParams;
  const strapi = {
    store: () => ({ get: async () => ({ otp_max_attempts: 3 }) }),
    log: { info() {}, warn() {}, error() {}, debug() {} },
    db: {
      query(uid) {
        assert.equal(uid, 'plugin::magic-link.otp-code');
        return { updateMany: async (params) => {
          consumeParams = params;
          return { count: 0 };
        } };
      },
    },
    documents(uid) {
      assert.equal(uid, 'plugin::magic-link.otp-code');
      return {
        findMany: async () => [record],
        update: async ({ data }) => Object.assign(record, data),
      };
    },
  };
  const service = createOtpService({ strapi });

  const result = await service.verifyOTP(
    'person@example.test',
    '731204',
    'email',
    'stored-token-hash'
  );

  assert.equal(result.valid, false);
  assert.equal(consumeParams.where.id, 24);
  assert.equal(consumeParams.where.used, false);
  assert.equal(consumeParams.where.magicLinkToken, 'stored-token-hash');
  assert.equal(consumeParams.data.used, true);
});

test('the winner of an OTP consumption race verifies the code once', async () => {
  const record = {
    id: 25,
    documentId: 'otp-winner-doc',
    email: 'person@example.test',
    type: 'email',
    used: false,
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
    magicLinkToken: 'stored-token-hash',
    code: cryptoUtils.hashOTP('842615'),
  };
  const strapi = {
    store: () => ({ get: async () => ({ otp_max_attempts: 3 }) }),
    log: { info() {}, warn() {}, error() {}, debug() {} },
    db: {
      query: () => ({ updateMany: async ({ where, data }) => {
        assert.equal(where.id, record.id);
        assert.equal(where.used, false);
        Object.assign(record, data);
        return { count: 1 };
      } }),
    },
    documents(uid) {
      assert.equal(uid, 'plugin::magic-link.otp-code');
      return {
        findMany: async ({ filters }) => record.used === filters.used ? [record] : [],
        update: async ({ data }) => Object.assign(record, data),
      };
    },
  };
  const service = createOtpService({ strapi });

  const result = await service.verifyOTP('person@example.test', '842615', 'email', 'stored-token-hash');

  assert.equal(result.valid, true);
  assert.equal(record.used, true);
});

test('challenge validation accepts only the originating active token and rejects spent challenges', async () => {
  const plaintext = 'bound-login-token-123456';
  const { hash, salt } = cryptoUtils.hashToken(plaintext);
  const record = {
    documentId: 'bound-token-doc',
    email: 'person@example.test',
    token: hash,
    token_salt: salt,
    token_prefix: plaintext.slice(0, 8),
    is_active: true,
    is_used: false,
    expires_at: new Date(Date.now() + 60_000),
    context: { requiresOTP: true, otpVerified: false },
  };
  const strapi = {
    store: () => ({ get: async () => ({ stays_valid: false }) }),
    documents(uid) {
      assert.equal(uid, 'plugin::magic-link.token');
      return {
        findMany: async ({ filters }) => {
          if (filters.token_prefix) {
            return record.is_active && record.token_prefix === filters.token_prefix ? [record] : [];
          }
          return [];
        },
      };
    },
  };
  const service = createMagicLinkService({ strapi });

  const bound = await service.validateBindingForChallenge(plaintext, 'person@example.test', 'otp');
  assert.equal(bound.documentId, 'bound-token-doc');
  assert.equal(await service.validateBindingForChallenge('different-login-token-1234', 'person@example.test', 'otp'), null);
  assert.equal(await service.validateBindingForChallenge(plaintext, 'other@example.test', 'otp'), null);

  record.context.otpVerified = true;
  assert.equal(await service.validateBindingForChallenge(plaintext, 'person@example.test', 'otp'), null);
  record.context.otpVerified = false;
  record.expires_at = new Date(Date.now() - 1_000);
  assert.equal(await service.validateBindingForChallenge(plaintext, 'person@example.test', 'otp'), null);
});

test('challenge consumption is a conditional one-row update and rejects a concurrent replay', async () => {
  const queryCalls = [];
  const strapi = {
    store: () => ({ get: async () => ({ store_login_info: true }) }),
    db: {
      query: (uid) => ({
        updateMany: async (params) => {
          queryCalls.push({ uid, params });
          return { count: queryCalls.length === 1 ? 1 : 0 };
        },
      }),
    },
  };
  const service = createMagicLinkService({ strapi });
  const token = {
    id: 42,
    documentId: 'challenge-doc',
    is_active: true,
    is_used: false,
    expires_at: new Date(Date.now() + 60_000),
    context: { requiresTOTP: true, totpVerified: false, userId: 9 },
  };

  const consumed = await service.consumeChallenge(token, 'totp', {
    ipAddress: '127.0.0.1',
    userAgent: 'local-test',
  });
  const replay = await service.consumeChallenge(token, 'totp');

  assert.equal(consumed, true);
  assert.equal(replay, false);
  assert.equal(queryCalls[0].uid, 'plugin::magic-link.token');
  assert.equal(queryCalls[0].params.where.id, 42);
  assert.equal(queryCalls[0].params.where.is_active, true);
  assert.equal(queryCalls[0].params.where.is_used, false);
  assert.ok(queryCalls[0].params.where.expires_at.$gt instanceof Date);
  assert.equal(queryCalls[0].params.data.is_active, false);
  assert.equal(queryCalls[0].params.data.is_used, true);
  assert.equal(queryCalls[0].params.data.context.totpVerified, true);
  assert.equal(queryCalls[0].params.data.user_agent, 'local-test');
});

test('OTP verification passes the stored token hash to the OTP service and consumes the bound token', async () => {
  const calls = [];
  let consumed = false;
  const boundToken = {
    documentId: 'token-doc',
    token: 'stored-token-hash',
    context: { requiresOTP: true, otpVerified: false },
  };
  const otpService = {
    getOTPSettings: async () => ({ enabled: true, type: 'email' }),
    verifyOTP: async (...args) => {
      calls.push(args);
      return { valid: true };
    },
  };
  const magicLink = {
    validateBindingForChallenge: async (token, email, challenge) => {
      assert.equal(token, 'plaintext-login-token');
      assert.equal(email, 'person@example.test');
      assert.equal(challenge, 'otp');
      return boundToken;
    },
    consumeChallenge: async (token, challenge) => {
      assert.equal(token, boundToken);
      assert.equal(challenge, 'otp');
      consumed = true;
      return true;
    },
  };
  global.strapi = {
    plugin(name) {
      if (name === 'magic-link') {
        return { service: (key) => ({
          otp: otpService,
          'magic-link': magicLink,
          'rate-limiter': { checkRateLimit: async () => ({ allowed: true }) },
        })[key] };
      }
      if (name === 'users-permissions') {
        return { service: () => ({ issue: async () => 'local-jwt' }) };
      }
      throw new Error(`Unexpected plugin ${name}`);
    },
    store: () => ({ get: async () => ({ otp_strict_binding: true, store_login_info: false }) }),
    documents(uid) {
      if (uid === 'plugin::magic-link.token') {
        return { update: async () => {} };
      }
      if (uid === 'plugin::users-permissions.user') {
        return { findMany: async () => [{ id: 9, username: 'person', email: 'person@example.test' }] };
      }
      throw new Error(`Unexpected document ${uid}`);
    },
    log: { info() {}, warn() {}, error() {}, debug() {} },
  };
  const ctx = makeContext({
    email: 'person@example.test',
    code: '731204',
    magicLinkToken: 'plaintext-login-token',
  });

  await otpController.verify(ctx);

  assert.deepEqual(calls, [[
    'person@example.test',
    '731204',
    'email',
    'stored-token-hash',
  ]]);
  assert.equal(consumed, true);
  assert.equal(ctx.response.jwt, 'local-jwt');
});

test('OTP send stores only the exact token hash, never the submitted login token', async () => {
  let createdOptions;
  const otpService = {
    getOTPSettings: async () => ({ enabled: true, type: 'email', expiry: 300, length: 6 }),
    createOTP: async (_email, _type, options) => {
      createdOptions = options;
      return { code: '731204' };
    },
    sendOTPEmail: async () => true,
  };
  const magicLink = {
    validateBindingForChallenge: async () => ({
      token: 'stored-token-hash',
      context: { requiresOTP: true, otpVerified: false },
    }),
  };
  global.strapi = {
    plugin(name) {
      assert.equal(name, 'magic-link');
      return { service: (key) => ({
        otp: otpService,
        'magic-link': magicLink,
        'rate-limiter': { checkRateLimit: async () => ({ allowed: true }) },
      })[key] };
    },
    store: () => ({ get: async () => ({ otp_strict_binding: true }) }),
    log: { info() {}, warn() {}, error() {}, debug() {} },
  };
  const submittedToken = 'plaintext-login-token';
  const ctx = makeContext({ email: 'person@example.test', magicLinkToken: submittedToken });

  await otpController.send(ctx);

  assert.equal(ctx.response.success, true);
  assert.equal(createdOptions.magicLinkToken, 'stored-token-hash');
  assert.notEqual(createdOptions.magicLinkToken, submittedToken);
});

test('invalid OTP request bodies are rejected before plugin services or providers are called', async () => {
  let serviceAccess = 0;
  global.strapi = {
    plugin() {
      serviceAccess += 1;
      throw new Error('invalid input must stop before service access');
    },
    log: { error() {} },
  };
  const ctx = makeContext({ email: 'not-an-email', magicLinkToken: 'short' });

  await otpController.send(ctx);

  assert.equal(ctx.status, 400);
  assert.equal(serviceAccess, 0);
});

test('OTP send rate limits before challenge lookup and code creation', async () => {
  let created = 0;
  let bindingChecks = 0;
  const otpService = {
    getOTPSettings: async () => ({ enabled: true, type: 'email' }),
    createOTP: async () => { created += 1; },
  };
  const magicLink = {
    validateBindingForChallenge: async () => { bindingChecks += 1; return { token: 'hash' }; },
  };
  global.strapi = {
    plugin() {
      return { service: (key) => ({
        otp: otpService,
        'magic-link': magicLink,
        'rate-limiter': { checkRateLimit: async () => ({ allowed: false, retryAfter: 20 }) },
      })[key] };
    },
    log: { info() {}, warn() {}, error() {}, debug() {} },
  };
  const ctx = makeContext({ email: 'person@example.test', magicLinkToken: 'plaintext-login-token' });

  await otpController.send(ctx);

  assert.equal(ctx.status, 429);
  assert.equal(bindingChecks, 0);
  assert.equal(created, 0);
});

test('unsupported SMS and TOTP OTP delivery fails before storing or sending a code', async (t) => {
  for (const type of ['sms', 'totp']) {
    await t.test(type, async () => {
      let created = 0;
      let sent = 0;
      const otpService = {
        getOTPSettings: async () => ({ enabled: true, type, expiry: 300, length: 6 }),
        createOTP: async () => { created += 1; return { code: '731204' }; },
        sendOTPEmail: async () => { sent += 1; },
        sendOTPSMS: async () => { sent += 1; },
      };
      const magicLink = {
        validateBindingForChallenge: async () => ({ token: 'stored-token-hash' }),
      };
      global.strapi = {
        plugin(name) {
          if (name === 'magic-link') {
            return { service: (key) => ({
              otp: otpService,
              'magic-link': magicLink,
              'rate-limiter': { checkRateLimit: async () => ({ allowed: true }) },
            })[key] };
          }
          throw new Error(`Unexpected plugin ${name}`);
        },
        store: () => ({ get: async () => ({ otp_strict_binding: true }) }),
        documents(uid) {
          assert.equal(uid, 'plugin::users-permissions.user');
          return { findMany: async () => [{ phoneNumber: '+49123456789' }] };
        },
        log: { info() {}, warn() {}, error() {}, debug() {} },
      };
      const ctx = makeContext({
        email: 'person@example.test',
        magicLinkToken: 'plaintext-login-token',
      });

      await otpController.send(ctx);

      assert.equal(ctx.status, 503);
      assert.equal(ctx.body.success, false);
      assert.equal(created, 0);
      assert.equal(sent, 0);
    });
  }
});

test('SMS delivery failure does not log the phone number or OTP', async () => {
  const logs = [];
  const strapi = {
    store: () => ({ get: async () => ({}) }),
    log: Object.fromEntries(['info', 'warn', 'error', 'debug'].map((level) => [
      level,
      (...args) => logs.push(args.map(String).join(' ')),
    ])),
  };
  const service = createOtpService({ strapi });
  const phone = '+49123456789';
  const code = '731204';

  await assert.rejects(service.sendOTPSMS(phone, code), (error) => {
    assert.equal(error.code, 'SMS_PROVIDER_UNAVAILABLE');
    return true;
  });

  assert.equal(logs.join('\n').includes(phone), false);
  assert.equal(logs.join('\n').includes(code), false);
});

test('provider errors during OTP email delivery never log the one-time code', async () => {
  const code = '731204';
  const logs = [];
  const strapi = {
    store: () => ({ get: async () => ({ use_magic_mail: true }) }),
    plugin(name) {
      if (name === 'magic-mail') {
        return { service: () => ({ send: async ({ html }) => {
          assert.ok(html.includes(code));
          throw new Error(`provider rejected message containing ${code}`);
        } }) };
      }
      if (name === 'email') return { service: () => ({ send: async () => true }) };
      return undefined;
    },
    log: Object.fromEntries(['info', 'warn', 'error', 'debug'].map((level) => [
      level,
      (...args) => logs.push(args.map(String).join(' ')),
    ])),
  };
  const service = createOtpService({ strapi });

  await service.sendOTPEmail('person@example.test', code);

  assert.equal(logs.join('\n').includes(code), false);
});

const setupTotpLogin = ({ expired = false } = {}) => {
  const now = Date.now();
  const token = {
    documentId: 'totp-token-doc',
    is_active: true,
    expires_at: new Date(now + (expired ? -1_000 : 60_000)),
    context: {
      requiresTOTP: true,
      totpVerified: false,
      userId: 9,
      userDocumentId: 'user-doc',
      redirectTo: '/account',
    },
  };
  const state = { deactivated: 0, issued: 0, verified: 0, contextUpdates: [] };
  const storeValue = { sessions: [] };
  const store = {
    get: async () => storeValue,
    set: async ({ key, value }) => { storeValue[key] = value; },
  };
  const magicLink = {
    fetchToken: async () => ({ ...token, context: { ...token.context } }),
    isTokenValid: async (candidate) => (
      candidate.is_active && new Date(candidate.expires_at).getTime() > Date.now()
    ),
    deactivateToken: async () => { token.is_active = false; },
    updateTokenOnLogin: async () => assert.fail('TOTP challenge consumption replaces reusable-token updates'),
    consumeChallenge: async (candidate, challenge) => {
      assert.equal(challenge, 'totp');
      if (!candidate.is_active || candidate.is_used) return false;
      token.is_active = false;
      token.is_used = true;
      state.deactivated += 1;
      return true;
    },
    settings: async () => ({ jwt_token_expires_in: '1h', store_login_info: false }),
  };
  const services = {
    'magic-link': {
      'magic-link': magicLink,
      otp: { verifyTOTP: async () => { state.verified += 1; return { valid: true }; } },
      'rate-limiter': { checkRateLimit: async () => ({ allowed: true }) },
    },
    'users-permissions': {
      user: { edit: async () => {} },
      jwt: { issue: async () => { state.issued += 1; return 'local-totp-jwt'; } },
    },
  };
  global.strapi = {
    plugin(name) {
      const pluginServices = services[name];
      if (!pluginServices) throw new Error(`Unexpected plugin ${name}`);
      return { service: (key) => pluginServices[key] };
    },
    store: () => store,
    documents(uid) {
      if (uid === 'plugin::magic-link.token') {
        return { update: async (params) => {
          state.contextUpdates.push(params.data.context);
          token.context = params.data.context;
          return token;
        } };
      }
      if (uid === 'plugin::users-permissions.user') {
        return {
          findOne: async () => ({ id: 9, documentId: 'user-doc', username: 'person', email: 'person@example.test', confirmed: true }),
          findMany: async () => [{ id: 9, documentId: 'user-doc', username: 'person', email: 'person@example.test', confirmed: true }],
        };
      }
      throw new Error(`Unexpected document ${uid}`);
    },
    log: { info() {}, warn() {}, error() {}, debug() {} },
  };

  return { state, token };
};

const totpContext = () => makeContext({
  loginToken: 'plaintext-totp-login-token',
  totpCode: '123456',
});

test('expired TOTP login challenges are rejected before checking a code', async () => {
  const { state } = setupTotpLogin({ expired: true });
  const ctx = totpContext();

  await auth.verifyMFATOTP(ctx);

  assert.equal(ctx.status, 400);
  assert.equal(state.verified, 0);
  assert.equal(state.issued, 0);
});

test('a TOTP login challenge can issue one JWT and cannot be replayed', async () => {
  const { state, token } = setupTotpLogin();
  const first = totpContext();

  await auth.verifyMFATOTP(first);

  assert.equal(first.response.jwt, 'local-totp-jwt');
  assert.equal(state.issued, 1);
  assert.equal(state.verified, 1);
  assert.equal(state.deactivated, 1);
  assert.equal(token.is_active, false);

  const replay = totpContext();
  await auth.verifyMFATOTP(replay);

  assert.equal(replay.status, 400);
  assert.equal(state.issued, 1);
  assert.equal(state.verified, 1);
});

test('a verified TOTP time-step cannot be reused for a second login', async () => {
  const originalNow = Date.now;
  const nowSeconds = Math.floor(originalNow() / 1000 / 30) * 30 + 5;
  const periodSeconds = 30;
  const secret = speakeasy.generateSecret({ length: 20 }).base32;
  const config = {
    id: 41,
    documentId: 'totp-config-for-replay-test',
    userId: 73,
    secret: cryptoUtils.encrypt(secret),
    enabled: true,
    lastUsedStep: null,
  };
  const writes = [];
  let appliedWrites = 0;
  const strapi = {
    store: () => ({ get: async () => ({ totp_algorithm: 'SHA1', totp_digits: 6, totp_period: periodSeconds }) }),
    log: { info() {}, warn() {}, error() {}, debug() {} },
    documents(uid) {
      assert.equal(uid, 'plugin::magic-link.totp-config');
      return {
        findMany: async () => [{ ...config }],
      };
    },
    db: {
      query(uid) {
        assert.equal(uid, 'plugin::magic-link.totp-config');
        return {
          updateMany: async ({ where, data }) => {
            writes.push({ where, data });
            if (config.userId !== where.userId || config.lastUsedStep !== where.lastUsedStep) return { count: 0 };
            Object.assign(config, data);
            appliedWrites += 1;
            return { count: 1 };
          },
        };
      },
    },
  };
  const service = createOtpService({ strapi });
  const code = speakeasy.totp({
    secret,
    encoding: 'base32',
    time: nowSeconds,
    step: periodSeconds,
  });

  try {
    Date.now = () => nowSeconds * 1000;
    const attempts = await Promise.all([
      service.verifyTOTP(config.userId, code, false),
      service.verifyTOTP(config.userId, code, false),
    ]);
    const first = attempts.find((attempt) => attempt.valid);
    const replay = attempts.find((attempt) => !attempt.valid);

    assert.ok(first, 'exactly one concurrent request may accept the TOTP code');
    assert.equal(replay.valid, false);
    assert.equal(replay.error, 'totp_replayed');
    assert.equal(writes.length, 2, 'both concurrent requests attempt the compare-and-set');
    assert.equal(appliedWrites, 1, 'only one concurrent request may update the stored TOTP step');
    assert.equal(config.lastUsedStep, Math.floor(nowSeconds / periodSeconds));

    const nextStepTime = (Math.floor(nowSeconds / periodSeconds) + 1) * periodSeconds + 1;
    Date.now = () => nextStepTime * 1000;
    const nextCode = speakeasy.totp({
      secret,
      encoding: 'base32',
      time: nextStepTime,
      step: periodSeconds,
    });
    const nextStep = await service.verifyTOTP(config.userId, nextCode, false);

    assert.equal(nextStep.valid, true);
    assert.equal(config.lastUsedStep, Math.floor(nextStepTime / periodSeconds));
  } finally {
    Date.now = originalNow;
  }
});

test('restarting TOTP setup clears replay state for the replaced secret', async () => {
  let update;
  const service = createOtpService({
    strapi: {
      store: () => ({ get: async () => ({ totp_algorithm: 'SHA1', totp_digits: 6, totp_period: 30 }) }),
      log: { info() {}, warn() {}, error() {}, debug() {} },
      documents(uid) {
        assert.equal(uid, 'plugin::magic-link.totp-config');
        return {
          findMany: async () => [{ documentId: 'existing-totp-config', lastUsedStep: 59_734_370 }],
          update: async (payload) => { update = payload; return payload; },
        };
      },
    },
  });

  await service.setupTOTP(73, 'local@example.test');

  assert.equal(update.documentId, 'existing-totp-config');
  assert.equal(update.data.lastUsedStep, null);
  assert.equal(update.data.lastUsed, null);
  assert.equal(update.data.enabled, false);
});
