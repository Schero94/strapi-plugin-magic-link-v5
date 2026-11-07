'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TEMPLATE_VARIABLES,
  buildTemplateVariables,
  migrateLegacyTemplate,
  renderTemplate,
} = require('../server/src/utils/template-renderer');
const { buildLoginUrl, isAllowedLinkUrl, redactUrl } = require('../server/src/utils/login-url');
const { filterContext, RESERVED_CONTEXT_KEYS } = require('../server/src/utils/context-policy');
const { migrateSettings } = require('../server/src/utils/settings-migration');
const { clampTokenLength } = require('../server/src/services/magic-link');
const i18n = require('../server/src/utils/i18n');
const { createLoginCoreStrapi, createCtx } = require('./helpers/login-core-strapi.cjs');
const auth = require('../server/src/controllers/auth');

test('template renderer never executes template code (AUTH-04/ADM-01/STR-02)', () => {
  let executed = false;
  global.__magicLinkTemplateProbe = () => {
    executed = true;
  };
  const templates = [
    '<%= global.__magicLinkTemplateProbe() %>',
    '<% global.__magicLinkTemplateProbe() %>',
    '<%- global.__magicLinkTemplateProbe() %>',
    '${global.__magicLinkTemplateProbe()}',
    '{{constructor.constructor("return process")()}}',
  ];
  for (const template of templates) {
    renderTemplate(template, { CODE: 'x' });
    renderTemplate(template, { CODE: 'x' }, { html: true });
  }
  delete global.__magicLinkTemplateProbe;
  assert.equal(executed, false);
  assert.equal(renderTemplate('<% x %>', {}, { html: true }), '&lt;% x %&gt;');
});

test('template renderer escapes HTML values and supports legacy syntaxes', () => {
  const variables = {
    USER: '<img src=x onerror=alert(1)>',
    LOGIN_URL: 'https://a.test/?a=1&b="2"',
    EMAIL: 'a@b.test',
  };
  const html = renderTemplate(
    '<p>{{USER}}</p><a href="<%= LOGIN_URL %>">{link}</a> {username} {{ email }}',
    variables,
    { html: true }
  );
  assert.equal(
    html,
    '<p>&lt;img src=x onerror=alert(1)&gt;</p><a href="https://a.test/?a=1&amp;b=&quot;2&quot;">https://a.test/?a=1&amp;b=&quot;2&quot;</a> &lt;img src=x onerror=alert(1)&gt; a@b.test'
  );
  assert.equal(renderTemplate('{{USER}}', variables), variables.USER, 'plain text is not escaped');
  assert.equal(
    renderTemplate('a{{NOT_DOCUMENTED}}b', variables),
    'ab',
    'unknown placeholders never throw'
  );
  assert.equal(renderTemplate('{display: block}', variables), '{display: block}');
});

test('legacy templates are migrated to the canonical syntax', () => {
  assert.equal(
    migrateLegacyTemplate('<p><%= URL %>?loginToken=<%= CODE %></p> <%=EXPIRY_TEXT%> <%= foo %>'),
    '<p>{{LOGIN_URL}}</p> {{EXPIRY_TEXT}} <%= foo %>'
  );
  assert.equal(migrateLegacyTemplate('{{URL}}?loginToken={{CODE}}'), '{{LOGIN_URL}}');
});

test('every documented template variable is provided (DOC-08/FUN-07)', () => {
  const variables = buildTemplateVariables({
    loginUrl: 'https://a.test/login?loginToken=t',
    baseUrl: 'https://a.test/login',
    code: 't',
    email: 'a@b.test',
    username: 'alice',
    expiresAt: new Date(Date.now() + 3600_000),
    expirePeriodSeconds: 3600,
  });
  for (const name of TEMPLATE_VARIABLES) {
    assert.ok(typeof variables[name] === 'string' && variables[name].length > 0, name);
  }
  assert.equal(variables.EXPIRY_TEXT, '1 hour');
  assert.equal(buildTemplateVariables({ expirePeriodSeconds: 900 }).EXPIRY_TEXT, '15 minutes');
});

test('login URL builder honours frontend_url, query strings and the API fallback (AUTH-27/FUN-05)', () => {
  const strapi = {
    config: {
      get: (key, fallback) =>
        ({ 'server.url': 'https://cms.example.test', 'api.rest.prefix': '/rest' })[key] ?? fallback,
    },
  };

  let { loginUrl } = buildLoginUrl(
    { frontend_url: 'https://app.example.test/', frontend_login_path: 'auth/magic' },
    'tok&en',
    strapi
  );
  assert.equal(loginUrl, 'https://app.example.test/auth/magic?loginToken=tok%26en');

  ({ loginUrl } = buildLoginUrl(
    { confirmationUrl: 'https://app.example.test/login?lang=de#top' },
    'abc',
    strapi
  ));
  assert.equal(loginUrl, 'https://app.example.test/login?lang=de&loginToken=abc#top');

  ({ loginUrl } = buildLoginUrl(
    { confirmationUrl: 'javascript:alert(1)', frontend_url: 'http://evil.test' },
    'abc',
    strapi
  ));
  assert.equal(loginUrl, 'https://cms.example.test/rest/magic-link/login?loginToken=abc');

  assert.equal(isAllowedLinkUrl('http://localhost:3000/x'), true);
  assert.equal(isAllowedLinkUrl('http://app.localhost'), true);
  assert.equal(isAllowedLinkUrl('http://example.test'), false);
  assert.equal(isAllowedLinkUrl('ftp://example.test'), false);
  assert.equal(redactUrl('/api/magic-link/login?loginToken=secret'), '/api/magic-link/login');
});

test('context policy strips reserved keys and applies the admin allow/deny lists (AUTH-10)', () => {
  const raw = {
    redirectTo: '/a',
    role: 'admin',
    requiresTOTP: true,
    userId: 1,
    password: 'x',
    nested: { a: { b: { c: { d: 1 } } } },
    __proto__: { polluted: true },
  };
  assert.deepEqual(filterContext(raw, {}), { redirectTo: '/a', role: 'admin' });
  assert.deepEqual(filterContext(raw, { context_whitelist: ['redirectTo'] }), { redirectTo: '/a' });
  assert.deepEqual(filterContext(raw, { context_blacklist: 'role, other' }), { redirectTo: '/a' });
  assert.deepEqual(filterContext('{"a":1}', {}), { a: 1 });
  assert.ok(RESERVED_CONTEXT_KEYS.includes('userDocumentId'));
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]));
  assert.equal(Object.keys(filterContext(many, {})).length, 20);
});

test('stored settings are migrated to the email-only 6.0 contract (DOC-04/DOC-05/DOC-M04)', () => {
  const { settings, changed, removedKeys } = migrateSettings(
    {
      whatsapp_enabled: true,
      whatsapp_message_text: 'x',
      sms_api_secret: 'synthetic-secret',
      sms_provider: null,
      otp_type: 'sms',
      token_length: 8,
      confirmationUrl: 'http://localhost:1337/',
      message_text: 'Go: <%= URL %>?loginToken=<%= CODE %>',
      from_name: 'Shop',
    },
    { serverUrl: 'http://localhost:1337', clampTokenLength }
  );

  assert.equal(changed, true);
  assert.equal(removedKeys, 4);
  assert.deepEqual(settings, {
    otp_type: 'email',
    token_length: 22,
    confirmationUrl: '',
    message_text: 'Go: {{LOGIN_URL}}',
    from_name: 'Shop',
  });
  assert.equal(
    migrateSettings(settings, { serverUrl: 'http://localhost:1337', clampTokenLength }).changed,
    false
  );
});

test('server i18n returns translated messages and ignores unknown locales (FUN-02)', () => {
  assert.equal(i18n.t('errors.token.invalid', 'en'), 'Invalid or expired token');
  assert.equal(i18n.t('errors.token.invalid', 'de'), 'Ungültiger oder abgelaufener Token');
  assert.equal(i18n.t('errors.token.invalid', '../../etc'), 'Invalid or expired token');
  for (const locale of ['de', 'en', 'es', 'fr', 'pt']) {
    for (const key of [
      'challenge.invalid',
      'mfa.setupRequired',
      'mfa.invalidCode',
      'otp.deliveryFailed',
      'totp.loginDisabled',
      'credentials.invalid',
      'rate.limit.exceeded',
    ]) {
      assert.notEqual(i18n.t(`errors.${key}`, locale), `errors.${key}`, `${locale}:${key}`);
    }
  }
  const ctx = { query: { locale: 'zz' }, request: { header: {} } };
  i18n.sendError(ctx, 'blocked.user', 403);
  assert.deepEqual(ctx.body.error.details, { key: 'blocked.user' });
  assert.equal(ctx.body.error.name, 'ForbiddenError');
});

test('expired links are deactivated and rejected', async () => {
  const { magicLinkService, state } = createLoginCoreStrapi({
    users: [{ id: 1, documentId: 'u', email: 'a@example.test', confirmed: true }],
  });
  const token = await magicLinkService.createToken('a@example.test');
  state.tokens[0].expires_at = new Date(Date.now() - 1000);

  const ctx = createCtx({ query: { loginToken: token._plaintextToken } });
  await auth.login(ctx);

  assert.equal(ctx.status, 400);
  assert.equal(state.tokens[0].is_active, false);
  assert.equal(state.issued.length, 0);
});
