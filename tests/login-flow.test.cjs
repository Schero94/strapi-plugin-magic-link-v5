'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const auth = require('../server/src/controllers/auth');

const setup = ({
  token = {
    documentId: 'token-doc',
    token: 'stored-token',
    email: 'person@example.test',
    is_active: true,
    context: { redirectTo: '/dashboard', secret: 'private-value' },
  },
  valid = true,
  rateLimit = { allowed: true },
  settings = { otp_enabled: false, mfa_mode: 'disabled', jwt_token_expires_in: '1h' },
  user = { id: 5, documentId: 'user-doc', email: 'person@example.test', username: 'person', confirmed: true, password: 'private' },
  totpStatus = { configured: false, enabled: false },
} = {}) => {
  const result = { sentEmails: [], updates: [], deactivated: 0, issued: [], sessions: [] };
  const magicLink = {
    fetchToken: async () => token,
    isTokenValid: async () => valid,
    deactivateToken: async () => { result.deactivated += 1; },
    settings: async () => settings,
    updateTokenOnLogin: async () => {},
  };
  const otp = {
    createOTP: async (email, type, options) => ({ email, type, options, code: '731204' }),
    sendOTPEmail: async () => { result.sentEmails.push('mail'); },
    getTOTPStatus: async () => totpStatus,
  };
  const store = {
    get: async () => ({ sessions: [] }),
    set: async ({ value }) => { result.sessions.push(...value.sessions); },
  };

  global.strapi = {
    plugin(name) {
      if (name === 'magic-link') return { service: (key) => ({ 'magic-link': magicLink, 'rate-limiter': { checkRateLimit: async () => rateLimit }, otp })[key] };
      if (name === 'users-permissions') return {
        service: (key) => key === 'user' ? { edit: async () => {} } : { issue: async (payload) => { result.issued.push(payload); return 'jwt-fake'; } },
      };
      throw new Error(`Unexpected plugin access: ${name}`);
    },
    documents(uid) {
      if (uid === 'plugin::magic-link.token') return { update: async (params) => result.updates.push(params) };
      if (uid === 'plugin::users-permissions.user') return { findMany: async () => user ? [user] : [] };
      throw new Error(`Unexpected document: ${uid}`);
    },
    store: () => store,
    log: { debug() {}, info() {}, warn() {}, error() {} },
  };

  return result;
};

const context = () => ({
  query: { loginToken: 'one-time-token' },
  request: { ip: '127.0.0.1', header: { 'user-agent': 'test' } },
  send(payload) { this.response = payload; return payload; },
  set() {},
  tooManyRequests(message) { this.rateLimitMessage = message; },
  badRequest(message) { this.badRequestMessage = message; },
});

test('expired or replayed login tokens are deactivated and rejected', async () => {
  const state = setup({ valid: false });
  const ctx = context();

  await auth.login(ctx);

  assert.equal(state.deactivated, 1);
  assert.equal(ctx.status, 400);
  assert.equal(ctx.body.error.key, 'token.invalid');
});

test('email OTP remains bound to the login token and never contacts an external mail provider in the test', async () => {
  const state = setup({ settings: { otp_enabled: true, otp_type: 'email', otp_expiry: 300, otp_length: 6 } });
  const ctx = context();

  await auth.login(ctx);

  assert.equal(ctx.response.requiresOTP, true);
  assert.equal(ctx.response.email, 'person@example.test');
  assert.equal(state.sentEmails.length, 1);
  assert.deepEqual(state.updates[0].data.context, {
    redirectTo: '/dashboard',
    secret: 'private-value',
    requiresOTP: true,
    otpVerified: false,
  });
});

test('required TOTP MFA returns a challenge and does not issue a JWT before verification', async () => {
  const state = setup({
    settings: { otp_enabled: false, mfa_mode: 'required' },
    totpStatus: { configured: true, enabled: true },
  });
  const ctx = context();

  await auth.login(ctx);

  assert.equal(ctx.response.requiresTOTP, true);
  assert.equal(ctx.response.userId, 5);
  assert.equal(state.issued.length, 0);
  assert.equal(state.updates[0].data.context.requiresTOTP, true);
});

test('normal passwordless login issues a JWT, stores only a hash and removes private user fields', async () => {
  const state = setup();
  const ctx = context();

  await auth.login(ctx);

  assert.equal(ctx.response.jwt, 'jwt-fake');
  assert.equal(ctx.response.user.password, undefined);
  assert.equal(ctx.response.context.secret, undefined);
  assert.equal(ctx.response.context.redirectTo, '/dashboard');
  assert.equal(state.issued.length, 1);
  assert.equal(state.sessions.length, 1);
  assert.notEqual(state.sessions[0].jwtTokenHash, 'jwt-fake');
});

test('login route rate limit stops token lookup', async () => {
  const state = setup({ rateLimit: { allowed: false, retryAfter: 15 } });
  const ctx = context();
  let tooManyRequests = false;
  ctx.tooManyRequests = () => { tooManyRequests = true; };
  let fetched = false;
  global.strapi.plugin('magic-link').service('magic-link').fetchToken = async () => { fetched = true; };

  await auth.login(ctx);

  assert.equal(tooManyRequests, true);
  assert.equal(fetched, false);
  assert.equal(state.issued.length, 0);
});
