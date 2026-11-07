'use strict';

/**
 * Adversarial security review (6.0.0 branch): attacks that must fail, plus
 * the utils hardening made during the review. Synthetic data only; no
 * network, no real mail, no database.
 */

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const test = require('node:test');

const { useTestSecrets } = require('./helpers/mfa-strapi.cjs');

useTestSecrets();

const auth = require('../server/src/controllers/auth');
const jwtController = require('../server/src/controllers/jwt');
const validation = require('../server/src/controllers/validation');
const cryptoUtils = require('../server/src/utils/crypto');
const { renderTemplate } = require('../server/src/utils/template-renderer');
const { filterContext } = require('../server/src/utils/context-policy');
const { createLoginCoreStrapi, createCtx } = require('./helpers/login-core-strapi.cjs');

const USER = {
  id: 7,
  documentId: 'user-doc',
  email: 'user@example.test',
  username: 'user',
  confirmed: true,
  blocked: false,
};

/**
 * Splits an encrypt() result into its parts.
 *
 * @param {string} value - Ciphertext from encrypt().
 * @returns {string[]} [ivHex, tagHex, dataHex].
 */
const partsOf = (value) => Buffer.from(value, 'base64').toString('utf8').split(':');
const join = (parts) => Buffer.from(parts.join(':')).toString('base64');

test('decrypt rejects a truncated GCM authentication tag', () => {
  const [iv, tag, data] = partsOf(cryptoUtils.encrypt('JBSWY3DPEHPK3PXP'));
  // A prefix of a valid tag still verifies when Node is not told the tag length.
  assert.throws(() => cryptoUtils.decrypt(join([iv, tag.slice(0, 8), data])));
  assert.throws(() => cryptoUtils.decrypt(join([iv, tag.slice(0, 24), data])));
  assert.throws(() => cryptoUtils.decrypt(join([iv.slice(0, 24), tag, data])));
  assert.equal(cryptoUtils.decrypt(join([iv, tag, data])), 'JBSWY3DPEHPK3PXP');
});

test('decrypt rejects a forged tag of full length', () => {
  const [iv, , data] = partsOf(cryptoUtils.encrypt('secret'));
  const forged = nodeCrypto.randomBytes(16).toString('hex');
  assert.throws(() => cryptoUtils.decrypt(join([iv, forged, data])));
});

test('refresh mode: the session record lives as long as the refresh family', async () => {
  const { magicLinkService, state, setConfig } = createLoginCoreStrapi({ users: [USER] });
  setConfig('plugin::users-permissions.jwtManagement', 'refresh');
  const token = await magicLinkService.createToken(USER.email);

  const ctx = createCtx({
    method: 'POST',
    body: { loginToken: token._plaintextToken, deviceId: 'device-a' },
  });
  await auth.login(ctx);
  assert.ok(ctx.body.jwt);

  const record = state.stores['magic-link'].jwt_sessions.sessions[0];
  const family = state.upSessions[0];
  assert.equal(record.deviceId, 'device-a', 'device id is kept for family revocation');
  assert.equal(record.upSessionId, family.sessionId);
  // Helper: access token 10 minutes, refresh family 1 day.
  const accessMs = new Date(record.accessTokenExpiresAt).getTime() - Date.now();
  const recordMs = new Date(record.expiresAt).getTime() - Date.now();
  assert.ok(accessMs > 0 && accessMs <= 10 * 60 * 1000);
  assert.ok(recordMs > 23 * 60 * 60 * 1000, 'record expiry follows the refresh family');
  // The response still describes the access token.
  assert.equal(ctx.body.expires_at, record.accessTokenExpiresAt);

  // Cleanup must not mark a live refresh session as revoked.
  const cleanupCtx = createCtx({ method: 'POST' });
  await jwtController.cleanupSessions(cleanupCtx);
  assert.equal(cleanupCtx.body.count, 0);
  assert.equal(state.stores['magic-link'].jwt_sessions.sessions[0].isRevoked, false);
});

test('legacy mode: a random device id is not recorded and expiry equals the JWT', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({
    users: [USER],
    settings: { jwt_token_expires_in: '2h' },
  });
  const token = await magicLinkService.createToken(USER.email);
  const ctx = createCtx({ query: { loginToken: token._plaintextToken } });
  await auth.login(ctx);
  const record = state.stores['magic-link'].jwt_sessions.sessions[0];
  assert.equal(record.deviceId, undefined);
  assert.equal(record.expiresAt, record.accessTokenExpiresAt);
  assert.equal(record.expiresAt, ctx.body.expires_at);
});

test('attack: stored context cannot override JWT identity or MFA claims', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({ users: [USER] });
  const token = await magicLinkService.createToken(USER.email);
  // Simulate a row written by an older release or a direct DB edit.
  const row = state.tokens.find((candidate) => candidate.id === token.id);
  row.context = JSON.parse(
    '{"id":1,"ID":1,"sub":"admin","mfaVerified":true,"OtpVerified":true,' +
      '" userId ":1,"__proto__":{"polluted":true},"theme":"dark"}'
  );

  const ctx = createCtx({ query: { loginToken: token._plaintextToken } });
  await auth.login(ctx);
  const { payload } = state.issued[0];
  assert.equal(payload.id, USER.id);
  assert.deepEqual(payload.context, { theme: 'dark' });
  assert.deepEqual(ctx.body.context, { theme: 'dark' });
  assert.equal({}.polluted, undefined);
});

test('attack: reserved context keys are rejected in any casing on send-link', () => {
  for (const key of ['MfaVerified', 'TOTPVERIFIED', 'userid', 'Exp', 'JTI']) {
    assert.throws(
      () =>
        validation.parseBody(validation.sendLinkSchema, {
          email: 'user@example.test',
          context: { [key]: true },
        }),
      /reserved/
    );
  }
  assert.deepEqual(filterContext({ 'requiresOTP ': false, ok: 1 }), { ok: 1 });
});

test('attack: end-user TOTP routes accept no foreign user id (no IDOR)', () => {
  for (const [schema, body] of [
    [validation.totpDisableSchema, { totpCode: '123456', userId: 1 }],
    [validation.totpBackupCodesSchema, { totpCode: '123456', user: 1 }],
    [validation.totpConfirmSchema, { totpCode: '123456', emailCode: '123456', email: 'x@y.z' }],
    [validation.totpSetupSchema, { principal: 'up:1' }],
  ]) {
    assert.throws(() => validation.parseBody(schema, body), /Invalid request body/);
  }
});

test('attack: e-mail templates never execute code and escape values in HTML', () => {
  global.__pwned = false;
  const template =
    '<%= global.__pwned = true %><% global.__pwned = true %>${global.__pwned=true}' +
    '{{constructor}}{{__proto__}}<a href="{{LOGIN_URL}}">{{USER}}</a>';
  const html = renderTemplate(
    template,
    { LOGIN_URL: 'https://app.example.test/l?a=1&b="x"', USER: '<img src=x onerror=alert(1)>' },
    { html: true }
  );
  assert.equal(global.__pwned, false);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('href="https://app.example.test/l?a=1&amp;b=&quot;x&quot;"'));
  assert.ok(html.includes('&lt;% global.__pwned = true %&gt;'));
  delete global.__pwned;
});
