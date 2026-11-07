'use strict';

/**
 * Multi-process concurrency test: starts N independent Node processes (like
 * Railway replicas or pm2 cluster workers) on ONE database and checks that
 * no update is lost, no row is duplicated, a background job runs once, a
 * rate limit is shared, logins store their session rows in parallel (also
 * while the old session-list lock is held), the 6.1 session list migrates
 * once and only one of several parallel revocations changes a row.
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
const { SESSION_UID } = require('../../server/src/utils/jwt-session-store');

const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

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

  const sessionQuery = strapi.db.query(SESSION_UID);
  const logins = await runScenario('sessions');
  const rows = await sessionQuery.findMany({ select: ['sessionId'] });
  assert.equal(new Set(rows.map((row) => row.sessionId)).size, total, 'lost sessions');
  assert.equal(
    logins.reduce((sum, result) => sum + result.written, 0),
    total,
    'a login could not store its session'
  );
  const slowest = Math.max(...logins.map((result) => result.elapsedMs));
  const held = Math.max(...logins.map((result) => result.heldLockMs));
  if (held > 0) {
    assert.ok(slowest < held, `logins waited for the session-list lock (${slowest} ms)`);
  }
  checks.push(
    `sessions: ${total}/${total} parallel logins stored as rows, slowest process ${slowest} ms` +
      (held > 0 ? ` while the old session-list lock was held for ${held} ms` : '')
  );

  // One-time migration of a 6.1 plugin-store list, started by every process.
  const legacyJwt = 'synthetic.legacy.cluster-jwt';
  const legacyCount = 300;
  await store.set({
    key: 'jwt_sessions',
    value: {
      sessions: [
        { id: 'legacy-plain', userId: 1, jwtToken: legacyJwt, expiresAt: inOneHour() },
        ...Array.from({ length: legacyCount - 1 }, (_, i) => ({
          id: `legacy-${i}`,
          userId: i,
          jwtTokenHash: `legacy-hash-${i}`,
          createdAt: new Date(Date.now() - 1000 * (legacyCount - i)).toISOString(),
          expiresAt: inOneHour(),
          isRevoked: i % 10 === 0,
        })),
        // Same id as a row of the logins above: skipped, not duplicated.
        { id: 'session-0-0', jwtTokenHash: 'jwt-0-0', expiresAt: inOneHour() },
      ],
    },
  });
  const migration = await runScenario('migration', 1);
  const migrated = migration.reduce((sum, result) => sum + result.migrated, 0);
  assert.equal(migrated, legacyCount, 'legacy records migrated more than once or lost');
  assert.equal(await sessionQuery.count(), total + legacyCount, 'duplicate or missing rows');
  assert.equal(await store.get({ key: 'jwt_sessions' }), null, 'legacy key not deleted');
  const plain = await sessionQuery.findOne({ where: { sessionId: 'legacy-plain' } });
  assert.equal(JSON.stringify(plain).includes(legacyJwt), false, 'plaintext JWT migrated');
  checks.push(
    `migration: ${legacyCount} legacy records moved once by ${PROCESSES} processes, key deleted`
  );

  // One-time removal of the 6.x registration key, started by every process.
  await store.set({ key: 'licenseKey', value: 'SYNTH-0000-CLUSTER-0000' });
  await store.set({ key: 'lastValidated', value: new Date().toISOString() });
  const legacyKeys = await runScenario('legacyKeys', 1);
  assert.equal(
    legacyKeys.reduce((sum, result) => sum + result.removed, 0),
    2,
    '6.x keys deleted more than once or not at all'
  );
  assert.equal((await rowsOf('licenseKey')).length, 0, 'licenseKey row left');
  assert.equal((await rowsOf('lastValidated')).length, 0, 'lastValidated row left');
  checks.push(`legacy keys: 2 rows deleted once by ${PROCESSES} processes`);

  await sessionQuery.create({
    data: { sessionId: 'race-session', jwtTokenHash: 'race-hash', expiresAt: inOneHour() },
  });
  const race = await runScenario('revokeRace', 1);
  assert.equal(
    race.reduce((sum, result) => sum + result.changed, 0),
    1,
    'more than one revocation changed the row'
  );
  checks.push(`revocation: 1 of ${PROCESSES} parallel revocations of one session changed it`);

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

  for (const key of ['cluster_counter', 'blocked_jwt_tokens']) {
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
