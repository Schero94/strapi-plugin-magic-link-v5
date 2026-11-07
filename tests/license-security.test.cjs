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

test('license service sends only the encoded key, never host or admin data, and never logs the key', async () => {
  const logs = [];
  const strapi = {
    config: { get: (_key, fallback) => fallback },
    store: () => ({ set: async () => {} }),
    log: createLogger(logs),
  };
  const guard = createLicenseGuard({ strapi });
  const key = 'TEST-ONLY-LICENSE-KEY-DO-NOT-USE';
  const requests = [];
  const originalFetch = global.fetch;

  try {
    global.fetch = async (url, options = {}) => {
      requests.push({ url, body: options.body });
      return { json: async () => ({ success: false, message: 'verification failed' }) };
    };
    await guard.verifyLicense(key);
    await guard.lookupLicense(key);
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(requests.length, 2);
  assert.deepEqual(Object.keys(JSON.parse(requests[0].body)).sort(), ['licenseKey', 'pluginName']);
  assert.ok(requests[1].url.endsWith(`/api/licenses/key/${encodeURIComponent(key)}`));
  assert.equal(typeof guard.createLicense, 'undefined', 'no telemetry-bearing license creation');
  assert.equal(typeof guard.generateDeviceId, 'undefined');
  const output = logs.join('\n');
  assert.equal(output.includes(key), false);
  assert.equal(output.includes(key.slice(0, 8)), false);
});

test('license lookups are cached, never sent for malformed keys and can be switched off', async () => {
  const configValues = { 'plugin::magic-link.license.remoteLookup': true };
  const strapi = {
    config: { get: (key, fallback) => (key in configValues ? configValues[key] : fallback) },
    store: () => ({ set: async () => {} }),
    log: createLogger([]),
  };
  const guard = createLicenseGuard({ strapi });
  let calls = 0;
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => { calls += 1; return { json: async () => ({ success: true, data: { isActive: true } }) }; };
    assert.equal((await guard.lookupLicense('SYNTHETIC-KEY-1234')).status, 'ok');
    assert.equal((await guard.lookupLicense('SYNTHETIC-KEY-1234')).status, 'ok');
    assert.equal(calls, 1, 'second lookup is served from the cache');

    assert.equal((await guard.lookupLicense('../../admin?x=1')).status, 'not-found');
    assert.equal(calls, 1, 'malformed keys never reach the network');

    configValues['plugin::magic-link.license.remoteLookup'] = false;
    guard.cleanup();
    assert.equal((await guard.lookupLicense('SYNTHETIC-KEY-1234')).status, 'disabled');
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('license status masks the key for settings readers and shows it only to settings editors', async () => {
  const key = 'SYNTHETIC-LICENSE-KEY-9876';
  const guard = {
    lookupLicense: async () => ({ status: 'unavailable', license: null }),
  };
  global.strapi = {
    plugin: () => ({ service: () => guard }),
    store: () => ({ get: async () => key }),
    log: createLogger([]),
  };
  const makeCtx = (canUpdate) => ({
    state: { userAbility: { can: (action) => canUpdate && action === 'plugin::magic-link.settings.update' } },
    send(payload) { this.response = payload; return payload; },
    throw(status) { throw new Error(String(status)); },
  });

  const reader = makeCtx(false);
  await licenseController.getStatus(reader);
  assert.equal(reader.response.data.licenseKey, undefined);
  assert.equal(reader.response.data.licenseKeyMasked.endsWith('9876'), true);
  assert.equal(JSON.stringify(reader.response).includes(key), false);
  assert.equal(reader.response.lookup, 'unavailable');
  assert.equal(reader.response.valid, true, 'an unreachable license server never invalidates the plugin');

  const editor = makeCtx(true);
  await licenseController.getStatus(editor);
  assert.equal(editor.response.data.licenseKey, key);
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
