'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const locales = ['de', 'en', 'es', 'fr', 'pt'];
const translationsDirectory = path.join(__dirname, '..', 'admin', 'src', 'translations');

test('token creation notice distinguishes delivered links from tokens created without email', async () => {
  const { getTokenCreationNotice } = await import('../admin/src/pages/Tokens/tokenCreateNotice.mjs');

  assert.deepEqual(getTokenCreationNotice({ sendEmail: true, email: 'audit@example.invalid' }), {
    messageId: 'tokens.notifications.created',
    values: { email: 'audit@example.invalid' },
  });
  assert.deepEqual(getTokenCreationNotice({ sendEmail: false, email: 'audit@example.invalid' }), {
    messageId: 'tokens.notifications.createdWithoutEmail',
    values: {},
  });
});

test('every supported locale has a truthful no-email token creation message', () => {
  for (const locale of locales) {
    const translations = JSON.parse(fs.readFileSync(path.join(translationsDirectory, `${locale}.json`), 'utf8'));
    assert.equal(typeof translations['magic-link.tokens.notifications.createdWithoutEmail'], 'string', locale);
    assert.ok(translations['magic-link.tokens.notifications.createdWithoutEmail'].trim().length > 0, locale);
  }
});
