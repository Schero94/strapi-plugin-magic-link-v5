'use strict';

/**
 * 7.0.0: the plugin has no license feature and makes no outbound call of its
 * own. These tests guard the removal (admin page, settings link, routes,
 * controller, service, config, translations, docs) and the one-time cleanup
 * of license data an earlier release stored.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

/**
 * Lists every file below a directory.
 *
 * @param {string} dir - Repository-relative directory.
 * @returns {string[]} Repository-relative file paths.
 */
const walk = (dir) =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(rel) : [rel];
  });

const LICENSE_PATTERN = /licen[cs]e|magicapi|fitlex|remoteLookup|MAGIC_LICENSE|LICENSE_LOOKUP/i;

test('license files are gone', () => {
  for (const file of [
    'admin/src/pages/License/index.jsx',
    'admin/src/components/LicenseGuard.jsx',
    'server/src/controllers/license.js',
    'server/src/services/license-guard.js',
  ]) {
    assert.equal(exists(file), false, file);
  }
});

test('no source file mentions a license, the license server or a lookup switch', () => {
  // legacy-cleanup.js names the two 6.x store keys it deletes.
  const files = [...walk('admin/src'), ...walk('server/src')].filter(
    (file) => !file.endsWith(path.join('utils', 'legacy-cleanup.js'))
  );
  for (const file of files) {
    const source = read(file);
    if (file.endsWith('.json')) {
      // Decode the JSON so \u escapes cannot hide a key or value.
      const entries = Object.entries(JSON.parse(source));
      for (const [key, value] of entries) {
        assert.doesNotMatch(`${key} ${JSON.stringify(value)}`, LICENSE_PATTERN, `${file}: ${key}`);
      }
    } else {
      assert.doesNotMatch(source, LICENSE_PATTERN, file);
    }
  }
});

test('the server makes no outbound HTTP call of its own (no telemetry, no ping)', () => {
  // The only fetch: SNS certificates and subscription confirmation for the
  // opt-in SES bounce webhook, triggered by AWS and limited to AWS hosts.
  const fetchers = [];
  for (const file of walk('server/src')) {
    if (!file.endsWith('.js')) continue;
    const source = read(file);
    if (/\bfetch\s*\(/.test(source)) fetchers.push(file);
    assert.doesNotMatch(source, /require\(['"](?:node:)?https?['"]\)/, `${file}: http module`);
    assert.doesNotMatch(source, /axios|got\(|undici/, `${file}: http client`);
  }
  assert.deepEqual(fetchers, [path.join('server', 'src', 'services', 'delivery-feedback.js')]);
  const feedback = read('server/src/services/delivery-feedback.js');
  assert.equal(feedback.match(/\bfetch\s*\(/g).length, 1);
  assert.match(feedback, /hosts validated by the caller/);
  assert.match(read('server/src/utils/webhook-signatures.js'), /SNS_HOST = .*amazonaws/);
});

test('no license route is registered', () => {
  const adminRoutes = require('../server/src/routes/admin.js').routes;
  const contentRoutes = require('../server/src/routes/content-api.js').routes;
  for (const route of [...adminRoutes, ...contentRoutes]) {
    assert.doesNotMatch(route.path, /licen/i, `${route.method} ${route.path}`);
    assert.doesNotMatch(route.handler, /licen/i, `${route.method} ${route.path}`);
  }
  const controllers = require('../server/src/controllers/index.js');
  const services = require('../server/src/services/index.js');
  assert.equal(
    Object.keys(controllers).some((name) => /licen/i.test(name)),
    false
  );
  assert.equal(
    Object.keys(services).some((name) => /licen/i.test(name)),
    false
  );
});

/**
 * Minimal plugin store fake with the get/delete API of the Strapi core store.
 *
 * @param {Record<string, unknown>} initial - Stored keys.
 * @returns {{ strapi: object, data: Map<string, unknown>, deletes: string[] }}
 */
const fakeStrapi = (initial) => {
  const data = new Map(Object.entries(initial));
  const deletes = [];
  const store = {
    async get({ key }) {
      return data.get(key);
    },
    async set({ key, value }) {
      data.set(key, value);
    },
    async delete({ key }) {
      deletes.push(key);
      data.delete(key);
    },
  };
  const logs = [];
  const strapi = {
    store: () => store,
    db: { dialect: { client: 'sqlite' }, connection: { client: { config: { client: 'x' } } } },
    log: { info: (msg) => logs.push(msg), warn: (msg) => logs.push(msg) },
  };
  return { strapi, data, deletes, logs };
};

test('removeLegacyRegistrationKeys deletes the stored 6.x key once and leaves other keys', async () => {
  const { removeLegacyRegistrationKeys } = require('../server/src/utils/legacy-cleanup');
  const { strapi, data, deletes, logs } = fakeStrapi({
    licenseKey: 'ABCD-1234-EFGH-5678',
    lastValidated: '2026-01-01T00:00:00.000Z',
    settings: { enabled: true },
  });

  const first = await removeLegacyRegistrationKeys(strapi);
  assert.equal(first, 2);
  assert.deepEqual(deletes.sort(), ['lastValidated', 'licenseKey']);
  assert.equal(data.has('licenseKey'), false);
  assert.equal(data.has('lastValidated'), false);
  assert.deepEqual(data.get('settings'), { enabled: true });
  // The log line never contains the key.
  assert.equal(
    logs.some((line) => line.includes('ABCD')),
    false
  );

  const second = await removeLegacyRegistrationKeys(strapi);
  assert.equal(second, 0);
  assert.equal(deletes.length, 2, 'nothing is deleted on the next start');
});

test('bootstrap runs the 6.x key cleanup', () => {
  const bootstrap = read('server/src/bootstrap.js');
  assert.match(bootstrap, /removeLegacyRegistrationKeys\(strapi\)/);
});

test('admin registers only the Settings link in its settings section', async () => {
  const source = read('admin/src/index.js');
  assert.doesNotMatch(source, /pages\/License|magic-link-license/);
});

test('package.json: accurate metadata and install-friendly peers', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.homepage, 'https://schero94.github.io/strapi-plugin-magic-link-v5/');
  assert.equal(
    pkg.repository.url,
    'git+https://github.com/Schero94/strapi-plugin-magic-link-v5.git'
  );
  assert.doesNotMatch(pkg.description, /enterprise|ultimate|powerful|seamless/i);
  assert.ok(pkg.dependencies['@strapi/utils'], '@strapi/utils is a dependency');
  assert.equal(pkg.peerDependencies['@strapi/utils'], undefined);
  for (const optional of ['@strapi/design-system', '@strapi/icons', 'react-intl']) {
    assert.ok(pkg.peerDependencies[optional], `${optional} peer`);
    assert.deepEqual(pkg.peerDependenciesMeta?.[optional], { optional: true }, optional);
  }
  for (const required of [
    '@strapi/strapi',
    '@strapi/plugin-users-permissions',
    'react',
    'react-dom',
    'react-router-dom',
    'styled-components',
  ]) {
    assert.ok(pkg.peerDependencies[required], `${required} peer`);
    assert.equal(pkg.peerDependenciesMeta?.[required], undefined, `${required} stays required`);
  }
});

test('README and Pages say nothing about a license key and Pages has the multi-instance guide', () => {
  const site = read('docs/site/index.html');
  // The 6.x to 7.0.0 upgrade guide names what was removed; nothing else may.
  const fullReadme = read('README.md');
  const upgradeStart = fullReadme.indexOf('## Upgrading from 6.x to 7.0.0');
  const upgradeEnd = fullReadme.indexOf('## Upgrading from 5.x to 6.0.0');
  assert.ok(upgradeStart > 0 && upgradeEnd > upgradeStart, 'README has the 7.0.0 upgrade guide');
  const readme = fullReadme.slice(0, upgradeStart) + fullReadme.slice(upgradeEnd);
  for (const [name, text] of [
    ['README.md', readme],
    ['docs/site/index.html', site],
  ]) {
    assert.doesNotMatch(text, /license key|magicapi|fitlex|remoteLookup|License page/i, name);
  }
  assert.match(site, /id="several-instances"/);
  assert.match(site, /pm2/);
  assert.match(site, /Railway/);
});
