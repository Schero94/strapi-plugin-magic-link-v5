'use strict';

/**
 * Strapi peer floor at start-up. Below Strapi 5.50.0 the users-permissions
 * session manager has no `revokeSessionById`, so revoking a session in
 * refresh mode answers 500 (measured with tests/host/strapi-host.test.cjs on
 * 5.24.2 and 5.49.0). The register hook logs one clear error naming the
 * required version; the peer range, this check and the CI floor job agree.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const register = require('../server/src/register');
const {
  MIN_STRAPI_VERSION,
  isSupportedStrapiVersion,
} = require('../server/src/utils/strapi-version');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/**
 * Minimal Strapi double for the register hook with a given runtime version.
 *
 * @param {string|undefined} version Value of `info.strapi`.
 * @returns {{strapi: object, errors: string[]}} The double and its error lines.
 */
function fakeStrapi(version) {
  const errors = [];
  const config = { 'info.strapi': version, 'api.rest.prefix': '/api' };
  const strapi = {
    config: { get: (key, fallback) => (key in config ? config[key] : fallback) },
    server: { use() {} },
    plugin: () => null,
    log: {
      debug() {},
      info() {},
      warn() {},
      error: (message) => errors.push(String(message)),
    },
  };
  return { strapi, errors };
}

test('the floor is Strapi 5.50.0 and matches the peer ranges', () => {
  assert.equal(MIN_STRAPI_VERSION, '5.50.0');
  assert.equal(pkg.peerDependencies['@strapi/strapi'], `^${MIN_STRAPI_VERSION}`);
  assert.equal(pkg.peerDependencies['@strapi/plugin-users-permissions'], `^${MIN_STRAPI_VERSION}`);
});

test('versions below the floor are unsupported, the floor and later 5.x are supported', () => {
  for (const version of ['5.0.0', '5.24.2', '5.49.0', '5.49.9']) {
    assert.equal(isSupportedStrapiVersion(version), false, version);
  }
  for (const version of ['5.50.0', '5.50.1', '5.62.0', '5.100.0']) {
    assert.equal(isSupportedStrapiVersion(version), true, version);
  }
  assert.equal(isSupportedStrapiVersion('6.0.0'), false, 'Strapi 6 is not a tested peer');
});

test('an unknown or malformed version is not judged', () => {
  for (const version of [undefined, null, '', 'latest', 5]) {
    assert.equal(isSupportedStrapiVersion(version), null, String(version));
  }
});

test('register logs one clear error on a Strapi version below the floor', () => {
  const { strapi, errors } = fakeStrapi('5.49.0');
  register({ strapi });
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /^\[magic-link\] Strapi 5\.49\.0 is not supported/);
  assert.match(errors[0], /requires Strapi 5\.50\.0 or later/);
});

test('register logs no floor error on a supported or unknown Strapi version', () => {
  for (const version of ['5.50.0', '5.62.0', undefined]) {
    const { strapi, errors } = fakeStrapi(version);
    register({ strapi });
    assert.deepEqual(errors, [], String(version));
  }
});
