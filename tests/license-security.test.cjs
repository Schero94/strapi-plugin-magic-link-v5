'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const createLicenseGuard = require('../server/src/services/license-guard');
const licenseController = require('../server/src/controllers/license');

const createLogger = (logs) => Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [
  level,
  (...parts) => logs.push(parts.map(String).join(' ')),
]));

test('license service logs redact full keys and identifying prefixes', async () => {
  const logs = [];
  const strapi = {
    config: { info: { strapi: '5.57.0' } },
    store: () => ({ set: async () => {} }),
    log: createLogger(logs),
  };
  const guard = createLicenseGuard({ strapi });
  guard.getLicenseServerUrl = () => 'https://license.invalid';
  guard.generateDeviceId = () => 'test-device';
  guard.getDeviceName = () => 'local-test';
  guard.getIpAddress = () => '127.0.0.1';
  guard.getUserAgent = () => 'local-test';
  const key = 'TEST-ONLY-LICENSE-KEY-DO-NOT-USE';
  const originalFetch = global.fetch;

  try {
    global.fetch = async () => ({
      json: async () => ({ success: true, data: { licenseKey: key } }),
    });
    await guard.createLicense({ email: 'local@example.test', firstName: 'Local', lastName: 'Test' });

    global.fetch = async () => ({
      json: async () => ({ success: false, message: 'verification failed' }),
    });
    await guard.verifyLicense(key);
  } finally {
    global.fetch = originalFetch;
  }

  const output = logs.join('\n');
  assert.equal(output.includes(key), false);
  assert.equal(output.includes(key.slice(0, 8)), false);
});

test('license-key fallback responses never log the key or its prefix', async () => {
  const logs = [];
  const guard = {
    verifyLicense: async () => ({ valid: false, networkError: true }),
    storeLicenseKey: async () => true,
  };
  global.strapi = {
    plugin: () => ({ service: () => guard }),
    store: () => ({ get: async () => null, set: async () => {} }),
    log: createLogger(logs),
  };
  const key = 'TEST-ONLY-ANOTHER-LICENSE-KEY';
  const ctx = {
    request: { body: { licenseKey: key, email: 'local@example.test' } },
    send(payload) { this.response = payload; return payload; },
    badRequest(message) { this.response = { error: message }; return this.response; },
  };

  await licenseController.storeKey(ctx);

  assert.equal(ctx.response.success, true);
  assert.equal(logs.join('\n').includes(key), false);
  assert.equal(logs.join('\n').includes(key.slice(0, 8)), false);
});

test('no-key license screen does not advertise registration controls that are absent', () => {
  const source = fs.readFileSync(path.join(__dirname, '../admin/src/pages/License/index.jsx'), 'utf8');

  assert.match(source, /All Magic Link features are available without activation\./);
  assert.ok(!/use the form below|Auto-Activate/.test(source), 'the no-key alert does not point to missing registration controls');
});
