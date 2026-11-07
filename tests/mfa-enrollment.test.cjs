'use strict';

/**
 * End-to-end MFA flows through the real controllers and the real OTP
 * service: enrolment during a login that requires MFA, backup-code
 * recovery, authenticated self-service and TOTP-only login limits.
 * Synthetic data only; e-mails are captured in memory.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const { createTable, useTestSecrets } = require('./helpers/mfa-strapi.cjs');

useTestSecrets();

const auth = require('../server/src/controllers/auth');
const totpController = require('../server/src/controllers/totp');
const createOtpService = require('../server/src/services/otp');
const totpUtils = require('../server/src/utils/totp');
const { createLoginCoreStrapi, createCtx } = require('./helpers/login-core-strapi.cjs');

const OTP_UID = 'plugin::magic-link.otp-code';
const TOTP_UID = 'plugin::magic-link.totp-config';
const USER = { id: 7, documentId: 'user-doc', email: 'person@example.test', username: 'person', confirmed: true, blocked: false };

/**
 * Login-core double plus the real OTP service on in-memory MFA tables.
 *
 * @param {object} options - createLoginCoreStrapi options.
 * @returns {object} Handles.
 */
const setup = (options = {}) => {
  const env = createLoginCoreStrapi({ users: [USER], ...options });
  const tables = { [OTP_UID]: createTable(), [TOTP_UID]: createTable() };
  const baseQuery = env.strapi.db.query.bind(env.strapi.db);
  env.strapi.db.query = (uid) => (tables[uid] ? tables[uid].api : baseQuery(uid));
  const otp = createOtpService({ strapi: env.strapi });
  const limiterKeys = [];
  const basePlugin = env.strapi.plugin.bind(env.strapi);
  env.strapi.plugin = (name) => {
    if (name !== 'magic-link') return basePlugin(name);
    const base = basePlugin(name);
    return {
      service: (key) => {
        if (key === 'otp') return otp;
        if (key === 'rate-limiter') {
          return { checkRateLimit: async (limiterKey, type) => { limiterKeys.push({ key: limiterKey, type }); return { allowed: true }; } };
        }
        return base.service(key);
      },
    };
  };
  return { ...env, tables, otp, limiterKeys };
};

const createLink = async (magicLinkService, email) => (await magicLinkService.createToken(email, {}))._plaintextToken;

const post = (body, extra = {}) => createCtx({ method: 'POST', body, ...extra });

const asUser = (body, user = USER, strategy = 'users-permissions') => {
  const ctx = post(body);
  ctx.state = { user: { ...user }, auth: { strategy: { name: strategy } } };
  return ctx;
};

/**
 * Moves Date.now forward so the next TOTP time step is reached.
 *
 * @returns {{advance: Function, restore: Function}} Clock control.
 */
const clock = () => {
  const real = Date.now;
  let offset = 0;
  Date.now = () => real() + offset;
  return {
    advance: (ms = 31_000) => { offset += ms; },
    restore: () => { Date.now = real; },
  };
};

const codeOf = (secret, params) => totpUtils.generateCode({ secret, totp: params });

test('required MFA: enrolment during login, then backup-code recovery (ADM-M01, FUN-04, DOC-16, E2E-01)', async () => {
  const { magicLinkService, state, tables } = setup({ settings: { mfa_mode: 'required', totp_issuer: 'Example' } });
  const time = clock();
  try {
    const loginToken = await createLink(magicLinkService, USER.email);
    const login = createCtx({ query: { loginToken } });
    await auth.login(login);
    assert.equal(login.body.requiresTOTPSetup, true);

    const foreign = post({ loginToken: 'not-a-real-login-token-123' });
    await totpController.enroll(foreign);
    assert.equal(foreign.status, 400);

    const enroll = post({ loginToken });
    await totpController.enroll(enroll);
    const { secret, otpauthUrl, algorithm, digits, period } = enroll.body.data;
    assert.ok(secret && otpauthUrl.startsWith('otpauth://totp/'));
    assert.equal(enroll.body.data.binding, undefined);

    const wrong = post({ loginToken, totpCode: '000000' });
    await totpController.enrollConfirm(wrong);
    assert.equal(wrong.status, 400);
    assert.equal(state.issued.length, 0);

    const confirm = post({ loginToken, totpCode: await codeOf(secret, { algorithm, digits, period }) });
    await totpController.enrollConfirm(confirm);
    assert.ok(confirm.body.jwt, 'enrolment completes the login');
    assert.equal(confirm.body.mfaVerified, true);
    assert.equal(confirm.body.backupCodes.length, 10);
    assert.equal(state.tokens[0].is_active, false, 'the link is consumed');
    const session = state.stores['magic-link'].jwt_sessions.sessions[0];
    assert.equal(session.backupCodes, undefined, 'backup codes never reach the session store');
    assert.equal(tables[TOTP_UID].rows[0].principalKey, 'up:7');

    const replay = post({ loginToken, totpCode: await codeOf(secret, { algorithm, digits, period }) });
    await totpController.enrollConfirm(replay);
    assert.equal(replay.status, 400);
    assert.equal(state.issued.length, 1);

    // Next login: authenticator challenge; a backup code is the recovery path.
    const second = await createLink(magicLinkService, USER.email);
    const login2 = createCtx({ query: { loginToken: second } });
    await auth.login(login2);
    assert.equal(login2.body.requiresTOTP, true);

    const enrollAgain = post({ loginToken: second });
    await totpController.enroll(enrollAgain);
    assert.equal(enrollAgain.status, 400, 'a TOTP challenge cannot be turned into a new enrolment');

    const recovery = post({ loginToken: second, backupCode: confirm.body.backupCodes[0] });
    await auth.verifyMFATOTP(recovery);
    assert.ok(recovery.body.jwt);
    assert.equal(recovery.body.backupCodesRemaining, 9);
  } finally {
    time.restore();
  }
});

test('authenticated self-service needs fresh proofs; a stolen JWT alone changes nothing', async () => {
  const { state } = setup({ settings: { mfa_mode: 'optional' } });
  const time = clock();
  try {
    const anonymous = post({});
    await totpController.status(anonymous);
    assert.equal(anonymous.status, 401);
    const adminToken = asUser({}, USER, 'admin');
    await totpController.status(adminToken);
    assert.equal(adminToken.status, 401, 'only users-permissions principals');

    const status = asUser({});
    await totpController.status(status);
    assert.equal(status.body.data.enabled, false);
    assert.equal(status.body.data.mfaMode, 'optional');

    const start = asUser({});
    await totpController.setup(start);
    const { secret, algorithm, digits, period } = start.body.data;
    assert.equal(start.body.data.emailCodeSent, true);
    const mail = state.mails.at(-1);
    assert.equal(mail.to, USER.email);
    const emailCode = /\n(\d{4,16})\n/.exec(mail.text)[1];
    const params = { algorithm, digits, period };

    const noEmail = asUser({ totpCode: await codeOf(secret, params), emailCode: '99999999' });
    await totpController.confirm(noEmail);
    assert.equal(noEmail.status, 400);
    assert.equal(noEmail.body.error.key, 'totp.invalidEmailCode');

    const confirm = asUser({ totpCode: await codeOf(secret, params), emailCode });
    await totpController.confirm(confirm);
    assert.equal(confirm.body.data.enabled, true);
    const backupCodes = confirm.body.data.backupCodes;

    time.advance();
    const resetup = asUser({});
    await totpController.setup(resetup);
    assert.equal(resetup.status, 403, 're-enrolment needs a current code');
    assert.equal(resetup.body.error.key, 'totp.currentCodeRequired');

    const regenerateWrong = asUser({ totpCode: '000000' });
    await totpController.backupCodes(regenerateWrong);
    assert.equal(regenerateWrong.status, 400);

    const regenerate = asUser({ totpCode: await codeOf(secret, params) });
    await totpController.backupCodes(regenerate);
    assert.equal(regenerate.body.data.backupCodes.length, 10);

    const disableOld = asUser({ backupCode: backupCodes[0] });
    await totpController.disable(disableOld);
    assert.equal(disableOld.status, 400, 'regenerated codes replace the old ones');

    const disable = asUser({ backupCode: regenerate.body.data.backupCodes[0] });
    await totpController.disable(disable);
    assert.equal(disable.body.data.enabled, false);
  } finally {
    time.restore();
  }
});

test('TOTP-only login: per-pair and per-account limits and equal work for unknown users (AUTH-26)', async () => {
  const { otp, limiterKeys } = setup({ settings: { totp_as_primary_auth: true } });
  let simulated = 0;
  const original = otp.simulateVerification;
  otp.simulateVerification = async (code) => { simulated += 1; return original(code); };

  const fromA = post({ email: 'unknown@example.test', totpCode: '123456' });
  fromA.request.ip = '192.0.2.1';
  await auth.loginWithTOTP(fromA);
  const fromB = post({ email: 'unknown@example.test', totpCode: '123456' });
  fromB.request.ip = '192.0.2.2';
  await auth.loginWithTOTP(fromB);

  assert.equal(fromA.status, 400);
  assert.equal(fromA.body.error.key, 'credentials.invalid');
  assert.equal(simulated, 2, 'unknown accounts run a dummy verification');

  const pairKeys = limiterKeys.filter(({ key }) => key.startsWith('totp-login:')).map(({ key }) => key);
  assert.equal(new Set(pairKeys).size, 2, 'one client cannot exhaust the budget of other clients');
  const accountKeys = limiterKeys.filter(({ key }) => key.startsWith('totp-login-account:'));
  assert.equal(new Set(accountKeys.map(({ key }) => key)).size, 1);
  assert.equal(accountKeys[0].type, 'login');
  assert.equal(limiterKeys.some(({ key }) => key.includes('unknown@example.test')), false, 'limiter keys are hashed');
});
