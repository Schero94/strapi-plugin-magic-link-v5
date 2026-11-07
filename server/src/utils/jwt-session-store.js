'use strict';

const cryptoUtils = require('./crypto');
const createId = require('./id');

/**
 * JWT session store helper for the magic-link plugin.
 *
 * Persists a small audit record per issued JWT (hash + metadata) in the
 * plugin store key `jwt_sessions`. Every write goes through
 * `updateJwtSessions`, which serialises read-modify-write cycles per Strapi
 * instance so concurrent logins and admin revocations cannot overwrite each
 * other's changes in one process. Each write also:
 *  - drops records whose token expired more than `RETENTION_MS` ago,
 *  - caps the list at `MAX_SESSIONS` (oldest first),
 *  - replaces plaintext `jwtToken` fields left by older releases with their
 *    hash, so no usable JWT stays in the database.
 *
 * Revocation itself is enforced by the blocklist (and, in refresh mode, by
 * the users-permissions session manager), not by this audit list.
 */

const STORE_KEY = 'jwt_sessions';
const MAX_SESSIONS = 1000;
// Keep expired records for a week so admins can still see recent history.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const queues = new WeakMap();

/**
 * Runs `task` after every earlier task for the same Strapi instance.
 *
 * @param {object} strapi - Strapi instance (lock scope).
 * @param {() => Promise<any>} task - Work to serialise.
 * @returns {Promise<any>} Result of the task.
 */
const serialize = (strapi, task) => {
  const previous = queues.get(strapi) || Promise.resolve();
  const run = previous.then(task, task);
  queues.set(
    strapi,
    run.catch(() => {})
  );
  return run;
};

/**
 * Removes a legacy plaintext JWT from a record, keeping only its hash.
 *
 * @param {object} session - Stored record.
 * @returns {object} Record without `jwtToken`.
 */
const scrubLegacyToken = (session) => {
  if (!session || !Object.prototype.hasOwnProperty.call(session, 'jwtToken')) return session;
  const { jwtToken, ...rest } = session;
  const legacyHash = typeof jwtToken === 'string' && jwtToken ? cryptoUtils.hashJwt(jwtToken) : undefined;
  return { ...rest, jwtTokenHash: rest.jwtTokenHash || legacyHash };
};

/**
 * Prunes, scrubs and caps a session list.
 *
 * @param {Array} sessions - Stored records.
 * @param {number} [now] - Current time in ms.
 * @returns {Array} Clean list.
 */
const cleanSessions = (sessions, now = Date.now()) => {
  const kept = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => {
      if (!session || !session.expiresAt) return false;
      const exp = new Date(session.expiresAt).getTime();
      return Number.isFinite(exp) && exp + RETENTION_MS > now;
    })
    .map(scrubLegacyToken);
  return kept.length > MAX_SESSIONS ? kept.slice(kept.length - MAX_SESSIONS) : kept;
};

/**
 * Reads the stored session list without modifying it.
 *
 * @param {object} strapi - Strapi instance.
 * @returns {Promise<Array>} Stored records.
 */
const readJwtSessions = async (strapi) => {
  const stored = await strapi.store({ type: 'plugin', name: 'magic-link' }).get({ key: STORE_KEY });
  return Array.isArray(stored?.sessions) ? stored.sessions : [];
};

/**
 * Serialised read-modify-write of the session list. `mutator` receives a
 * cleaned copy and returns the new list, or `{ sessions, result }`.
 *
 * @param {object} strapi - Strapi instance.
 * @param {(sessions: Array) => any} mutator - Change to apply.
 * @returns {Promise<any>} The mutator's `result` (undefined for a plain list).
 */
const updateJwtSessions = (strapi, mutator) =>
  serialize(strapi, async () => {
    const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
    const current = cleanSessions(await readJwtSessions(strapi));
    const outcome = await mutator(current.map((session) => ({ ...session })));
    const next = Array.isArray(outcome) ? outcome : outcome?.sessions || current;
    await pluginStore.set({ key: STORE_KEY, value: { sessions: cleanSessions(next) } });
    return Array.isArray(outcome) ? undefined : outcome?.result;
  });

/**
 * Appends a new JWT audit record. Failures are logged, never thrown, so a
 * store problem cannot block a login.
 *
 * @param {object} strapi
 * @param {object} record - Session data to persist
 * @returns {Promise<void>}
 */
async function appendJwtSession(strapi, record) {
  try {
    await updateJwtSessions(strapi, (sessions) => [...sessions, scrubLegacyToken(record)]);
  } catch {
    strapi.log.error('[magic-link] Failed to persist JWT session record');
  }
}

/**
 * Builds a session record from a newly-issued JWT. Hashes the JWT so the raw
 * token is never written to disk.
 *
 * @param {object} params
 * @param {string} params.jwtToken
 * @param {object} params.user
 * @param {Date} params.expiresAt
 * @param {object} [params.requestInfo]
 * @param {string} [params.source]
 * @param {object} [params.context]
 * @param {object} [params.extra]
 * @returns {object}
 */
function buildSessionRecord({ jwtToken, user, expiresAt, requestInfo = {}, source, context, extra }) {
  return {
    id: `session_${Date.now()}_${createId(12)}`,
    userId: user.id,
    userEmail: user.email,
    username: user.username || (user.email ? user.email.split('@')[0] : 'user'),
    jwtTokenHash: cryptoUtils.hashJwt(jwtToken),
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    isRevoked: false,
    ipAddress: requestInfo.ipAddress,
    userAgent: requestInfo.userAgent,
    source: source || 'Magic Link',
    lastUsedAt: new Date().toISOString(),
    context: context || undefined,
    ...(extra || {}),
  };
}

module.exports = {
  appendJwtSession,
  buildSessionRecord,
  cleanSessions,
  readJwtSessions,
  updateJwtSessions,
  MAX_SESSIONS,
  RETENTION_MS,
};
