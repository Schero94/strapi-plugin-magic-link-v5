'use strict';

/**
 * Multi-process concurrency test: starts N independent Node processes (like
 * Railway replicas or pm2 cluster workers) on ONE database and checks that
 * no update is lost, no row is duplicated, a background job runs once and
 * a rate limit is shared.
 *
 *   npm run test:cluster                       # SQLite file, 8 processes
 *   ML_CLUSTER_DB=postgres ML_CLUSTER_PG_URL=postgres://user@host:5432/throwaway_db \
 *     npm run test:cluster
 *
 * The PostgreSQL run DROPS AND RECREATES the `public` schema of the given
 * database: point it at a throwaway test database only.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const PROCESSES = Math.max(2, Number(process.env.ML_CLUSTER_PROCESSES) || 8);
const ITERATIONS = Math.max(1, Number(process.env.ML_CLUSTER_ITERATIONS) || 15);
const WORKER = path.join(__dirname, 'worker.cjs');
const client = process.env.ML_CLUSTER_DB || 'sqlite';

/**
 * Empties the test database.
 *
 * @returns {Promise<void>}
 */
const resetDatabase = async () => {
  if (client === 'postgres') {
    // Explicit URL only: this run drops the schema of that database.
    if (!process.env.ML_CLUSTER_PG_URL) throw new Error('ML_CLUSTER_PG_URL is required');
    const { Client } = require('pg');
    const pg = new Client({
      connectionString: process.env.ML_CLUSTER_PG_URL,
    });
    await pg.connect();
    await pg.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pg.query('CREATE SCHEMA public');
    await pg.end();
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-cluster-'));
  process.env.ML_CLUSTER_SQLITE = path.join(dir, 'cluster.db');
};

/**
 * Runs one scenario in PROCESSES parallel processes.
 *
 * @param {string} scenario - Worker scenario.
 * @param {number} [iterations] - Iterations per process.
 * @returns {Promise<Array<object>>} Worker results.
 */
const runScenario = async (scenario, iterations = ITERATIONS) => {
  // All processes start their work at the same moment.
  const startAt = Date.now() + 1500;
  const results = await Promise.all(
    Array.from({ length: PROCESSES }, (_, index) =>
      run(
        process.execPath,
        [WORKER, scenario, String(index), String(iterations), String(startAt)],
        {
          env: process.env,
          timeout: 120_000,
        }
      ).then(
        ({ stdout }) => JSON.parse(stdout.trim().split('\n').pop()),
        (error) => ({ ok: false, index, error: String(error.stdout || error.message) })
      )
    )
  );
  for (const result of results) assert.equal(result.ok, true, JSON.stringify(result));
  return results;
};

(async () => {
  await resetDatabase();
  const { createClusterStrapi } = require('./harness.cjs');
  const strapi = await createClusterStrapi({ sync: true });
  const store = strapi.store({ type: 'plugin', name: 'magic-link' });
  const rowsOf = async (key) =>
    strapi.db.query('strapi::core-store').findMany({ where: { key: `plugin_magic-link_${key}` } });
  const total = PROCESSES * ITERATIONS;
  const checks = [];

  await runScenario('counter');
  assert.equal(await store.get({ key: 'cluster_counter' }), total, 'counter lost updates');
  checks.push(`counter: ${total}/${total} increments kept`);

  await runScenario('blocklist');
  const blocked = (await store.get({ key: 'blocked_jwt_tokens' })).tokens;
  assert.equal(new Set(blocked.map((entry) => entry.tokenHash)).size, total, 'lost revocations');
  checks.push(`blocklist: ${total}/${total} revocations kept despite concurrent prune/read`);

  await runScenario('sessions');
  const sessions = (await store.get({ key: 'jwt_sessions' })).sessions;
  assert.equal(new Set(sessions.map((session) => session.id)).size, total, 'lost sessions');
  checks.push(`sessions: ${total}/${total} session records kept`);

  const lease = await runScenario('lease', 1);
  assert.equal(lease.filter((result) => result.ran).length, 1, 'job ran in more than one process');
  checks.push(`lease: background job ran in 1 of ${PROCESSES} processes`);

  await runScenario('firstWrite', 1);
  assert.equal((await rowsOf('cluster_first_write')).length, 1, 'duplicate core-store rows');
  checks.push('first write: one core-store row');

  const limiter = await runScenario('limiter', 5);
  const allowed = limiter.reduce((sum, result) => sum + result.allowed, 0);
  assert.equal(allowed, limiter[0].points, 'verify limit not shared');
  checks.push(
    `rate limit: ${allowed} of ${PROCESSES * 5} code checks allowed (limit ${limiter[0].points})`
  );

  for (const key of ['cluster_counter', 'blocked_jwt_tokens', 'jwt_sessions']) {
    assert.equal((await rowsOf(key)).length, 1, `duplicate rows for ${key}`);
  }

  await strapi.db.destroy();
  process.stdout.write(
    `cluster test (${client}, ${PROCESSES} processes) passed\n${checks.map((c) => `  - ${c}`).join('\n')}\n`
  );
})().catch((error) => {
  process.stderr.write(`cluster test (${client}) failed: ${error.message}\n`);
  process.exit(1);
});
