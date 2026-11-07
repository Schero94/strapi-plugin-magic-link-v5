'use strict';

/**
 * Behavioural tests for the shared admin foundation: RBAC actions and
 * capability mapping, i18n scope and translations, theme tokens, clipboard,
 * formatters, unsaved-changes guard helpers, gallery email templates and the
 * shared dialog.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { createIntl, IntlProvider, useIntl } = require('react-intl');
const IntlMessageFormat = require('intl-messageformat').default;
const {
  loadAdminModule,
  loadAdminModuleAsync,
  contrastRatio,
  ROOT,
} = require('./helpers/load-admin-module.cjs');

const LOCALES = ['en', 'de', 'fr', 'es', 'pt'];
const translationsDir = path.join(ROOT, 'admin', 'src', 'translations');
const readLocale = (locale) =>
  JSON.parse(fs.readFileSync(path.join(translationsDir, `${locale}.json`), 'utf8'));
const EMOJI = /\p{Extended_Pictographic}/u;

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

test('permissions define read, manage and settings actions and no legacy access action', () => {
  const { default: permissions } = loadAdminModule('admin/src/permissions.js');
  const uids = (list) => list.map((entry) => entry.action);

  assert.deepEqual(uids(permissions.read), ['plugin::magic-link.read']);
  assert.deepEqual(uids(permissions.manage), ['plugin::magic-link.manage']);
  assert.deepEqual(uids(permissions.settingsRead), ['plugin::magic-link.settings.read']);
  assert.deepEqual(uids(permissions.settingsUpdate), ['plugin::magic-link.settings.update']);
  assert.deepEqual(uids(permissions.main), ['plugin::magic-link.read']);

  const all = Object.values(permissions).flatMap(uids);
  assert.ok(!all.includes('plugin::magic-link.access'), 'the 5.x access action is gone');
  for (const entry of Object.values(permissions).flat()) assert.equal(entry.subject, null);
});

test('admin registration gates the menu with read and both settings pages with settings.read', async () => {
  const { default: plugin } = await loadAdminModuleAsync('admin/src/index.js', {
    externalPattern: /^\.\/pages\//,
    stubs: { '@strapi/icons': { Key: () => null } },
  });
  const calls = { menu: [], sections: [] };
  plugin.register({
    registerPlugin: () => {},
    addMenuLink: (link) => calls.menu.push(link),
    createSettingSection: (section, links) => calls.sections.push({ section, links }),
  });

  assert.equal(calls.menu.length, 1);
  assert.deepEqual(
    calls.menu[0].permissions.map((p) => p.action),
    ['plugin::magic-link.read']
  );
  assert.equal(calls.menu[0].intlLabel.id, 'magic-link.tokens.title');

  const links = calls.sections[0].links;
  assert.deepEqual(
    links.map((link) => [link.id, link.permissions.map((p) => p.action)]),
    [
      ['magic-link-settings', ['plugin::magic-link.settings.read']],
      ['magic-link-license', ['plugin::magic-link.settings.read']],
    ]
  );
});

test('registerTrads returns plugin messages per locale and an empty set for unknown locales', async () => {
  const { default: plugin } = await loadAdminModuleAsync('admin/src/index.js', {
    externalPattern: /^\.\/pages\//,
    stubs: { '@strapi/icons': { Key: () => null } },
  });
  const result = await plugin.registerTrads({ locales: ['de', 'xx'] });
  const de = result.find((entry) => entry.locale === 'de');
  const xx = result.find((entry) => entry.locale === 'xx');
  assert.equal(de.data['magic-link.common.cancel'], readLocale('de')['magic-link.common.cancel']);
  assert.deepEqual(xx.data, {});
});

test('capabilities fail closed while loading or on error and map one flag per server action', () => {
  const { resolveCapabilities } = loadAdminModule('admin/src/hooks/useMagicLinkRBAC.js', {
    stubs: { '@strapi/strapi/admin': { useRBAC: () => ({}) } },
  });
  const granted = { allowedActions: { canRead: true, canManage: true, canUpdate: true } };

  const loading = resolveCapabilities({ ...granted, isLoading: true }, granted);
  assert.equal(loading.canRead, false);
  assert.equal(loading.canManage, false);
  assert.equal(loading.isLoading, true);

  const failed = resolveCapabilities(granted, { ...granted, error: new Error('x') });
  assert.deepEqual(
    [failed.canRead, failed.canManage, failed.canReadSettings, failed.canUpdateSettings],
    [false, false, false, false]
  );

  const readOnly = resolveCapabilities(
    { allowedActions: { canRead: true, canManage: false } },
    { allowedActions: { canRead: true, canUpdate: false } }
  );
  assert.equal(readOnly.canRead, true);
  assert.equal(readOnly.canManage, false);
  assert.equal(readOnly.isReadOnly, true);
  assert.equal(readOnly.isSettingsReadOnly, true);

  const manageOnly = resolveCapabilities({ allowedActions: { canManage: true } }, {});
  assert.equal(manageOnly.canRead, false, 'manage does not imply read');
  assert.equal(manageOnly.canManage, true);
});

test('useMagicLinkRBAC checks plugin and settings actions in separate useRBAC calls', () => {
  const seen = [];
  const { useMagicLinkRBAC } = loadAdminModule('admin/src/hooks/useMagicLinkRBAC.js', {
    stubs: {
      '@strapi/strapi/admin': {
        useRBAC: (perms) => {
          seen.push(perms.map((p) => p.action));
          return { isLoading: false, allowedActions: { canRead: true } };
        },
      },
    },
  });
  const result = useMagicLinkRBAC();
  assert.deepEqual(seen, [
    ['plugin::magic-link.read', 'plugin::magic-link.manage'],
    ['plugin::magic-link.settings.read', 'plugin::magic-link.settings.update'],
  ]);
  assert.equal(result.canRead, true);
  assert.equal(result.canReadSettings, true);
  assert.equal(result.canManage, false);
});

// ---------------------------------------------------------------------------
// i18n helpers
// ---------------------------------------------------------------------------

test('getTranslation prefixes once and getTrad stays an alias', () => {
  const { getTranslation } = loadAdminModule('admin/src/utils/getTranslation.js');
  const { default: getTrad } = loadAdminModule('admin/src/utils/getTrad.js');
  assert.equal(getTranslation('tokens.title'), 'magic-link.tokens.title');
  assert.equal(getTranslation('magic-link.tokens.title'), 'magic-link.tokens.title');
  assert.equal(getTrad('tokens.title'), 'magic-link.tokens.title');
});

test('useMagicLinkIntl passes the English defaultMessage and ICU values', () => {
  const { useMagicLinkIntl } = loadAdminModule('admin/src/hooks/useMagicLinkIntl.js');
  const Probe = () => {
    const { t } = useMagicLinkIntl();
    return React.createElement(
      'p',
      null,
      `${t('tokens.missing', 'Delete {count, plural, one {# token} other {# tokens}}', { count: 2 })}|${t('known', 'fallback')}`
    );
  };
  const html = renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: 'de', messages: { 'magic-link.known': 'Bekannt' }, onError: () => {} },
      React.createElement(Probe)
    )
  );
  assert.equal(html, '<p>Delete 2 tokens|Bekannt</p>');
});

const loadLanguageProvider = () => loadAdminModule('admin/src/components/LanguageProvider.jsx');

test('LanguageProvider helpers map admin locales, guard storage and keep admin messages', () => {
  const lp = loadLanguageProvider();
  assert.equal(lp.toSupportedLanguage('de'), 'de');
  assert.equal(lp.toSupportedLanguage('pt-BR'), 'pt');
  assert.equal(lp.toSupportedLanguage('en_GB'), 'en');
  assert.equal(lp.toSupportedLanguage('ja'), null);
  assert.equal(lp.toSupportedLanguage(undefined), null);

  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(lp.readStoredLanguage(throwing), null);
  assert.doesNotThrow(() => lp.writeStoredLanguage('de', throwing));
  assert.equal(lp.readStoredLanguage({ getItem: () => 'fr' }), 'fr');
  assert.equal(lp.readStoredLanguage({ getItem: () => 'klingon' }), null);

  const messages = lp.buildMessages({ 'global.save': 'Speichern (admin)' }, 'de');
  assert.equal(messages['global.save'], 'Speichern (admin)');
  assert.equal(messages['magic-link.common.cancel'], readLocale('de')['magic-link.common.cancel']);

  const reported = [];
  const onError = lp.createIntlErrorHandler((error) => reported.push(error.code));
  onError({ code: 'MISSING_TRANSLATION' });
  onError({ code: 'FORMAT_ERROR' });
  assert.deepEqual(reported, ['FORMAT_ERROR']);
});

test('LanguageProvider follows the admin locale and keeps Strapi messages available', () => {
  const { LanguageProvider } = loadLanguageProvider();
  const Probe = () => {
    const intl = useIntl();
    return React.createElement(
      'p',
      null,
      [
        intl.locale,
        intl.formatMessage({ id: 'magic-link.common.cancel' }),
        intl.formatMessage({ id: 'global.cancel' }),
      ].join('|')
    );
  };
  const render = (locale) =>
    renderToStaticMarkup(
      React.createElement(
        IntlProvider,
        { locale, messages: { 'global.cancel': `admin-${locale}` }, onError: () => {} },
        React.createElement(LanguageProvider, null, React.createElement(Probe))
      )
    );

  assert.equal(render('de'), `<p>de|${readLocale('de')['magic-link.common.cancel']}|admin-de</p>`);
  assert.equal(
    render('pt-BR'),
    `<p>pt-BR|${readLocale('pt')['magic-link.common.cancel']}|admin-pt-BR</p>`
  );
  // Unsupported admin locale: English plugin messages, admin messages kept.
  assert.equal(render('ja'), '<p>en|Cancel|admin-ja</p>');
});

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------

test('all locales have the same keys, no empty values and no emoji', () => {
  const en = readLocale('en');
  const enKeys = Object.keys(en).sort();
  for (const locale of LOCALES) {
    const data = readLocale(locale);
    assert.deepEqual(Object.keys(data).sort(), enKeys, `${locale} key parity`);
    for (const [key, value] of Object.entries(data)) {
      assert.ok(key.startsWith('magic-link.'), `${locale} ${key} prefix`);
      assert.equal(typeof value, 'string');
      assert.ok(value.trim().length > 0, `${locale} ${key} empty`);
      assert.ok(!EMOJI.test(value), `${locale} ${key} contains emoji`);
    }
  }
});

test('every message is valid ICU and formats without throwing', () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(readLocale(locale))) {
      const message = new IntlMessageFormat(value, locale);
      const names = [...new Set([...value.matchAll(/(?<!')\{(\w+)/g)].map((m) => m[1]))];
      const values = Object.fromEntries(names.map((name) => [name, 2]));
      assert.doesNotThrow(() => message.format(values), `${locale} ${key}`);
    }
  }
  const en = readLocale('en');
  const format = (key) => new IntlMessageFormat(en[key], 'en').format();
  assert.ok(format('magic-link.settings.email.designer.variables').includes('{{magicLink}}'));
  assert.equal(format('magic-link.tokens.create.context.placeholder'), '{ "key": "value" }');
});

test('German uses the formal Sie register and no template uses lodash syntax', () => {
  const informal =
    /\b(du|dein|deine|deinen|deinem|deiner|dich|dir)\b|\b(Wähle|Gib|Klicke|Kopiere|Konfiguriere|Verwalte|Erstelle|Nutze|Verwende|Gestalte|Aktiviere|Teste|Stelle|Lade)\b/i;
  for (const [key, value] of Object.entries(readLocale('de'))) {
    assert.ok(!informal.test(value), `informal German in ${key}: ${value}`);
  }
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(readLocale(locale))) {
      assert.ok(!value.includes('<%'), `${locale} ${key} uses <% %>`);
    }
  }
});

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------

const DARK = {
  colorScheme: 'dark',
  colors: { neutral0: '#212134', neutral100: '#181826', neutral800: '#ffffff' },
  fontSizes: ['1.1rem', '1.2rem', '1.4rem'],
  spaces: ['0px', '4px', '8px', '12px', '16px'],
};

test('theme helpers read DS tokens from the active theme and fall back to light values', () => {
  const t = loadAdminModule('admin/src/utils/theme.js');
  assert.equal(t.color('neutral0')({ theme: DARK }), '#212134');
  assert.equal(t.color('neutral0')({}), '#ffffff');
  assert.equal(t.fontSize(1)({}), '1.2rem');
  assert.equal(t.space(4)({ theme: DARK }), '16px');
  assert.equal(t.space(3)({}), '12px');
  assert.equal(t.accent.primary({ theme: DARK }), t.ACCENT_VALUES.primary[1]);
  assert.equal(t.accent.primary({}), t.ACCENT_VALUES.primary[0]);
  assert.equal(t.tint.danger.fg({ theme: DARK }), t.ACCENT_VALUES.danger[1]);
});

test('brand fills keep white text at WCAG AA and accents are readable in both schemes', () => {
  const t = loadAdminModule('admin/src/utils/theme.js');
  for (const name of ['primary', 'secondary', 'success', 'warning', 'danger']) {
    assert.ok(contrastRatio(t.brand[name], '#ffffff') >= 4.5, `brand.${name} with white text`);
  }
  for (const [name, [light, dark]] of Object.entries(t.ACCENT_VALUES)) {
    assert.ok(contrastRatio(light, '#ffffff') >= 4.5, `accent.${name} on light neutral0`);
    assert.ok(contrastRatio(dark, '#212134') >= 4.5, `accent.${name} on dark neutral0`);
    assert.ok(contrastRatio(dark, '#181826') >= 4.5, `accent.${name} on dark neutral100`);
  }
  // Hero gradient start: white headline text must be large (>= 3:1).
  assert.ok(contrastRatio('#0284C7', '#ffffff') >= 3);
});

// ---------------------------------------------------------------------------
// Clipboard, formatters, unsaved-changes helpers
// ---------------------------------------------------------------------------

test('copyToClipboard reports real success, falls back on rejection and never throws', async () => {
  const { copyToClipboard } = loadAdminModule('admin/src/components/shared/clipboard.js');
  const written = [];
  const okNav = { clipboard: { writeText: async (text) => written.push(text) } };
  assert.equal(
    await copyToClipboard('abc', { navigator: okNav, window: { isSecureContext: true } }),
    true
  );
  assert.deepEqual(written, ['abc']);

  const fakeDoc = (result) => {
    const body = { appendChild() {}, removeChild() {} };
    return {
      body,
      activeElement: null,
      createElement: () => ({ style: {}, setAttribute() {}, select() {} }),
      execCommand: () => result,
    };
  };
  const rejecting = { clipboard: { writeText: async () => Promise.reject(new Error('denied')) } };
  assert.equal(
    await copyToClipboard('abc', { navigator: rejecting, document: fakeDoc(true), window: {} }),
    true
  );
  assert.equal(
    await copyToClipboard('abc', { navigator: rejecting, document: fakeDoc(false), window: {} }),
    false
  );
  assert.equal(await copyToClipboard('', { navigator: okNav }), false);
});

test('formatters follow the admin locale and render a dash for empty or invalid dates', () => {
  const { createFormatters } = loadAdminModule('admin/src/components/shared/format.js');
  const date = new Date(Date.UTC(2026, 10, 6, 14, 5));
  const de = createFormatters(createIntl({ locale: 'de', timeZone: 'UTC' }));
  const en = createFormatters(createIntl({ locale: 'en-US', timeZone: 'UTC' }));
  assert.equal(de.formatDate(date), '06.11.2026');
  assert.equal(en.formatDate(date), 'Nov 6, 2026');
  assert.equal(de.formatDateTime(null), '-');
  assert.equal(de.formatDateTime('not a date'), '-');
  assert.equal(de.formatNumber(1234.5), '1.234,5');
});

test('unsaved-changes guard blocks only dirty navigations and registers beforeunload', () => {
  const { shouldBlockNavigation, attachBeforeUnload } = loadAdminModule(
    'admin/src/hooks/useUnsavedChangesGuard.js',
    { stubs: { 'react-router-dom': { useBlocker: () => ({ state: 'unblocked' }) } } }
  );
  const from = { pathname: '/a', search: '' };
  assert.equal(
    shouldBlockNavigation(false, { currentLocation: from, nextLocation: { pathname: '/b' } }),
    false
  );
  assert.equal(
    shouldBlockNavigation(true, { currentLocation: from, nextLocation: { pathname: '/b' } }),
    true
  );
  assert.equal(
    shouldBlockNavigation(true, {
      currentLocation: from,
      nextLocation: { pathname: '/a', search: '' },
    }),
    false
  );
  assert.equal(
    shouldBlockNavigation(true, {
      currentLocation: from,
      nextLocation: { pathname: '/a', search: '?x' },
    }),
    true
  );

  const listeners = new Map();
  const win = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  const detach = attachBeforeUnload(true, win);
  const event = { preventDefault() {}, returnValue: undefined };
  listeners.get('beforeunload')(event);
  assert.equal(event.returnValue, '');
  detach();
  assert.equal(listeners.size, 0);
  attachBeforeUnload(false, win)();
  assert.equal(listeners.size, 0);
});

// ---------------------------------------------------------------------------
// Gallery email templates
// ---------------------------------------------------------------------------

test('gallery templates use only safe {{VARIABLE}} placeholders and no emoji', () => {
  const { EMAIL_TEMPLATES, getTemplate, getTemplateList, toPlaceholderSyntax } = loadAdminModule(
    'admin/src/utils/emailTemplates.js'
  );
  const allowed = new Set(['LOGIN_URL', 'EXPIRY_TEXT']);
  for (const [key, template] of Object.entries(EMAIL_TEMPLATES)) {
    for (const body of [template.html, template.text]) {
      assert.ok(!body.includes('<%'), `${key} uses lodash syntax`);
      assert.ok(!EMOJI.test(body), `${key} contains emoji`);
      assert.ok(body.includes('{{LOGIN_URL}}'), `${key} has the login link`);
      for (const [, name] of body.matchAll(/\{\{\s*([A-Z_]+)\s*\}\}/g)) {
        assert.ok(allowed.has(name), `${key} uses unknown {{${name}}}`);
      }
    }
    assert.ok(!/1 hour|60 minutes/.test(template.html), `${key} hard-codes the lifetime`);
  }
  assert.equal(getTemplateList().length, Object.keys(EMAIL_TEMPLATES).length);
  assert.equal(getTemplate('__proto__'), EMAIL_TEMPLATES.modern);
  assert.equal(
    toPlaceholderSyntax(
      '<a href="<%= URL %>?loginToken=<%= CODE %>">x</a> <%= EXPIRY_TEXT %> <%=code%>'
    ),
    '<a href="{{LOGIN_URL}}">x</a> {{EXPIRY_TEXT}} {{CODE}}'
  );
  assert.equal(toPlaceholderSyntax(undefined), '');
});

// ---------------------------------------------------------------------------
// Shared dialog
// ---------------------------------------------------------------------------

test('ConfirmDialog renders a DS alert dialog with translated default labels', () => {
  const el =
    (tag) =>
    ({ children, ...props }) =>
      React.createElement(tag, { 'data-ds': props['data-ds'] }, children);
  const Dialog = {
    Root: ({ open, children }) =>
      open ? React.createElement('div', { role: 'alertdialog' }, children) : null,
    Content: el('section'),
    Header: el('h2'),
    Body: el('div'),
    Description: el('p'),
    Footer: el('footer'),
    Cancel: el('span'),
  };
  const Button = ({ children, variant }) =>
    React.createElement('button', { 'data-variant': variant }, children);
  const stubs = {
    '@strapi/design-system': {
      Dialog,
      Button,
      Flex: el('div'),
      Typography: el('span'),
    },
    '@strapi/icons': { WarningCircle: () => null },
  };
  // Layout effects never run during server rendering; use the passive hook so
  // React does not warn about them.
  stubs.react = { ...React, useLayoutEffect: React.useEffect };
  const { ConfirmDialog } = loadAdminModule('admin/src/components/shared/ConfirmDialog.jsx', {
    stubs,
  });
  const render = (props) =>
    renderToStaticMarkup(
      React.createElement(
        IntlProvider,
        { locale: 'de', messages: readLocale('de'), onError: () => {} },
        React.createElement(ConfirmDialog, { onClose() {}, onConfirm() {}, title: 'T', ...props })
      )
    );

  assert.equal(render({ isOpen: false }), '');
  const html = render({ isOpen: true, description: 'Body text' });
  assert.match(html, /role="alertdialog"/);
  assert.match(html, /<h2>T<\/h2>/);
  assert.match(html, /<p>Body text<\/p>/);
  assert.match(html, />Abbrechen</);
  assert.match(html, /data-variant="danger">Löschen</);
  assert.match(render({ isOpen: true, variant: 'default' }), /data-variant="default">Bestätigen</);
});
