'use strict';

/**
 * Tokens view (admin/src/pages/Tokens): behaviour of the pure token model
 * (state, filters, pagination, request bodies, login link) and source guards
 * for the view files (no window.confirm, no raw clipboard, no hard-coded
 * locales or light-only colours, labelled controls, RBAC gating).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadAdminModule, ROOT } = require('./helpers/load-admin-module.cjs');

const model = loadAdminModule('admin/src/pages/Tokens/tokenModel.js');

const NOW = Date.parse('2026-11-07T12:00:00.000Z');
const PAST = '2026-11-01T12:00:00.000Z';
const FUTURE = '2026-12-01T12:00:00.000Z';

const token = (overrides = {}) => ({
  id: 1,
  documentId: 'abcdefghijklmnopqrstuvwx',
  email: 'synthetic.user@example.invalid',
  is_active: true,
  is_used: false,
  expires_at: FUTURE,
  createdAt: PAST,
  ...overrides,
});

const VIEW_FILES = [
  'admin/src/pages/Tokens/TokensProfessional.jsx',
  'admin/src/pages/Tokens/MagicLinksPanel.jsx',
  'admin/src/pages/Tokens/CreateTokenModal.jsx',
  'admin/src/pages/Tokens/ExtendTokenModal.jsx',
  'admin/src/pages/Tokens/useTokenData.js',
  'admin/src/pages/Tokens/tokenModel.js',
  'admin/src/pages/Tokens/components/CreatedTokenModal.jsx',
  'admin/src/pages/Tokens/components/TokenDetailsModal.jsx',
  'admin/src/pages/Tokens/components/TokenStatus.jsx',
  'admin/src/pages/Tokens/components/TokenTabs.jsx',
  'admin/src/pages/Tokens/components/TokensFilterBar.jsx',
  'admin/src/pages/Tokens/components/TokensTable.jsx',
  'admin/src/pages/Tokens/components/tokenStyles.js',
];
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('blocked tokens are derived from is_active/is_used, not a missing status field (UI-02)', () => {
  assert.equal(model.getTokenState(token(), NOW), 'active');
  assert.equal(model.getTokenState(token({ expires_at: PAST }), NOW), 'expired');
  assert.equal(model.getTokenState(token({ is_active: false, is_used: true }), NOW), 'used');
  assert.equal(model.getTokenState(token({ is_active: false, is_used: false }), NOW), 'blocked');
  // A blocked token that has also expired is still blocked (activate first, then extend).
  assert.equal(model.getTokenState(token({ is_active: false, expires_at: PAST }), NOW), 'blocked');

  const blocked = model.getTokenActions(token({ is_active: false }), NOW);
  assert.deepEqual(
    { activate: blocked.canActivate, block: blocked.canBlock, reissue: blocked.canReissue },
    { activate: true, block: false, reissue: true }
  );
  const active = model.getTokenActions(token(), NOW);
  assert.deepEqual(
    {
      activate: active.canActivate,
      block: active.canBlock,
      extend: active.canExtend,
      reissue: active.canReissue,
    },
    { activate: false, block: true, extend: true, reissue: false }
  );
  const used = model.getTokenActions(token({ is_active: false, is_used: true }), NOW);
  assert.equal(used.canActivate, false, 'a consumed single-use link is never re-activated');
  assert.equal(used.canExtend, false);
});

test('stats count each derived state once and blocked tokens are not counted as used', () => {
  const stats = model.computeTokenStats(
    [
      token(),
      token({ id: 2, expires_at: PAST }),
      token({ id: 3, is_active: false, is_used: true }),
      token({ id: 4, is_active: false }),
      token({ id: 5, is_active: false }),
    ],
    NOW
  );
  assert.deepEqual(stats, { total: 5, active: 1, expired: 1, used: 1, blocked: 2 });
});

test('normalizeToken turns SQLite 0/1 into booleans and invalid dates into null', () => {
  const normalized = model.normalizeToken({
    is_active: 0,
    is_used: 1,
    created_at: PAST,
    expires_at: 'nope',
  });
  assert.equal(normalized.is_active, false);
  assert.equal(normalized.is_used, true);
  assert.equal(normalized.createdAt, PAST);
  assert.equal(normalized.expires_at, null);
});

test('filter, search and sort never mutate the token list and sort status by derived state', () => {
  const list = [
    token({
      id: 1,
      documentId: 'doc-aaaaaaaa11111111',
      email: 'b@example.invalid',
      is_active: false,
    }),
    token({
      id: 2,
      documentId: 'doc-bbbbbbbb22222222',
      email: 'a@example.invalid',
      ip_address: '203.0.113.7',
    }),
    token({
      id: 3,
      documentId: 'doc-cccccccc33333333',
      email: 'c@example.invalid',
      expires_at: PAST,
    }),
  ];
  const snapshot = JSON.stringify(list);

  const byStatus = model.filterAndSortTokens(list, {
    sortBy: 'status',
    sortOrder: 'asc',
    now: NOW,
  });
  assert.deepEqual(
    byStatus.map((t) => t.id),
    [2, 3, 1]
  );
  assert.equal(JSON.stringify(list), snapshot, 'input array untouched');

  assert.deepEqual(
    model.filterAndSortTokens(list, { status: 'blocked', now: NOW }).map((t) => t.id),
    [1]
  );
  assert.deepEqual(
    model.filterAndSortTokens(list, { search: '203.0.113', now: NOW }).map((t) => t.id),
    [2],
    'search matches the login IP'
  );
  assert.deepEqual(
    model.filterAndSortTokens(list, { search: '33333333', now: NOW }).map((t) => t.id),
    [3],
    'search matches the reference shown in the table'
  );
  assert.deepEqual(
    model
      .filterAndSortTokens(list, { sortBy: 'email', sortOrder: 'desc', now: NOW })
      .map((t) => t.email),
    ['c@example.invalid', 'b@example.invalid', 'a@example.invalid']
  );
});

test('pagination clamps the page and collapses long ranges with ellipses', () => {
  assert.equal(model.clampPage(9, 3), 3);
  assert.equal(model.clampPage(0, 3), 1);
  assert.equal(model.clampPage(2, 0), 1);
  assert.deepEqual(model.getPaginationItems(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(model.getPaginationItems(5, 12), [1, 'dots', 4, 5, 6, 'dots', 12]);
  assert.deepEqual(model.getPaginationItems(1, 12), [1, 2, 3, 4, 'dots', 12]);
  assert.deepEqual(model.getPaginationItems(12, 12), [1, 'dots', 9, 10, 11, 12]);
});

test('the create form sends the parsed JSON context and a top-level ttl (UI-01, UI-M01)', () => {
  const validation = model.validateCreateForm({
    email: '  synthetic.user@example.invalid ',
    ttl: 48,
    contextText: '{ "redirectTo": "/account", "plan": "pro" }',
  });
  assert.deepEqual(validation.errors, {});
  const body = model.buildCreateTokenBody({
    email: ' synthetic.user@example.invalid ',
    ttl: 48,
    context: validation.context,
    sendEmail: false,
  });
  assert.deepEqual(body, {
    email: 'synthetic.user@example.invalid',
    ttl: 48,
    send_email: false,
    context: { redirectTo: '/account', plan: 'pro' },
  });
  assert.equal('ttl' in body.context, false, 'ttl no longer travels inside context');
});

test('create form validation rejects bad email, ttl out of range, invalid JSON and reserved keys', () => {
  assert.equal(model.validateCreateForm({ email: '', ttl: 24 }).errors.email, 'required');
  assert.equal(model.validateCreateForm({ email: 'no-at-sign', ttl: 24 }).errors.email, 'format');
  for (const ttl of [0, -1, 1.5, 721, undefined, Number.NaN]) {
    assert.equal(
      model.validateCreateForm({ email: 'a@example.invalid', ttl }).errors.ttl,
      'range',
      String(ttl)
    );
  }
  assert.equal(
    model.validateCreateForm({ email: 'a@example.invalid', ttl: 720 }).errors.ttl,
    undefined
  );
  assert.equal(
    model.validateCreateForm({ email: 'a@example.invalid', ttl: 1, contextText: '{oops' }).errors
      .context,
    'json'
  );
  assert.equal(
    model.validateCreateForm({ email: 'a@example.invalid', ttl: 1, contextText: '[1,2]' }).errors
      .context,
    'object'
  );
  const reserved = model.validateCreateForm({
    email: 'a@example.invalid',
    ttl: 1,
    contextText: '{"otpVerified": true, "RequiresTOTP": false, "ok": 1}',
  });
  assert.equal(reserved.errors.context, 'reserved');
  assert.deepEqual(reserved.reservedKeys, ['otpVerified', 'RequiresTOTP']);
});

test('"New token" re-sends only user context, never stale challenge or expiry keys (FUN-13)', () => {
  const body = model.buildReissueTokenBody({
    email: 'synthetic.user@example.invalid',
    context: {
      redirectTo: '/after-login',
      otpVerified: true,
      totpVerified: true,
      requiresTOTP: true,
      userId: 7,
      user: { id: 7 },
      ttl: 999,
      expires_at: PAST,
      expiry_formatted: '01.11.2026',
    },
  });
  assert.deepEqual(body, {
    email: 'synthetic.user@example.invalid',
    send_email: true,
    context: { redirectTo: '/after-login' },
  });
  assert.deepEqual(model.toUserContext(null), {});
  assert.deepEqual(model.toUserContext(['x']), {});
});

test('extend preview mirrors the server and day input must be an integer from 1 to 365 (UI-16)', () => {
  const fromFuture = model.computeExtendedExpiry(FUTURE, 7, NOW);
  assert.equal(fromFuture.toISOString(), '2026-12-08T12:00:00.000Z');
  const fromExpired = model.computeExtendedExpiry(PAST, 1, NOW);
  assert.equal(
    fromExpired.toISOString(),
    '2026-11-08T12:00:00.000Z',
    'expired tokens extend from now'
  );
  for (const days of [0, -5, 1.5, 366, undefined]) {
    assert.equal(model.isIntegerInRange(days, model.EXTEND_LIMITS), false, String(days));
  }
  assert.equal(model.isIntegerInRange(365, model.EXTEND_LIMITS), true);
});

test('login link prefers the server URL, then frontend URL, confirmation URL and API route (UI-22)', () => {
  const secret = 'synthetic-token-value';
  assert.equal(
    model.buildLoginUrl({
      loginUrl: 'https://app.example.invalid/login?loginToken=x',
      token: secret,
    }),
    'https://app.example.invalid/login?loginToken=x'
  );
  assert.equal(
    model.buildLoginUrl({
      token: secret,
      settings: {
        frontend_url: 'https://app.example.invalid/',
        frontend_login_path: '/auth/magic',
      },
      origin: 'https://admin.example.invalid',
    }),
    'https://app.example.invalid/auth/magic?loginToken=synthetic-token-value'
  );
  assert.equal(
    model.buildLoginUrl({
      token: secret,
      settings: { confirmationUrl: 'https://app.example.invalid/confirm?lang=de' },
    }),
    'https://app.example.invalid/confirm?lang=de&loginToken=synthetic-token-value'
  );
  assert.equal(
    model.buildLoginUrl({ token: secret, settings: null, origin: 'https://admin.example.invalid' }),
    'https://admin.example.invalid/api/magic-link/login?loginToken=synthetic-token-value'
  );
  assert.equal(
    model.buildLoginUrl({ token: secret, settings: { confirmationUrl: 'not a url' } }),
    ''
  );
  assert.equal(model.buildLoginUrl({ loginUrl: 'javascript:alert(1)', token: '' }), '');
});

test('default TTL is derived from expire_period and clamped to the create form range', () => {
  assert.equal(model.defaultTtlFromSettings(3600), 1);
  assert.equal(model.defaultTtlFromSettings(86400), 24);
  assert.equal(model.defaultTtlFromSettings(60), 1);
  assert.equal(model.defaultTtlFromSettings(10 * 365 * 86400), 720);
  assert.equal(model.defaultTtlFromSettings(undefined), 24);
});

test('bulk delete reports partial failures and keeps the failed ids', () => {
  const summary = model.summarizeBulkResults(
    ['a', 'b', 'c'],
    [{ status: 'fulfilled' }, { status: 'rejected' }, { status: 'fulfilled' }]
  );
  assert.deepEqual(summary, { succeeded: ['a', 'c'], failed: ['b'], total: 3 });
});

test('TokenTabs renders the WAI-ARIA tabs pattern with one selected, focusable tab', () => {
  const Stub = ({ children, ...props }) => React.createElement('div', props, children);
  const { TokenTabs } = loadAdminModule('admin/src/pages/Tokens/components/TokenTabs.jsx', {
    stubs: {
      '@strapi/design-system': { Box: Stub, Flex: Stub, Table: Stub, Typography: Stub },
    },
  });
  const Icon = () => null;
  const html = renderToStaticMarkup(
    React.createElement(TokenTabs, {
      label: 'Token views',
      activeTab: 'b',
      onChange: () => {},
      tabs: [
        { id: 'a', icon: Icon, label: 'First tab', shortLabel: 'A' },
        { id: 'b', icon: Icon, label: 'Second tab', shortLabel: 'B' },
      ],
    })
  );
  assert.match(html, /role="tablist"[^>]*aria-label="Token views"/);
  assert.equal((html.match(/role="tab"/g) || []).length, 2);
  assert.match(
    html,
    /id="magic-link-tab-b"[^>]*aria-selected="true"[^>]*aria-controls="magic-link-panel-b"[^>]*tabindex="0"/
  );
  assert.match(html, /id="magic-link-tab-a"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
});

test('Tokens view files use DS tokens, shared dialogs and translated, labelled controls', () => {
  for (const file of VIEW_FILES) {
    const source = read(file);
    assert.equal(/var\(--colors-/.test(source), false, `${file}: no --colors-* variables`);
    assert.equal(
      /window\.confirm\(|[^.\w]confirm\(/.test(source),
      false,
      `${file}: no window.confirm`
    );
    assert.equal(
      source.includes('navigator.clipboard'),
      false,
      `${file}: clipboard via useCopyToClipboard`
    );
    assert.equal(
      /'de-DE'|'en-US'|toLocale(Date)?String\(/.test(source),
      false,
      `${file}: locale-aware formatting`
    );
    assert.equal(/\p{Extended_Pictographic}|[✓✔⚠]/u.test(source), false, `${file}: no emoji`);
    assert.equal(
      /font-?size:\s*'?(9|10|11|13|15)px/i.test(source),
      false,
      `${file}: DS font scale, 12px minimum`
    );
    assert.equal(
      /fontSize:\s*'(0\.\d+|1\.\d+)rem'/.test(source),
      false,
      `${file}: no rem overrides`
    );
    assert.equal(/console\.(log|debug|error)/.test(source), false, `${file}: no console output`);
    assert.equal(/getTrad\(|useIntl\(/.test(source), false, `${file}: t() with English defaults`);
    assert.equal(/\bas="/.test(source), false, `${file}: DS 2 uses tag, not as`);
    assert.equal(
      /position:\s*'fixed'/.test(source),
      false,
      `${file}: DS Modal instead of fixed overlays`
    );
    assert.equal(
      /#[0-9a-fA-F]{3,8}\b/.test(source.replace(/byScheme\([^)]*\)/g, '')),
      false,
      `${file}: hex only in byScheme`
    );
  }

  const filterBar = read('admin/src/pages/Tokens/components/TokensFilterBar.jsx');
  assert.equal(
    (filterBar.match(/aria-label=/g) || []).length >= 2,
    true,
    'both selects are labelled'
  );
  assert.match(
    filterBar,
    /<Searchbar[\s\S]*?>\s*\{t\('tokens\.search\.label'/,
    'Searchbar has its label child'
  );
  assert.equal(/key=\{`searchbar/.test(filterBar), false, 'no Searchbar remount key');

  const table = read('admin/src/pages/Tokens/components/TokensTable.jsx');
  assert.ok(table.includes("t('tokens.table.select', 'Select {email}'"));
  assert.ok(table.includes('aria-sort='));
  assert.ok(table.includes('ip_address') && !table.includes('login_ip'), 'table reads ip_address');

  const created = read('admin/src/pages/Tokens/components/CreatedTokenModal.jsx');
  assert.ok(
    created.includes('onInteractOutside={preventClose}'),
    'one-time token survives overlay clicks'
  );
  assert.ok(created.includes('onEscapeKeyDown={preventClose}'), 'one-time token survives Escape');
  assert.ok(created.includes('useCopyToClipboard'));

  const modal = read('admin/src/pages/Tokens/CreateTokenModal.jsx');
  assert.ok(modal.includes('context: validation.context'), 'submit passes the parsed context');
  assert.equal(modal.includes('setFormData'), false, 'no stale parent state on submit');
  assert.ok(modal.includes('<Field.Label>') && modal.includes('<Field.Error />'));
});

test('Tokens page gates every control by the 6.0 RBAC capabilities (UI-31)', () => {
  const page = read('admin/src/pages/Tokens/TokensProfessional.jsx');
  assert.ok(page.includes('useMagicLinkRBAC()'));
  assert.ok(
    page.includes('useTokenSettings({ enabled: canReadSettings })'),
    'settings fetched only with settings.read'
  );
  assert.ok(page.includes('useTokenList({ enabled: canRead })'));
  assert.match(
    page,
    /\{canReadSettings \? \(\s*<HeaderButton type="button" onClick=\{\(\) => navigate\('\/settings\/magic-link\/config'\)\}/
  );
  assert.match(
    page,
    /\{canManage \? \(\s*<HeaderButton type="button" onClick=\{\(\) => setIsCreateOpen\(true\)\}/
  );
  assert.ok(page.includes('<Page.NoPermissions />'));
  assert.ok(page.includes('<PluginPageTitle>'));

  const panel = read('admin/src/pages/Tokens/MagicLinksPanel.jsx');
  for (const handler of [
    'deleteToken',
    'bulkDelete',
    'blockToken',
    'activateToken',
    'reissueToken',
    'extend',
  ]) {
    const start = panel.indexOf(`const ${handler} = async`);
    assert.ok(start >= 0, handler);
    assert.match(
      panel.slice(start, start + 200),
      /if \(!canManage/,
      `${handler} checks canManage first`
    );
  }
  assert.ok(panel.includes('Promise.allSettled'), 'bulk delete reports partial results');
});
