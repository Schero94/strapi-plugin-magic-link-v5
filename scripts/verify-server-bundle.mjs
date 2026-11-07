import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const allowedExternals = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
]);
const RBAC_ACTIONS = new Set([
  'plugin::magic-link.read',
  'plugin::magic-link.manage',
  'plugin::magic-link.tokens.issue',
  'plugin::magic-link.settings.read',
  'plugin::magic-link.settings.update',
]);
const route = (routes, method, path) =>
  routes.some((entry) => entry.method === method && entry.path === path);
const outputs = [
  ['CommonJS', require('../dist/server/index.js')],
  ['ESM', await import('../dist/server/index.mjs')],
];

for (const [format, loaded] of outputs) {
  const plugin = loaded.default || loaded;
  assert.equal(
    typeof plugin.controllers.auth.sendLink,
    'function',
    `${format} auth controller is missing`
  );
  assert.equal(
    typeof plugin.services['magic-link'],
    'function',
    `${format} magic-link service is missing`
  );
  assert.equal(
    typeof plugin.services['rate-limiter'],
    'function',
    `${format} rate-limiter is missing`
  );
  assert.equal(plugin.controllers.whatsapp, undefined, `${format} includes the removed controller`);
  assert.equal(plugin.services.whatsapp, undefined, `${format} includes the removed transport`);
  assert.equal(
    plugin.routes.admin.routes.some((route) => route.path.startsWith('/whatsapp/')),
    false
  );
  assert.equal(typeof plugin.controllers.totp, 'object', `${format} TOTP controller is missing`);

  // 6.0 public surface: POST exchange, legacy GET, end-user TOTP self-service.
  const publicRoutes = plugin.routes['content-api'].routes;
  for (const [method, path] of [
    ['POST', '/login'],
    ['GET', '/login'],
    ['POST', '/send-link'],
    ['POST', '/totp/enroll'],
    ['POST', '/totp/setup'],
    ['POST', '/totp/disable'],
    ['POST', '/totp/backup-codes'],
  ]) {
    assert.ok(route(publicRoutes, method, path), `${format} misses ${method} ${path}`);
  }
  assert.equal(
    [...publicRoutes, ...plugin.routes.admin.routes].some((entry) =>
      /whatsapp|sms|phone/i.test(entry.path)
    ),
    false,
    `${format} exposes a removed WhatsApp/SMS route`
  );

  // Every admin route requires an authenticated admin and a plugin RBAC action.
  for (const entry of plugin.routes.admin.routes) {
    const policies = entry.config?.policies || [];
    assert.ok(
      policies.includes('admin::isAuthenticatedAdmin'),
      `${format} ${entry.method} ${entry.path} lacks isAuthenticatedAdmin`
    );
    const permission = policies.find((policy) => policy?.name === 'admin::hasPermissions');
    assert.ok(
      permission?.config?.actions?.length &&
        permission.config.actions.every((action) => RBAC_ACTIONS.has(action)),
      `${format} ${entry.method} ${entry.path} lacks a plugin RBAC action`
    );
  }
}

// The bundles may only load Node built-ins, declared dependencies and peers.
for (const file of ['../dist/server/index.js', '../dist/server/index.mjs']) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const specifiers = [...source.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map(
    (match) => match[1]
  );
  const undeclared = [...new Set(specifiers)].filter(
    (specifier) => !specifier.startsWith('.') && !allowedExternals.has(specifier)
  );
  assert.deepEqual(undeclared, [], `${file} requires undeclared packages`);
}

console.log(
  'Magic Link server bundles load, expose the e-mail/TOTP surface, guard every admin route with RBAC and use only declared dependencies'
);
