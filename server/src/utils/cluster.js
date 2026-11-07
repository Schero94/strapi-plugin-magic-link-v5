'use strict';

/**
 * Coordination between several Strapi processes that share one database
 * (Railway replicas, pm2 cluster mode, Kubernetes pods).
 *
 * Process memory is not shared between those processes, so every
 * read-modify-write on shared state and every "check, then create" step
 * needs a lock that lives in the database:
 *
 * - `withClusterLock(strapi, name, fn)` runs `fn` inside a Strapi database
 *   transaction (`strapi.db.transaction`, docs.strapi.io/cms/database-transactions:
 *   db.query, the Document Service and the core store join it through
 *   AsyncLocalStorage) after taking an exclusive lock for `name`:
 *   - PostgreSQL: `pg_advisory_xact_lock(int4, int4)`, released at COMMIT or
 *     ROLLBACK (postgresql.org/docs/16/functions-admin.html), bounded by
 *     `SET LOCAL lock_timeout`.
 *   - MySQL/MariaDB: `GET_LOCK(name, timeout)` on a dedicated pooled
 *     connection, released with `RELEASE_LOCK(name)` only after the
 *     transaction has committed or rolled back. GET_LOCK locks are session
 *     locks that COMMIT does not release
 *     (dev.mysql.com/doc/refman/8.4/en/locking-functions.html); releasing
 *     before the commit would let the next holder read the old value.
 *   - SQLite: one writer per database file. The first statement of the
 *     transaction is a no-op UPDATE, which takes the database write lock at
 *     once, so other processes wait (busy timeout) instead of interleaving.
 *   Calls are also queued per lock name inside the process, so one process
 *   never holds more than one pooled connection waiting for the same lock.
 * - `runExclusiveJob(strapi, name, ttlMs, job)` runs a background job only in
 *   the process that wins a time-limited lease stored in the core store.
 *
 * Without a real database (unit tests with a Strapi double) both helpers fall
 * back to the in-process queue, which was the previous behaviour.
 */

const crypto = require('node:crypto');
const os = require('node:os');

const LOCK_NAMESPACE = 'strapi-plugin-magic-link';
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
// Two int4 keys: a fixed namespace for this plugin and one per lock name.
const PG_NAMESPACE_KEY = crypto.createHash('sha256').update(LOCK_NAMESPACE).digest().readInt32BE(0);
const SQLITE_LOCK_TABLE = 'strapi_core_store_settings';

/** Unique id of this process for leases (host, pid and a random part). */
const PROCESS_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

/** @type {WeakMap<object, Map<string, Promise<any>>>} */
const localQueues = new WeakMap();

/**
 * Runs `task` after every earlier task with the same name in this process.
 *
 * @param {object} strapi - Strapi instance (queue scope).
 * @param {string} name - Lock name.
 * @param {() => Promise<any>} task - Work.
 * @returns {Promise<any>} Result of the task.
 */
const serializeLocal = (strapi, name, task) => {
  const scope = strapi && typeof strapi === 'object' ? strapi : localQueues;
  if (!localQueues.has(scope)) localQueues.set(scope, new Map());
  const queues = localQueues.get(scope);
  const previous = queues.get(name) || Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.catch(() => {});
  queues.set(name, settled);
  // Drop the entry once the queue is idle so lock names do not accumulate.
  settled.then(() => {
    if (queues.get(name) === settled) queues.delete(name);
  });
  return run;
};

/**
 * Database client of a Strapi instance: 'postgres', 'mysql', 'sqlite' or
 * null when there is no usable database (unit tests).
 *
 * @param {object} strapi - Strapi instance.
 * @returns {'postgres'|'mysql'|'sqlite'|null} Client.
 */
const dialectOf = (strapi) => {
  const db = strapi?.db;
  if (!db || typeof db.transaction !== 'function') return null;
  const client = db.dialect?.client || db.config?.connection?.client;
  return ['postgres', 'mysql', 'sqlite'].includes(client) ? client : null;
};

/**
 * Stable signed int4 for a lock name (PostgreSQL second key).
 *
 * @param {string} name - Lock name.
 * @returns {number} Key.
 */
const pgKeyOf = (name) => crypto.createHash('sha256').update(name).digest().readInt32BE(0);

/**
 * MySQL lock name: at most 64 characters, server-wide, so it is namespaced
 * and hashed.
 *
 * @param {string} name - Lock name.
 * @returns {string} GET_LOCK name.
 */
const mysqlLockName = (name) =>
  `ml.${crypto.createHash('sha256').update(`${LOCK_NAMESPACE}:${name}`).digest('hex').slice(0, 56)}`;

/**
 * First value of a knex raw result for mysql2 ([rows, fields]).
 *
 * @param {any} result - knex raw result.
 * @returns {any} Value of the first column of the first row.
 */
const firstMysqlValue = (result) => {
  const rows = Array.isArray(result) ? result[0] : result;
  const row = Array.isArray(rows) ? rows[0] : rows;
  return row ? Object.values(row)[0] : undefined;
};

/**
 * MySQL releases deferred to the end of the outermost locked transaction,
 * keyed by its knex transaction object.
 *
 * @type {WeakMap<object, Array<() => Promise<void>>>}
 */
const deferredMysqlReleases = new WeakMap();

/**
 * Takes a MySQL named lock on a dedicated pooled connection.
 *
 * @param {object} strapi - Strapi instance.
 * @param {string} name - Lock name.
 * @param {number} timeoutMs - Maximum wait.
 * @returns {Promise<() => Promise<void>>} Release function (also returns the connection).
 * @throws {Error} When the lock is not obtained in time.
 */
const acquireMysqlLock = async (strapi, name, timeoutMs) => {
  const knex = strapi.db.connection;
  const connection = await knex.client.acquireConnection();
  const lockName = mysqlLockName(name);
  let acquired;
  try {
    acquired = firstMysqlValue(
      await knex
        .raw('SELECT GET_LOCK(?, ?) AS acquired', [lockName, Math.ceil(timeoutMs / 1000)])
        .connection(connection)
    );
  } catch (error) {
    knex.client.releaseConnection(connection);
    throw error;
  }
  if (Number(acquired) !== 1) {
    knex.client.releaseConnection(connection);
    throw new Error('Cluster lock timeout');
  }
  return async () => {
    try {
      await knex.raw('SELECT RELEASE_LOCK(?) AS released', [lockName]).connection(connection);
    } catch {
      // The lock ends with the session at the latest.
    } finally {
      knex.client.releaseConnection(connection);
    }
  };
};

/**
 * Runs `fn` while holding a cluster-wide exclusive lock for `name`. `fn`
 * runs inside a database transaction; Strapi queries in it use that
 * transaction automatically. Keep `fn` short and free of network calls.
 *
 * @template T
 * @param {object} strapi - Strapi instance.
 * @param {string} name - Lock name (e.g. 'store:settings').
 * @param {(trx?: object) => Promise<T>} fn - Critical section; receives the
 *   knex transaction for raw/schema queries (undefined without a database).
 * @param {{timeoutMs?: number}} [options] - Maximum wait for the lock.
 * @returns {Promise<T>} Result of `fn`.
 * @throws {Error} When the lock cannot be taken in time or `fn` fails.
 */
const withClusterLock = (strapi, name, fn, options = {}) => {
  const dialect = dialectOf(strapi);
  if (!dialect) return serializeLocal(strapi, `lock:${name}`, fn);
  // Nested call (already inside a transaction, e.g. an account claim that
  // revokes sessions): take the database lock on the open transaction and
  // skip the local queue. Queuing here could wait for a task that itself
  // waits for this transaction's connection (SQLite has one connection).
  if (typeof strapi.db.inTransaction === 'function' && strapi.db.inTransaction()) {
    return lockedTransaction(strapi, dialect, name, fn, options);
  }
  return serializeLocal(strapi, `lock:${name}`, () =>
    lockedTransaction(strapi, dialect, name, fn, options)
  );
};

/**
 * Runs `fn` in a (possibly joined) transaction after taking the lock.
 *
 * @template T
 * @param {object} strapi - Strapi instance.
 * @param {'postgres'|'mysql'|'sqlite'} dialect - Database client.
 * @param {string} name - Lock name.
 * @param {() => Promise<T>} fn - Critical section.
 * @param {{timeoutMs?: number}} options - Lock options.
 * @returns {Promise<T>} Result of `fn`.
 */
const lockedTransaction = async (strapi, dialect, name, fn, options) => {
  const timeoutMs = Math.max(
    1000,
    Math.trunc(Number(options.timeoutMs) || DEFAULT_LOCK_TIMEOUT_MS)
  );
  if (dialect === 'mysql') return mysqlLockedTransaction(strapi, name, fn, timeoutMs);
  return strapi.db.transaction(async ({ trx }) => {
    if (dialect === 'postgres') {
      // SET cannot take bind parameters; timeoutMs is an integer.
      await trx.raw(`SET LOCAL lock_timeout = ${timeoutMs}`);
      await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [PG_NAMESPACE_KEY, pgKeyOf(name)]);
      return fn(trx);
    }
    // SQLite: take the write lock with the first statement of the transaction.
    await trx.raw(`UPDATE ${SQLITE_LOCK_TABLE} SET id = id WHERE 1 = 0`);
    return fn(trx);
  });
};

/**
 * MySQL: lock first (dedicated connection), then run the transaction, then
 * release after COMMIT/ROLLBACK. A nested lock joins the outer transaction
 * and is released together with the outer lock.
 *
 * @template T
 * @param {object} strapi - Strapi instance.
 * @param {string} name - Lock name.
 * @param {(trx: object) => Promise<T>} fn - Critical section.
 * @param {number} timeoutMs - Maximum wait for the lock.
 * @returns {Promise<T>} Result of `fn`.
 */
const mysqlLockedTransaction = async (strapi, name, fn, timeoutMs) => {
  const release = await acquireMysqlLock(strapi, name, timeoutMs);
  const nested = typeof strapi.db.inTransaction === 'function' && strapi.db.inTransaction();
  if (nested) {
    let deferred = false;
    try {
      return await strapi.db.transaction(async ({ trx }) => {
        const outer = deferredMysqlReleases.get(trx);
        if (outer) {
          outer.push(release);
          deferred = true;
        }
        return fn(trx);
      });
    } finally {
      // A transaction not opened by withClusterLock: release now (best effort).
      if (!deferred) await release();
    }
  }
  const releases = [];
  try {
    return await strapi.db.transaction(async ({ trx }) => {
      deferredMysqlReleases.set(trx, releases);
      return fn(trx);
    });
  } finally {
    for (const releaseNested of releases.reverse()) await releaseNested();
    await release();
  }
};

/**
 * Plugin store bound to magic-link.
 *
 * @param {object} strapi - Strapi instance.
 * @returns {object} Scoped core store.
 */
const pluginStore = (strapi) => strapi.store({ type: 'plugin', name: 'magic-link' });

/**
 * Cluster-safe read-modify-write of one plugin-store key. `mutator` gets the
 * stored value (or undefined) and returns `{ value, result }`; when `value`
 * is undefined nothing is written.
 *
 * @template T
 * @param {object} strapi - Strapi instance.
 * @param {string} key - Plugin-store key.
 * @param {(current: any) => Promise<{value?: any, result?: T}>|{value?: any, result?: T}} mutator
 * @returns {Promise<T|undefined>} The mutator's result.
 */
const updateStoreKey = (strapi, key, mutator) =>
  withClusterLock(strapi, `store:${key}`, async () => {
    const store = pluginStore(strapi);
    const current = await store.get({ key });
    const outcome = (await mutator(current)) || {};
    if (outcome.value !== undefined) await store.set({ key, value: outcome.value });
    return outcome.result;
  });

/**
 * Tries to take (or renew) the lease for a background job. Only one process
 * holds a lease at a time; an expired lease can be taken over.
 *
 * @param {object} strapi - Strapi instance.
 * @param {string} name - Job name.
 * @param {number} ttlMs - Lease duration.
 * @returns {Promise<boolean>} Whether this process holds the lease now.
 */
const acquireLease = async (strapi, name, ttlMs) => {
  if (!dialectOf(strapi)) return true;
  return updateStoreKey(strapi, `lease_${name}`, (current) => {
    const now = Date.now();
    const heldByOther =
      current &&
      current.owner !== PROCESS_ID &&
      Number.isFinite(Number(current.expiresAt)) &&
      Number(current.expiresAt) > now;
    if (heldByOther) return { result: false };
    return { value: { owner: PROCESS_ID, expiresAt: now + ttlMs }, result: true };
  });
};

/**
 * Runs `job` only in the process that holds the lease for `name`. The lease
 * lasts `ttlMs`, so with an interval longer than `ttlMs` each run is done by
 * exactly one process; a crashed holder is replaced after `ttlMs`.
 *
 * @param {object} strapi - Strapi instance.
 * @param {string} name - Job name.
 * @param {number} ttlMs - Lease duration.
 * @param {() => Promise<any>} job - Work.
 * @returns {Promise<{ran: boolean, result?: any}>} Whether this process ran the job.
 */
const runExclusiveJob = async (strapi, name, ttlMs, job) => {
  if (!(await acquireLease(strapi, name, ttlMs))) return { ran: false };
  return { ran: true, result: await job() };
};

module.exports = {
  PROCESS_ID,
  acquireLease,
  dialectOf,
  mysqlLockName,
  pgKeyOf,
  runExclusiveJob,
  serializeLocal,
  updateStoreKey,
  withClusterLock,
};
