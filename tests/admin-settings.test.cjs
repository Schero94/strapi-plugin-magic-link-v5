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
