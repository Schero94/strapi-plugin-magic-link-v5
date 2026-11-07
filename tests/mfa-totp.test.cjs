'use strict';

/**
 * Authenticator (TOTP) service: otplib migration, principal namespaces,
 * per-enrolment parameters, staged re-enrolment, replay protection, backup
 * codes and the pre-6.0 data migration. Synthetic data only.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const { createMfaStrapi, useTestSecrets } = require('./helpers/mfa-strapi.cjs');

useTestSecrets();

const createOtpService = require('../server/src/services/otp');
const cryptoUtils = require('../server/src/utils/crypto');
const totpUtils = require('../server/src/utils/totp');

const TOTP_UID = 'plugin::magic-link.totp-config';
// RFC 6238 Appendix B: ASCII secret "12345678901234567890", base32-encoded
// exactly as speakeasy stored it (upper case, no padding).
const RFC_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const codeFor = (secret, totp, now = Date.now()) => totpUtils.generateCode({ secret, totp, now });

/**
 * Enrols a principal through beginSetup/confirmSetup and returns the secret.
 *
 * @param {object} service - OTP service.
 * @param {object|number} principal - Principal.
 * @param {string} email - E-mail.
 * @param {string} [origin] - Setup origin.
 * @returns {Promise<{secret: string, setup: object, confirm: object}>}
 */
const enrol = async (service, principal, email, origin = 'admin') => {
  const setup = await service.beginSetup(principal, email, { origin });
  const confirm = await service.confirmSetup(principal, await codeFor(setup.secret, setup), {
    origin,
  });
  assert.equal(confirm.valid, true);
  return { secret: setup.secret, setup, confirm };
};

test('RFC 6238 test vector and speakeasy-era base32 secrets stay valid with otplib (AUTH-22)', async () => {
  const sha1 = { algorithm: 'SHA1', digits: 8, period: 30 };
  assert.equal(await codeFor(RFC_SECRET_BASE32, sha1, 59_000), '94287082');
  assert.equal(await codeFor(RFC_SECRET_BASE32, sha1, 1_111_111_109_000), '07081804');
  assert.deepEqual(
    await totpUtils.verifyCode({
      secret: RFC_SECRET_BASE32,
      code: '94287082',
      totp: sha1,
      now: 59_000,
    }),
    { valid: true, timeStep: 1 }
  );
  assert.equal(
    (
      await totpUtils.verifyCode({
        secret: RFC_SECRET_BASE32,
        code: '94287083',
        totp: sha1,
        now: 59_000,
      })
    ).valid,
    false
  );
  assert.equal(
    (
      await totpUtils.verifyCode({
        secret: RFC_SECRET_BASE32,
        code: 'abc',
        totp: sha1,
        now: 59_000,
      })
    ).valid,
    false
  );

  // A 5.x enrolment (encrypted base32 secret, enabled, no stored parameters)
  // keeps working after the upgrade.
  const now = Date.now();
  const { strapi } = createMfaStrapi({
    settings: { totp_algorithm: 'SHA1', totp_digits: 6, totp_period: 30 },
    totpConfigs: [
      {
        id: 1,
        principalType: 'users-permissions',
        principalKey: 'up:7',
        userId: 7,
        email: 'legacy@example.test',
        secret: cryptoUtils.encrypt(RFC_SECRET_BASE32),
        enabled: true,
        lastUsedStep: null,
        revision: 0,
      },
    ],
  });
  const service = createOtpService({ strapi });
  const code = await codeFor(RFC_SECRET_BASE32, { algorithm: 'SHA1', digits: 6, period: 30 }, now);
  assert.equal((await service.verifyTOTP(7, code)).valid, true);
});

test('admin and end-user enrolments with equal numeric ids never collide (AUTH-03, ADM-02, S-01)', async () => {
  const { strapi, tables } = createMfaStrapi();
  const service = createOtpService({ strapi });

  const admin = await enrol(service, { type: 'admin', id: 7 }, 'admin@example.test', 'admin');

  const endUserStatus = await service.getTOTPStatus(7);
  assert.equal(
    endUserStatus.enabled,
    false,
    "the admin enrolment is not the end user's second factor"
  );
  const adminCode = await codeFor(admin.secret, admin.setup);
  assert.equal((await service.verifyTOTP(7, adminCode)).valid, false);
  assert.equal(
    (await service.verifyTOTP({ type: 'users-permissions', id: 7 }, adminCode)).valid,
    false
  );

  const user = await enrol(service, 7, 'user@example.test', 'account');
  assert.notEqual(user.secret, admin.secret);
  assert.deepEqual(tables[TOTP_UID].rows.map((row) => row.principalKey).sort(), [
    'admin:7',
    'up:7',
  ]);

  // Removing one never removes the other.
  await service.disableTOTP({ type: 'admin', id: 7 });
  assert.equal((await service.getTOTPStatus(7)).enabled, true);
  assert.equal((await service.getTOTPStatus({ type: 'admin', id: 7 })).enabled, false);
  assert.equal(service.toPrincipal({ type: 'other', id: 7 }), null);
  assert.equal(service.toPrincipal('7abc'), null);
});

test('enrolment parameters are stored per user and travel into the otpauth URI (AUTH-21, ADM-15, STR-04, E2E-09)', async () => {
  const { strapi, store } = createMfaStrapi({
    settings: {
      totp_algorithm: 'SHA256',
      totp_digits: 8,
      totp_period: 60,
      totp_issuer: 'Example App',
    },
  });
  const service = createOtpService({ strapi });

  const { secret, setup } = await enrol(service, 9, 'person@example.test', 'account');
  const uri = new URL(setup.otpauthUrl);
  assert.equal(uri.searchParams.get('algorithm'), 'SHA256');
  assert.equal(uri.searchParams.get('digits'), '8');
  assert.equal(uri.searchParams.get('period'), '60');
  assert.equal(uri.searchParams.get('issuer'), 'Example App');
  assert.match(setup.qrCode, /^data:image\/png;base64,/);

  // Changing the global settings does not lock the enrolled user out.
  store.settings = { totp_algorithm: 'SHA1', totp_digits: 6, totp_period: 30 };
  const later = Date.now() + 120_000;
  const realNow = Date.now;
  Date.now = () => later;
  try {
    const code = await codeFor(secret, { algorithm: 'SHA256', digits: 8, period: 60 }, later);
    assert.equal(code.length, 8);
    assert.equal((await service.verifyTOTP(9, code)).valid, true);
  } finally {
    Date.now = realNow;
  }
});

test('re-enrolment keeps the active authenticator until the new one is confirmed (AUTH-21, FUN-16, FUN-M08)', async () => {
  const { strapi, tables } = createMfaStrapi();
  const service = createOtpService({ strapi });
  const old = await enrol(service, 9, 'person@example.test', 'account');
  const row = () => tables[TOTP_UID].rows[0];
  const stepBefore = row().lastUsedStep;

  const next = await service.beginSetup(9, 'person@example.test', { origin: 'account' });
  assert.equal(row().enabled, true, 'starting a new setup does not disable MFA');
  assert.equal(row().lastUsedStep, stepBefore, 'replay state is kept');
  assert.equal((await service.getTOTPStatus(9)).pendingSetup, true);

  // A setup started elsewhere cannot be confirmed through another entry point.
  const wrongOrigin = await service.confirmSetup(9, await codeFor(next.secret, next), {
    origin: 'login',
  });
  assert.equal(wrongOrigin.valid, false);

  const realNow = Date.now;
  const future = realNow() + 31_000;
  Date.now = () => future;
  try {
    // The old authenticator still works for logins.
    assert.equal(
      (await service.verifyTOTP(9, await codeFor(old.secret, old.setup, future))).valid,
      true
    );
  } finally {
    Date.now = realNow;
  }

  const confirmed = await service.confirmSetup(9, await codeFor(next.secret, next), {
    origin: 'account',
  });
  assert.equal(confirmed.valid, true);
  assert.equal(row().pending, null);
  assert.equal(cryptoUtils.decrypt(row().secret), next.secret);
});

test('a verified TOTP time step cannot be reused, also by concurrent requests', async () => {
  const { strapi } = createMfaStrapi();
  const service = createOtpService({ strapi });
  const { secret, setup } = await enrol(service, 9, 'person@example.test', 'account');

  const realNow = Date.now;
  const future = realNow() + 60_000;
  Date.now = () => future;
  try {
    const code = await codeFor(secret, setup, future);
    const attempts = await Promise.all([service.verifyTOTP(9, code), service.verifyTOTP(9, code)]);
    assert.equal(attempts.filter((attempt) => attempt.valid).length, 1);
    assert.equal(attempts.find((attempt) => !attempt.valid).error, 'totp_replayed');
    assert.equal((await service.verifyTOTP(9, code)).valid, false);
  } finally {
    Date.now = realNow;
  }
});

test('backup codes: strong, hashed, owner-bound, single use and atomic (AUTH-20, E2E-M02)', async () => {
  const { strapi, tables } = createMfaStrapi();
  const service = createOtpService({ strapi });
  const { confirm } = await enrol(service, 9, 'person@example.test', 'account');
  await enrol(service, { type: 'admin', id: 9 }, 'admin@example.test', 'admin');
  const codes = confirm.backupCodes;

  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes)
    assert.match(code, /^[A-HJKMNP-TV-Z2-9]{4}(-[A-HJKMNP-TV-Z2-9]{4}){3}$/);
  const stored = JSON.stringify(tables[TOTP_UID].rows);
  assert.equal(
    codes.some((code) => stored.includes(code) || stored.includes(code.replace(/-/g, ''))),
    false
  );

  assert.equal(
    (await service.consumeBackupCode({ type: 'admin', id: 9 }, codes[0])).valid,
    false,
    'owner-bound'
  );

  const parallel = await Promise.all([
    service.consumeBackupCode(9, codes[0]),
    service.consumeBackupCode(9, codes[0]),
  ]);
  assert.equal(parallel.filter((result) => result.valid).length, 1, 'one code, one use');
  assert.equal((await service.consumeBackupCode(9, codes[0])).valid, false);

  const lower = await service.verifySecondFactor(9, {
    backupCode: codes[1].toLowerCase().replace(/-/g, ' '),
  });
  assert.equal(lower.valid, true);
  assert.equal(lower.method, 'backup-code');
  assert.equal((await service.getTOTPStatus(9)).backupCodesRemaining, 8);

  const fresh = await service.regenerateBackupCodes(9);
  assert.equal(
    (await service.consumeBackupCode(9, codes[2])).valid,
    false,
    'old codes are replaced'
  );
  assert.equal((await service.consumeBackupCode(9, fresh[0])).valid, true);
});

test('setups that require an e-mail proof cannot be confirmed without the bound e-mail code', async () => {
  const { strapi } = createMfaStrapi();
  const service = createOtpService({ strapi });

  const setup = await service.beginSetup(9, 'person@example.test', {
    origin: 'account',
    requireEmailProof: true,
  });
  assert.ok(setup.binding);
  const entry = await service.createOTP('person@example.test', 'totp-setup', {
    magicLinkToken: setup.binding,
  });
  const code = await codeFor(setup.secret, setup);

  assert.equal(
    (await service.confirmSetup(9, code, { origin: 'account' })).error,
    'email_proof_required'
  );
  const foreign = await service.createOTP('person@example.test', 'totp-setup', {
    magicLinkToken: 'other-binding',
  });
  assert.equal(
    (
      await service.confirmSetup(9, code, {
        origin: 'account',
        emailProof: { email: 'person@example.test', code: foreign.code },
      })
    ).valid,
    false
  );
  // The foreign code replaced the right one (single active code), so request a new one.
  const fresh = await service.createOTP('person@example.test', 'totp-setup', {
    magicLinkToken: setup.binding,
  });
  assert.equal(
    (
      await service.confirmSetup(9, code, {
        origin: 'account',
        emailProof: { email: 'person@example.test', code: entry.code },
      })
    ).valid,
    false,
    'a superseded e-mail code is rejected'
  );
  const ok = await service.confirmSetup(9, code, {
    origin: 'account',
    emailProof: { email: 'person@example.test', code: fresh.code },
  });
  assert.equal(ok.valid, true);
});

test('pre-6.0 enrolments are migrated fail-closed (AUTH-03 migration)', async () => {
  const legacySecret = cryptoUtils.encrypt(RFC_SECRET_BASE32);
  const { strapi, tables } = createMfaStrapi({
    settings: { totp_algorithm: 'SHA1', totp_digits: 6, totp_period: 30 },
    adminUsers: [
      { id: 1, email: 'admin@example.test' },
      { id: 3, email: 'boss@example.test' },
    ],
    upUsers: [
      { id: 1, email: 'someone-else@example.test' },
      { id: 2, email: 'user@example.test' },
      { id: 3, email: 'boss@example.test' },
    ],
    totpConfigs: [
      // Enrolled by admin 1 (the only 5.x path); u-p user 1 is a different person.
      {
        id: 10,
        userId: 1,
        email: 'admin@example.test',
        secret: legacySecret,
        enabled: true,
        backupCodes: ['abc'],
      },
      // E-mail matches the users-permissions user 2.
      { id: 11, userId: 2, email: 'user@example.test', secret: legacySecret, enabled: true },
      // Nobody owns this e-mail any more.
      { id: 12, userId: 4, email: 'gone@example.test', secret: legacySecret, enabled: true },
      // Same mailbox for admin 3 and u-p user 3: the login enrolment wins.
      { id: 13, userId: 3, email: 'boss@example.test', secret: legacySecret, enabled: true },
    ],
  });
  const service = createOtpService({ strapi });

  const stats = await service.migrateTotpConfigs();
  assert.deepEqual(stats, { assigned: 3, disabled: 1, reencrypted: 0 });
  const byId = Object.fromEntries(tables[TOTP_UID].rows.map((row) => [row.id, row]));
  assert.equal(byId[10].principalKey, 'admin:1');
  assert.equal(byId[10].backupCodes, null, 'unsalted legacy backup codes are dropped');
  assert.equal(byId[11].principalKey, 'up:2');
  assert.equal(byId[12].principalKey, 'legacy:12');
  assert.equal(byId[12].enabled, false);
  assert.equal(byId[13].principalKey, 'up:3');
  assert.equal(byId[11].algorithm, 'SHA1');

  assert.equal(
    (await service.getTOTPStatus(1)).enabled,
    false,
    'u-p user 1 does not inherit the admin authenticator'
  );
  assert.equal((await service.getTOTPStatus(2)).enabled, true);
  assert.deepEqual(
    await service.migrateTotpConfigs(),
    { assigned: 0, disabled: 0, reencrypted: 0 },
    'idempotent'
  );
});

test('TOTP setup and verification logs contain no principal id, e-mail, secret or code', async () => {
  const { strapi, logs } = createMfaStrapi();
  const service = createOtpService({ strapi });
  const { secret, setup } = await enrol(service, 932781, 'private-person@example.test', 'account');
  await service.verifyTOTP(932781, '000000');
  const code = await codeFor(secret, setup);
  await service.verifyTOTP(932781, code);

  const joined = logs.join('\n');
  assert.doesNotMatch(joined, /932781|private-person@example\.test/);
  assert.equal(joined.includes(secret), false);
  assert.equal(joined.includes(code), false);
});
