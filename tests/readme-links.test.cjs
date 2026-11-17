'use strict';

/**
 * The README is rendered outside GitHub: on npmjs.com and on the Strapi
 * marketplace (community.strapi.io/marketplace), which resolve relative links
 * against their own host, so `LICENSE` or `docs/site/img/x.png` return 404
 * there. npm also cuts a README at about 64 KB. These tests keep the README
 * portable: every link and image is absolute https or an in-page #fragment
 * that exists, screenshots are full width (never inside a table), and the
 * long reference lives in docs/reference.md.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const REPO = 'https://github.com/Schero94/strapi-plugin-magic-link-v5';
const REFERENCE = `${REPO}/blob/main/docs/reference.md`;
const RAW = 'https://raw.githubusercontent.com/Schero94/strapi-plugin-magic-link-v5/main/';

/** npm truncates a README near 64 KB; stay well below that. */
const MAX_README_BYTES = 50_000;

/**
 * Removes fenced code blocks so example code is not parsed as links or headings.
 *
 * @param {string} markdown Markdown source.
 * @returns {string} The source with every ``` block blanked out.
 */
function stripCode(markdown) {
  return markdown.replace(/^```[\s\S]*?^```/gm, '');
}

/**
 * Collects every link and image target: markdown `[..](url)`, `![..](url)`,
 * and HTML `src="..."` / `href="..."`.
 *
 * @param {string} markdown Markdown source.
 * @returns {string[]} Raw URL strings in document order.
 */
function linkTargets(markdown) {
  const text = stripCode(markdown);
  const urls = [];
  for (const match of text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g))
    urls.push(match[1]);
  for (const match of text.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)) urls.push(match[1]);
  return urls;
}

/**
 * Computes the heading anchors GitHub generates (lower case, punctuation
 * removed, spaces to hyphens, duplicates suffixed with -1, -2, ...).
 *
 * @param {string} markdown Markdown source.
 * @returns {Set<string>} Anchor ids without the leading #.
 */
function headingAnchors(markdown) {
  const anchors = new Set();
  const seen = new Map();
  for (const line of stripCode(markdown).split('\n')) {
    const match = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!match) continue;
    const base = match[1]
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

test('README stays below the npm README size limit', () => {
  const bytes = Buffer.byteLength(read('README.md'), 'utf8');
  assert.ok(bytes <= MAX_README_BYTES, `README.md is ${bytes} bytes, limit ${MAX_README_BYTES}`);
});

test('every README link and image is absolute https or an existing #fragment', () => {
  const readme = read('README.md');
  const anchors = headingAnchors(readme);
  const targets = linkTargets(readme);
  assert.ok(targets.length > 20, 'README links were found');
  for (const url of targets) {
    if (url.startsWith('#')) {
      assert.ok(anchors.has(url.slice(1)), `README anchor ${url} has no heading`);
      continue;
    }
    assert.match(url, /^https:\/\/[^/\s]+\//, `README link must be absolute https: ${url}`);
  }
});

test('README links into docs/reference.md and back into the README resolve', () => {
  const readme = read('README.md');
  const reference = read('docs/reference.md');
  const readmeAnchors = headingAnchors(readme);
  const referenceAnchors = headingAnchors(reference);
  const check = (url, source) => {
    if (url.startsWith(`${REFERENCE}#`)) {
      const anchor = url.slice(REFERENCE.length + 1);
      assert.ok(referenceAnchors.has(anchor), `${source}: docs/reference.md has no #${anchor}`);
    } else if (url.startsWith(`${REPO}#`) && url !== `${REPO}#readme`) {
      const anchor = url.slice(REPO.length + 1);
      assert.ok(readmeAnchors.has(anchor), `${source}: README has no #${anchor}`);
    }
  };
  for (const url of linkTargets(readme)) check(url, 'README.md');
  for (const url of linkTargets(reference)) {
    if (url.startsWith('#')) {
      assert.ok(
        referenceAnchors.has(url.slice(1)),
        `docs/reference.md anchor ${url} has no heading`
      );
      continue;
    }
    assert.match(url, /^https:\/\//, `docs/reference.md link must be absolute https: ${url}`);
    check(url, 'docs/reference.md');
  }
  for (const url of linkTargets(read('docs/site/index.html'))) check(url, 'docs/site/index.html');
});

test('README images point at files in this repository and show full width', () => {
  const readme = read('README.md');
  const images = [
    ...stripCode(readme).matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g),
    ...stripCode(readme).matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g),
  ];
  assert.ok(images.length >= 5, 'README shows screenshots');
  const seen = new Set();
  for (const match of images) {
    const url = match[2] ?? match[1];
    if (!url.startsWith(RAW)) continue;
    const file = url.slice(RAW.length);
    assert.ok(
      fs.existsSync(path.join(root, file)),
      `README image ${file} exists in the repository`
    );
    assert.ok(!seen.has(url), `README shows ${file} only once`);
    seen.add(url);
  }
  for (const match of stripCode(readme).matchAll(/!\[([^\]]*)\]\(/g)) {
    assert.ok(match[1].trim().length > 10, 'every screenshot has descriptive alt text');
  }
  for (const line of stripCode(readme).split('\n')) {
    if (line.trimStart().startsWith('|')) {
      assert.doesNotMatch(line, /!\[|<img\b/, 'screenshots are not squeezed into table cells');
    }
  }
});
