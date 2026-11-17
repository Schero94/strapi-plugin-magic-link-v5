'use strict';

/**
 * Release pipeline contract: the local semantic-release plugin
 * scripts/release-unreleased.mjs folds the hand-written [Unreleased] section of
 * CHANGELOG.md into the release notes before @semantic-release/changelog
 * prepends the new entry, and strips co-author trailers from the notes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const root = join(__dirname, '..');
const readText = (file) => readFileSync(join(root, file), 'utf8');
const loadPlugin = () => import('../scripts/release-unreleased.mjs');

const SAMPLE =
  '## [Unreleased]\n\n### Migration\n\n* Step.\n\n## [1.5.1](x) (2026-02-12)\n\n* old\n';

test('semantic-release folds [Unreleased] after the notes generator and before the changelog', () => {
  const config = JSON.parse(readText('.releaserc.json'));
  assert.deepEqual(config.branches, ['main']);
  // No tagFormat: the default v${version} matches the existing tags.
  assert.equal(config.tagFormat, undefined);
  const names = config.plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
  assert.deepEqual(names, [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    './scripts/release-unreleased.mjs',
    '@semantic-release/changelog',
    '@semantic-release/npm',
    '@semantic-release/github',
    '@semantic-release/git',
  ]);
});

test('the release plugin moves [Unreleased] into the notes and out of CHANGELOG.md', async () => {
  const { generateNotes, prepare, splitUnreleased } = await loadPlugin();
  assert.equal(splitUnreleased(SAMPLE).body, '### Migration\n\n* Step.');
  assert.deepEqual(splitUnreleased('## [1.0.0]\n'), { body: '', rest: '## [1.0.0]\n' });
  const cwd = await mkdtemp(join(tmpdir(), 'release-unreleased-'));
  try {
    await writeFile(join(cwd, 'CHANGELOG.md'), SAMPLE);
    assert.equal(await generateNotes({}, { cwd }), '### Migration\n\n* Step.');
    await prepare({}, { cwd, logger: { log() {} } });
    const after = await readFile(join(cwd, 'CHANGELOG.md'), 'utf8');
    assert.ok(!after.includes('[Unreleased]'));
    assert.ok(after.startsWith('## [1.5.1]'));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
  assert.equal(await generateNotes({}, { cwd }), '');
});

test('release notes carry no co-author trailers', async () => {
  const { prepare, stripCoAuthorTrailers } = await loadPlugin();
  const notes =
    '### BREAKING CHANGES\n\n* removed.\n\nCo-Authored-By: Someone <a@example.test>\n\n* other\nco-authored-by: x <y@example.test>\n';
  assert.equal(stripCoAuthorTrailers(notes), '### BREAKING CHANGES\n\n* removed.\n\n* other\n');
  const cwd = await mkdtemp(join(tmpdir(), 'release-unreleased-'));
  try {
    await writeFile(join(cwd, 'CHANGELOG.md'), '## [1.0.0]\n');
    const nextRelease = { notes };
    await prepare({}, { cwd, logger: { log() {} }, nextRelease });
    assert.doesNotMatch(nextRelease.notes, /co-authored-by/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('CHANGELOG.md has at most one [Unreleased] section and it sits above every release', () => {
  const text = readText('CHANGELOG.md');
  const headings = text.match(/^## \[Unreleased\]/gm) || [];
  assert.ok(headings.length <= 1);
  if (headings.length === 1) {
    assert.ok(text.indexOf('## [Unreleased]') < text.search(/^#{1,2} \[\d/m));
  }
});
