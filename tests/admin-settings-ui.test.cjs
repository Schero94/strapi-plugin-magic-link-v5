'use strict';

/**
 * Settings view: behaviour of the form helpers (validation mirrors the
 * settings API, dirty tracking, partial save payload, login modes, lock-out
 * protection), a server-side render of the MFA section, and source guards for
 * every Settings file (tokens, i18n, a11y, no WhatsApp/SMS).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { IntlProvider } = require('react-intl');
const { loadAdminModule, loadAdminModuleAsync, ROOT } = require('./helpers/load-admin-module.cjs');

const SETTINGS_DIR = path.join(ROOT, 'admin/src/pages/Settings');
const form = loadAdminModule('admin/src/pages/Settings/utils/settingsForm.js');

const listFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
const settingsFiles = listFiles(SETTINGS_DIR);

/* ------------------------------------------------------------------ */
/* Validation mirrors the server                                       */
/* ------------------------------------------------------------------ */

test('link URL rule matches the server policy for login e-mails', () => {
  const { isAllowedLinkUrl } = require('../server/src/utils/login-url');
  const samples = [
    'https://app.example.com',
    'https://app.example.com/auth/magic-link?x=1',
    'http://localhost:3000/login',
    'http://127.0.0.1:1337',
    'http://dev.localhost',
    'http://app.example.com',
    'https://user:pass@app.example.com',
    'javascript:alert(1)',
    'ftp://example.com',
    'not a url',
    '//evil.example.com',
  ];
  for (const sample of samples) {
    assert.equal(form.isValidLinkUrl(sample), isAllowedLinkUrl(sample), sample);
  }
  assert.equal(form.isValidLinkUrl(''), true, 'blank is allowed');
  assert.equal(form.isValidLinkUrl('   '), true, 'blank after trim is allowed');
});

test('client validation accepts exactly what the settings API accepts', () => {
  const { settingsUpdateSchema } = require('../server/src/controllers/validation');
  const serverAccepts = (key, value) => settingsUpdateSchema.safeParse({ [key]: value }).success;
  const cases = [
    ['jwt_token_expires_in', ['30d', '1h', '15m', '0d', '1w', '30', '', '1234567d']],
    ['frontend_login_path', ['/auth/magic-link', '', 'auth', '/a b', '/ok/path-1']],
    ['frontend_url', ['https://a.example', 'http://evil.example', '']],
    ['confirmationUrl', ['https://a.example/x', 'data:text/html,1']],
    ['token_length', [22, 21, 128, 129, 32.5]],
    ['expire_period', [10, 9, 31_536_000]],
    ['otp_length', [4, 3, 16, 17]],
    ['rate_limit_window_minutes', [1, 0, 10_080, 10_081]],
    ['totp_period', [15, 14, 300, 301]],
    ['from_email', ['', 'a@b.co', 'invalid']],
  ];
  for (const [key, values] of cases) {
    for (const value of values) {
      const clientOk = !form.validateSettings({ [key]: value })[key];
      assert.equal(clientOk, serverAccepts(key, value), `${key}=${JSON.stringify(value)}`);
    }
  }
});

test('a cleared number input is reported instead of being dropped silently', () => {
  const errors = form.validateSettings({ ...form.DEFAULT_SETTINGS, expire_period: undefined });
  assert.deepEqual(errors.expire_period, { code: 'range', min: 10, max: 31_536_000 });
  assert.deepEqual(form.validateSettings({ ...form.DEFAULT_SETTINGS }), {});
});

test('invalid fields are ordered by page position and mapped to their section', () => {
  const keys = form.orderedErrorKeys({ rate_limit_max_attempts: 1, frontend_url: 1, jwt_token_expires_in: 1 });
  assert.deepEqual(keys, ['frontend_url', 'jwt_token_expires_in', 'rate_limit_max_attempts']);
  assert.equal(form.FIELD_SECTIONS.frontend_url, 'general');
  assert.equal(form.FIELD_SECTIONS.otp_length, 'mfa');
  assert.equal(form.fieldId('frontend_url'), 'magic-link-settings-frontend_url');
});

/* ------------------------------------------------------------------ */
/* Loading, dirty tracking and the save payload                       */
/* ------------------------------------------------------------------ */

test('loaded settings drop WhatsApp/SMS keys and keep e-mail as the only OTP channel', () => {
  const clean = form.sanitizeLoadedSettings({
    whatsapp_enabled: true,
    sms_api_key: 'synthetic',
    delivery: 'whatsapp',
    phoneNumber: '+10000000000',
    otp_type: 'sms',
    magic_mail_template_id: 7,
    token_length: 40,
  });
  for (const key of ['whatsapp_enabled', 'sms_api_key', 'delivery', 'phoneNumber']) {
    assert.equal(key in clean, false, key);
  }
  assert.equal(clean.otp_type, 'email');
  assert.equal(clean.magic_mail_template_id, '7');
  assert.equal(clean.token_length, 40);
  assert.equal(clean.frontend_login_path, '/auth/magic-link', 'defaults fill missing keys');
});

test('legacy mfa_require_totp is shown as the required policy, like the server', () => {
  const { resolveMfaMode } = require('../server/src/utils/mfa-mode');
  for (const sample of [
    { mfa_require_totp: true, mfa_mode: 'disabled' },
    { mfa_mode: 'optional' },
    { mfa_mode: 'bogus' },
    {},
  ]) {
    assert.equal(form.resolveMfaMode(sample), resolveMfaMode(sample));
  }
  const clean = form.sanitizeLoadedSettings({ mfa_require_totp: true, mfa_mode: 'disabled' });
  assert.equal(clean.mfa_mode, 'required');
});

test('dirty tracking ignores list formatting and the payload contains only changed keys', () => {
  const initial = form.sanitizeLoadedSettings({ context_whitelist: ['a', 'b'], from_name: 'App' });
  assert.equal(form.isSettingsDirty(initial, { ...initial, context_whitelist: 'a, b' }), false);
  assert.equal(form.isSettingsDirty(null, initial), false);

  const edited = { ...initial, context_whitelist: 'a, b, c', frontend_url: ' https://app.example ' };
  assert.equal(form.isSettingsDirty(initial, edited), true);
  assert.deepEqual(form.buildSavePayload(initial, edited), {
    context_whitelist: ['a', 'b', 'c'],
    frontend_url: 'https://app.example',
  });
});

test('save payload never sends removed delivery settings', () => {
  const initial = form.sanitizeLoadedSettings({});
  const payload = form.buildSavePayload(initial, { ...initial, sms_enabled: true, delivery: 'sms', object: 'Hi' });
  assert.deepEqual(payload, { object: 'Hi' });
});

test('server validation errors name the rejected field', () => {
  const error = {
    response: { data: { error: { message: "Invalid request body at 'frontend_url': Must be an https URL" } } },
  };
  assert.equal(form.getServerErrorField(error), 'frontend_url');
  assert.equal(form.getServerErrorField({ message: 'Network down' }), null);
  assert.equal(form.getServerErrorField({ message: "Invalid request body at '(root)': x" }), null);
});

/* ------------------------------------------------------------------ */
/* Login modes and lock-out protection (UI-05, UI-07, UI-M03)          */
/* ------------------------------------------------------------------ */

test('login mode is derived from the settings only and modes are exclusive', () => {
  assert.equal(form.getAuthMode({}), 'magic-link');
  assert.equal(form.getAuthMode({ otp_enabled: true }), 'email-otp');
  assert.equal(form.getAuthMode({ otp_enabled: true, mfa_mode: 'optional' }), 'totp');
  assert.equal(form.getAuthMode({ mfa_require_totp: true }), 'totp');

  assert.deepEqual(form.applyAuthMode('email-otp', {}), {
    otp_enabled: true,
    mfa_mode: 'disabled',
    mfa_require_totp: false,
  });
  assert.deepEqual(form.applyAuthMode('magic-link', { mfa_mode: 'required' }), {
    otp_enabled: false,
    mfa_mode: 'disabled',
    mfa_require_totp: false,
  });
});

test('choosing the authenticator mode never requires TOTP for everyone by itself', () => {
  assert.deepEqual(form.applyAuthMode('totp', { mfa_mode: 'disabled' }), {
    otp_enabled: false,
    mfa_mode: 'optional',
    mfa_require_totp: false,
  });
  assert.equal(form.applyAuthMode('totp', { mfa_mode: 'required' }).mfa_mode, 'required');
  assert.deepEqual(form.applyTotpPolicy('required'), { mfa_mode: 'required', mfa_require_totp: true });
  assert.deepEqual(form.applyTotpPolicy('optional'), { mfa_mode: 'optional', mfa_require_totp: false });
});

test('"required for every user" is blocked while nobody is enrolled', () => {
  assert.deepEqual(form.canRequireTotp({ enrolled: 0 }), { allowed: false, reason: 'none-enrolled' });
  assert.deepEqual(form.canRequireTotp({ enrolled: 3 }), { allowed: true, reason: 'some-enrolled' });
  assert.deepEqual(form.canRequireTotp(null), { allowed: true, reason: 'unknown' });
  assert.deepEqual(form.parseEnrollmentSummary({ data: { enrolled: 2 } }), { enrolled: 2 });
  assert.deepEqual(form.parseEnrollmentSummary({ enrolled: 0 }), { enrolled: 0 });
  assert.equal(form.parseEnrollmentSummary({ data: { enrolled: -1 } }), null);
  assert.equal(form.parseEnrollmentSummary(undefined), null);
});

/* ------------------------------------------------------------------ */
/* Link preview and templates                                          */
/* ------------------------------------------------------------------ */

test('login link preview follows the server precedence and skips invalid URLs', () => {
  const origin = 'https://cms.example';
  assert.deepEqual(
    form.buildLoginUrlPreview({ frontend_url: 'https://app.example/', frontend_login_path: '/auth' }, origin),
    { url: 'https://app.example/auth?loginToken=EXAMPLE', source: 'frontend' }
  );
  assert.deepEqual(
    form.buildLoginUrlPreview({ frontend_url: 'http://evil.example', confirmationUrl: 'https://c.example/l?a=1' }, origin),
    { url: 'https://c.example/l?a=1&loginToken=EXAMPLE', source: 'confirmation' }
  );
  assert.deepEqual(form.buildLoginUrlPreview({}, origin), {
    url: 'https://cms.example/api/magic-link/login?loginToken=EXAMPLE',
    source: 'api',
  });
});

test('default templates escape translated text and use only safe placeholders', () => {
  const { html, text } = form.buildDefaultTemplates({
    heading: 'Sign <in>',
    intro: 'Tom & Jerry',
    button: '"Go"',
    expiry: 'Expires in {{EXPIRY_TEXT}}.',
    ignore: 'Ignore it.',
  });
  assert.match(html, /<h2>Sign &lt;in&gt;<\/h2>/);
  assert.match(html, /Tom &amp; Jerry/);
  assert.match(html, /href="\{\{LOGIN_URL\}\}"/);
  assert.match(html, /\{\{EXPIRY_TEXT\}\}/);
  assert.doesNotMatch(html + text, /<%/);
  assert.match(text, /\{\{LOGIN_URL\}\}/);
});

test('custom template content is detected before it is overwritten', () => {
  const known = ['<p>{{LOGIN_URL}}</p>'];
  assert.equal(form.isCustomTemplate('', known), false);
  assert.equal(form.isCustomTemplate('  <p>{{LOGIN_URL}}</p>\n', known), false);
  assert.equal(form.isCustomTemplate('<p>Mine</p>', known), true);
  const legacy = (value) => value.replace('<%= URL %>', '{{LOGIN_URL}}');
  assert.equal(form.isCustomTemplate('<p><%= URL %></p>', known, legacy), false);
  assert.deepEqual(form.templateStats('a\nb'), { lines: 2, chars: 3 });
  assert.deepEqual(form.formatList(['a', ' b ']), 'a, b');
  assert.deepEqual(form.parseList(' a, ,b '), ['a', 'b']);
});

/* ------------------------------------------------------------------ */
/* Server-side render of the MFA section                               */
/* ------------------------------------------------------------------ */

const SAFE_ATTR = /^(id|role|htmlFor|tabIndex|type|value|placeholder|aria-[a-z-]+|data-[a-z-]+)$/;

/** DS stub: every export is a plain element that keeps a11y attributes. */
const createDsStub = () => {
  const make = (name) => {
    const Component = ({ children, disabled, value, checked, ...props }) => {
      const attrs = { 'data-ds': name };
      for (const [key, val] of Object.entries(props)) {
        if (SAFE_ATTR.test(key) && ['string', 'number', 'boolean'].includes(typeof val)) attrs[key] = val;
      }
      if (typeof props.error === 'string') attrs['data-error'] = props.error;
      if (typeof props.hint === 'string') attrs['data-hint'] = props.hint;
      if (disabled) attrs['data-disabled'] = 'true';
      if (value !== undefined && value !== null) attrs['data-value'] = String(value);
      if (checked !== undefined) attrs['data-checked'] = String(Boolean(checked));
      return React.createElement('div', attrs, children);
    };
    return new Proxy(Component, {
      // Only capitalised names are sub-components (Field.Root); anything else
      // (symbols, displayName, styledComponentId) stays a normal lookup.
      get: (target, key) =>
        key in target || typeof key !== 'string' || !/^[A-Z]/.test(key) ? target[key] : make(`${name}.${key}`),
    });
  };
  return new Proxy({}, { get: (_target, key) => (key === '__esModule' ? false : make(String(key))) });
};

const iconStub = new Proxy({}, { get: (_t, key) => (key === '__esModule' ? false : () => null) });

const loadMfaSection = () =>
  loadAdminModule('admin/src/pages/Settings/sections/MfaSection.jsx', {
    stubs: {
      react: { ...React, useLayoutEffect: React.useEffect },
      '@strapi/design-system': createDsStub(),
      '@strapi/icons': iconStub,
      '@strapi/strapi/admin': { Page: { Title: () => null } },
    },
  }).MfaSection;

const renderMfa = (props) => {
  const MfaSection = loadMfaSection();
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: 'en', messages: {}, onError: () => {} },
      React.createElement(MfaSection, {
        settings: form.sanitizeLoadedSettings({}),
        update() {},
        patch() {},
        disabled: false,
        errorFor: () => undefined,
        enrollment: { status: 'ready', summary: { enrolled: 0 } },
        savedMfaMode: 'disabled',
        statusOn: 'ACTIVE',
        statusOff: 'INACTIVE',
        ...props,
      })
    )
  );
};

test('mode cards are one keyboard radio group with exactly one checked mode', () => {
  const html = renderMfa({});
  assert.match(html, /role="radiogroup"/);
  assert.equal((html.match(/role="radio"/g) || []).length, 3);
  assert.equal((html.match(/aria-checked="true"/g) || []).length, 1);
  assert.match(html, /aria-checked="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-checked="true"/i);
  assert.doesNotMatch(html, /Aktivieren|Premium|Advanced|LOCKED/);
});

test('with no enrolled user the "every user" policy is disabled and explained', () => {
  const html = renderMfa({ settings: form.sanitizeLoadedSettings({ mfa_mode: 'optional' }) });
  assert.match(html, /data-ds="Radio.Item" data-disabled="true" data-value="required"/);
  assert.match(html, /no user has set up an authenticator app, so every sign-in would fail/);
  assert.match(html, /No user has set up an authenticator app yet\./);
});

test('a saved required policy without enrolled users shows a lock-out alert', () => {
  const html = renderMfa({
    settings: form.sanitizeLoadedSettings({ mfa_mode: 'required' }),
    savedMfaMode: 'required',
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /Every sign-in currently fails/);
});

test('enrollment state is shown when known and when the server cannot report it', () => {
  const known = renderMfa({
    settings: form.sanitizeLoadedSettings({ mfa_mode: 'optional' }),
    enrollment: { status: 'ready', summary: { enrolled: 4 } },
  });
  assert.match(known, /4 users have set up an authenticator app\./);
  assert.doesNotMatch(known, /data-ds="Radio.Item" data-disabled="true"/);

  const unknown = renderMfa({
    settings: form.sanitizeLoadedSettings({ mfa_mode: 'optional' }),
    enrollment: { status: 'unavailable', summary: null },
  });
  assert.match(unknown, /could not be determined/);
});

test('email code mode states e-mail delivery and offers no SMS or WhatsApp channel', () => {
  const html = renderMfa({ settings: form.sanitizeLoadedSettings({ otp_enabled: true }) });
  assert.match(html, /Delivery: email/);
  assert.doesNotMatch(html, /SMS|WhatsApp|Versandmethode/i);
});

test('every Settings section renders with labelled fields and no removed channels', async () => {
  const stubs = {
    react: { ...React, useLayoutEffect: React.useEffect },
    '@strapi/design-system': createDsStub(),
    '@strapi/icons': iconStub,
    '@strapi/strapi/admin': { Page: { Title: () => null }, useNotification: () => ({ toggleNotification() {} }) },
  };
  stubs['../../../components/LanguageProvider'] = {
    usePluginLanguage: () => ({
      language: 'en',
      isFollowingAdmin: true,
      changeLanguage() {},
      languages: ['en', 'de', 'fr', 'es', 'pt'],
    }),
  };
  const settings = form.sanitizeLoadedSettings({
    use_email_designer: true,
    frontend_url: 'http://evil.example',
    token_length: 8,
  });
  const common = {
    settings,
    update() {},
    patch() {},
    disabled: true,
    errorFor: (key) => (form.validateSettings(settings)[key] ? `error:${key}` : undefined),
    statusOn: 'ACTIVE',
    statusOff: 'INACTIVE',
  };
  const sections = {
    GeneralSection: {},
    AuthSection: {},
    EmailSection: {
      integrations: {
        emailDesignerInstalled: true,
        magicMailInstalled: false,
        emailProviderConfigured: false,
        emailProviderName: null,
      },
      emailDesignerTemplates: [{ id: 1, templateReferenceId: 10, name: 'Login' }],
      magicMailTemplates: [],
    },
    RateLimitSection: {
      canManage: false,
      stats: { status: 'ready', data: { totalEntries: 3, blocked: 1 } },
      onRetryStats() {},
      onCleanup() {},
      onRequestReset() {},
      isCleaning: false,
    },
    AdvancedSection: {},
  };
  for (const [name, extra] of Object.entries(sections)) {
    const file = `admin/src/pages/Settings/sections/${name}.jsx`;
    const Section = (await loadAdminModuleAsync(file, { stubs, externalPattern: /components\/LanguageProvider$/ }))[name];
    const html = renderToStaticMarkup(
      React.createElement(
        IntlProvider,
        { locale: 'en', messages: {}, onError: () => {} },
        React.createElement(Section, { ...common, ...extra })
      )
    );
    assert.ok(html.length > 200, `${name} renders`);
    assert.doesNotMatch(html, /WhatsApp|SMS/i, `${name}: e-mail only`);
    // Read-only: every switch and input is disabled.
    assert.doesNotMatch(html, /data-ds="(?:Switch|TextInput|NumberInput)"(?![^>]*data-disabled)/, `${name}: read-only`);
    if (name === 'GeneralSection') {
      assert.match(html, /data-ds="Field.Root"[^>]*id="magic-link-settings-frontend_url"/);
      assert.match(html, /data-error="error:frontend_url"/);
      assert.match(html, /data-error="error:token_length"/);
      assert.match(html, /id="magic-link-settings-expire_period" data-hint="Recommended: 3600 seconds/);
      assert.match(html, /http:\/\/localhost|loginToken=EXAMPLE/);
    }
    if (name === 'EmailSection') {
      assert.match(html, /role="alert"/, 'missing provider is announced');
      assert.match(html, /data-ds="SingleSelectOption" data-value="10"/, 'Email Designer uses the reference id');
      assert.match(html, /\{\{LOGIN_URL\}\}/);
    }
    if (name === 'RateLimitSection') {
      assert.doesNotMatch(html, /Reset all limits|Clean up expired entries|Cleanup Expired|Reset All Limits/, 'actions hidden');
    }
  }
});

/* ------------------------------------------------------------------ */
/* Source guards                                                       */
/* ------------------------------------------------------------------ */

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}\u{2728}]/u;

test('Settings sources use theme tokens, translated strings and accessible controls', () => {
  for (const file of settingsFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const name = path.relative(ROOT, file);
    assert.doesNotMatch(source, /var\(--colors-/, `${name}: DS defines no --colors-* variables`);
    assert.doesNotMatch(source, /window\.confirm\(|\bconfirm\(/, `${name}: use ConfirmDialog`);
    assert.doesNotMatch(source, /navigator\.clipboard/, `${name}: use useCopyToClipboard`);
    assert.doesNotMatch(source, /console\.(log|debug|info|warn|error)\(/, `${name}: no console output`);
    assert.doesNotMatch(source, /'de-DE'|'en-US'|toLocaleString\(/, `${name}: use useFormatters`);
    assert.doesNotMatch(source, EMOJI, `${name}: no emoji`);
    assert.doesNotMatch(source, /font-?[sS]ize:\s*'?(?:9|10|11|13|15)px/, `${name}: DS font scale only`);
    assert.doesNotMatch(source, /\bhint=\{[^}]*\}\s*\n?\s*value=/, `${name}: hints belong to Field.Root`);
    // settingsForm.js names the removed keys only to strip them.
    if (!name.endsWith('settingsForm.js')) {
      assert.doesNotMatch(source, /whatsapp|phoneNumber|otp_type/i, `${name}: e-mail is the only channel`);
    }
    assert.doesNotMatch(source, /licenseInfo|checkLicenseAndSetMode|\/license\/status/, `${name}: no tier gating`);
    assert.doesNotMatch(source, /Aktivieren|Versandmethode|Wähle|deiner|So funktioniert/, `${name}: no German literals`);
  }
});

test('the Settings page wires RBAC, the unsaved-changes guard and confirmations', () => {
  const page = fs.readFileSync(path.join(SETTINGS_DIR, 'SettingsModern.jsx'), 'utf8');
  assert.ok(page.includes('useMagicLinkRBAC()'));
  assert.ok(page.includes('const canWriteSettings = canUpdateSettings'));
  assert.ok(page.includes('useUnsavedChangesGuard(isDirty)'));
  assert.ok(page.includes('<UnsavedChangesDialog guard={guard} />'));
  assert.ok(page.includes('<Page.Main>'));
  assert.ok(page.includes('<PluginPageTitle>'));
  assert.ok(page.includes("tag=\"h1\""));
  assert.ok(page.includes('<ConfirmDialog'));
  assert.ok(page.includes("post('/magic-link/rate-limit/reset')"));
  // Rate-limit actions refresh only the statistics, never the form.
  const actions = page.slice(page.indexOf('const handleRateLimitCleanup'), page.indexOf('/* ---------------- Render'));
  assert.doesNotMatch(actions, /loadSettings\(/);
  assert.match(actions, /await loadStats\(\)/);

  const mfa = fs.readFileSync(path.join(SETTINGS_DIR, 'sections/MfaSection.jsx'), 'utf8');
  assert.doesNotMatch(mfa, /put\(|post\(/, 'mode selection only changes the form');
  assert.equal(fs.existsSync(path.join(SETTINGS_DIR, 'index.jsx.old')), false);
});
