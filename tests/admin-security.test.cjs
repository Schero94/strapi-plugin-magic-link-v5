'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const routes = require('../server/src/routes/admin').routes;
const controller = require('../server/src/controllers/controller');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('settings routes require their distinct read and update permissions', () => {
  const readRoute = routes.find((route) => route.method === 'GET' && route.path === '/settings');
  const writeRoute = routes.find((route) => route.method === 'PUT' && route.path === '/settings');
  const actionsFor = (route) => route.config.policies
    .flatMap((policy) => policy.config?.actions || []);

  assert.ok(actionsFor(readRoute).includes('plugin::magic-link.settings.read'));
  assert.ok(actionsFor(writeRoute).includes('plugin::magic-link.settings.update'));
  assert.equal(actionsFor(readRoute).includes('plugin::magic-link.access'), false);
  assert.equal(actionsFor(writeRoute).includes('plugin::magic-link.access'), false);
  assert.ok(readRoute.config.policies.includes('admin::isAuthenticatedAdmin'));
  assert.ok(writeRoute.config.policies.includes('admin::isAuthenticatedAdmin'));

  const resetRoute = routes.find((route) => route.path === '/reset-data');
  assert.ok(actionsFor(resetRoute).includes('plugin::magic-link.settings.update'));

  const statsRoute = routes.find((route) => route.path === '/rate-limit/stats');
  assert.ok(actionsFor(statsRoute).includes('plugin::magic-link.settings.read'));
});

test('public login and second-factor endpoints remain intentionally unauthenticated', () => {
  const publicRoutes = require('../server/src/routes/content-api').routes;

  for (const pathName of ['/login', '/send-link', '/otp/send', '/otp/verify', '/otp/resend', '/verify-mfa-totp', '/login-totp']) {
    const route = publicRoutes.find((candidate) => candidate.path === pathName);
    assert.ok(route, `${pathName} route remains registered`);
    assert.equal(route.config.auth, false, `${pathName} remains public by design`);
  }
});

test('rate-limit cleanup and reset are registered only as POST mutations', () => {
  const actions = routes.filter((route) => ['/rate-limit/cleanup', '/rate-limit/reset'].includes(route.path));

  assert.equal(actions.length, 2);
  assert.ok(actions.every((route) => route.method === 'POST'));
});

test('settings update rejects invalid authentication policy values without writing', async () => {
  let writes = 0;
  global.strapi = {
    store: () => ({
      get: async () => ({ mfa_mode: 'disabled', mfa_require_totp: false }),
      set: async () => { writes += 1; },
    }),
    plugin: () => undefined,
    log: { info() {} },
  };
  const ctx = { request: { body: { mfa_mode: 'not-a-mode', otp_enabled: 'yes' } } };

  ctx.throw = (status, error) => { throw error || new Error(String(status)); };

  await assert.rejects(controller.updateSettings(ctx), /Invalid request body/);
  assert.equal(writes, 0);
});

test('settings writes normalize legacy required TOTP and preserve unrelated stored settings', async () => {
  let persisted;
  const existing = {
    custom_flag: 'kept',
    mfa_mode: 'disabled',
    mfa_require_totp: false,
    sms_api_secret: 'local-test-secret',
  };
  global.strapi = {
    store: () => ({
      get: async () => existing,
      set: async ({ value }) => { persisted = value; },
    }),
    plugin: () => undefined,
    log: { info() {} },
  };
  const ctx = {
    request: { body: { mfa_mode: 'disabled', mfa_require_totp: true } },
    send(payload) { this.response = payload; return payload; },
  };

  await controller.updateSettings(ctx);

  assert.equal(persisted.mfa_mode, 'required');
  assert.equal(persisted.mfa_require_totp, true);
  assert.equal(persisted.custom_flag, 'kept');
  assert.equal(persisted.sms_api_secret, 'local-test-secret');
  assert.equal(ctx.response.settings.custom_flag, persisted.custom_flag);
  assert.equal(ctx.response.settings.sms_api_secret, undefined);
});

test('settings read responses omit reserved provider credentials', async () => {
  const stored = { sms_api_key: 'local-test-key', sms_api_secret: 'local-test-secret' };
  global.strapi = {
    store: () => ({ get: async () => stored }),
    plugin: () => undefined,
    config: { get: () => ({}) },
    log: { info() {} },
  };
  const ctx = { send(payload) { this.response = payload; return payload; } };

  await controller.getSettings(ctx);

  assert.equal(ctx.response.settings.sms_api_key, undefined);
  assert.equal(ctx.response.settings.sms_api_secret, undefined);
});

test('a legacy-only TOTP disable update clears a previously required mode', async () => {
  let persisted;
  global.strapi = {
    store: () => ({
      get: async () => ({ mfa_mode: 'required', mfa_require_totp: true }),
      set: async ({ value }) => { persisted = value; },
    }),
    plugin: () => undefined,
    log: { info() {} },
  };
  const ctx = {
    request: { body: { mfa_require_totp: false } },
    send(payload) { this.response = payload; return payload; },
  };

  await controller.updateSettings(ctx);

  assert.equal(persisted.mfa_mode, 'disabled');
  assert.equal(persisted.mfa_require_totp, false);
});

test('rate-limit controls submit mutations with POST', () => {
  const settingsPage = source('admin/src/pages/Settings/SettingsModern.jsx');

  assert.ok(/post\('\/magic-link\/rate-limit\/cleanup'\)/.test(settingsPage));
  assert.ok(/post\('\/magic-link\/rate-limit\/reset'\)/.test(settingsPage));
  assert.equal(/get\('\/magic-link\/rate-limit\/(?:cleanup|reset)'\)/.test(settingsPage), false);
});

test('settings write and rate-limit controls are hidden or disabled without update permission', () => {
  const settingsPage = source('admin/src/pages/Settings/SettingsModern.jsx');

  assert.ok(settingsPage.includes('useRBAC(pluginPermissions.updateSettings)'));
  assert.ok(settingsPage.includes('const canWriteSettings = canUpdate'));
  assert.ok(settingsPage.includes('disabled={isSaving || isPermissionLoading || !canWriteSettings || !settingsFormValid}'));
  assert.ok(settingsPage.includes('disabled={isPermissionLoading || !canWriteSettings}'));
  assert.ok(settingsPage.includes('if (!canWriteSettings || isPermissionLoading) return;'));
  assert.ok(settingsPage.includes("getTrad('settings.permission.readOnly')"));

  const adminRegistration = source('admin/src/index.js');
  assert.ok(adminRegistration.includes('permissions: pluginPermissions.readSettings'));
});

test('individual and bulk token deletion both require an explicit confirmation', () => {
  const tokenPage = source('admin/src/pages/Tokens/TokensProfessional.jsx');
  const individual = tokenPage.slice(tokenPage.indexOf('const handleDelete ='), tokenPage.indexOf('const handleBulkDelete ='));
  const bulk = tokenPage.slice(tokenPage.indexOf('const handleBulkDelete ='), tokenPage.indexOf('const handleCreateToken ='));

  assert.ok(individual.indexOf('window.confirm(') >= 0);
  assert.ok(individual.indexOf('window.confirm(') < individual.indexOf('del('));
  assert.ok(bulk.indexOf('window.confirm(') >= 0);
  assert.ok(bulk.indexOf('window.confirm(') < bulk.indexOf('del('));
});

test('JWT revoke and unrevoke require localized confirmation before changing access', () => {
  const jwtSessions = source('admin/src/pages/Tokens/JWTSessions.jsx');
  const revoke = jwtSessions.slice(
    jwtSessions.indexOf('const handleRevoke ='),
    jwtSessions.indexOf('const handleUnrevoke ='),
  );
  const unrevoke = jwtSessions.slice(
    jwtSessions.indexOf('const handleUnrevoke ='),
    jwtSessions.indexOf('const handleCleanup ='),
  );

  assert.ok(revoke.indexOf("window.confirm(formatMessage({ id: getTrad('jwt.confirm.revoke') }))") >= 0);
  assert.ok(revoke.indexOf('window.confirm(') < revoke.indexOf("post('/magic-link/revoke-jwt'"));
  assert.ok(unrevoke.indexOf("window.confirm(formatMessage({ id: getTrad('jwt.confirm.unrevoke') }))") >= 0);
  assert.ok(unrevoke.indexOf('window.confirm(') < unrevoke.indexOf("post('/magic-link/unrevoke-jwt'"));

  for (const locale of ['de', 'en', 'es', 'fr', 'pt']) {
    const messages = JSON.parse(source(`admin/src/translations/${locale}.json`));
    assert.ok(messages['magic-link.jwt.confirm.revoke'], `${locale} revoke confirmation is translated`);
    assert.ok(messages['magic-link.jwt.confirm.unrevoke'], `${locale} unrevoke confirmation is translated`);
  }
});

test('JWT session cleanup requires a localized confirmation before revoking expired sessions', () => {
  const jwtSessions = source('admin/src/pages/Tokens/JWTSessions.jsx');
  const cleanup = jwtSessions.slice(
    jwtSessions.indexOf('const handleCleanup ='),
    jwtSessions.indexOf('const handleSelectAll ='),
  );

  assert.ok(cleanup.indexOf("window.confirm(formatMessage({ id: getTrad('jwt.confirm.cleanup') }))") >= 0);
  assert.ok(cleanup.indexOf('window.confirm(') < cleanup.indexOf("post('/magic-link/cleanup-sessions')"));

  for (const locale of ['de', 'en', 'es', 'fr', 'pt']) {
    const messages = JSON.parse(source(`admin/src/translations/${locale}.json`));
    assert.ok(messages['magic-link.jwt.confirm.cleanup'], `${locale} cleanup confirmation is translated`);
  }
});

test('reset-data preserves unexpired JWT revocations', async () => {
  const blockedTokens = {
    tokens: [{ tokenHash: 'synthetic-revoked-hash', expiresAt: new Date(Date.now() + 60_000).toISOString() }],
  };
  const values = new Map([['blocked_jwt_tokens', blockedTokens]]);
  global.strapi = {
    store: () => ({
      get: async ({ key }) => values.get(key),
      set: async ({ key, value }) => values.set(key, value),
      delete: async ({ key }) => values.delete(key),
    }),
    documents: () => ({ findMany: async () => [] }),
    log: { info() {}, error() {} },
  };
  const ctx = {
    send(payload) { this.response = payload; return payload; },
    throw(status, error) { throw error || new Error(String(status)); },
  };

  await controller.resetData(ctx);

  assert.deepEqual(values.get('blocked_jwt_tokens'), blockedTokens);
  assert.match(ctx.response.message, /widerrufene jwts/i);
});

test('rate-limit reset clears the live limiter instead of writing an unused plugin-store key', async () => {
  let resetCalls = 0;
  const writes = [];
  global.strapi = {
    plugin: () => ({ service: () => ({ resetAll: async () => { resetCalls += 1; return { reset: true }; } }) }),
    store: () => ({ set: async (entry) => writes.push(entry) }),
    log: { error() {} },
  };
  const ctx = {
    send(payload) { this.response = payload; return payload; },
    throw(status, error) { throw error || new Error(String(status)); },
  };

  await require('../server/src/controllers/rate-limit').reset(ctx);

  assert.equal(resetCalls, 1);
  assert.deepEqual(writes, []);
  assert.equal(ctx.response.success, true);
});

test('settings updates reload the live rate limiter after persisting its configuration', async () => {
  const events = [];
  const storedSettings = {};
  global.strapi = {
    store: () => ({
      get: async () => storedSettings,
      set: async ({ value }) => { Object.assign(storedSettings, value); events.push('persist'); },
    }),
    plugin: () => ({ service: () => ({ reloadSettings: async () => events.push('reload') }) }),
    log: { info() {} },
  };
  const ctx = {
    request: { body: { rate_limit_enabled: true, rate_limit_max_attempts: 7, rate_limit_window_minutes: 20 } },
    send(payload) { this.response = payload; return payload; },
  };

  await controller.updateSettings(ctx);

  assert.deepEqual(events, ['persist', 'reload']);
  assert.equal(storedSettings.rate_limit_max_attempts, 7);
  assert.equal(storedSettings.rate_limit_window_minutes, 20);
});
