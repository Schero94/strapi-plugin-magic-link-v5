'use strict';

/**
 * Follow-up fixes after the 2026-11-07 acceptance run, written before the
 * fixes: MFA lock-out guard on the server, hashed send-link limiter key,
 * the dead `max_login_attempts` setting, sender fields and reset-data under
 * `settings.security`, the Tokens table keyboard start column and the
 * RBAC reload race in the admin. Synthetic data only.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { useTestSecrets } = require('./helpers/mfa-strapi.cjs');

useTestSecrets();

const auth = require('../server/src/controllers/auth');
const settingsController = require('../server/src/controllers/controller');
const { SETTINGS_KEYS } = require('../server/src/controllers/validation');
const { createDefaultSettings } = require('../server/src/utils/default-settings');
const { createLoginCoreStrapi, createCtx } = require('./helpers/login-core-strapi.cjs');
const { loadAdminModule } = require('./helpers/load-admin-module.cjs');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const UPDATE = 'plugin::magic-link.settings.update';
const SECURITY = 'plugin::magic-link.settings.security';

const settingsEnv = ({ stored = {}, enrolled = 0 } = {}) => {
  const values = new Map([['settings', { ...createDefaultSettings(), ...stored }]]);
  const counted = [];
  global.strapi = {
    store: () => ({
      get: async ({ key }) => values.get(key),
      set: async ({ key, value }) => values.set(key, value),
      delete: async ({ key }) => values.delete(key),
    }),
    config: { get: (_key, fallback) => fallback },
    db: {
      query: (uid) => ({
        deleteMany: async () => ({ count: 0 }),
        count: async (params) => {
          counted.push({ uid, params });
          return enrolled;
        },
      }),
    },
    plugin: () => undefined,
    log: Object.fromEntries(['info', 'warn', 'error', 'debug'].map((level) => [level, () => {}])),
  };
  return { values, counted };
};

const adminCtx = (body, actions = [UPDATE, SECURITY]) => ({
  state: { user: { id: 3 }, userAbility: { can: (action) => actions.includes(action) } },
  request: { body },
  send(payload) {
    this.response = payload;
    return payload;
  },
  throw(status, error) {
    throw error || new Error(String(status));
  },
});

// ─────────────── MFA "required" with nobody enrolled ───────────────

test('mfa_mode required is refused on the server while no end user has an authenticator', async () => {
  const { values, counted } = settingsEnv({ enrolled: 0 });
  const before = JSON.stringify(values.get('settings'));
  await assert.rejects(
    settingsController.updateSettings(adminCtx({ mfa_mode: 'required' })),
    (error) => {
      assert.equal(error.name, 'ValidationError');
      assert.equal(error.details.key, 'settings.mfa.noEnrolledUsers');
      assert.deepEqual(error.details.fields, ['mfa_mode']);
      return true;
    }
  );
  assert.equal(JSON.stringify(values.get('settings')), before, 'nothing was written');
  assert.equal(counted[0].uid, 'plugin::magic-link.totp-config');
  assert.deepEqual(counted[0].params, {
    where: { principalType: 'users-permissions', enabled: true },
  });
});

test('the legacy mfa_require_totp flag cannot bypass the enrolment guard', async () => {
  settingsEnv({ enrolled: 0 });
  await assert.rejects(
    settingsController.updateSettings(adminCtx({ mfa_require_totp: true })),
    (error) => error.details?.key === 'settings.mfa.noEnrolledUsers'
  );
});

test('mfa_mode required is allowed with enrolled users or an explicit acknowledgement', async () => {
  const withUsers = settingsEnv({ enrolled: 2 });
  await settingsController.updateSettings(adminCtx({ mfa_mode: 'required' }));
  assert.equal(withUsers.values.get('settings').mfa_mode, 'required');

  const acknowledged = settingsEnv({ enrolled: 0 });
  await settingsController.updateSettings(
    adminCtx({ settings: { mfa_mode: 'required' }, acknowledgeNoEnrolledUsers: true })
  );
  assert.equal(acknowledged.values.get('settings').mfa_mode, 'required');
  assert.equal(
    'acknowledgeNoEnrolledUsers' in acknowledged.values.get('settings'),
    false,
    'the acknowledgement is never stored'
  );
});

test('an unchanged required mode does not re-run the enrolment guard', async () => {
  const { values, counted } = settingsEnv({
    stored: { mfa_mode: 'required', mfa_require_totp: true },
    enrolled: 0,
  });
  await settingsController.updateSettings(adminCtx({ mfa_mode: 'required', object: 'Sign in' }));
  assert.equal(values.get('settings').object, 'Sign in');
  assert.equal(counted.length, 0);
});

// ─────────────── send-link limiter key ───────────────

test('send-link keys the e-mail limiter with a hash, never the address in clear', async () => {
  createLoginCoreStrapi({ users: [] });
  const keys = [];
  const original = global.strapi.plugin;
  global.strapi.plugin = (name) => {
    const plugin = original(name);
    if (name !== 'magic-link') return plugin;
    return {
      ...plugin,
      service: (key) =>
        key === 'rate-limiter'
          ? {
              checkRateLimit: async (limiterKey, type) => {
                keys.push({ limiterKey, type });
                return { allowed: true };
              },
            }
          : plugin.service(key),
    };
  };
  await auth.sendLink(createCtx({ method: 'POST', body: { email: 'Person@Example.test' } }));
  await auth.sendLink(createCtx({ method: 'POST', body: { email: 'person@example.test' } }));
  const emailKeys = keys.filter(({ type }) => type === 'email').map(({ limiterKey }) => limiterKey);
  assert.equal(emailKeys.length, 2);
  for (const key of emailKeys) {
    assert.doesNotMatch(key, /@|example/i, 'no address in the limiter key');
    assert.match(key, /^email:[0-9a-f]{32}$/);
  }
  assert.equal(emailKeys[0], emailKeys[1], 'case variants share one bucket');
});

// ─────────────── max_login_attempts ───────────────

test('max_login_attempts is no longer a settings field (it never did anything)', () => {
  assert.equal(SETTINGS_KEYS.includes('max_login_attempts'), false);
  assert.equal(settingsController.SECURITY_SETTING_KEYS.includes('max_login_attempts'), false);
});

test('a stored or sent max_login_attempts is dropped, not persisted', async () => {
  const { values } = settingsEnv({ stored: { max_login_attempts: 5 } });
  await settingsController.updateSettings(adminCtx({ max_login_attempts: 9, object: 'Hello' }));
  assert.equal('max_login_attempts' in values.get('settings'), false);
});

// ─────────────── sender identity and reset-data need settings.security ───────────────

test('sender identity fields need settings.security', async (t) => {
  for (const [key, value] of Object.entries({
    from_name: 'Not the shop',
    from_email: 'other@example.test',
    response_email: 'reply@example.test',
  })) {
    await t.test(key, async () => {
      settingsEnv();
      await assert.rejects(
        settingsController.updateSettings(adminCtx({ [key]: value }, [UPDATE])),
        (error) =>
          error.name === 'PolicyError' &&
          error.details.key === 'settings.security.forbidden' &&
          error.details.fields.includes(key)
      );
    });
  }
});

test('reset-data needs settings.security (it deletes tokens, sessions and IP bans)', async () => {
  settingsEnv();
  await assert.rejects(
    settingsController.resetData(adminCtx({ confirm: 'RESET' }, [UPDATE])),
    (error) => error.name === 'PolicyError' && error.details.key === 'settings.security.forbidden'
  );
  settingsEnv();
  const ctx = adminCtx({ confirm: 'RESET' });
  await settingsController.resetData(ctx);
  assert.equal(ctx.response.success, true);
});

// ─────────────── admin: Tokens table keyboard, RBAC reload race ───────────────

test('the Tokens table starts the DS grid on the second column when it has checkboxes', () => {
  assert.match(
    read('admin/src/pages/Tokens/components/TokensTable.jsx'),
    /initialCol=\{canManage \? 1 : 0\}/
  );
});

test('capabilities follow the loaded admin permissions even when a useRBAC check went stale', () => {
  const { resolveCapabilities } = loadAdminModule('admin/src/hooks/useMagicLinkRBAC.js', {
    stubs: { '@strapi/strapi/admin': { useRBAC: () => ({}) } },
  });
  // useRBAC ran while the admin permissions were still loading, settled with
  // nothing allowed and never re-ran (Strapi 5.61 useRBAC only re-checks when
  // the requested permissions change).
  const stale = { allowedActions: { canRead: false, canManage: false }, isLoading: false };
  const loaded = [
    { action: 'plugin::magic-link.read', subject: null },
    { action: 'plugin::magic-link.settings.read', subject: null },
  ];
  const caps = resolveCapabilities(stale, stale, { permissions: loaded, isLoading: false });
  assert.equal(caps.canRead, true);
  assert.equal(caps.canReadSettings, true);
  assert.equal(caps.canManage, false);
  assert.equal(caps.isLoading, false);

  const loading = resolveCapabilities(stale, stale, { permissions: [], isLoading: true });
  assert.equal(loading.isLoading, true);
  assert.equal(loading.canRead, false);

  const conditioned = resolveCapabilities(stale, stale, {
    permissions: [{ action: 'plugin::magic-link.read', subject: null, conditions: ['x'] }],
    isLoading: false,
  });
  assert.equal(conditioned.canRead, false, 'conditioned grants stay with the useRBAC result');
});
