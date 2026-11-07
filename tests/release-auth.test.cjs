'use strict';

/**
 * Release authentication contract.
 *
 * npm Trusted Publishing (OIDC) is not configured for this package on npmjs.com yet,
 * so the OIDC exchange returns 404 and semantic-release falls back to token auth.
 * The release step must therefore receive the NPM_TOKEN secret, while keeping
 * id-token: write and provenance so OIDC can take over once it is configured.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'release.yml'),
  'utf8'
);

test('release step passes the npm token as fallback to trusted publishing', () => {
  assert.match(workflow, /NPM_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
  assert.match(workflow, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
});

test('release job keeps OIDC and provenance enabled', () => {
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /NPM_CONFIG_PROVENANCE:\s*'true'/);
});
