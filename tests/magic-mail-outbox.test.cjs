'use strict';

/**
 * Magic Mail 4.4 outbox: login links and OTP codes pass `notAfter` (the
 * expiry) and a stable idempotency key, a queued result is recorded as
 * `queued` without a fallback, an uncertain failure is `failed` with
 * MAGIC_MAIL_UNCERTAIN, and Magic Mail before 4.4 is called as before.
 * Synthetic data only; no network.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createLoginCoreStrapi } = require('./helpers/login-core-strapi.cjs');
const { createMfaStrapi, useTestSecrets } = require('./helpers/mfa-strapi.cjs');
const createOtpService = require('../server/src/services/otp');
const {
  OUTBOX_SCOPE,
  buildMagicMailSendOptions,
  isMagicMailPreSendFailure,
  isMagicMailQueuedResult,
  isMagicMailUncertain,
  outboxKeyFor,
  supportsMagicMailOutbox,
} = require('../server/src/utils/magic-mail-delivery');
const {
  DELIVERY_STATUSES,
  classifyDeliveryError,
  toDeliveryAttributes,
} = require('../server/src/utils/delivery-status');

useTestSecrets();

const EMAIL = 'person@example.test';
const CODE = '482913';
const QUEUED = Object.freeze({
  success: true,
  queued: true,
  status: 'pending',
  outboxId: 'outbox1',
  accountUsed: null,
  messageId: null,
});

/**
 * Installs a fake Magic Mail. `outbox: true` adds the 4.4 queue service.
 * Every call records the message and the options argument (if any).
 */
const withMagicMail = (strapi, send, { outbox = true } = {}) => {
  const base = strapi.plugin.bind(strapi);
  const calls = [];
  const router = {
    send: async (...args) => {
      calls.push({ mail: args[0], options: args[1], argCount: args.length });
      return send(args[0], args[1]);
    },
  };
  strapi.plugin = (name) => {
    if (name !== 'magic-mail') return base(name);
    return {
      service: (key) => {
        if (key === 'email-router') return router;
        if (key === 'queue') return outbox ? { capture: async () => null } : undefined;
        return { findOne: async () => null };
      },
    };
  };
  return calls;
};

const uncertainError = () =>
  Object.assign(new Error(`SendGrid API request failed: 504 for ${EMAIL}`), {
    status: 504,
    magicMailRetryable: false,
    magicMailOutboxId: 'outbox2',
  });

const fakeStrapi = (queueService) => ({
  plugin: (name) =>
    name === 'magic-mail'
      ? { service: (key) => (key === 'queue' ? queueService : undefined) }
      : undefined,
});

// ─────────────────────────── helpers ───────────────────────────

test('outbox detection: only a Magic Mail with a queue service that can capture', () => {
  assert.equal(supportsMagicMailOutbox({ plugin: () => undefined }), false);
  assert.equal(supportsMagicMailOutbox(fakeStrapi(undefined)), false);
  assert.equal(supportsMagicMailOutbox(fakeStrapi({ enqueue() {} })), false);
  assert.equal(
    supportsMagicMailOutbox({
      plugin: () => ({
        service: () => {
          throw new Error('no queue');
        },
      }),
    }),
    false
  );
  assert.equal(supportsMagicMailOutbox(fakeStrapi({ capture() {} })), true);
});

test('idempotency key: stable, per purpose and record, no raw id or secret', () => {
  const key = outboxKeyFor('login-link', 'abc123');
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(outboxKeyFor('login-link', 'abc123'), key);
  assert.notEqual(outboxKeyFor('login-link', 'abc124'), key);
  assert.notEqual(outboxKeyFor('otp', 'abc123'), key);
  assert.equal(key.includes('abc123'), false);
  assert.equal(outboxKeyFor('otp', 7), outboxKeyFor('otp', '7'));
});

test('send options: notAfter is the expiry, never later; fallback to queue: false', () => {
  const strapi = fakeStrapi({ capture() {} });
  const now = Date.parse('2026-11-08T10:00:00.000Z');
  const expiresAt = '2026-11-08T10:15:00.000Z';

  const options = buildMagicMailSendOptions(strapi, { purpose: 'otp', id: 9, expiresAt, now });
  assert.ok(options.notAfter instanceof Date);
  assert.equal(options.notAfter.toISOString(), expiresAt);
  assert.equal(options.idempotencyKey, outboxKeyFor('otp', 9));
  assert.equal(options.idempotencyScope, OUTBOX_SCOPE);
  assert.equal('queue' in options, false, 'never queue: true');

  const fromDate = new Date(expiresAt);
  const copy = buildMagicMailSendOptions(strapi, {
    purpose: 'otp',
    id: 9,
    expiresAt: fromDate,
    now,
  });
  assert.notEqual(copy.notAfter, fromDate, 'the caller date is not shared');

  for (const input of [
    { id: 9, expiresAt: null },
    { id: 9, expiresAt: 'not a date' },
    { id: 9, expiresAt: '2026-11-08T10:00:00.000Z' },
    { id: 9, expiresAt: '2026-11-08T09:00:00.000Z' },
    { id: null, expiresAt },
    { id: '', expiresAt },
    { id: 1.5, expiresAt },
  ]) {
    assert.deepEqual(
      buildMagicMailSendOptions(strapi, { purpose: 'otp', ...input, now }),
      { queue: false },
      JSON.stringify(input)
    );
  }

  assert.equal(
    buildMagicMailSendOptions(fakeStrapi(undefined), { purpose: 'otp', id: 9, expiresAt, now }),
    null,
    'Magic Mail before 4.4: no options'
  );
});

test('result and error classification for the outbox', () => {
  assert.equal(isMagicMailQueuedResult(QUEUED), true);
  assert.equal(isMagicMailQueuedResult({ ...QUEUED, status: 'sent' }), false);
  assert.equal(isMagicMailQueuedResult({ success: true, messageId: 'm1' }), false);
  assert.equal(isMagicMailQueuedResult(undefined), false);

  assert.equal(isMagicMailUncertain(uncertainError()), true);
  assert.equal(isMagicMailUncertain(new Error('x')), false);
  assert.equal(
    isMagicMailUncertain(Object.assign(new Error('x'), { magicMailOutboxId: '' })),
    false
  );
  assert.equal(isMagicMailUncertain(null), false);

  const withPreSendCode = Object.assign(uncertainError(), { code: 'MAGIC_MAIL_NO_ACCOUNT' });
  assert.equal(isMagicMailPreSendFailure(withPreSendCode), false, 'an outbox id wins');

  assert.deepEqual(classifyDeliveryError(uncertainError()), {
    status: 'failed',
    reason: 'MAGIC_MAIL_UNCERTAIN',
  });
  assert.ok(DELIVERY_STATUSES.includes('queued'));
  assert.equal(
    toDeliveryAttributes({ status: 'queued', channel: 'magic-mail' }).delivery_status,
    'queued'
  );
});

// ─────────────────────────── login link ───────────────────────────

const loginCore = () =>
  createLoginCoreStrapi({
    settings: {
      use_magic_mail: true,
      use_email_designer: true,
      email_designer_template_id: '3',
    },
  });

const storedToken = (state, token) =>
  state.tokens.find((row) => row.documentId === token.documentId);

test('login link: Magic Mail 4.4 gets notAfter = token expiry and a per-token key', async () => {
  const { strapi, magicLinkService, state } = loginCore();
  const calls = withMagicMail(strapi, async () => ({ success: true, messageId: '<m1@x>' }));
  const token = await magicLinkService.createToken(EMAIL, {});
  await magicLinkService.sendLoginLink(token, {});
  await magicLinkService.sendLoginLink(token, {});

  assert.equal(calls.length, 2);
  const [{ options }, second] = calls;
  assert.equal(options.notAfter.getTime(), new Date(token.expires_at).getTime());
  assert.equal(options.idempotencyKey, outboxKeyFor('login-link', token.documentId));
  assert.equal(options.idempotencyScope, OUTBOX_SCOPE);
  assert.equal(options.queue, undefined, 'never queue: true');
  assert.equal(second.options.idempotencyKey, options.idempotencyKey, 'stable per token');
  assert.equal(options.idempotencyKey.includes(token._plaintextToken), false);
  assert.equal(state.mails.length, 0);
  assert.equal(storedToken(state, token).delivery_status, 'sent');
});

test('login link: a queued result is recorded as queued and never falls back', async () => {
  const { strapi, magicLinkService, state } = loginCore();
  const calls = withMagicMail(strapi, async () => ({ ...QUEUED }));
  const token = await magicLinkService.createToken(EMAIL, {});
  await magicLinkService.sendLoginLink(token, {});

  assert.equal(calls.length, 1);
  assert.equal(state.mails.length, 0, 'no second login link through the e-mail plugin');
  const row = storedToken(state, token);
  assert.equal(row.delivery_status, 'queued');
  assert.equal(row.delivery_channel, 'magic-mail');
  assert.equal(row.delivery_message_id, null);
  const logText = state.logs.join('\n');
  assert.ok(logText.includes('queued the login e-mail'));
  assert.equal(logText.includes(EMAIL), false);
  assert.equal(logText.includes(token._plaintextToken), false);
});

test('login link: an uncertain failure is failed/MAGIC_MAIL_UNCERTAIN, no fallback', async () => {
  const { strapi, magicLinkService, state } = loginCore();
  const calls = withMagicMail(strapi, async () => {
    throw uncertainError();
  });
  const token = await magicLinkService.createToken(EMAIL, {});
  await assert.rejects(magicLinkService.sendLoginLink(token, {}), /504/);

  assert.equal(calls.length, 1);
  assert.equal(state.mails.length, 0);
  const row = storedToken(state, token);
  assert.equal(row.delivery_status, 'failed');
  assert.equal(row.delivery_reason, 'MAGIC_MAIL_UNCERTAIN');
  assert.equal(row.delivery_channel, 'magic-mail');
  const logText = state.logs.join('\n');
  assert.ok(logText.includes('uncertain in its outbox (HTTP 504)'));
  assert.equal(logText.includes(EMAIL), false);
});

test('login link: a pre-send failure still falls back with Magic Mail 4.4', async () => {
  const { strapi, magicLinkService, state } = createLoginCoreStrapi({
    settings: { use_magic_mail: true },
  });
  withMagicMail(strapi, async () => {
    throw Object.assign(new Error('none'), { code: 'MAGIC_MAIL_NO_ACCOUNT' });
  });
  const token = await magicLinkService.createToken(EMAIL, {});
  await magicLinkService.sendLoginLink(token, {});
  assert.equal(state.mails.length, 1);
  assert.equal(storedToken(state, token).delivery_status, 'sent');
  assert.equal(storedToken(state, token).delivery_channel, 'email');
});

test('login link: an expired token is sent with queue: false (never captured)', async () => {
  const { strapi, magicLinkService } = loginCore();
  const calls = withMagicMail(strapi, async () => ({ success: true }));
  const token = await magicLinkService.createToken(EMAIL, {});
  token.expires_at = new Date(Date.now() - 1000);
  await magicLinkService.sendLoginLink(token, {});
  assert.deepEqual(calls[0].options, { queue: false });
});

test('login link: Magic Mail before 4.4 is called exactly as before', async () => {
  const { strapi, magicLinkService, state } = loginCore();
  const calls = withMagicMail(strapi, async () => ({ success: true }), { outbox: false });
  const token = await magicLinkService.createToken(EMAIL, {});
  await magicLinkService.sendLoginLink(token, {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].argCount, 1, 'no options argument');
  assert.equal(storedToken(state, token).delivery_status, 'sent');
});

// ─────────────────────────── OTP ───────────────────────────

const otpOptions = (expiresAt) => ({ expiryMinutes: 5, otpId: 41, expiresAt });

test('OTP: Magic Mail 4.4 gets notAfter = code expiry and a per-code key', async () => {
  const mfa = createMfaStrapi({ settings: { use_magic_mail: true } });
  const calls = withMagicMail(mfa.strapi, async () => ({ success: true }));
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const sent = await createOtpService({ strapi: mfa.strapi }).sendOTPEmail(
    EMAIL,
    CODE,
    otpOptions(expiresAt)
  );
  assert.equal(sent, true);
  const { options } = calls[0];
  assert.equal(options.notAfter.getTime(), expiresAt.getTime());
  assert.equal(options.idempotencyKey, outboxKeyFor('otp', 41));
  assert.equal(options.idempotencyKey.includes(CODE), false);
  assert.equal(options.queue, undefined);
});

test('OTP: a queued result resolves without the e-mail plugin', async () => {
  const mfa = createMfaStrapi({ settings: { use_magic_mail: true } });
  withMagicMail(mfa.strapi, async () => ({ ...QUEUED }));
  const sent = await createOtpService({ strapi: mfa.strapi }).sendOTPEmail(
    EMAIL,
    CODE,
    otpOptions(new Date(Date.now() + 60_000))
  );
  assert.equal(sent, true);
  assert.equal(mfa.mails.length, 0);
  const logText = mfa.logs.join('\n');
  assert.ok(logText.includes('queued the OTP e-mail'));
  assert.equal(logText.includes(CODE), false);
});

test('OTP: an uncertain failure throws and never falls back', async () => {
  const mfa = createMfaStrapi({ settings: { use_magic_mail: true } });
  withMagicMail(mfa.strapi, async () => {
    throw uncertainError();
  });
  await assert.rejects(
    createOtpService({ strapi: mfa.strapi }).sendOTPEmail(
      EMAIL,
      CODE,
      otpOptions(new Date(Date.now() + 60_000))
    ),
    /504/
  );
  assert.equal(mfa.mails.length, 0);
  assert.ok(mfa.logs.join('\n').includes('uncertain in its outbox'));
});

test('OTP: without an id or expiry nothing is captured; old Magic Mail unchanged', async () => {
  const bare = createMfaStrapi({ settings: { use_magic_mail: true } });
  const bareCalls = withMagicMail(bare.strapi, async () => ({ success: true }));
  await createOtpService({ strapi: bare.strapi }).sendOTPEmail(EMAIL, CODE, { expiryMinutes: 5 });
  assert.deepEqual(bareCalls[0].options, { queue: false });

  const old = createMfaStrapi({ settings: { use_magic_mail: true } });
  const oldCalls = withMagicMail(old.strapi, async () => ({ success: true }), { outbox: false });
  await createOtpService({ strapi: old.strapi }).sendOTPEmail(
    EMAIL,
    CODE,
    otpOptions(new Date(Date.now() + 60_000))
  );
  assert.equal(oldCalls[0].argCount, 1);
});

test('OTP: createOTP output carries the id and expiry the send needs', async () => {
  const mfa = createMfaStrapi({
    settings: { use_magic_mail: true, otp_enabled: true },
  });
  const calls = withMagicMail(mfa.strapi, async () => ({ success: true }));
  const service = createOtpService({ strapi: mfa.strapi });
  const entry = await service.createOTP(EMAIL, 'email', { expirySeconds: 300 });
  await service.sendOTPEmail(EMAIL, entry.code, {
    expiryMinutes: 5,
    otpId: entry.id,
    expiresAt: entry.expiresAt,
  });
  assert.equal(calls[0].options.idempotencyKey, outboxKeyFor('otp', entry.id));
  assert.equal(calls[0].options.notAfter.getTime(), new Date(entry.expiresAt).getTime());
});

test('every OTP send site passes the OTP id and expiry', () => {
  const root = path.join(__dirname, '..', 'server', 'src', 'controllers');
  let sites = 0;
  for (const file of ['otp.js', 'auth.js', 'totp.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const calls = source.split('sendOTPEmail(').slice(1);
    for (const call of calls) {
      const args = call.slice(0, call.indexOf('});'));
      assert.match(args, /otpId: \w+\.id,/, file);
      assert.match(args, /expiresAt: \w+\.expiresAt,/, file);
      sites += 1;
    }
  }
  assert.equal(sites, 4);
});
