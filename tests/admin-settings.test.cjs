'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const settingsSources = [
  '../admin/src/pages/Settings/SettingsModern.jsx',
  '../admin/src/pages/License/index.jsx',
].map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8'));

test('Magic Link admin accordions use Strapi Design System single-value API', () => {
  for (const [index, source] of settingsSources.entries()) {
    const root = source.match(/<Accordion\.Root\b([^>]*)>/)?.[1];

    assert.ok(root, `admin accordion ${index + 1} exists`);
    // Settings controls the open item so it can open the section of an invalid field.
    assert.match(root, /defaultValue="(?:general|account)"|value=\{openSection\} onValueChange=\{setOpenSection\}/);
    assert.doesNotMatch(root, /\btype=/);
    assert.doesNotMatch(root, /(?:defaultValue|value)=\{\[/);
  }
});

test('MFA mode cards only change the form; the canonical mode comes from one helper', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '../admin/src/pages/Settings', file), 'utf8');
  const settingsPage = read('SettingsModern.jsx');
  const mfa = read('sections/MfaSection.jsx');
  const form = read('utils/settingsForm.js');

  assert.ok(form.includes("mfa_mode: 'required'"));
  assert.ok(form.includes("mfa_mode: 'disabled'"));
  assert.ok(mfa.includes('patch(applyAuthMode(next, settings))'));
  assert.equal(/put\(|post\(/.test(mfa), false, 'mode cards never save on their own');
  assert.ok(settingsPage.includes('setSettings((current) => ({ ...current, [key]: value }))'));
});

test('OTP settings offer e-mail only, without SMS or a delivery select', () => {
  const mfa = fs.readFileSync(
    path.join(__dirname, '../admin/src/pages/Settings/sections/MfaSection.jsx'),
    'utf8'
  );

  assert.equal(/value="sms"|value="totp"|otp_type/.test(mfa), false);
  assert.ok(mfa.includes("t('settings.mfa.otp.delivery'"));
});

test('delete confirmations are translated in every supported admin locale', () => {
  for (const locale of ['de', 'en', 'es', 'fr', 'pt']) {
    const translations = JSON.parse(fs.readFileSync(
      path.join(__dirname, `../admin/src/translations/${locale}.json`),
      'utf8'
    ));

    assert.ok(translations['magic-link.tokens.delete.body'], `${locale} has individual confirmation`);
    assert.ok(translations['magic-link.tokens.confirm.bulkDelete'], `${locale} has bulk confirmation`);
    assert.ok(translations['magic-link.settings.permission.readOnly'], `${locale} explains read-only access`);
  }
});
