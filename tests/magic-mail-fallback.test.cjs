'use strict';

/**
 * Magic Mail fallback rules for login links and OTP codes: fall back to
 * another provider only when Magic Mail proves it sent nothing; never after
 * an ambiguous provider error (a second, still valid login mail). Synthetic
 * data only; no network.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const { createLoginCoreStrapi } = require('./helpers/login-core-strapi.cjs');
const { createMfaStrapi, useTestSecrets } = require('./helpers/mfa-strapi.cjs');
const createOtpService = require('../server/src/services/otp');
const {
  isMagicMailPreSendFailure,
  describeMagicMailError,
  getMagicMailRouter,
} = require('../server/src/utils/magic-mail-delivery');

useTestSecrets();

const EMAIL = 'person@example.test';

const withMagicMail = (strapi, send) => {
  const base = strapi.plugin.bind(strapi);
  const calls = [];
  strapi.plugin = (name) =>
    name === 'magic-mail'
      ? {
          service: (key) =>
            key === 'email-router'
              ? {
                  send: async (mail) => {
                    calls.push(mail);
                    return send(mail);
                  },
                }
              : { findOne: async () => null },
        }
      : base(name);
  return calls;
};

const codedError = (code, message = `failed for ${EMAIL}`) =>
  Object.assign(new Error(message), { code });

test('pre-send classification follows the Magic Mail 4.0 router contract', () => {
  for (const code of [
    'MAGIC_MAIL_NO_ACCOUNT',
    'MAGIC_MAIL_QUOTA_EXHAUSTED',
    'MAGIC_MAIL_ACCOUNT_QUOTA',
    'MAGIC_MAIL_ACCOUNT_UNAVAILABLE',
    'MAGIC_MAIL_ACCOUNT_CONFIG',
  ]) {
    assert.equal(isMagicMailPreSendFailure(codedError(code)), true, code);
  }
  assert.equal(
    isMagicMailPreSendFailure(Object.assign(new Error('x'), { magicMailRetryable: true })),
    true
  );
  assert.equal(isMagicMailPreSendFailure(new Error('Template rendering failed: missing')), true);

  for (const error of [
    new Error('socket hang up'),
    codedError('ETIMEDOUT'),
    codedError('ECONNRESET'),
    codedError('MAGIC_MAIL_VALIDATION'),
    Object.assign(new Error('SendGrid API request failed: 504'), {
      status: 504,
      magicMailRetryable: false,
    }),
    null,
    'string',
  ]) {
    assert.equal(isMagicMailPreSendFailure(error), false);
  }
});

test('log labels never contain the error message', () => {
  assert.equal(
    describeMagicMailError(codedError('MAGIC_MAIL_NO_ACCOUNT')),
    'MAGIC_MAIL_NO_ACCOUNT'
  );
  assert.equal(
    describeMagicMailError(Object.assign(new Error(EMAIL), { status: 504 })),
    'HTTP 504'
  );
  assert.equal(
    describeMagicMailError(new Error(`Template rendering failed: ${EMAIL}`)),
    'TEMPLATE_RENDERING'
  );
  assert.equal(describeMagicMailError(codedError(`bad ${EMAIL}`)), 'Error');
  assert.equal(describeMagicMailError(undefined), 'unknown');
});

test('router lookup returns null when Magic Mail is absent or incomplete', () => {
  assert.equal(getMagicMailRouter({ plugin: () => undefined }), null);
  assert.equal(getMagicMailRouter({ plugin: () => ({ service: () => undefined }) }), null);
  assert.equal(
    getMagicMailRouter({
      plugin: () => ({
        service: () => {
          throw new Error('no service');
        },
      }),
    }),
    null
  );
  const router = { send() {} };
  assert.equal(getMagicMailRouter({ plugin: () => ({ service: () => router }) }), router);
});

test('login link: without Magic Mail the e-mail plugin sends once', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({
    settings: { use_magic_mail: true },
  });
  const token = await magicLinkService.createToken(EMAIL, {});
  await magicLinkService.sendLoginLink(token, {});
  assert.equal(state.mails.length, 1);
  assert.ok(state.logs.some((line) => line.includes('not installed')));
});

test('login link: Magic Mail success sends exactly once', async () => {
  const { strapi, magicLinkService, state } = createLoginCoreStrapi({
    settings: { use_magic_mail: true },
  });
  const calls = withMagicMail(strapi, async () => ({ success: true }));
  const token = await magicLinkService.createToken(EMAIL, {});
  await magicLinkService.sendLoginLink(token, {});
  assert.equal(calls.length, 1);
  assert.equal(state.mails.length, 0);
});

test('login link: a pre-send failure falls back to the e-mail plugin', async () => {
  const { strapi, magicLinkService, state } = createLoginCoreStrapi({
    settings: { use_magic_mail: true },
  });
  const calls = withMagicMail(strapi, async () => {
    throw codedError('MAGIC_MAIL_NO_ACCOUNT');
  });
  const token = await magicLinkService.createToken(EMAIL, {});
  await magicLinkService.sendLoginLink(token, {});
  assert.equal(calls.length, 1);
  assert.equal(state.mails.length, 1);
  const logText = state.logs.join('\n');
  assert.ok(logText.includes('MAGIC_MAIL_NO_ACCOUNT'));
  assert.equal(logText.includes(EMAIL), false);
  assert.equal(logText.includes('Invalid Email Designer template id'), false);
});

test('login link: an ambiguous provider failure is surfaced and never re-sent', async () => {
  const { strapi, magicLinkService, state } = createLoginCoreStrapi({
    settings: {
      use_magic_mail: true,
      use_email_designer: true,
      email_designer_template_id: '3',
    },
  });
  const calls = withMagicMail(strapi, async () => {
    throw Object.assign(new Error(`SendGrid API request failed: 504 for ${EMAIL}`), {
      status: 504,
      magicMailRetryable: false,
    });
  });
  const token = await magicLinkService.createToken(EMAIL, {});
  await assert.rejects(magicLinkService.sendLoginLink(token, {}), /504/);
  assert.equal(calls.length, 1);
  assert.equal(state.mails.length, 0, 'no second login link through the e-mail plugin');
  const logText = state.logs.join('\n');
  assert.ok(logText.includes('unknown outcome (HTTP 504)'));
  assert.equal(logText.includes(EMAIL), false);
  assert.equal(logText.includes(token._plaintextToken), false);
});

test('OTP: Magic Mail success is untracked; absent Magic Mail uses the e-mail plugin', async () => {
  const absent = createMfaStrapi({ settings: { use_magic_mail: true } });
  await createOtpService({ strapi: absent.strapi }).sendOTPEmail(EMAIL, '482913', {
    expiryMinutes: 5,
  });
  assert.equal(absent.mails.length, 1);

  const present = createMfaStrapi({ settings: { use_magic_mail: true } });
  const calls = withMagicMail(present.strapi, async () => ({ success: true }));
  await createOtpService({ strapi: present.strapi }).sendOTPEmail(EMAIL, '482913', {
    expiryMinutes: 5,
  });
  assert.equal(calls.length, 1);
  assert.equal(present.mails.length, 0);
  assert.equal(calls[0].type, 'transactional');
  assert.equal(calls[0].enableTracking, false);
  assert.equal(calls[0].skipLinkTracking, true);
});

test('OTP: quota exhaustion falls back, a timeout does not', async () => {
  const quota = createMfaStrapi({ settings: { use_magic_mail: true } });
  withMagicMail(quota.strapi, async () => {
    throw codedError('MAGIC_MAIL_QUOTA_EXHAUSTED');
  });
  await createOtpService({ strapi: quota.strapi }).sendOTPEmail(EMAIL, '482913', {
    expiryMinutes: 5,
  });
  assert.equal(quota.mails.length, 1);

  const timeout = createMfaStrapi({ settings: { use_magic_mail: true } });
  withMagicMail(timeout.strapi, async () => {
    throw codedError('ETIMEDOUT');
  });
  await assert.rejects(
    createOtpService({ strapi: timeout.strapi }).sendOTPEmail(EMAIL, '482913', {
      expiryMinutes: 5,
    })
  );
  assert.equal(timeout.mails.length, 0);
  assert.equal(timeout.logs.join('\n').includes('482913'), false);
});
