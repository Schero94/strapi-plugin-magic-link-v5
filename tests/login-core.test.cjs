'use strict';

/**
 * Behavioural tests for the login core: send-link, link login, Magic Link +
 * TOTP, TOTP-only login, session issuing and JWT revocation. Synthetic data
 * only; no network and no real e-mail.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const auth = require('../server/src/controllers/auth');
const { createLoginCoreStrapi, createCtx, fakeJwt } = require('./helpers/login-core-strapi.cjs');
const { createJwtRevocationMiddleware, parseBearerToken } = require('../server/src/middlewares/jwt-revocation');
const passwordlessCompat = require('../server/src/middlewares/passwordless-compat');
const cryptoUtils = require('../server/src/utils/crypto');

const VICTIM = { id: 7, documentId: 'victim-doc', email: 'victim@example.test', username: 'victim', confirmed: true, blocked: false, internalNote: 'private-note', password: 'hash' };
const ATTACKER = { id: 9, documentId: 'attacker-doc', email: 'attacker@example.test', username: 'attacker', confirmed: true, blocked: false };

const createLink = async (magicLinkService, email, context = {}) => {
  const token = await magicLinkService.createToken(email, context);
  return token._plaintextToken;
};

const login = async (loginToken, options = {}) => {
  const ctx = createCtx({ query: { loginToken }, ...options });
  await auth.login(ctx);
  return ctx;
};

test('send-link rejects WhatsApp/SMS fields, missing e-mail and reserved context keys', async () => {
  createLoginCoreStrapi({ users: [VICTIM] });

  for (const body of [
    { phoneNumber: '+490000000', username: 'victim', delivery: 'whatsapp' },
    { email: 'victim@example.test', phoneNumber: '+490000000' },
    { email: 'victim@example.test', delivery: 'whatsapp' },
    { email: 'victim@example.test', via: 'sms' },
    { username: 'victim' },
    { email: 'victim@example.test', context: { requiresTOTP: true, userId: 9, userDocumentId: 'victim-doc' } },
    { email: 'victim@example.test', context: { requiresOTP: true } },
    { email: 'victim@example.test', username: '<a href=https://evil.test>x</a>' },
  ]) {
    await assert.rejects(auth.sendLink(createCtx({ method: 'POST', body })), (error) => {
      assert.equal(error.name, 'ValidationError');
      return true;
    }, JSON.stringify(body));
  }

  await assert.rejects(
    auth.sendLink(createCtx({ method: 'POST', body: { email: 'victim@example.test', phoneNumber: '+49' } })),
    /e-mail delivery is supported/i
  );
});

test('send-link answers identically for known and unknown e-mails before any lookup', async () => {
  const { magicLinkService } = createLoginCoreStrapi({ users: [VICTIM] });
  const calls = [];
  magicLinkService.requestLoginLink = async (params) => { calls.push(params); return 'sent'; };

  const known = createCtx({ method: 'POST', body: { email: 'Victim@Example.Test' } });
  const unknown = createCtx({ method: 'POST', body: { email: 'nobody@example.test' } });
  await auth.sendLink(known);
  await auth.sendLink(unknown);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(Object.keys(known.body), Object.keys(unknown.body));
  assert.equal(known.body.sent, true);
  assert.equal(unknown.body.sent, true);
  assert.equal(known.body.delivery, 'email');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].email, 'victim@example.test');
});

test('send-link delivery errors never reach the caller', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({ users: [VICTIM] });
  magicLinkService.requestLoginLink = async () => { throw new Error('smtp detail victim@example.test'); };
  const ctx = createCtx({ method: 'POST', body: { email: 'victim@example.test' } });

  await auth.sendLink(ctx);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(ctx.status, 200);
  assert.equal(ctx.body.sent, true);
  assert.equal(state.logs.join('\n').includes('victim@example.test'), false);
});

test('requestLoginLink mails a safe link built from frontend_url and filters context', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({
    users: [VICTIM],
    settings: {
      frontend_url: 'https://app.example.test',
      frontend_login_path: '/auth/magic?lang=de',
      message_html: '<p>Hi <%= USER %>, <a href="<%= URL %>?loginToken=<%= CODE %>">login</a> {{EXPIRES_AT}} <% global.process.exit(1) %></p>',
      message_text: 'Link: {{LOGIN_URL}} for {{EMAIL}} ({{EXPIRY_TEXT}}) {{UNKNOWN}}',
      expire_period: 3600,
      context_blacklist: ['internal'],
      from_email: 'login@example.test',
    },
  });

  const outcome = await magicLinkService.requestLoginLink({
    email: 'victim@example.test',
    context: { redirectTo: '/account', internal: 'x', requiresTOTP: true, userId: 9 },
  });

  assert.equal(outcome, 'sent');
  assert.equal(state.mails.length, 1);
  const mail = state.mails[0];
  const link = /Link: (\S+)/.exec(mail.text)[1];
  const url = new URL(link);
  assert.equal(url.origin + url.pathname, 'https://app.example.test/auth/magic');
  assert.equal(url.searchParams.get('lang'), 'de');
  assert.ok(url.searchParams.get('loginToken').length >= 22);
  assert.match(mail.text, /\(1 hour\)/);
  assert.equal(mail.text.includes('{{'), false);
  assert.ok(mail.html.includes('&lt;% global.process.exit(1) %&gt;'), 'lodash code blocks are inert text');
  assert.ok(mail.html.includes(`href="${link.replace(/&/g, '&amp;')}"`), 'legacy URL?loginToken=CODE becomes the built link');
  assert.equal(mail.from, 'login@example.test');

  const stored = state.tokens[0];
  assert.deepEqual(stored.context, { redirectTo: '/account' });
  assert.equal(stored.challenge, null);
  assert.notEqual(stored.token, url.searchParams.get('loginToken'));
});

test('auto-registration requires the plugin opt-in and users-permissions sign-ups, and creates unconfirmed users', async () => {
  const optedIn = { allow_magic_links_on_public_registration: true, createUserIfNotExists: true };

  let fixture = createLoginCoreStrapi({ settings: optedIn, advanced: { default_role: 'authenticated', allow_register: false } });
  assert.equal(await fixture.magicLinkService.requestLoginLink({ email: 'new@example.test' }), 'unknown_user');
  assert.equal(fixture.state.users.length, 0);
  assert.equal(fixture.state.mails.length, 0);

  fixture = createLoginCoreStrapi({ settings: {}, advanced: { default_role: 'authenticated', allow_register: true } });
  assert.equal(await fixture.magicLinkService.requestLoginLink({ email: 'new@example.test' }), 'unknown_user');

  fixture = createLoginCoreStrapi({
    settings: { ...optedIn, welcome_email: true, from_name: 'Shop' },
    advanced: { default_role: 'authenticated', allow_register: true },
    users: [{ id: 1, documentId: 'u1', email: 'new@other.test', username: 'new', confirmed: true }],
  });
  assert.equal(await fixture.magicLinkService.requestLoginLink({ email: 'new@example.test' }), 'sent');
  const created = fixture.state.users.find((user) => user.email === 'new@example.test');
  assert.equal(created.confirmed, false);
  assert.notEqual(created.username, 'new', 'username collisions get a unique suffix');
  assert.match(created.username, /^new-/);
  assert.equal(fixture.state.mails.length, 2, 'login mail and welcome mail');
});

test('welcome e-mail escapes user-controlled values', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi();
  await magicLinkService.sendWelcomeEmail({ email: 'a@example.test', username: '<b>x</b>' }, {});
  assert.ok(state.mails[0].html.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('forged challenge context cannot log in as another user (AUTH-01/FUN-01)', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({
    users: [VICTIM, ATTACKER],
    settings: { mfa_mode: 'optional' },
    totp: { 9: { configured: true, enabled: true } },
  });
  // Even if a reserved key reached the service directly, it is stripped.
  const plaintext = await createLink(magicLinkService, ATTACKER.email, {
    requiresTOTP: true,
    totpVerified: false,
    userId: 9,
    userDocumentId: VICTIM.documentId,
  });
  assert.deepEqual(state.tokens[0].context, {});

  // Simulate a legacy row whose context still carries forged flags.
  state.tokens[0].context = { requiresTOTP: true, userId: 9, userDocumentId: VICTIM.documentId };
  const ctx = createCtx({ method: 'POST', body: { loginToken: plaintext, totpCode: '123456' } });
  await auth.verifyMFATOTP(ctx);

  assert.equal(ctx.status, 400);
  assert.equal(ctx.body.error.key, 'challenge.invalid');
  assert.equal(state.issued.length, 0);
});

test('forged requiresOTP context cannot open an OTP challenge (AUTH-M01)', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({ users: [VICTIM] });
  const plaintext = await createLink(magicLinkService, VICTIM.email);
  state.tokens[0].context = { requiresOTP: true, otpVerified: false };

  assert.equal(await magicLinkService.validateBindingForChallenge(plaintext, VICTIM.email, 'otp'), null);
});

test('TOTP challenge is bound to the server-side user and issues one session', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({
    users: [VICTIM],
    settings: { mfa_mode: 'optional', otp_enabled: true, jwt_token_expires_in: '2h' },
    totp: { 7: { configured: true, enabled: true } },
  });
  const plaintext = await createLink(magicLinkService, VICTIM.email, { redirectTo: '/home' });

  const first = await login(plaintext);
  assert.equal(first.body.requiresTOTP, true, 'TOTP wins over e-mail OTP (AUTH-05/FUN-15)');
  assert.equal(first.body.userId, undefined);
  assert.equal(state.otpMails.length, 0);
  assert.equal(state.tokens[0].challenge.type, 'totp');
  assert.equal(state.tokens[0].challenge.userDocumentId, VICTIM.documentId);

  // Re-opening the link cannot skip the challenge.
  const again = await login(plaintext);
  assert.equal(again.body.requiresTOTP, true);
  assert.equal(state.issued.length, 0);

  const wrong = createCtx({ method: 'POST', body: { loginToken: plaintext, totpCode: '000000' } });
  await auth.verifyMFATOTP(wrong);
  assert.equal(wrong.body.error.key, 'mfa.invalidCode');

  const ok = createCtx({ method: 'POST', body: { loginToken: plaintext, totpCode: '123456' } });
  await auth.verifyMFATOTP(ok);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.mfaVerified, true);
  assert.equal(ok.body.user.id, VICTIM.id);
  assert.equal(ok.body.user.internalNote, undefined);
  assert.deepEqual(ok.body.context, { redirectTo: '/home' });
  assert.equal(state.issued[0].options.expiresIn, '2h');
  assert.equal(ok.responseHeaders['Cache-Control'], 'no-store');

  const replay = createCtx({ method: 'POST', body: { loginToken: plaintext, totpCode: '123456' } });
  await auth.verifyMFATOTP(replay);
  assert.equal(replay.status, 400);
  assert.equal(state.issued.length, 1);
});

test('required MFA without an enrolled authenticator starts enrolment and issues no session', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({ users: [VICTIM], settings: { mfa_mode: 'required', otp_enabled: true } });
  const plaintext = await createLink(magicLinkService, VICTIM.email);

  const ctx = await login(plaintext);
  assert.equal(ctx.body.requiresTOTPSetup, true);
  assert.equal(ctx.body.loginToken, plaintext);
  assert.equal(ctx.body.jwt, undefined);
  assert.equal(state.tokens[0].challenge.type, 'totp-setup');
  assert.equal(state.issued.length, 0);
  assert.equal(state.otpMails.length, 0);

  // Re-opening the link answers with the same enrolment challenge.
  const again = await login(plaintext);
  assert.equal(again.body.requiresTOTPSetup, true);
  assert.equal(state.issued.length, 0);
});

test('repeated link opens in OTP mode send one code while it is valid (AUTH-25)', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({ users: [VICTIM], settings: { otp_enabled: true, otp_type: 'sms', otp_expiry: 300 } });
  const plaintext = await createLink(magicLinkService, VICTIM.email);

  const first = await login(plaintext);
  const second = await login(plaintext);
  assert.equal(first.body.requiresOTP, true, 'a stored legacy otp_type no longer blocks login');
  assert.equal(second.body.requiresOTP, true);
  assert.equal(state.otpMails.length, 1);
  assert.equal(state.otpCreated[0].options.magicLinkToken, state.tokens[0].token);

  const bound = await magicLinkService.validateBindingForChallenge(plaintext, VICTIM.email, 'otp');
  assert.ok(bound);
  assert.equal(await magicLinkService.consumeChallenge(bound, 'otp'), true);
  assert.equal(await magicLinkService.consumeChallenge(bound, 'otp'), false);
});

test('parallel logins with one single-use link yield exactly one JWT (AUTH-08)', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({ users: [VICTIM] });
  const plaintext = await createLink(magicLinkService, VICTIM.email);

  const results = await Promise.all([login(plaintext), login(plaintext), login(plaintext)]);
  const winners = results.filter((ctx) => ctx.body?.jwt);
  assert.equal(winners.length, 1);
  assert.equal(state.issued.length, 1);
  assert.equal(results.filter((ctx) => ctx.status === 400).length, 2);
});

test('direct login sanitizes the user, honours the JWT lifetime and records the real expiry', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({
    users: [{ ...VICTIM, confirmed: false }],
    settings: { jwt_token_expires_in: '12h', context_whitelist: ['redirectTo'] },
  });
  const plaintext = await createLink(magicLinkService, VICTIM.email, { redirectTo: '/a', role: 'admin' });

  const ctx = createCtx({ method: 'POST', body: { loginToken: plaintext } });
  await auth.login(ctx);

  assert.equal(ctx.status, 200);
  assert.ok(ctx.body.jwt);
  assert.equal(ctx.body.user.password, undefined);
  assert.equal(ctx.body.user.internalNote, undefined);
  assert.deepEqual(ctx.body.context, { redirectTo: '/a' });
  assert.equal(ctx.body.expiry_formatted, undefined);
  assert.equal(state.issued[0].options.expiresIn, '12h');
  const expiresMs = new Date(ctx.body.expires_at).getTime() - Date.now();
  assert.ok(expiresMs > 11.9 * 3600_000 && expiresMs <= 12 * 3600_000);
  const session = state.stores['magic-link'].jwt_sessions.sessions[0];
  assert.equal(session.expiresAt, ctx.body.expires_at);
  assert.equal(session.jwtTokenHash, cryptoUtils.hashJwt(ctx.body.jwt));
  assert.deepEqual(state.edits, [{ id: VICTIM.id, data: { confirmed: true } }]);
  assert.equal(ctx.responseHeaders['Referrer-Policy'], 'no-referrer');
});

test('use_jwt_token=false confirms the login without minting a token (STR-M07)', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({ users: [VICTIM], settings: { use_jwt_token: false } });
  const plaintext = await createLink(magicLinkService, VICTIM.email);
  const ctx = await login(plaintext);

  assert.equal(ctx.body.jwt, undefined);
  assert.equal(ctx.body.jwtIssued, false);
  assert.equal(state.issued.length, 0);
});

test('refresh mode issues tokens through the users-permissions session manager (AUTH-07/STR-01)', async () => {
  const { magicLinkService, state, setConfig } = createLoginCoreStrapi({ users: [VICTIM] });
  setConfig('plugin::users-permissions.jwtManagement', 'refresh');
  const plaintext = await createLink(magicLinkService, VICTIM.email);

  const ctx = createCtx({ method: 'POST', body: { loginToken: plaintext, deviceId: 'device-1' } });
  await auth.login(ctx);

  assert.equal(state.issued.length, 0, 'the legacy jwt service is not used');
  assert.equal(state.upSessions.length, 1);
  assert.equal(state.upSessions[0].deviceId, 'device-1');
  assert.equal(state.upSessions[0].userId, String(VICTIM.id));
  assert.equal(ctx.body.refreshToken, 'refresh-up-session-1');
  const session = state.stores['magic-link'].jwt_sessions.sessions[0];
  assert.equal(session.upSessionId, 'up-session-1');

  // Revoking from the plugin also revokes the users-permissions session.
  await magicLinkService.blockJwtTokenByHash(session.jwtTokenHash, VICTIM.id, 'test');
  assert.deepEqual(state.revokedUpSessions, [{ userId: String(VICTIM.id), sessionId: 'up-session-1' }]);
  const entry = state.stores['magic-link'].blocked_jwt_tokens.tokens[0];
  assert.equal(entry.expiresAt, session.expiresAt);
  assert.equal(await magicLinkService.isJwtTokenBlocked(ctx.body.jwt), true);
});

test('refresh mode with httpOnly sessions sets the refresh cookie instead of returning it', async () => {
  const { magicLinkService, setConfig } = createLoginCoreStrapi({ users: [VICTIM] });
  setConfig('plugin::users-permissions.jwtManagement', 'refresh');
  setConfig('plugin::users-permissions.sessions', { httpOnly: true, cookie: { name: 'up_refresh', secure: true } });
  const plaintext = await createLink(magicLinkService, VICTIM.email);

  const ctx = await login(plaintext);
  assert.equal(ctx.body.refreshToken, undefined);
  assert.equal(ctx.cookies.list[0].name, 'up_refresh');
  assert.equal(ctx.cookies.list[0].options.httpOnly, true);
  assert.equal(ctx.cookies.list[0].options.secure, true);
});

test('revocation entries live until the JWT expiry, not a fixed 30 days (AUTH-06)', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi();
  const jwt = fakeJwt({ id: 1 }, '90d');
  await magicLinkService.blockJwtToken(jwt, 1);
  const entry = state.stores['magic-link'].blocked_jwt_tokens.tokens[0];
  const days = (new Date(entry.expiresAt).getTime() - Date.now()) / 86400000;
  assert.ok(days > 89 && days <= 90);

  // Parallel revocations are not lost.
  await Promise.all([fakeJwt({ id: 2 }), fakeJwt({ id: 3 }), fakeJwt({ id: 4 })].map((token) => magicLinkService.blockJwtToken(token, 2)));
  assert.equal(state.stores['magic-link'].blocked_jwt_tokens.tokens.length, 4);
});

test('revocation middleware parses Bearer like users-permissions and skips admin paths (AUTH-M02)', async () => {
  const { magicLinkService } = createLoginCoreStrapi();
  const jwt = fakeJwt({ id: 1 });
  await magicLinkService.blockJwtToken(jwt, 1);
  const middleware = createJwtRevocationMiddleware({ strapi: global.strapi });

  for (const header of [`Bearer ${jwt}`, `bearer ${jwt}`, `BEARER  ${jwt}`, `Bearer\t${jwt}`, ` Bearer ${jwt} `]) {
    const ctx = createCtx({ headers: { authorization: header }, path: '/api/articles' });
    let reached = false;
    await middleware(ctx, async () => { reached = true; });
    assert.equal(reached, false, JSON.stringify(header));
    assert.equal(ctx.status, 401);
  }

  assert.equal(parseBearerToken('Basic abc'), null);
  assert.equal(parseBearerToken('Bearer a b'), null);

  const adminCtx = createCtx({ headers: { authorization: `Bearer ${jwt}` }, path: '/admin/users/me' });
  let adminReached = false;
  await middleware(adminCtx, async () => { adminReached = true; });
  assert.equal(adminReached, true);
});

test('revocation middleware fails closed on store errors for API requests only', async () => {
  const { strapi } = createLoginCoreStrapi();
  strapi.plugin = () => ({ service: () => ({ isJwtTokenBlocked: async () => { throw new Error('store detail'); } }) });
  const middleware = createJwtRevocationMiddleware({ strapi });

  const apiCtx = createCtx({ headers: { authorization: 'bearer x.y.z' }, path: '/graphql' });
  let reached = false;
  await middleware(apiCtx, async () => { reached = true; });
  assert.equal(reached, false);
  assert.equal(apiCtx.status, 503);

  const adminCtx = createCtx({ headers: { authorization: 'Bearer x.y.z' }, path: '/admin/init' });
  await middleware(adminCtx, async () => { reached = true; });
  assert.equal(reached, true);
});

test('TOTP-only login never confirms the account and respects e-mail confirmation (AUTH-26)', async () => {
  const unconfirmed = { ...VICTIM, confirmed: false };
  let fixture = createLoginCoreStrapi({
    users: [unconfirmed],
    settings: { totp_as_primary_auth: true },
    totp: { 7: { configured: true, enabled: true } },
    advanced: { email_confirmation: true },
  });
  let ctx = createCtx({ method: 'POST', body: { email: VICTIM.email, totpCode: '123456' } });
  await auth.loginWithTOTP(ctx);
  assert.equal(ctx.status, 400);
  assert.equal(ctx.body.error.key, 'credentials.invalid');

  fixture = createLoginCoreStrapi({
    users: [unconfirmed],
    settings: { totp_as_primary_auth: true },
    totp: { 7: { configured: true, enabled: true } },
    advanced: { email_confirmation: false },
  });
  ctx = createCtx({ method: 'POST', body: { email: VICTIM.email, totpCode: '123456' } });
  await auth.loginWithTOTP(ctx);
  assert.equal(ctx.status, 200);
  assert.equal(ctx.body.loginMethod, 'totp');
  assert.deepEqual(fixture.state.edits, []);
});

test('legacy unsalted tokens and too-short tokens are never accepted (AUTH-24/AUTH-16)', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({ users: [VICTIM], settings: { token_length: 5 } });
  const plaintext = 'legacyPlaintextToken1234';
  state.tokens.push({ id: 99, documentId: 'legacy', email: VICTIM.email, token: plaintext, token_salt: null, token_prefix: plaintext.slice(0, 8), is_active: true, is_used: false, expires_at: new Date(Date.now() + 60000) });
  assert.equal(await magicLinkService.fetchToken(plaintext), null);
  assert.equal(await magicLinkService.deactivateLegacyTokens(), 1);
  assert.equal(state.tokens[0].is_active, false);

  const created = await createLink(magicLinkService, VICTIM.email);
  assert.equal(created.length, 22, 'configured lengths below the minimum are clamped');
});

test('blocked users and unknown links get translated, uniform errors', async () => {
  const { magicLinkService } = createLoginCoreStrapi({ users: [{ ...VICTIM, blocked: true }] });
  const plaintext = await createLink(magicLinkService, VICTIM.email);

  const blocked = await login(plaintext);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.message, 'User account is blocked');
  assert.equal(blocked.body.data, null);

  const unknown = await login('x'.repeat(30), { query: { loginToken: 'x'.repeat(30), locale: 'fr' } });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error.key, 'token.invalid');
  assert.notEqual(unknown.body.error.message, 'errors.token.invalid');
});

test('login is rate limited before any token lookup', async () => {
  const { magicLinkService } = createLoginCoreStrapi({ rateLimit: { allowed: false, retryAfter: 15 } });
  let fetched = false;
  magicLinkService.fetchToken = async () => { fetched = true; return null; };
  const ctx = await login('y'.repeat(30));
  assert.equal(ctx.status, 429);
  assert.equal(ctx.responseHeaders['Retry-After'], '15');
  assert.equal(fetched, false);
});

test('passwordless compatibility rewrites only when enabled and honours the REST prefix', async () => {
  const { strapi, state, setConfig } = createLoginCoreStrapi();
  setConfig('api.rest.prefix', '/v2');
  const middleware = passwordlessCompat({}, { strapi });

  const off = { path: '/v2/passwordless/login' };
  await middleware(off, async () => {});
  assert.equal(off.path, '/v2/passwordless/login');

  state.stores['magic-link'].settings.passwordlessCompatibility = true;
  const on = { path: '/v2/passwordless/login' };
  await middleware(on, async () => {});
  assert.equal(on.path, '/v2/magic-link/login');

  const other = { path: '/v2/passwordless/unknown' };
  await middleware(other, async () => {});
  assert.equal(other.path, '/v2/passwordless/unknown');
});
