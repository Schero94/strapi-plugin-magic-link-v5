'use strict';

/**
 * Security tabs (OTP codes, JWT sessions, IP bans): behavioural tests for the
 * pure helpers in admin/src/pages/Tokens/securityTabs.utils.js, plus source
 * guards for the three views. Synthetic data only.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAdminModule, ROOT } = require('./helpers/load-admin-module.cjs');

const utils = loadAdminModule('admin/src/pages/Tokens/securityTabs.utils.js');
const VIEWS = ['OTPCodes.jsx', 'JWTSessions.jsx', 'IPBans.jsx', 'securityTabs.shared.jsx'];
const read = (file) => fs.readFileSync(path.join(ROOT, 'admin/src/pages/Tokens', file), 'utf8');

const NOW = Date.parse('2026-11-07T12:00:00.000Z');
const past = '2026-11-07T11:00:00.000Z';
const future = '2026-11-07T13:00:00.000Z';

test('clampPage keeps the page inside the available range', () => {
  assert.equal(utils.clampPage(3, 1), 1);
  assert.equal(utils.clampPage(0, 4), 1);
  assert.equal(utils.clampPage(Number.NaN, 4), 1);
  assert.equal(utils.clampPage(5, 4), 4);
  assert.equal(utils.clampPage(2, 0), 1);
  assert.equal(utils.getPageCount(0, 10), 1);
  assert.equal(utils.getPageCount(21, 10), 3);
});

test('a search on page 3 still shows the matching rows (page is clamped, E2E-13)', () => {
  const sessions = Array.from({ length: 30 }, (_, i) => ({
    id: `s${i}`,
    email: i === 7 ? 'match@example.test' : `user${i}@example.test`,
    expiresAt: future,
  }));
  const filtered = utils.filterSessions(sessions, { query: 'MATCH', now: NOW });
  const page = utils.clampPage(3, utils.getPageCount(filtered.length, 10));
  assert.deepEqual(
    utils.paginate(filtered, page, 10).map((s) => s.id),
    ['s7']
  );
});

test('getPageItems renders ellipses instead of one link per page', () => {
  assert.deepEqual(utils.getPageItems(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(utils.getPageItems(5, 10), [1, 'dots-start', 4, 5, 6, 'dots-end', 10]);
  assert.deepEqual(utils.getPageItems(1, 10), [1, 2, 3, 4, 5, 'dots-end', 10]);
  assert.deepEqual(utils.getPageItems(10, 10), [1, 'dots-start', 6, 7, 8, 9, 10]);
  assert.deepEqual(utils.getPageItems(50, 10), [1, 'dots-start', 6, 7, 8, 9, 10]);
});

test('session status is derived: revoked wins over expired, expiry is checked by date', () => {
  assert.equal(utils.getSessionStatus({ revoked: true, isExpired: true }, NOW), 'revoked');
  assert.equal(utils.getSessionStatus({ isExpired: true }, NOW), 'expired');
  assert.equal(utils.getSessionStatus({ expiresAt: past }, NOW), 'expired');
  assert.equal(utils.getSessionStatus({ expiresAt: future }, NOW), 'active');
  assert.deepEqual(
    utils.getSessionStats(
      [
        { revoked: true, isExpired: true },
        { expiresAt: past },
        { expiresAt: future },
        { expiresAt: future },
      ],
      NOW
    ),
    { total: 4, active: 2, expired: 1, revoked: 1 }
  );
});

test('filterSessions searches email, username and IP and filters by derived status', () => {
  const sessions = [
    {
      id: 1,
      email: 'a@example.test',
      username: 'alpha',
      ipAddress: '192.0.2.1',
      expiresAt: future,
    },
    {
      id: 2,
      email: 'b@example.test',
      username: 'beta',
      ipAddress: '198.51.100.7',
      revoked: true,
      expiresAt: future,
    },
    { id: 3, email: 'c@example.test', username: null, ipAddress: null, expiresAt: past },
  ];
  assert.deepEqual(
    utils.filterSessions(sessions, { query: 'BETA', now: NOW }).map((s) => s.id),
    [2]
  );
  assert.deepEqual(
    utils.filterSessions(sessions, { query: '192.0.2', now: NOW }).map((s) => s.id),
    [1]
  );
  assert.deepEqual(
    utils.filterSessions(sessions, { status: 'expired', now: NOW }).map((s) => s.id),
    [3]
  );
  assert.deepEqual(
    utils.filterSessions(sessions, { status: 'active', now: NOW }).map((s) => s.id),
    [1]
  );
});

test('sortSessions returns a sorted copy and never mutates state (UI-18)', () => {
  const sessions = [
    { id: 'a', username: 'zoe', createdAt: '2026-01-02T00:00:00Z', expiresAt: future },
    {
      id: 'b',
      username: 'adam',
      createdAt: '2026-01-03T00:00:00Z',
      revoked: true,
      expiresAt: future,
    },
    { id: 'c', username: null, email: 'mia@example.test', createdAt: null, expiresAt: past },
  ];
  const snapshot = sessions.map((s) => s.id);
  const byCreatedDesc = utils.sortSessions(sessions, 'createdAt', 'desc', NOW);
  assert.deepEqual(
    byCreatedDesc.map((s) => s.id),
    ['b', 'a', 'c'],
    'empty dates sort last'
  );
  assert.deepEqual(
    sessions.map((s) => s.id),
    snapshot,
    'input array untouched'
  );
  assert.notEqual(byCreatedDesc, sessions);
  assert.deepEqual(
    utils.sortSessions(sessions, 'username', 'asc', NOW).map((s) => s.id),
    ['b', 'c', 'a']
  );
  assert.deepEqual(
    utils.sortSessions(sessions, 'status', 'asc', NOW).map((s) => s.id),
    ['a', 'c', 'b']
  );
});

test('OTP delete uses the documentId (Strapi 5 Document Service), id only as fallback (UI-03)', () => {
  assert.equal(utils.getOtpDeleteId({ id: 12, documentId: 'abc123def456' }), 'abc123def456');
  assert.equal(utils.getOtpDeleteId({ id: 12 }), '12');
  assert.equal(utils.getOtpDeleteId({}), null);
});

test('OTP rows never keep the stored code hash or magic-link token (UI-17)', () => {
  const row = utils.normalizeOtpCode({
    id: 1,
    documentId: 'doc0000abcd1234',
    email: 'user@example.test',
    code: 'f'.repeat(64),
    magicLinkToken: 'e'.repeat(64),
    type: 'email',
    used: 0,
    attempts: '2',
    created_at: past,
    expiresAt: future,
  });
  assert.equal('code' in row, false);
  assert.equal('magicLinkToken' in row, false);
  assert.equal(row.attempts, 2);
  assert.equal(row.used, false);
  assert.equal(row.createdAt, past.replace('.000Z', '.000Z'));
  assert.equal(utils.getOtpReference(row), 'ABCD1234');
  assert.equal(utils.getOtpReference({ id: 9 }), '#9');
});

test('buildOtpQuery requests one capped page with server-side filters (FUN-20, ADM-24)', () => {
  assert.deepEqual(
    utils.buildOtpQuery({ page: 2, pageSize: 1000, search: '  user@ ', status: 'expired' }),
    {
      page: 2,
      pageSize: 100,
      email: 'user@',
      status: 'expired',
    }
  );
  assert.deepEqual(utils.buildOtpQuery({ page: 'x', pageSize: 25, search: '', status: 'all' }), {
    page: 1,
    pageSize: 25,
  });
  assert.equal(
    utils.buildOtpQuery({ page: 1, pageSize: 10, search: 'a'.repeat(400) }).email.length,
    320
  );
});

test('normalizeOtpListResponse fixes pagination meta echoed with an uncapped pageSize', () => {
  const codes = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    documentId: `doc${i}`,
    expiresAt: future,
  }));
  const result = utils.normalizeOtpListResponse(
    { codes, pagination: { page: 1, pageSize: 1000, total: 245, pageCount: 1 } },
    { page: 1, pageSize: 10, now: NOW }
  );
  assert.equal(result.pagination.pageSize, 10);
  assert.equal(result.pagination.pageCount, 25);
  assert.equal(result.pagination.total, 245);
  assert.equal(result.stats, null, 'stats are unknown when only one page of many was loaded');
});

test('normalizeOtpListResponse clamps the page and applies the status filter as a fallback', () => {
  const codes = [
    { id: 1, used: true, expiresAt: future },
    { id: 2, expiresAt: past },
    { id: 3, expiresAt: future },
  ];
  const result = utils.normalizeOtpListResponse(
    { codes, pagination: { page: 7, total: 3 } },
    { page: 7, pageSize: 10, status: 'expired', filtersActive: true, now: NOW }
  );
  assert.deepEqual(
    result.codes.map((c) => c.id),
    [2]
  );
  assert.equal(result.pagination.page, 1);
  assert.equal(result.stats, null);

  const complete = utils.normalizeOtpListResponse(
    { codes, pagination: { total: 3 } },
    { page: 1, pageSize: 10, now: NOW }
  );
  assert.deepEqual(complete.stats, { total: 3, active: 1, expired: 1, used: 1 });

  const fromServer = utils.normalizeOtpListResponse(
    {
      codes,
      pagination: { total: 300 },
      stats: { total: 300, active: 10, expired: 280, used: 10 },
    },
    { page: 1, pageSize: 10, filtersActive: true, now: NOW }
  );
  assert.deepEqual(fromServer.stats, { total: 300, active: 10, expired: 280, used: 10 });
});

test('IP helpers filter case-insensitively and count IPv4/IPv6', () => {
  const ips = ['192.0.2.10', '2001:db8::1', '198.51.100.3', 42, ''];
  assert.deepEqual(utils.filterIps(ips, 'DB8'), ['2001:db8::1']);
  assert.deepEqual(utils.filterIps(ips, ''), ['192.0.2.10', '2001:db8::1', '198.51.100.3']);
  assert.deepEqual(utils.getIpStats(ips), { total: 3, ipv4: 2, ipv6: 1 });
});

test('bulk results report partial failures and keep the failed ids selected', () => {
  const summary = utils.summarizeSettled(
    ['a', 'b', 'c'],
    [
      { status: 'fulfilled', value: { data: { success: true } } },
      { status: 'rejected', reason: new Error('synthetic') },
      { status: 'fulfilled', value: { data: { success: false } } },
    ]
  );
  assert.equal(summary.succeeded, 1);
  assert.deepEqual(summary.failedIds, ['b', 'c']);
  assert.equal(utils.getSelectAllState(['a', 'b'], []), false);
  assert.equal(utils.getSelectAllState(['a', 'b'], ['a']), 'indeterminate');
  assert.equal(utils.getSelectAllState(['a', 'b'], ['b', 'a', 'z']), true);
  assert.equal(utils.getSelectAllState([], ['a']), false);
});

test('security tab views use tokens, DS dialogs and translated strings only', () => {
  const emoji = /\p{Extended_Pictographic}/u;
  for (const file of VIEWS) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /var\(--colors-/,
      `${file}: no DS CSS variables (they do not exist)`
    );
    assert.doesNotMatch(source, /window\.confirm\(|\bconfirm\(/, `${file}: no window.confirm`);
    assert.doesNotMatch(
      source,
      /'de-DE'|'en-US'|toLocale(Date)?String\(/,
      `${file}: locale-aware dates`
    );
    assert.doesNotMatch(
      source,
      /navigator\.clipboard/,
      `${file}: clipboard through the shared hook`
    );
    assert.doesNotMatch(source, /console\.(log|debug|error)\(/, `${file}: no console output`);
    assert.doesNotMatch(
      source,
      /font-size:\s*(9|10|11)px|fontSize:\s*'(9|10|11)px'/,
      `${file}: no sub-12px text`
    );
    assert.doesNotMatch(
      source,
      /#(E5E7EB|6B7280|1F2937|F9FAFB)\b|background:\s*white/i,
      `${file}: no light-only colours`
    );
    assert.doesNotMatch(
      source,
      /getTrad\(|formatMessage\(\{/,
      `${file}: t(key, defaultMessage) everywhere`
    );
    assert.doesNotMatch(source, /\bsms\b|whatsapp|phoneNumber/i, `${file}: email only`);
    assert.ok(!emoji.test(source), `${file}: no emoji`);
  }
});

test('security tab views gate writes with manage RBAC and confirm destructive actions', () => {
  for (const file of ['OTPCodes.jsx', 'JWTSessions.jsx', 'IPBans.jsx']) {
    const source = read(file);
    assert.match(source, /useMagicLinkRBAC\(\)/, `${file}: RBAC hook`);
    assert.match(
      source,
      /<ConfirmDialog[\s\S]*isOpen=\{canManage && /,
      `${file}: confirm dialog gated by manage`
    );
    assert.match(
      source,
      /<Searchbar[\s\S]*?>\s*\{t\('[a-z]+\.search\.label'/,
      `${file}: Searchbar has a label child`
    );
    assert.doesNotMatch(source, /position:\s*'fixed'/, `${file}: no hand-made overlays`);
    assert.doesNotMatch(
      source,
      /withTooltip=\{false\}/,
      `${file}: icon buttons keep their tooltip`
    );
    const handlers = [
      ...source.matchAll(
        /const handle(Delete|BulkDelete|Cleanup|Revoke|Unrevoke|BulkRevoke|BanIP|UnbanIP) = async \([^)]*\) => \{\n([^\n]*\n){0,2}/g
      ),
    ];
    assert.ok(handlers.length > 0, `${file}: mutation handlers found`);
    for (const [block] of handlers)
      assert.match(block, /if \(!canManage/, `${file}: handler checks canManage first`);
  }
  for (const file of ['OTPCodes.jsx', 'JWTSessions.jsx']) {
    assert.match(read(file), /<SingleSelect\s+aria-label=/, `${file}: status select is labelled`);
  }
  assert.match(
    read('IPBans.jsx'),
    /<Modal\.Root[\s\S]*<Modal\.Title>[\s\S]*<Field\.Root/,
    'IP ban form is a DS modal with a Field'
  );
});
