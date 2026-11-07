'use strict';

/**
 * One "Strapi process" of the concurrency test. Runs one scenario against
 * the shared database and prints a JSON result line. Started by run.cjs.
 */

const { createClusterStrapi } = require('./harness.cjs');
const {
  dialectOf,
  runExclusiveJob,
  updateStoreKey,
  withClusterLock,
} = require('../../server/src/utils/cluster');
const {
  appendJwtSession,
  markSessionsRevoked,
  migrateLegacySessions,
} = require('../../server/src/utils/jwt-session-store');
const createMagicLinkService = require('../../server/src/services/magic-link');
const createRateLimiter = require('../../server/src/services/rate-limiter');
const { VERIFY_LIMIT } = require('../../server/src/services/rate-limiter');

const [scenario, indexArg, iterationsArg, startAtArg] = process.argv.slice(2);
const index = Number(indexArg);
const iterations = Number(iterationsArg);
const startAt = Number(startAtArg);

const waitForStart = () =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, startAt - Date.now())));

const scenarios = {
  /** Plain read-modify-write counter on one plugin-store key. */
  async counter(strapi) {
    for (let i = 0; i < iterations; i += 1) {
      await updateStoreKey(strapi, 'cluster_counter', (value) => ({
        value: (Number(value) || 0) + 1,
      }));
    }
    return {};
  },

  /** JWT revocations from every process, with a concurrent read and prune. */
  async blocklist(strapi) {
    const service = createMagicLinkService({ strapi });
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    for (let i = 0; i < iterations; i += 1) {
      await Promise.all([
        service.addBlocklistEntries([
          { tokenHash: `hash-${index}-${i}`, userId: index, reason: 'test', expiresAt },
        ]),
        service.getBlockedJwtTokens(),
        service.pruneBlocklist(),
      ]);
    }
    return {};
  },

  /**
   * Logins on every process at the same moment: each process writes
   * `iterations` session records in parallel (no per-process queue either).
   * On PostgreSQL/MySQL process 0 first takes the old session-list lock and
   * holds it for HOLD_MS; logins must not wait for it. (SQLite has one
   * writer per file, so there the hold is skipped.)
   */
  async sessions(strapi) {
    const HOLD_MS = 3000;
    const holdLock = index === 0 && dialectOf(strapi) !== 'sqlite';
    const hold = holdLock
      ? withClusterLock(
          strapi,
          'store:jwt_sessions',
          () => new Promise((resolve) => setTimeout(resolve, HOLD_MS))
        )
      : Promise.resolve();
    // Let the holder take the lock before the logins start.
    if (holdLock) await new Promise((resolve) => setTimeout(resolve, 100));
    const started = Date.now();
    const written = await Promise.all(
      Array.from({ length: iterations }, (_, i) =>
        appendJwtSession(strapi, {
          id: `session-${index}-${i}`,
          userId: index * 1000 + i,
          userEmail: `user${index}-${i}@example.test`,
          jwtTokenHash: `jwt-${index}-${i}`,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          isRevoked: false,
        })
      )
    );
    const elapsedMs = Date.now() - started;
    await hold;
    return {
      written: written.filter(Boolean).length,
      elapsedMs,
      heldLockMs: holdLock ? HOLD_MS : 0,
    };
  },

  /** Every process starts the one-time legacy list migration at once. */
  async migration(strapi) {
    return migrateLegacySessions(strapi);
  },

  /** Every process revokes the same session at once; one UPDATE wins. */
  async revokeRace(strapi) {
    const changed = await markSessionsRevoked(
      strapi,
      { sessionId: 'race-session' },
      { reason: `revoked by ${index}`, revokedBy: index }
    );
    return { changed };
  },

  /** Every process tries to run the same background job at the same time. */
  async lease(strapi) {
    const outcome = await runExclusiveJob(strapi, 'cluster-test-job', 60_000, async () => true);
    return { ran: outcome.ran };
  },

  /** First write of a key that does not exist yet, from every process. */
  async firstWrite(strapi) {
    await updateStoreKey(strapi, 'cluster_first_write', (value) => ({
      value: value || { writer: index },
    }));
    return {};
  },

  /** Second-factor guesses for one account spread over every process. */
  async limiter(strapi) {
    const limiter = createRateLimiter({ strapi });
    let allowed = 0;
    for (let i = 0; i < iterations; i += 1) {
      const result = await limiter.checkRateLimit('verify:up:4242', 'verify');
      if (result.allowed) allowed += 1;
    }
    return { allowed, points: VERIFY_LIMIT.points };
  },
};

(async () => {
  const strapi = await createClusterStrapi();
  try {
    await waitForStart();
    const result = await scenarios[scenario](strapi);
    process.stdout.write(`${JSON.stringify({ ok: true, index, ...result })}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, index, error: String(error?.message || error) })}\n`
    );
    process.exitCode = 1;
  } finally {
    await strapi.db.destroy();
  }
})();
