'use strict';

/**
 * Every translation id used by the admin code must exist in all five plugin
 * locales, and the English defaultMessage written next to the id must match
 * en.json, so the merged translations and the code never drift apart.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN_SRC = path.join(__dirname, '../admin/src');
const LOCALES = ['en', 'de', 'fr', 'es', 'pt'];
const PREFIX = 'magic-link.';

const listSources = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'translations' ? [] : listSources(full);
    return /\.(js|jsx|mjs)$/.test(entry.name) ? [full] : [];
  });

const readLocale = (locale) =>
  JSON.parse(fs.readFileSync(path.join(ADMIN_SRC, 'translations', `${locale}.json`), 'utf8'));

/** Strips comments so documentation examples are not taken for real ids. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Unescapes a JS string literal body (quotes and backslashes only). */
const unescape = (body) => body.replace(/\\(['"\\])/g, '$1');

const STRING = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`;
const T_CALL = new RegExp(String.raw`\bt\(\s*(?:${STRING})(?:\s*,\s*(?:${STRING})\s*[,)])?`, 'g');
const GET_TRANSLATION = new RegExp(String.raw`\b(?:getTranslation|getTrad)\(\s*(?:${STRING})`, 'g');
const DYNAMIC_KEY = /\b(?:t|getTranslation|getTrad)\(\s*`/g;

const collectUsages = () => {
  const usages = [];
  const dynamic = [];
  for (const file of listSources(ADMIN_SRC)) {
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    const rel = path.relative(ADMIN_SRC, file);
    for (const match of source.matchAll(T_CALL)) {
      const key = unescape(match[1] ?? match[2]);
      const fallback = match[3] ?? match[4];
      usages.push({
        file: rel,
        id: key.startsWith(PREFIX) ? key : PREFIX + key,
        fallback: fallback === undefined ? undefined : unescape(fallback),
      });
    }
    for (const match of source.matchAll(GET_TRANSLATION)) {
      const key = unescape(match[1] ?? match[2]);
      usages.push({ file: rel, id: key.startsWith(PREFIX) ? key : PREFIX + key });
    }
    for (const match of source.matchAll(DYNAMIC_KEY)) dynamic.push(`${rel}@${match.index}`);
  }
  return { usages, dynamic };
};

test('admin code uses only static translation ids', () => {
  const { usages, dynamic } = collectUsages();
  assert.deepEqual(dynamic, [], 'template-literal ids cannot be checked; use a static key');
  assert.ok(usages.length > 300, `expected the views to use many ids, found ${usages.length}`);
});

test('every translation id used by the admin code exists in all five locales', () => {
  const { usages } = collectUsages();
  for (const locale of LOCALES) {
    const messages = readLocale(locale);
    const missing = [
      ...new Set(
        usages
          .filter(({ id }) => typeof messages[id] !== 'string')
          .map(({ id, file }) => `${id} (${file})`)
      ),
    ];
    assert.deepEqual(missing, [], `${locale}.json is missing ids`);
  }
});

test('the English defaultMessage next to each id matches en.json', () => {
  const { usages } = collectUsages();
  const en = readLocale('en');
  const drift = usages
    .filter(
      ({ fallback, id }) => fallback !== undefined && en[id] !== undefined && en[id] !== fallback
    )
    .map(({ id, file, fallback }) => `${id} (${file}): code "${fallback}" vs en.json "${en[id]}"`);
  assert.deepEqual([...new Set(drift)], []);
});

test('all five locales have exactly the same ids', () => {
  const keys = (locale) => Object.keys(readLocale(locale)).sort();
  for (const locale of LOCALES.slice(1)) assert.deepEqual(keys(locale), keys('en'), locale);
});

test('translations carry no keys of removed WhatsApp or SMS features', () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(readLocale(locale))) {
      assert.ok(!/whatsapp|\bsms\b|phone/i.test(key), `${locale}: ${key}`);
      assert.ok(!/whatsapp/i.test(value), `${locale}: ${key} mentions WhatsApp`);
    }
  }
});
