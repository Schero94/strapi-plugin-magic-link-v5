'use strict';

/**
 * Code scanning runs on every pull request, on main and weekly, for the
 * plugin's JavaScript and its GitHub Actions workflows. Actions are pinned by
 * commit SHA and the write permission stays on the analysis job.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const file = path.join(__dirname, '..', '.github', 'workflows', 'codeql.yml');

test('CodeQL scans JavaScript and workflows with SHA-pinned actions', () => {
  assert.ok(fs.existsSync(file), '.github/workflows/codeql.yml exists');
  const workflow = fs.readFileSync(file, 'utf8');
  assert.match(workflow, /language: \[actions, javascript-typescript\]/);
  assert.match(workflow, /build-mode: none/);
  assert.match(workflow, /^ {2}pull_request:/m);
  assert.match(workflow, /^ {2}schedule:/m);
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m, 'top-level token is read-only');
  for (const match of workflow.matchAll(/uses: ([^\s@]+)@(\S+)/g)) {
    assert.match(match[2], /^[0-9a-f]{40}$/, `${match[1]} is pinned by commit SHA`);
  }
  assert.equal((workflow.match(/security-events: write/g) || []).length, 1);
});
