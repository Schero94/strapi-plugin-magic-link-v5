'use strict';

/**
 * Packaging guards (ADM-22, ADM-11): the root entry files ship in the npm
 * package and must point at the build output, never at sources that are not
 * published, and dead packaging leftovers stay deleted.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

test('root entry files point at published build output', () => {
  const published = (relative) =>
    pkg.files.some(
      (entry) => relative === entry || relative.startsWith(entry.replace(/\/?$/, '/'))
    );
  for (const [file, target] of [
    ['strapi-server.js', 'dist/server/index.js'],
    ['strapi-admin.js', 'dist/admin/index.js'],
  ]) {
    assert.ok(pkg.files.includes(file), `${file} is published`);
    const source = readFileSync(path.join(root, file), 'utf8');
    const required = /require\('\.\/([^']+)'\)/.exec(source)?.[1];
    assert.equal(required, target, `${file} loads ${target}`);
    assert.ok(published(required), `${required} is inside the published files`);
  }
});

test('dead packaging and feature-tier leftovers are gone', () => {
  for (const file of [
    '.npmignore',
    '.externals.json',
    '.trigger-release',
    'server/src/config/features.js',
    'server/src/utils/otp-email.js',
  ]) {
    assert.equal(existsSync(path.join(root, file)), false, file);
  }
});
