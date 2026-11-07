'use strict';

/**
 * E-mail OTP second factor: service (attempt counting, atomic consumption,
 * code generation) and the public /otp/* controller. Synthetic data only;
 * no network and no real e-mail.
 */

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const test = require('node:test');

const { createMfaStrapi, useTestSecrets } = require('./helpers/mfa-strapi.cjs');

useTestSecrets();

const auth = require('../server/src/controllers/auth');
const otpController = require('../server/src/controllers/otp');
const createOtpService = require('../server/src/services/otp');
const createMagicLinkService = require('../server/src/services/magic-link');
const cryptoUtils = require('../server/src/utils/crypto');

const OTP_UID = 'plugin::magic-link.otp-code';
const EMAIL = 'person@example.test';

const makeContext = (body, extra = {}) => ({
  request: {
    body,
    ip: '127.0.0.1',
    headers: { 'user-agent': 'local-test' },
    header: { 'user-agent': 'local-test' },
  },
  state: {},
  headers: {},
  set(name, value) {
    this.headers[name] = value;
  },
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
  notFound(message) {
    this.status = 404;
    this.response = { error: message };
    return this.response;
  },
  forbidden(message) {
    this.status = 403;
    this.response = { error: message };
    return this.response;
  },
  ...extra,
});

const otpRow = (overrides = {}) => ({
  email: EMAIL,
  type: 'email',
  used: false,
  attempts: 0,
  expiresAt: new Date(Date.now() + 60_000),
  magicLinkToken: 'stored-token-hash',
  code: cryptoUtils.hashOTP('731204'),
  ...overrides,
});

test('OTP verification only looks at the exact login-token binding', async () => {
  const { strapi, tables } = createMfaStrapi({
    settings: { otp_max_attempts: 3 },
    otpCodes: [otpRow({ id: 1, magicLinkToken: 'hash-for-another-login' })],
  });
  const service = createOtpService({ strapi });

  const result = await service.verifyOTP(EMAIL, '731204', 'email', 'hash-for-this-login');

  assert.equal(result.valid, false);
  assert.equal(tables[OTP_UID].rows[0].used, false, 'a foreign login OTP must not be consumed');
  assert.equal(tables[OTP_UID].rows[0].attempts, 0);
});

test('the winner of an OTP consumption race verifies the code exactly once', async () => {
  const { strapi, tables } = createMfaStrapi({
    settings: { otp_max_attempts: 5 },
    otpCodes: [otpRow({ id: 1 })],
  });
  const service = createOtpService({ strapi });

  const first = await service.verifyOTP(EMAIL, '731204', 'email', 'stored-token-hash');
  const replay = await service.verifyOTP(EMAIL, '731204', 'email', 'stored-token-hash');

  assert.equal(first.valid, true);
  assert.equal(replay.valid, false);
  assert.equal(tables[OTP_UID].rows[0].used, true);
});

test('parallel guesses cannot exceed otp_max_attempts (AUTH-19, FUN-M05)', async () => {
  const { strapi, tables } = createMfaStrapi({
    settings: { otp_max_attempts: 3 },
    otpCodes: [otpRow({ id: 1 })],
  });
  const service = createOtpService({ strapi });
  const original = cryptoUtils.verifyOTP;
  let comparisons = 0;
  cryptoUtils.verifyOTP = (...args) => {
    comparisons += 1;
    return original(...args);
  };
  try {
    const guesses = Array.from({ length: 20 }, (_, i) => String(100000 + i));
    const results = await Promise.all(
      guesses.map((guess) => service.verifyOTP(EMAIL, guess, 'email', 'stored-token-hash'))
    );
    assert.ok(results.every((result) => !result.valid));
    assert.ok(
      comparisons <= 3,
      `at most otp_max_attempts guesses are compared, got ${comparisons}`
    );
    assert.ok(tables[OTP_UID].rows[0].attempts <= 3);

    // Sequential guesses: the code is burned after the budget is used up.
    for (let i = 0; i < 4; i += 1)
      await service.verifyOTP(EMAIL, '000000', 'email', 'stored-token-hash');
    const late = await service.verifyOTP(EMAIL, '731204', 'email', 'stored-token-hash');
    assert.equal(late.valid, false, 'the right code no longer works after the attempt budget');
    assert.equal(tables[OTP_UID].rows[0].used, true);
  } finally {
    cryptoUtils.verifyOTP = original;
  }
});

test('OTP codes are drawn with crypto.randomInt (no modulo bias)', () => {
  const { strapi } = createMfaStrapi();
  const service = createOtpService({ strapi });
  const original = nodeCrypto.randomInt;
  const calls = [];
  nodeCrypto.randomInt = (min, max) => {
    calls.push([min, max]);
    return original(min, max);
  };
  try {
    const code = service.generateCode(8);
    assert.match(code, /^\d{8}$/);
    assert.deepEqual(
      calls,
      Array.from({ length: 8 }, () => [0, 10])
    );
  } finally {
    nodeCrypto.randomInt = original;
  }
});

test('createOTP keeps exactly one active code and stores only its hash', async () => {
  const { strapi, tables } = createMfaStrapi();
  const service = createOtpService({ strapi });

  const first = await service.createOTP(EMAIL, 'email', { magicLinkToken: 'binding' });
  const second = await service.createOTP(EMAIL, 'email', { magicLinkToken: 'binding' });

  const rows = tables[OTP_UID].rows;
  assert.equal(rows.filter((row) => !row.used).length, 1);
  assert.equal(
    rows.some((row) => row.code === first.code || row.code === second.code),
    false
  );
  assert.equal(rows[0].phoneNumber, undefined);
});

test('challenge validation accepts only the originating active token and rejects spent challenges', async () => {
  const plaintext = 'bound-login-token-123456';
  const { hash, salt } = cryptoUtils.hashToken(plaintext);
  const record = {
    documentId: 'bound-token-doc',
    email: EMAIL,
    token: hash,
    token_salt: salt,
    token_prefix: plaintext.slice(0, 8),
    is_active: true,
    is_used: false,
    expires_at: new Date(Date.now() + 60_000),
    context: { redirectTo: '/account' },
    challenge: { type: 'otp', userId: 9, userDocumentId: 'user-doc' },
  };
  const strapi = {
    store: () => ({ get: async () => ({ stays_valid: false }) }),
    documents(uid) {
      assert.equal(uid, 'plugin::magic-link.token');
      return {
        findMany: async ({ filters }) =>
          filters.token_prefix && record.is_active && record.token_prefix === filters.token_prefix
            ? [record]
            : [],
      };
    },
  };
  const service = createMagicLinkService({ strapi });

  const bound = await service.validateBindingForChallenge(plaintext, EMAIL, 'otp');
  assert.equal(bound.documentId, 'bound-token-doc');
  assert.equal(
    await service.validateBindingForChallenge('different-login-token-1234', EMAIL, 'otp'),
    null
  );
  assert.equal(
    await service.validateBindingForChallenge(plaintext, 'other@example.test', 'otp'),
    null
  );

  const serverChallenge = record.challenge;
  record.challenge = null;
  record.context = { requiresOTP: true, otpVerified: false };
  assert.equal(await service.validateBindingForChallenge(plaintext, EMAIL, 'otp'), null);
  record.challenge = { ...serverChallenge, verifiedAt: new Date().toISOString() };
  assert.equal(await service.validateBindingForChallenge(plaintext, EMAIL, 'otp'), null);
  record.challenge = { ...serverChallenge, type: 'totp' };
  assert.equal(await service.validateBindingForChallenge(plaintext, EMAIL, 'otp'), null);
  record.challenge = serverChallenge;
  record.expires_at = new Date(Date.now() - 1_000);
  assert.equal(await service.validateBindingForChallenge(plaintext, EMAIL, 'otp'), null);
});

/**
 * Global Strapi double for the OTP controller.
 *
 * @param {object} [options] - { settings, totpEnabled, binding }.
 * @returns {object} Handles.
 */
const setupOtpController = ({ settings = {}, totpEnabled = false, binding } = {}) => {
  const state = {
    verifyCalls: [],
    consumed: 0,
    issued: [],
    sessions: null,
    created: [],
    sent: 0,
    edits: [],
    revokedUsers: [],
  };
  const boundToken =
    binding === null
      ? null
      : {
          id: 3,
          documentId: 'token-doc',
          token: 'stored-token-hash',
          email: EMAIL,
          context: { redirectTo: '/account', requiresOTP: true },
          challenge: { type: 'otp', userId: 9, userDocumentId: 'user-doc' },
          ...(binding || {}),
        };
  const otpService = {
    getOTPSettings: async () => ({
      enabled: true,
      type: 'email',
      expiry: 300,
      length: 6,
      resendCooldown: 0,
    }),
    verifyOTP: async (...args) => {
      state.verifyCalls.push(args);
      return { valid: true };
    },
    createOTP: async (_email, _type, options) => {
      state.created.push(options);
      return { code: '731204' };
    },
    sendOTPEmail: async () => {
      state.sent += 1;
      return true;
    },
    getTOTPStatus: async () => ({ configured: totpEnabled, enabled: totpEnabled }),
  };
  const magicLink = {
    revokeUserSessions: async (userId) => {
      state.revokedUsers.push(userId);
      return { revoked: 0 };
    },
    validateBindingForChallenge: async (token, email, challenge) =>
      token === 'plaintext-login-token' && email === EMAIL && challenge === 'otp'
        ? boundToken
        : null,
    consumeChallenge: async (token, challenge) => {
      assert.equal(token, boundToken);
      assert.equal(challenge, 'otp');
      state.consumed += 1;
      return state.consumed === 1;
    },
  };
  const storeValues = {
    settings: { otp_strict_binding: true, jwt_token_expires_in: '2h', ...settings },
  };
  global.strapi = {
    config: { get: (_key, fallback) => fallback },
    plugin(name) {
      if (name === 'magic-link') {
        return {
          service: (key) =>
            ({
              otp: otpService,
              'magic-link': magicLink,
              'rate-limiter': { checkRateLimit: async () => ({ allowed: true }) },
            })[key],
        };
      }
      if (name === 'users-permissions') {
        return {
          service: (key) =>
            key === 'jwt'
              ? {
                  issue: async (payload, options) => {
                    state.issued.push({ payload, options });
                    return 'local-jwt';
                  },
                }
              : { edit: async (id, data) => state.edits.push({ id, data }) },
        };
      }
      throw new Error(`Unexpected plugin ${name}`);
    },
    store: () => ({
      get: async ({ key }) => storeValues[key] ?? null,
      set: async ({ key, value }) => {
        storeValues[key] = value;
      },
    }),
    documents(uid) {
      assert.equal(uid, 'plugin::users-permissions.user');
      return {
        findMany: async () => [
          { id: 9, documentId: 'user-doc', username: 'person', email: EMAIL, confirmed: false },
        ],
      };
    },
    db: { query: () => ({ findMany: async () => [] }) },
    log: { info() {}, warn() {}, error() {}, debug() {} },
  };
  return { state, storeValues };
};

test('OTP verify binds to the stored token hash and issues a recorded session (STR-M02, FUN-11)', async () => {
  const { state, storeValues } = setupOtpController();
  const ctx = makeContext({
    email: EMAIL,
    code: '731204',
    magicLinkToken: 'plaintext-login-token',
  });

  await otpController.verify(ctx);

  assert.deepEqual(state.verifyCalls, [[EMAIL, '731204', 'email', 'stored-token-hash']]);
  assert.equal(state.consumed, 1);
  assert.equal(ctx.response.jwt, 'local-jwt');
  assert.ok(ctx.response.expires_at, 'the response carries the real expiry');
  assert.deepEqual(
    state.issued[0].options,
    { expiresIn: '2h' },
    'the configured lifetime is honoured'
  );
  assert.deepEqual(
    ctx.response.context,
    { redirectTo: '/account' },
    'reserved context keys are filtered'
  );
  assert.equal(
    storeValues.jwt_sessions.sessions.length,
    1,
    'the OTP login is visible and revocable'
  );
  assert.equal(storeValues.jwt_sessions.sessions[0].source, 'Magic Link + Email OTP');
  // The unconfirmed account is claimed: sessions end, the password is cleared.
  assert.deepEqual(state.revokedUsers, [9]);
  assert.deepEqual(state.edits, [
    {
      id: 9,
      data: { confirmed: true, password: null, resetPasswordToken: null, confirmationToken: null },
    },
  ]);
  assert.equal(ctx.headers['Cache-Control'], 'no-store');
});

test('OTP verify refuses a user who enrolled an authenticator meanwhile', async () => {
  const { state } = setupOtpController({ settings: { mfa_mode: 'optional' }, totpEnabled: true });
  const ctx = makeContext({
    email: EMAIL,
    code: '731204',
    magicLinkToken: 'plaintext-login-token',
  });

  await otpController.verify(ctx);

  assert.equal(ctx.status, 400);
  assert.equal(state.issued.length, 0);
  assert.equal(state.consumed, 0);
});

test('the unbound legacy OTP flow is refused while an MFA mode is active (AUTH-05)', async (t) => {
  for (const mfaMode of ['optional', 'required']) {
    await t.test(mfaMode, async () => {
      const { state } = setupOtpController({
        settings: { otp_strict_binding: false, mfa_mode: mfaMode },
      });
      const send = makeContext({ email: EMAIL });
      await otpController.send(send);
      assert.equal(send.status, 400);
      assert.equal(state.created.length, 0);

      const verify = makeContext({ email: EMAIL, code: '731204' });
      await otpController.verify(verify);
      assert.equal(verify.status, 400);
      assert.equal(state.verifyCalls.length, 0);
      assert.equal(state.issued.length, 0);
    });
  }

  await t.test('disabled MFA keeps the explicit legacy flow working', async () => {
    const { state } = setupOtpController({
      settings: { otp_strict_binding: false, mfa_mode: 'disabled' },
    });
    const verify = makeContext({ email: EMAIL, code: '731204' });
    await otpController.verify(verify);
    assert.equal(verify.response.jwt, 'local-jwt');
    assert.deepEqual(state.verifyCalls[0], [EMAIL, '731204', 'email', null]);
  });
});

test('OTP send stores only the exact token hash, never the submitted login token', async () => {
  const { state } = setupOtpController();
  const ctx = makeContext({ email: EMAIL, magicLinkToken: 'plaintext-login-token' });

  await otpController.send(ctx);

  assert.equal(ctx.response.success, true);
  assert.equal(state.created[0].magicLinkToken, 'stored-token-hash');
  assert.equal(state.sent, 1);
});

test('invalid OTP request bodies are rejected before plugin services are called', async () => {
  let serviceAccess = 0;
  global.strapi = {
    plugin() {
      serviceAccess += 1;
      throw new Error('invalid input must stop before service access');
    },
    log: { error() {} },
  };

  for (const handler of ['send', 'verify', 'resend']) {
    await assert.rejects(
      otpController[handler](makeContext({ email: 'not-an-email', magicLinkToken: 'short' })),
      {
        name: 'ValidationError',
      }
    );
  }
  await assert.rejects(
    otpController.send(makeContext({ email: EMAIL, phoneNumber: '+490000000' })),
    {
      name: 'ValidationError',
    }
  );
  assert.equal(serviceAccess, 0);
});

test('OTP send rate limits before challenge lookup and code creation', async () => {
  let created = 0;
  let bindingChecks = 0;
  global.strapi = {
    plugin() {
      return {
        service: (key) =>
          ({
            otp: {
              getOTPSettings: async () => ({ enabled: true, type: 'email' }),
              createOTP: async () => {
                created += 1;
              },
            },
            'magic-link': {
              validateBindingForChallenge: async () => {
                bindingChecks += 1;
                return { token: 'hash' };
              },
            },
            'rate-limiter': { checkRateLimit: async () => ({ allowed: false, retryAfter: 20 }) },
          })[key],
      };
    },
    log: { info() {}, warn() {}, error() {}, debug() {} },
  };
  const ctx = makeContext({ email: EMAIL, magicLinkToken: 'plaintext-login-token' });

  await otpController.send(ctx);

  assert.equal(ctx.status, 429);
  assert.equal(ctx.headers['Retry-After'], '20');
  assert.equal(bindingChecks, 0);
  assert.equal(created, 0);
});

test('provider errors during OTP e-mail delivery never log the code or the address', async () => {
  const code = '731204';
  const { strapi, logs, mails } = createMfaStrapi({ settings: { use_magic_mail: true } });
  const basePlugin = strapi.plugin;
  strapi.plugin = (name) => {
    if (name === 'magic-mail') {
      return {
        service: () => ({
          send: async () => {
            throw new Error(`provider rejected ${code} for ${EMAIL}`);
          },
        }),
      };
    }
    return basePlugin(name);
  };
  const service = createOtpService({ strapi });

  await service.sendOTPEmail(EMAIL, code, { expiryMinutes: 0.5 });

  assert.equal(mails.length, 1, 'falls back to the Strapi e-mail plugin');
  assert.match(mails[0].text, /1 minute\b/, 'a 30 s expiry never reads "0 minutes" (FUN-27)');
  assert.equal(logs.join('\n').includes(code), false);
  assert.equal(logs.join('\n').includes(EMAIL), false);
});

test('admin OTP list paginates server-side, validates the query and hides hashes (STR-08, ADM-24, FUN-20)', async () => {
  const rows = Array.from({ length: 130 }, (_, i) =>
    otpRow({ id: i + 1, email: `user${i}@example.test` })
  );
  createMfaStrapi({ otpCodes: rows });

  const ctx = makeContext({}, { query: { page: '2', pageSize: '1000' } });
  await otpController.listCodes(ctx);

  assert.equal(ctx.response.pagination.pageSize, 100);
  assert.equal(ctx.response.pagination.page, 2);
  assert.equal(ctx.response.pagination.total, 130);
  assert.equal(ctx.response.pagination.pageCount, 2);
  assert.equal(ctx.response.pagination.truncated, true);
  assert.equal(ctx.response.codes.length, 30);
  assert.equal(ctx.response.codes[0].code, undefined);
  assert.equal(ctx.response.codes[0].magicLinkToken, undefined);

  for (const query of [
    { type: { $ne: 'x' } },
    { page: 'abc' },
    { type: 'sms' },
    { unexpected: '1' },
  ]) {
    await assert.rejects(otpController.listCodes(makeContext({}, { query })), {
      name: 'ValidationError',
    });
  }
});

test('admin OTP delete accepts documentId or numeric id and reports missing rows (STR-07)', async () => {
  const { tables } = createMfaStrapi({
    otpCodes: [otpRow({ id: 5, documentId: 'abc123' }), otpRow({ id: 6, documentId: 'def456' })],
  });

  const byNumeric = makeContext({}, { params: { id: '5' } });
  await otpController.deleteCode(byNumeric);
  assert.equal(byNumeric.response.success, true);

  const byDocument = makeContext({}, { params: { id: 'def456' } });
  await otpController.deleteCode(byDocument);
  assert.equal(byDocument.response.success, true);
  assert.equal(tables[OTP_UID].rows.length, 0);

  const missing = makeContext({}, { params: { id: 'def456' } });
  await otpController.deleteCode(missing);
  assert.equal(missing.status, 404);
});

test('verify-mfa-totp accepts a backup code as the recovery path', async () => {
  const token = {
    id: 1,
    documentId: 'totp-token-doc',
    is_active: true,
    expires_at: new Date(Date.now() + 60_000),
    context: {},
    email: EMAIL,
    challenge: { type: 'totp', userId: 9, userDocumentId: 'user-doc' },
  };
  const calls = [];
  const storeValues = {};
  global.strapi = {
    config: { get: (_key, fallback) => fallback },
    plugin(name) {
      if (name === 'magic-link') {
        return {
          service: (key) =>
            ({
              'magic-link': {
                fetchToken: async () => ({ ...token }),
                isTokenValid: async () => true,
                deactivateToken: async () => {},
                consumeChallenge: async () => true,
                settings: async () => ({}),
              },
              otp: {
                getTOTPStatus: async () => ({ configured: true, enabled: true }),
                verifySecondFactor: async (userId, input) => {
                  calls.push({ userId, input });
                  return { valid: true, method: 'backup-code', remaining: 9 };
                },
              },
              'rate-limiter': { checkRateLimit: async () => ({ allowed: true }) },
            })[key],
        };
      }
      return {
        service: (key) =>
          key === 'jwt' ? { issue: async () => 'backup-jwt' } : { edit: async () => {} },
      };
    },
    store: () => ({
      get: async ({ key }) => storeValues[key] ?? null,
      set: async ({ key, value }) => {
        storeValues[key] = value;
      },
    }),
    documents: () => ({
      findOne: async () => ({ id: 9, documentId: 'user-doc', email: EMAIL, confirmed: true }),
    }),
    log: { info() {}, warn() {}, error() {}, debug() {} },
  };

  const ctx = makeContext({
    loginToken: 'plaintext-totp-login-token',
    backupCode: 'ABCD-EFGH-JKMN-PQRS',
  });
  await auth.verifyMFATOTP(ctx);

  assert.deepEqual(calls, [
    { userId: 9, input: { totpCode: undefined, backupCode: 'ABCD-EFGH-JKMN-PQRS' } },
  ]);
  assert.equal(ctx.response.jwt, 'backup-jwt');
  assert.equal(ctx.response.backupCodesRemaining, 9);
  assert.equal(storeValues.jwt_sessions.sessions[0].source, 'Magic Link + backup code (MFA)');

  await assert.rejects(
    auth.verifyMFATOTP(
      makeContext({
        loginToken: 'plaintext-totp-login-token',
        totpCode: '123456',
        backupCode: 'ABCD-EFGH-JKMN-PQRS',
      })
    ),
    { name: 'ValidationError' }
  );
});

test('admin enrolment summary counts only active end-user authenticators', async () => {
  createMfaStrapi({
    totpConfigs: [
      { id: 1, principalType: 'users-permissions', principalKey: 'up:1', enabled: true },
      { id: 2, principalType: 'users-permissions', principalKey: 'up:2', enabled: false },
      { id: 3, principalType: 'admin', principalKey: 'admin:1', enabled: true },
      { id: 4, principalType: 'legacy', principalKey: 'legacy:4', enabled: false },
    ],
  });
  const ctx = makeContext({});
  await otpController.enrollmentSummary(ctx);
  assert.deepEqual(ctx.response, { data: { enrolled: 1, enrollmentDuringLogin: true } });
});
