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
    assert.match(root, /defaultValue="(?:general|account)"/);
    assert.doesNotMatch(root, /\btype=/);
    assert.doesNotMatch(root, /defaultValue=\{\[/);
  }
});

test('MFA mode cards save a canonical mode and state updates retain adjacent changes', () => {
  const settingsPage = fs.readFileSync(
    path.join(__dirname, '../admin/src/pages/Settings/SettingsModern.jsx'),
    'utf8'
  );

  assert.ok(settingsPage.includes("mfa_mode: 'required'"));
  assert.ok(settingsPage.includes("mfa_mode: 'disabled'"));
  assert.ok(settingsPage.includes('setSettings((current) => ({ ...current, [key]: value }))'));
});

test('unsupported SMS and generic TOTP delivery choices are visibly disabled', () => {
  const settingsPage = fs.readFileSync(
    path.join(__dirname, '../admin/src/pages/Settings/SettingsModern.jsx'),
    'utf8'
  );

  assert.ok(/SingleSelectOption value="sms" disabled/.test(settingsPage));
  assert.ok(/SingleSelectOption value="totp" disabled/.test(settingsPage));
  assert.ok(settingsPage.includes('TOTP wird separat im MFA-Modus geprüft.'));
});

test('delete confirmations are translated in every supported admin locale', () => {
  for (const locale of ['de', 'en', 'es', 'fr', 'pt']) {
    const translations = JSON.parse(fs.readFileSync(
      path.join(__dirname, `../admin/src/translations/${locale}.json`),
      'utf8'
    ));

    assert.ok(translations['magic-link.tokens.confirm.delete'], `${locale} has individual confirmation`);
    assert.ok(translations['magic-link.tokens.confirm.bulkDelete'], `${locale} has bulk confirmation`);
    assert.ok(translations['magic-link.settings.permission.readOnly'], `${locale} explains read-only access`);
  }
});
