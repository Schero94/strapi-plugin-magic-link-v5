'use strict';

/**
 * CI must test what the package claims. engines.node and the README badge
 * name a Node range; the CI matrix covers every major in it. Audit steps say
 * the level they really enforce.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/**
 * Reads the Node majors from the `matrix.node` list of a workflow.
 *
 * @param {string} workflow Workflow YAML source.
 * @returns {number[]} The majors, in file order.
 * @throws {assert.AssertionError} When the workflow has no `node:` matrix list.
 */
function matrixMajors(workflow) {
  const match = workflow.match(/^\s+node:\s*\[([^\]]+)\]/m);
  assert.ok(match, 'workflow has a node matrix');
  return match[1].split(',').map((v) => Number(v.trim().replace(/['"]/g, '')));
}

test('the CI matrix tests every Node major that engines.node allows', () => {
  const pkg = JSON.parse(read('package.json'));
  const range = pkg.engines.node.match(/^>=(\d+)\.\d+\.\d+ <=(\d+)\.x\.x$/);
  assert.ok(range, `engines.node keeps the ">=A.0.0 <=B.x.x" form: ${pkg.engines.node}`);
  const [low, high] = [Number(range[1]), Number(range[2])];
  const majors = matrixMajors(read('.github/workflows/ci.yml'));
  for (let major = low; major <= high; major += 2) {
    assert.ok(majors.includes(major), `CI tests Node ${major} (engines.node ${pkg.engines.node})`);
  }
  for (const major of majors) {
    assert.ok(major >= low && major <= high, `CI Node ${major} is inside engines.node`);
  }
  assert.match(
    read('README.md'),
    new RegExp(`\\| Node\\.js +\\| ${low} to ${high} `),
    'README compatibility table matches engines.node'
  );
});

test('every audit step name states the level it enforces', () => {
  let steps = 0;
  for (const file of ['ci.yml', 'dependency-auto-merge.yml', 'release.yml']) {
    const workflow = read(`.github/workflows/${file}`);
    for (const match of workflow.matchAll(
      /- name: ([^\n]*audit[^\n]*)\n\s+run: npm audit[^\n]*--audit-level=(\w+)/gi
    )) {
      const [, name, level] = match;
      steps += 1;
      assert.match(
        name,
        new RegExp(`\\(${level}\\)$`),
        `${file}: "${name}" runs --audit-level=${level}`
      );
    }
  }
  assert.equal(steps, 3, 'ci, dependency auto-merge and release each run one audit step');
});

test('a CI job runs the real-host suite on the @strapi/strapi peer floor', () => {
  const pkg = JSON.parse(read('package.json'));
  const ci = read('.github/workflows/ci.yml');
  const floor = pkg.peerDependencies['@strapi/strapi'].replace(/^\^/, '');
  assert.equal(pkg.peerDependencies['@strapi/plugin-users-permissions'], `^${floor}`);
  assert.equal(pkg.dependencies['@strapi/utils'], `^${floor}`);
  const job = ci.match(/STRAPI_FLOOR:\s*([\d.]+)/);
  assert.ok(job, 'ci.yml sets STRAPI_FLOOR');
  assert.equal(job[1], floor, 'the floor job installs exactly the peer floor');
  assert.match(ci, /"@strapi\/strapi@\$STRAPI_FLOOR"/);
  assert.match(ci, /ML_HOST_REQUIRED: '1'/);
  assert.match(ci, /ML_HOST_JWT_MODE=refresh node --test tests\/host\/strapi-host\.test\.cjs/);
  assert.match(
    ci,
    /ML_HOST_JWT_MODE=legacy-support node --test tests\/host\/strapi-host\.test\.cjs/
  );
});
