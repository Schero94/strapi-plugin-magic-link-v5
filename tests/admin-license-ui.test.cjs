'use strict';

/**
 * License page (admin/src/pages/License/index.jsx): key masking, status
 * mapping, the downloadable license file, translated errors, RBAC gating of
 * the full key, and source guards for dark mode, i18n and a11y.
 * Synthetic data only; nothing is fetched.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { IntlProvider } = require('react-intl');
const { loadAdminModule, contrastRatio, ROOT } = require('./helpers/load-admin-module.cjs');

const PAGE = 'admin/src/pages/License/index.jsx';
const SOURCE = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
const SYNTHETIC_KEY = 'TEST-ONLY-0000-1111-2222-ABCD';
const EMOJI = /\p{Extended_Pictographic}/u;

const el = (tag) =>
  function Stub({ children }) {
    return React.createElement(tag, null, children);
  };

// useMagicLinkRBAC calls useRBAC twice: plugin actions, then settings actions.
let rbac = { plugin: { allowedActions: {} }, settings: { allowedActions: {} } };
const isSettingsCheck = (permissions) =>
  permissions.some((permission) => permission.action.startsWith('plugin::magic-link.settings.'));

const stubs = {
  '@strapi/design-system': {
    Box: el('div'),
    Flex: el('div'),
    Typography: ({ children, tag }) => React.createElement(tag || 'span', null, children),
    Badge: ({ children }) => React.createElement('span', { 'data-badge': '' }, children),
    Alert: ({ title, children, variant, closeLabel, action }) =>
      React.createElement(
        'div',
        { 'data-alert': variant, 'data-close-label': closeLabel },
        title,
        ' ',
        children,
        action
      ),
    Button: ({ children, onClick: _onClick, ...props }) =>
      React.createElement(
        'button',
        { type: 'button', 'aria-pressed': props['aria-pressed'] },
        children
      ),
    Loader: ({ children }) => React.createElement('div', { 'data-loader': '' }, children),
    VisuallyHidden: ({ children }) => React.createElement('span', { 'data-sr': '' }, children),
    Accordion: {
      Root: el('div'),
      Item: el('div'),
      Header: el('h3'),
      Trigger: el('button'),
      Content: el('div'),
    },
  },
  '@strapi/strapi/admin': {
    Page: {
      Main: el('main'),
      Loading: ({ children }) => React.createElement('div', { 'data-page': 'loading' }, children),
      Error: ({ content }) => React.createElement('div', { 'data-page': 'error' }, content),
      NoPermissions: () => React.createElement('div', { 'data-page': 'no-permissions' }),
      Title: () => null,
    },
    useFetchClient: () => ({ get: () => new Promise(() => {}) }),
    useNotification: () => ({ toggleNotification() {} }),
    useRBAC: (permissions) => (isSettingsCheck(permissions) ? rbac.settings : rbac.plugin),
  },
  '@strapi/icons': new Proxy(
    {},
    { get: (_target, name) => (name === '__esModule' ? false : () => null) }
  ),
};

const mod = loadAdminModule(PAGE, { stubs });

const renderEn = (element) =>
  renderToStaticMarkup(
    React.createElement(IntlProvider, { locale: 'en', messages: {}, onError: () => {} }, element)
  );

const t = (_key, defaultMessage) => defaultMessage;

test('maskLicenseKey keeps only the last four characters of a long key', () => {
  const masked = mod.maskLicenseKey(SYNTHETIC_KEY);
  assert.equal(masked.endsWith('ABCD'), true);
  assert.equal(masked.includes('TEST'), false);
  assert.equal(masked.includes('0000'), false);
  assert.equal(mod.maskLicenseKey('SHORT-KEY'), '•'.repeat(8));
  assert.equal(mod.maskLicenseKey(''), '');
  assert.equal(mod.maskLicenseKey(null), '');
  assert.equal(mod.maskLicenseKey('****-ABCD'), '****-ABCD', 'server-masked keys stay as they are');
});

test('getLicenseView maps status payloads and never treats a masked key as the full key', () => {
  const none = mod.getLicenseView({ valid: true, hasKey: false, data: null });
  assert.equal(none.kind, 'none');
  assert.equal(none.fullKey, null);
  assert.equal(none.maskedKey, '');

  const active = mod.getLicenseView({
    valid: true,
    hasKey: true,
    data: { licenseKey: SYNTHETIC_KEY },
  });
  assert.equal(active.kind, 'active');
  assert.equal(active.fullKey, SYNTHETIC_KEY);
  assert.equal(active.isActive, true);

  const unverified = mod.getLicenseView({
    valid: false,
    hasKey: true,
    data: { licenseKey: SYNTHETIC_KEY, isActive: false },
  });
  assert.equal(unverified.kind, 'unverified');
  assert.equal(unverified.isActive, false);

  const serverMasked = mod.getLicenseView({
    hasKey: true,
    data: { licenseKeyMasked: '••••-ABCD' },
  });
  assert.equal(serverMasked.fullKey, null);
  assert.equal(serverMasked.maskedKey, '••••-ABCD');

  const maskedInPlace = mod.getLicenseView({ hasKey: true, data: { licenseKey: '****-ABCD' } });
  assert.equal(maskedInPlace.fullKey, null);

  assert.equal(mod.getLicenseView(undefined).kind, 'none');
});

test('holderName joins trimmed names and is empty when none are set', () => {
  assert.equal(mod.holderName({ firstName: ' Ada ', lastName: 'Example' }), 'Ada Example');
  assert.equal(mod.holderName({ firstName: 'Ada', lastName: null }), 'Ada');
  assert.equal(mod.holderName({}), '');
});

test('the license file uses the given labels and the file name carries no key characters', () => {
  const content = mod.buildLicenseFileContent(
    {
      key: SYNTHETIC_KEY,
      name: 'Ada Example',
      email: 'ada@example.test',
      status: 'Aktiv',
      expires: 'Nie',
      generated: 'heute',
    },
    {
      title: 'Titel',
      key: 'Schlüssel',
      holder: 'Inhaber',
      name: 'Name',
      email: 'E-Mail',
      statusSection: 'Lizenzstatus',
      status: 'Status',
      expires: 'Läuft ab am',
      generated: 'Erstellt',
    }
  );
  assert.match(content, /^Titel\n/);
  assert.match(content, new RegExp(`Schlüssel: ${SYNTHETIC_KEY}`));
  assert.match(content, /Läuft ab am: Nie/);
  assert.equal(EMOJI.test(content), false);
  assert.equal(mod.LICENSE_FILE_NAME.includes(SYNTHETIC_KEY.slice(0, 4)), false);
});

test('licenseErrorMessage maps statuses to translated text and ignores server messages', () => {
  const serverText = 'internal stack trace';
  const forbidden = mod.licenseErrorMessage({ status: 403, message: serverText }, t);
  assert.match(forbidden, /permission/);
  const generic = mod.licenseErrorMessage({ status: 500, message: serverText }, t);
  assert.match(generic, /could not be loaded/);
  assert.equal(generic.includes(serverText), false);
  assert.match(mod.licenseErrorMessage(null, t), /could not be loaded/);
});

test('describeLicense formats expiry through the given formatter and falls back to Never', () => {
  const view = mod.getLicenseView({
    hasKey: true,
    data: {
      licenseKey: SYNTHETIC_KEY,
      expiresAt: '2030-01-02T00:00:00Z',
      firstName: 'Ada',
      lastName: 'Example',
    },
  });
  const described = mod.describeLicense(view, t, () => 'FORMATTED');
  assert.equal(described.expiresText, 'FORMATTED');
  assert.equal(described.name, 'Ada Example');
  assert.equal(described.activeLabel, 'Active');
  const never = mod.describeLicense(mod.getLicenseView({ hasKey: true, data: {} }), t, () => 'x');
  assert.equal(never.expiresText, 'Never');
});

test('overview shows only the masked key and no key actions without the full-key right', () => {
  const view = mod.getLicenseView({
    valid: true,
    hasKey: true,
    data: { licenseKey: SYNTHETIC_KEY, email: 'ada@example.test' },
  });
  const props = {
    view,
    revealed: true,
    alertDismissed: false,
    onDismissAlert() {},
    onToggleReveal() {},
    onCopy() {},
    onDownload() {},
  };

  const readOnly = renderEn(
    React.createElement(mod.LicenseOverview, { ...props, canUseFullKey: false })
  );
  assert.equal(readOnly.includes(SYNTHETIC_KEY), false, 'full key is not rendered');
  assert.match(readOnly, /ABCD/);
  assert.equal(readOnly.includes('Copy key'), false);
  assert.equal(readOnly.includes('Download as TXT'), false);
  assert.match(readOnly, /data-alert="success"/);
  assert.match(readOnly, /data-close-label="Dismiss message"/);

  const manager = renderEn(
    React.createElement(mod.LicenseOverview, { ...props, canUseFullKey: true, revealed: false })
  );
  assert.equal(manager.includes(SYNTHETIC_KEY), false, 'key is hidden until revealed');
  assert.match(manager, /Show key/);
  assert.match(manager, /aria-pressed="false"/);
  assert.match(manager, /Copy key/);

  const revealed = renderEn(
    React.createElement(mod.LicenseOverview, { ...props, canUseFullKey: true, revealed: true })
  );
  assert.equal(revealed.includes(SYNTHETIC_KEY), true);
  assert.match(revealed, /Hide key/);
  assert.match(revealed, /aria-pressed="true"/);

  const empty = renderEn(
    React.createElement(mod.LicenseOverview, {
      ...props,
      view: mod.getLicenseView({ valid: true, hasKey: false }),
      canUseFullKey: false,
    })
  );
  assert.match(empty, /data-alert="default"/);
  assert.match(empty, /No key registered/);
  assert.equal(empty.includes('License key</h2>'), false, 'no banner without a key');
});

test('page view follows RBAC: loading, permission error, no permission, then the data loader', () => {
  const set = (plugin, settings) => {
    rbac = { plugin, settings };
  };
  set({ allowedActions: {} }, { isLoading: true, allowedActions: {} });
  assert.match(renderEn(React.createElement(mod.LicenseView)), /data-page="loading"/);

  set({ allowedActions: {} }, { error: new Error('synthetic'), allowedActions: {} });
  assert.match(renderEn(React.createElement(mod.LicenseView)), /data-page="error"/);

  // Token read/manage rights alone do not open the License page.
  set(
    { allowedActions: { canRead: true, canManage: true } },
    { allowedActions: { canRead: false, canUpdate: false } }
  );
  assert.match(renderEn(React.createElement(mod.LicenseView)), /data-page="no-permissions"/);

  set({ allowedActions: {} }, { allowedActions: { canRead: true, canUpdate: false } });
  const html = renderEn(React.createElement(mod.LicenseView));
  assert.match(html, /<main>/);
  assert.match(html, /<h1>License management<\/h1>/);
  assert.match(html, /data-loader=""/);
  assert.match(html, /Refresh status/);
  set({ allowedActions: {} }, { allowedActions: {} });
});

test('banner colours keep white text readable', () => {
  // 25 % #0F172A over the light end of brand.violetGradient (#667EEA) -> #5064BA
  assert.ok(contrastRatio('#FFFFFF', '#5064BA') >= 4.5);
  assert.match(SOURCE, /rgba\(15, 23, 42, 0\.25\)/);
});

test('License page source guards: tokens, i18n, motion, a11y and no secrets in logs', () => {
  assert.doesNotMatch(SOURCE, /var\(--colors-/);
  assert.doesNotMatch(SOURCE, /#[0-9a-fA-F]{3,8}\b/, 'no hard-coded hex colours');
  assert.doesNotMatch(SOURCE, /\bbackground:\s*white\b/);
  assert.doesNotMatch(SOURCE, /console\./);
  assert.doesNotMatch(SOURCE, /navigator\.clipboard/);
  assert.doesNotMatch(SOURCE, /'(?:en-US|de-DE)'/);
  assert.doesNotMatch(SOURCE, /toLocale(?:Date)?String\(/);
  assert.doesNotMatch(SOURCE, /fontSize:\s*'\d+px'|font-size:\s*\d+px/);
  assert.doesNotMatch(SOURCE, /window\.confirm\(/);
  assert.equal(EMOJI.test(SOURCE), false);
  assert.match(SOURCE, /<Page\.Main>/);
  assert.match(SOURCE, /tag="h1"/);
  assert.match(SOURCE, /<LanguageProvider>/);
  assert.match(SOURCE, /useMagicLinkRBAC\(\)/);
  assert.match(SOURCE, /motionSafe\(css`\s*animation: \$\{shimmer\}/);
  assert.match(SOURCE, /closeLabel=/);
  // Every Alert gets a close label, so the DS close button is named.
  const alerts = SOURCE.match(/<Alert\b[\s\S]*?>/g) || [];
  assert.ok(alerts.length >= 2);
  for (const alert of alerts) assert.match(alert, /closeLabel=/);
});

const EN = JSON.parse(fs.readFileSync(path.join(ROOT, 'admin/src/translations/en.json'), 'utf8'));
const MERGED = Boolean(EN['magic-link.license.title']);

test(
  'every License message id used in the page is translated with its English default',
  {
    skip: MERGED ? false : 'license i18n fragments are not merged into admin/src/translations yet',
  },
  () => {
    const pairs = [...SOURCE.matchAll(/\bt\(\s*'(license\.[\w.]+)',\s*'((?:[^'\\]|\\.)*)'/g)];
    assert.ok(pairs.length > 20);
    for (const [, key, english] of pairs) {
      assert.equal(EN[`magic-link.${key}`], english, `${key} matches its defaultMessage`);
    }
  }
);
