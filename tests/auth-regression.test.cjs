'use strict';

/**
 * Email-only regression guards: WhatsApp and SMS delivery were removed in
 * 6.0.0. These checks keep them from coming back through routes, schemas,
 * services or dependencies.
 */

const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { sendLinkSchema, settingsUpdateSchema } = require('../server/src/controllers/validation');

test('Magic Link ships no WhatsApp delivery code, routes or dependencies', () => {
  const server = require('../server/src');
  const controllers = require('../server/src/controllers');
  const services = require('../server/src/services');
  const adminRoutes = require('../server/src/routes/admin').routes;
  const contentRoutes = require('../server/src/routes/content-api').routes;
  const authSource = readFileSync(
    path.join(__dirname, '../server/src/controllers/auth.js'),
    'utf8'
  );
  const packageJson = require('../package.json');
  const packageLock = require('../package-lock.json');

  assert.equal(
    existsSync(path.join(__dirname, '../server/src/services/magic-whatsapp-provider.js')),
    false
  );
  assert.equal(server.services.whatsapp, undefined);
  assert.equal(controllers.whatsapp, undefined);
  assert.equal(services.whatsapp, undefined);
  assert.equal(
    [...adminRoutes, ...contentRoutes].some((route) => /whatsapp|sms/i.test(route.path)),
    false
  );
  assert.equal(
    /whatsapp|phoneNumber/i.test(authSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
    false
  );
  assert.equal(existsSync(path.join(__dirname, '../admin/src/pages/WhatsApp/index.jsx')), false);
  assert.equal('@whiskeysockets/baileys' in packageJson.dependencies, false);
  assert.equal(
    packageJson.keywords.some((keyword) => /whatsapp|sms/i.test(keyword)),
    false
  );
  assert.equal(
    Object.keys(packageLock.packages).some((key) => /baileys|libsignal/i.test(key)),
    false
  );
});

test('send-link accepts e-mail delivery only', () => {
  assert.equal(
    sendLinkSchema.safeParse({ email: 'Person@Example.Test' }).data.email,
    'person@example.test'
  );
  assert.equal(
    sendLinkSchema.safeParse({ email: 'person@example.test', delivery: 'email' }).success,
    true
  );
  for (const body of [
    { phoneNumber: '+490000000' },
    { phone: '+490000000', email: 'person@example.test' },
    { email: 'person@example.test', delivery: 'whatsapp' },
    { email: 'person@example.test', delivery: 'sms' },
    { email: 'person@example.test', via: 'whatsapp' },
  ]) {
    const result = sendLinkSchema.safeParse(body);
    assert.equal(result.success, false, JSON.stringify(body));
    assert.match(result.error.issues[0].message, /e-mail delivery/i);
  }
});

test('settings reject SMS OTP, short tokens and unsafe link URLs', () => {
  const invalid = [
    { otp_type: 'sms' },
    { otp_type: 'totp' },
    { token_length: 5 },
    { token_length: 21 },
    { confirmationUrl: 'http://login.example.test/api/magic-link/login' },
    { frontend_url: 'javascript:alert(1)' },
    { frontend_url: 'https://user:pass@example.test' },
    { jwt_token_expires_in: '0d' },
  ];
  for (const settings of invalid) {
    assert.equal(settingsUpdateSchema.safeParse(settings).success, false, JSON.stringify(settings));
  }

  const valid = [
    { otp_type: 'email' },
    { token_length: 22 },
    { confirmationUrl: '' },
    { confirmationUrl: 'http://localhost:1337/api/magic-link/login' },
    { frontend_url: 'https://app.example.test' },
    { jwt_token_expires_in: '15m' },
  ];
  for (const settings of valid) {
    assert.equal(settingsUpdateSchema.safeParse(settings).success, true, JSON.stringify(settings));
  }
});
