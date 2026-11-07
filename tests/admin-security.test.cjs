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
  const actionsFor = (route) =>
    route.config.policies.flatMap((policy) => policy.config?.actions || []);

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

  for (const pathName of [
    '/login',
    '/send-link',
    '/otp/send',
    '/otp/verify',
    '/otp/resend',
    '/verify-mfa-totp',
    '/login-totp',
  ]) {
    const route = publicRoutes.find((candidate) => candidate.path === pathName);
    assert.ok(route, `${pathName} route remains registered`);
    assert.equal(route.config.auth, false, `${pathName} remains public by design`);
  }
});

test('rate-limit cleanup and reset are registered only as POST mutations', () => {
  const actions = routes.filter((route) =>
    ['/rate-limit/cleanup', '/rate-limit/reset'].includes(route.path)
  );

  assert.equal(actions.length, 2);
  assert.ok(actions.every((route) => route.method === 'POST'));
});

test('settings update rejects invalid authentication policy values without writing', async () => {
  let writes = 0;
  global.strapi = {
    store: () => ({
      get: async () => ({ mfa_mode: 'disabled', mfa_require_totp: false }),
      set: async () => {
        writes += 1;
      },
    }),
    plugin: () => undefined,
    log: { info() {} },
  };
  const ctx = { request: { body: { mfa_mode: 'not-a-mode', otp_enabled: 'yes' } } };

  ctx.throw = (status, error) => {
    throw error || new Error(String(status));
  };

  await assert.rejects(controller.updateSettings(ctx), /Invalid request body/);
  assert.equal(writes, 0);
});

test('settings writes normalize legacy required TOTP, keep known settings and drop unknown or legacy keys', async () => {
  let persisted;
  const existing = {
    custom_flag: 'dropped',
    create_new_user: true,
    expire_period: 900,
    mfa_mode: 'disabled',
    mfa_require_totp: false,
    sms_api_secret: 'local-test-secret',
  };
  global.strapi = {
    store: () => ({
      get: async () => existing,
      set: async ({ value }) => {
        persisted = value;
      },
    }),
    plugin: () => undefined,
    log: { info() {} },
  };
  const ctx = {
    request: {
      body: {
        mfa_mode: 'disabled',
        mfa_require_totp: true,
        unknown_key: 'x',
        context_blacklist: 'secret, pin',
      },
    },
    send(payload) {
      this.response = payload;
      return payload;
    },
  };

  await controller.updateSettings(ctx);

  assert.equal(persisted.mfa_mode, 'required');
  assert.equal(persisted.mfa_require_totp, true);
  assert.equal(persisted.expire_period, 900, 'known settings are preserved');
  assert.deepEqual(
    persisted.context_blacklist,
    ['secret', 'pin'],
    'string lists are stored as arrays'
  );
  for (const key of ['custom_flag', 'create_new_user', 'sms_api_secret', 'unknown_key']) {
    assert.equal(key in persisted, false, `${key} is not stored`);
    assert.equal(key in ctx.response.settings, false, `${key} is not returned`);
  }
});

test('settings read responses omit reserved provider credentials', async () => {
  const stored = { sms_api_key: 'local-test-key', sms_api_secret: 'local-test-secret' };
  global.strapi = {
    store: () => ({ get: async () => stored }),
    plugin: () => undefined,
    config: { get: () => ({}) },
    log: { info() {} },
  };
  const ctx = {
    send(payload) {
      this.response = payload;
      return payload;
    },
  };

  await controller.getSettings(ctx);

  assert.equal(ctx.response.settings.sms_api_key, undefined);
  assert.equal(ctx.response.settings.sms_api_secret, undefined);
});

test('a legacy-only TOTP disable update clears a previously required mode', async () => {
  let persisted;
  global.strapi = {
    store: () => ({
      get: async () => ({ mfa_mode: 'required', mfa_require_totp: true }),
      set: async ({ value }) => {
        persisted = value;
      },
    }),
    plugin: () => undefined,
    log: { info() {} },
  };
  const ctx = {
    request: { body: { mfa_require_totp: false } },
    send(payload) {
      this.response = payload;
      return payload;
    },
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

  assert.ok(settingsPage.includes('} = useMagicLinkRBAC();'));
  assert.ok(settingsPage.includes('const canWriteSettings = canUpdateSettings'));
  assert.ok(
    settingsPage.includes(
      'disabled={isSaving || isPermissionLoading || !canWriteSettings || !isDirty}'
    )
  );
  // Every control is disabled for read-only roles, not only Save.
  assert.ok(settingsPage.includes('const formDisabled = !canWriteSettings || isSaving'));
  assert.ok(settingsPage.includes('disabled: formDisabled'));
  assert.ok(settingsPage.includes('if (!canWriteSettings || isPermissionLoading) return;'));
  assert.match(settingsPage, /\bt\(\s*'settings\.permission\.readOnly'/);
  // Rate-limit cleanup and reset are hidden without settings.update.
  assert.ok(settingsPage.includes('canManage={canWriteSettings}'));
  const rateLimit = source('admin/src/pages/Settings/sections/RateLimitSection.jsx');
  assert.ok(rateLimit.includes('{canManage ? ('));

  const adminRegistration = source('admin/src/index.js');
  assert.ok(adminRegistration.includes('permissions: pluginPermissions.settingsRead'));
  assert.equal(adminRegistration.includes('pluginPermissions.access'), false);
});

test('individual and bulk token deletion both require an explicit confirmation', () => {
  const panel = source('admin/src/pages/Tokens/MagicLinksPanel.jsx');
  const table = source('admin/src/pages/Tokens/components/TokensTable.jsx');
  const details = source('admin/src/pages/Tokens/components/TokenDetailsModal.jsx');

  // Row, details and bulk buttons only queue a confirmation; the request runs from ConfirmDialog.
  assert.ok(table.includes('onClick={() => onDelete(token)}'));
  assert.ok(details.includes('onClick={() => onDelete(token)}'));
  assert.ok(panel.includes("onDelete={(token) => setPending({ type: 'delete', token })}"));
  assert.ok(panel.includes("setPending({ type: 'bulkDelete', keys: [...selectedKeys] })"));
  assert.ok(panel.includes('onConfirm: () => deleteToken(pending.token)'));
  assert.ok(panel.includes('onConfirm: () => bulkDelete(pending.keys)'));
  assert.ok(panel.includes('isOpen={canManage && confirmConfig !== null}'));
  assert.equal(/window\.confirm\(|\bconfirm\(/.test(panel), false);
});

test('JWT revoke, unrevoke and cleanup run only from the manage-gated ConfirmDialog', () => {
  const jwtSessions = source('admin/src/pages/Tokens/JWTSessions.jsx');
  const section = (from, to) =>
    jwtSessions.slice(jwtSessions.indexOf(from), jwtSessions.indexOf(to));
  const revoke = section('const handleRevoke =', 'const handleUnrevoke =');
  const unrevoke = section('const handleUnrevoke =', 'const handleCleanup =');
  const cleanup = section('const handleCleanup =', 'const handleBulkRevoke =');

  for (const [name, block, call] of [
    ['revoke', revoke, "post('/magic-link/revoke-jwt'"],
    ['unrevoke', unrevoke, "post('/magic-link/unrevoke-jwt'"],
    ['cleanup', cleanup, "post('/magic-link/cleanup-sessions')"],
  ]) {
    assert.ok(block.indexOf('if (!canManage) return;') >= 0, `${name} checks manage access`);
    assert.ok(
      block.indexOf('if (!canManage) return;') < block.indexOf(call),
      `${name} checks before the request`
    );
  }
  assert.doesNotMatch(jwtSessions, /window\.confirm\(/);
  // Every mutation is reached only through pendingAction -> ConfirmDialog.onConfirm.
  assert.match(
    jwtSessions,
    /onClick=\{\(\) => setPendingAction\(\{ type: 'revoke', session \}\)\}/
  );
  assert.match(
    jwtSessions,
    /onClick=\{\(\) => setPendingAction\(\{ type: 'unrevoke', session \}\)\}/
  );
  assert.match(jwtSessions, /onClick=\{\(\) => setPendingAction\(\{ type: 'cleanup' \}\)\}/);
  assert.match(
    jwtSessions,
    /<ConfirmDialog\s+isOpen=\{canManage && pendingAction !== null\}[\s\S]*onConfirm=\{confirmPending\}/
  );
  assert.match(jwtSessions, /t\(\s*'jwt\.confirm\.cleanup'/);

  for (const locale of ['de', 'en', 'es', 'fr', 'pt']) {
    const messages = JSON.parse(source(`admin/src/translations/${locale}.json`));
    assert.ok(
      messages['magic-link.jwt.confirm.cleanup'],
      `${locale} cleanup confirmation is translated`
    );
  }
});

test('reset-data preserves unexpired JWT revocations and writes the install defaults', async () => {
  const { createDefaultSettings } = require('../server/src/utils/default-settings');
  const blockedTokens = {
    tokens: [
      {
        tokenHash: 'synthetic-revoked-hash',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    ],
  };
  const values = new Map([
    ['blocked_jwt_tokens', blockedTokens],
    ['jwt_sessions', { sessions: [] }],
  ]);
  let deleteManyWhere;
  global.strapi = {
    store: () => ({
      get: async ({ key }) => values.get(key),
      set: async ({ key, value }) => values.set(key, value),
      delete: async ({ key }) => values.delete(key),
    }),
    db: {
      query: () => ({
        deleteMany: async ({ where }) => {
          deleteManyWhere = where;
          return { count: 3 };
        },
      }),
    },
    plugin: () => undefined,
    log: { info() {}, warn() {}, error() {} },
  };
  const ctx = {
    state: { user: { id: 7 } },
    send(payload) {
      this.response = payload;
      return payload;
    },
    throw(status, error) {
      throw error || new Error(String(status));
    },
  };

  await controller.resetData(ctx);

  assert.deepEqual(values.get('blocked_jwt_tokens'), blockedTokens);
  assert.deepEqual(values.get('settings'), createDefaultSettings());
  assert.equal(
    values.get('settings').confirmationUrl,
    '',
    'links use the API login URL after a reset'
  );
  assert.deepEqual(values.get('banned_ips'), { ips: [] });
  assert.equal(values.has('jwt_sessions'), false);
  assert.deepEqual(deleteManyWhere, {});
  assert.equal(ctx.response.deletedTokens, 3);
  assert.match(ctx.response.message, /revoked jwts stay blocked/i);
});

test('rate-limit reset clears the live limiter instead of writing an unused plugin-store key', async () => {
  let resetCalls = 0;
  const writes = [];
  global.strapi = {
    plugin: () => ({
      service: () => ({
        resetAll: async () => {
          resetCalls += 1;
          return { reset: true };
        },
      }),
    }),
    store: () => ({ set: async (entry) => writes.push(entry) }),
    log: { error() {} },
  };
  const ctx = {
    send(payload) {
      this.response = payload;
      return payload;
    },
    throw(status, error) {
      throw error || new Error(String(status));
    },
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
      set: async ({ value }) => {
        Object.assign(storedSettings, value);
        events.push('persist');
      },
    }),
    plugin: () => ({ service: () => ({ reloadSettings: async () => events.push('reload') }) }),
    log: { info() {} },
  };
  const ctx = {
    request: {
      body: { rate_limit_enabled: true, rate_limit_max_attempts: 7, rate_limit_window_minutes: 20 },
    },
    send(payload) {
      this.response = payload;
      return payload;
    },
  };

  await controller.updateSettings(ctx);

  assert.deepEqual(events, ['persist', 'reload']);
  assert.equal(storedSettings.rate_limit_max_attempts, 7);
  assert.equal(storedSettings.rate_limit_window_minutes, 20);
});
