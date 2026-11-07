'use strict';

const cryptoUtils = require('./crypto');
const createId = require('./id');
const { withClusterLock } = require('./cluster');

/**
 * JWT session audit store for the magic-link plugin.
 *
 * One row per issued JWT in the hidden content type
 * `plugin::magic-link.jwt-session` (table `magic_link_jwt_sessions`). Only
 * the SHA-256 hash of the JWT is stored, never the token.
 *
 * Why a table and not one plugin-store JSON value: with one shared JSON
 * value every login had to read, change and write the whole list under a
 * cluster-wide lock, so all logins of all processes ran one after another.
 * With one row per JWT:
 *  - a login is a plain INSERT (no lock, no read),
 *  - a revocation or restore is a conditional UPDATE
 *    (`WHERE session_id = ? AND revoked_at IS NULL`) that touches only the
 *    rows it changes, so two admins cannot both "win",
 *  - retention and the size cap are indexed DELETEs run by the periodic
 *    cleanup job, which already runs in one process only (DB lease),
 *  - the admin list reads one page through the primary key and indexes.
 *
 * Queries use the Query Engine (`strapi.db.query`), not the Document
 * Service: these rows have no draft/publish, locales or relations, and the
 * conditional `updateMany`/`deleteMany` calls need `where` plus the
 * `{ count }` result (docs.strapi.io/cms/api/query-engine/bulk-operations).
 *
 * Records written by releases before 6.2 live in the plugin-store key
 * `jwt_sessions`; `migrateLegacySessions` moves them into rows once.
 *
 * Revocation itself is enforced by the blocklist (and, in refresh mode, by
 * the users-permissions session manager), not by this audit table.
 */

const SESSION_UID = 'plugin::magic-link.jwt-session';
const LEGACY_STORE_KEY = 'jwt_sessions';
// Upper bound on stored rows; the oldest rows beyond it are deleted by the
// periodic cleanup. Retention (below) normally removes rows long before.
const MAX_SESSIONS = 50_000;
// Keep expired records for a week so admins can still see recent history.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
// Rows returned by the admin list without explicit paging (the newest ones).
const DEFAULT_LIST_LIMIT = 1000;
const MAX_PAGE_SIZE = 1000;
// Rows per lookup/INSERT batch in the legacy migration.
const MIGRATION_BATCH = 200;
const AUTO_EXPIRED_REASON = 'Automatically expired';

/** Record fields with their own column; everything else goes to loginDetails. */
const COLUMN_FIELDS = new Set([
  'id',
  'sessionId',
  'jwtToken',
  'jwtTokenHash',
  'userId',
  'userDocumentId',
  'userEmail',
  'username',
  'jwtManagement',
  'upSessionId',
  'deviceId',
  'upFamilyExpiresAt',
  'accessTokenNonExpiring',
  'accessTokenExpiresAt',
  'createdAt',
  'updatedAt',
  'expiresAt',
  'isRevoked',
  'ipAddress',
  'userAgent',
  'source',
  'lastUsedAt',
  'context',
  'revokedAt',
  'revokeReason',
  'revokedBy',
  'restoredBy',
  'loginDetails',
]);

/**
 * Query Engine repository of the session table.
 *
 * @param {object} strapi - Strapi instance.
 * @returns {object} `strapi.db.query(SESSION_UID)`.
 */
const sessions = (strapi) => strapi.db.query(SESSION_UID);

/**
 * ISO string of a date-like value, or null.
 *
 * @param {any} value - Date, ISO string or ms.
 * @returns {string|null} ISO date or null.
 */
const toIso = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * Optional string column value.
 *
 * @param {any} value - Id or text.
 * @returns {string|null} String or null.
 */
const toText = (value) => (value === null || value === undefined ? null : String(value));

/**
 * users-permissions and admin ids are integers but stored as strings, so
 * numeric ones are handed back as numbers like before (API shape unchanged).
 *
 * @param {string|null} value - Stored id.
 * @returns {number|string|null} Id.
 */
const fromStoredId = (value) => {
  if (value === null || value === undefined) return null;
  return /^\d{1,15}$/.test(String(value)) ? Number(value) : value;
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
  const legacyHash =
    typeof jwtToken === 'string' && jwtToken ? cryptoUtils.hashJwt(jwtToken) : undefined;
  return { ...rest, jwtTokenHash: rest.jwtTokenHash || legacyHash };
};

/**
 * Prunes and scrubs a legacy session list (plugin-store JSON). Used by the
 * one-time migration; new records never use it.
 *
 * @param {Array} list - Stored records.
 * @param {number} [now] - Current time in ms.
 * @returns {Array} Records inside the retention period, without plaintext JWTs.
 */
const cleanSessions = (list, now = Date.now()) =>
  (Array.isArray(list) ? list : [])
    .filter((session) => {
      if (!session || !session.expiresAt) return false;
      const exp = new Date(session.expiresAt).getTime();
      return Number.isFinite(exp) && exp + RETENTION_MS > now;
    })
    .map(scrubLegacyToken);

/**
 * Table row data for a session record (the record shape used before 6.2).
 * The plaintext `jwtToken` of very old records is replaced by its hash.
 *
 * @param {object} record - Session record.
 * @returns {object} Row data for `create`.
 */
const toRowData = (record) => {
  const clean = scrubLegacyToken(record) || {};
  const extra = Object.fromEntries(
    Object.entries(clean).filter(([key, value]) => !COLUMN_FIELDS.has(key) && value !== undefined)
  );
  const details = { ...(clean.loginDetails || {}), ...extra };
  const revokedAt =
    toIso(clean.revokedAt) ||
    (clean.isRevoked ? toIso(clean.createdAt) || new Date().toISOString() : null);
  const createdAt = toIso(clean.createdAt);
  return {
    sessionId: String(clean.id || clean.sessionId || `session_${Date.now()}_${createId(12)}`),
    jwtTokenHash: clean.jwtTokenHash || null,
    userId: toText(clean.userId),
    userDocumentId: toText(clean.userDocumentId),
    userEmail: toText(clean.userEmail),
    username: toText(clean.username),
    jwtManagement: toText(clean.jwtManagement),
    upSessionId: toText(clean.upSessionId),
    deviceId: toText(clean.deviceId),
    upFamilyExpiresAt: toIso(clean.upFamilyExpiresAt),
    accessTokenNonExpiring: clean.accessTokenNonExpiring === true,
    accessTokenExpiresAt: toIso(clean.accessTokenExpiresAt),
    expiresAt: toIso(clean.expiresAt),
    ipAddress: toText(clean.ipAddress),
    userAgent: toText(clean.userAgent),
    source: toText(clean.source),
    lastUsedAt: toIso(clean.lastUsedAt),
    context: clean.context && typeof clean.context === 'object' ? clean.context : null,
    loginDetails: Object.keys(details).length > 0 ? details : null,
    revokedAt,
    revokeReason: revokedAt ? toText(clean.revokeReason) : null,
    revokedBy: revokedAt ? toText(clean.revokedBy) : null,
    restoredBy: toText(clean.restoredBy),
    ...(createdAt ? { createdAt } : {}),
  };
};

/**
 * Session record (pre-6.2 shape) of a table row, so the controllers and the
 * admin API keep their response shape.
 *
 * @param {object|null} row - Table row.
 * @returns {object|null} Session record.
 */
const fromRow = (row) => {
  if (!row) return null;
  const details = row.loginDetails && typeof row.loginDetails === 'object' ? row.loginDetails : {};
  const optional = (value) => (value === null || value === undefined ? undefined : value);
  return {
    ...details,
    id: row.sessionId,
    userId: fromStoredId(row.userId),
    userDocumentId: optional(row.userDocumentId),
    userEmail: optional(row.userEmail),
    username: optional(row.username),
    jwtTokenHash: optional(row.jwtTokenHash),
    jwtManagement: optional(row.jwtManagement),
    upSessionId: optional(row.upSessionId),
    deviceId: optional(row.deviceId),
    upFamilyExpiresAt: optional(toIso(row.upFamilyExpiresAt)),
    accessTokenNonExpiring: row.accessTokenNonExpiring ? true : undefined,
    accessTokenExpiresAt: optional(toIso(row.accessTokenExpiresAt)),
    createdAt: toIso(row.createdAt),
    expiresAt: toIso(row.expiresAt),
    isRevoked: Boolean(row.revokedAt),
    revokedAt: toIso(row.revokedAt),
    revokeReason: row.revokeReason ?? null,
    revokedBy: fromStoredId(row.revokedBy),
    restoredBy: fromStoredId(row.restoredBy),
    ipAddress: optional(row.ipAddress),
    userAgent: optional(row.userAgent),
    source: optional(row.source),
    lastUsedAt: optional(toIso(row.lastUsedAt)),
    context: optional(row.context),
  };
};

/**
 * Stores a new JWT audit record with one INSERT. No lock and no read: logins
 * on every process run in parallel. Failures are logged, never thrown, so a
 * storage problem cannot block a login.
 *
 * @param {object} strapi - Strapi instance.
 * @param {object} record - Session record (see buildSessionRecord).
 * @returns {Promise<boolean>} Whether the row was written.
 */
async function appendJwtSession(strapi, record) {
  try {
    await sessions(strapi).create({ data: toRowData(record) });
    return true;
  } catch {
    strapi.log.error('[magic-link] Failed to persist JWT session record');
    return false;
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
function buildSessionRecord({
  jwtToken,
  user,
  expiresAt,
  requestInfo = {},
  source,
  context,
  extra,
}) {
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

/**
 * Session record by its public id (unique index on session_id).
 *
 * @param {object} strapi - Strapi instance.
 * @param {string} sessionId - Record id.
 * @returns {Promise<object|null>} Record.
 */
const findSessionById = async (strapi, sessionId) =>
  fromRow(await sessions(strapi).findOne({ where: { sessionId: String(sessionId) } }));

/**
 * Session record by JWT hash (unique index on jwt_token_hash).
 *
 * @param {object} strapi - Strapi instance.
 * @param {string} tokenHash - SHA-256 hash of the JWT.
 * @returns {Promise<object|null>} Record.
 */
const findSessionByHash = async (strapi, tokenHash) => {
  if (!tokenHash) return null;
  return fromRow(await sessions(strapi).findOne({ where: { jwtTokenHash: String(tokenHash) } }));
};

/**
 * Every record of one user that carries a JWT hash (index on user_id).
 *
 * @param {object} strapi - Strapi instance.
 * @param {string|number} userId - users-permissions user id.
 * @returns {Promise<Array<object>>} Records.
 */
const findUserSessions = async (strapi, userId) => {
  const rows = await sessions(strapi).findMany({
    where: { userId: String(userId), jwtTokenHash: { $notNull: true } },
    orderBy: { id: 'asc' },
  });
  return (rows || []).map(fromRow);
};

/**
 * `where` of a status filter, matching the statuses of the admin list.
 *
 * @param {'all'|'active'|'revoked'|'expired'} status - Filter.
 * @param {Date} now - Current time.
 * @returns {object} Query Engine where clause.
 */
const statusWhere = (status, now) => {
  if (status === 'active') return { revokedAt: { $null: true }, expiresAt: { $gt: now } };
  if (status === 'revoked') return { revokedAt: { $notNull: true } };
  if (status === 'expired') return { expiresAt: { $lte: now } };
  return {};
};

/**
 * One page of session records, newest first, read through the primary key
 * and the user_id / revoked_at+expires_at indexes. Without `page` the newest
 * `DEFAULT_LIST_LIMIT` records are returned.
 *
 * @param {object} strapi - Strapi instance.
 * @param {{page?: number, pageSize?: number, status?: string, userId?: string|number}} [options]
 * @returns {Promise<{results: Array<object>, total: number}>} Page and total count.
 */
const listSessions = async (strapi, options = {}) => {
  const now = new Date();
  const hasUser = options.userId !== undefined && options.userId !== null && options.userId !== '';
  const where = {
    ...statusWhere(options.status || 'all', now),
    ...(hasUser ? { userId: String(options.userId) } : {}),
  };
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(Number(options.pageSize) || DEFAULT_LIST_LIMIT))
  );
  const page = Math.max(1, Math.trunc(Number(options.page) || 1));
  const [rows, total] = await Promise.all([
    sessions(strapi).findMany({
      where,
      orderBy: { id: 'desc' },
      offset: (page - 1) * pageSize,
      limit: pageSize,
    }),
    sessions(strapi).count({ where }),
  ]);
  return { results: (rows || []).map(fromRow), total: Number(total) || 0 };
};

/**
 * Marks matching, not yet revoked records as revoked with one conditional
 * UPDATE (`... AND revoked_at IS NULL`). Already revoked rows keep their
 * first revocation time, reason and actor.
 *
 * @param {object} strapi - Strapi instance.
 * @param {object} where - Rows to revoke (e.g. `{ sessionId }`, `{ jwtTokenHash }`, `{ userId }`).
 * @param {{reason: string, revokedBy?: string|number|null, at?: Date}} details - Audit data.
 * @returns {Promise<number>} Number of rows changed.
 */
const markSessionsRevoked = async (
  strapi,
  where,
  { reason, revokedBy = null, at = new Date() }
) => {
  const result = await sessions(strapi).updateMany({
    where: { ...where, revokedAt: { $null: true } },
    data: { revokedAt: at, revokeReason: reason, revokedBy: toText(revokedBy) },
  });
  return Number(result?.count) || 0;
};

/**
 * Clears the revocation of one record (single-row conditional UPDATE).
 *
 * @param {object} strapi - Strapi instance.
 * @param {string} sessionId - Record id.
 * @param {string|number|null} restoredBy - Admin id.
 * @returns {Promise<number>} Number of rows changed (0 or 1).
 */
const markSessionRestored = async (strapi, sessionId, restoredBy) => {
  const result = await sessions(strapi).updateMany({
    where: { sessionId: String(sessionId), revokedAt: { $notNull: true } },
    data: { revokedAt: null, revokeReason: null, revokedBy: null, restoredBy: toText(restoredBy) },
  });
  return Number(result?.count) || 0;
};

/**
 * Marks expired, still active records as ended (index on
 * revoked_at + expires_at). Nothing is revoked by this; the JWTs expired.
 *
 * @param {object} strapi - Strapi instance.
 * @param {Date} [now] - Current time.
 * @returns {Promise<number>} Number of rows marked.
 */
const expireSessions = (strapi, now = new Date()) =>
  markSessionsRevoked(
    strapi,
    { expiresAt: { $lt: now } },
    { reason: AUTO_EXPIRED_REASON, revokedBy: null, at: now }
  );

/**
 * Retention and size cap as indexed DELETEs: rows whose JWT expired more
 * than `RETENTION_MS` ago (index on expires_at), then the oldest rows beyond
 * `MAX_SESSIONS` (primary key). Run by the periodic cleanup job, which runs
 * in one process at a time (DB lease); both statements are idempotent.
 *
 * @param {object} strapi - Strapi instance.
 * @param {{now?: number, maxSessions?: number}} [options] - Overrides for tests.
 * @returns {Promise<{expired: number, capped: number}>} Deleted rows.
 */
const pruneSessions = async (strapi, { now = Date.now(), maxSessions = MAX_SESSIONS } = {}) => {
  const expired = await sessions(strapi).deleteMany({
    where: { expiresAt: { $lt: new Date(now - RETENTION_MS) } },
  });
  let capped = 0;
  const boundary = await sessions(strapi).findMany({
    select: ['id'],
    orderBy: { id: 'desc' },
    offset: maxSessions,
    limit: 1,
  });
  if (boundary?.[0]?.id !== undefined) {
    const result = await sessions(strapi).deleteMany({ where: { id: { $lte: boundary[0].id } } });
    capped = Number(result?.count) || 0;
  }
  return { expired: Number(expired?.count) || 0, capped };
};

/**
 * Deletes every session record (admin data reset).
 *
 * @param {object} strapi - Strapi instance.
 * @returns {Promise<number>} Deleted rows.
 */
const deleteAllSessions = async (strapi) => {
  const result = await sessions(strapi).deleteMany({ where: {} });
  return Number(result?.count) || 0;
};

/**
 * One-time migration of the pre-6.2 plugin-store list `jwt_sessions` into
 * rows. Runs under the lock of that key, so processes that start together
 * migrate it once; records already present (same id or hash) are skipped,
 * so an interrupted run can simply run again. Plaintext JWTs left by very
 * old releases are replaced by their hash before anything is written, and
 * records past the retention period are dropped. The key is deleted last.
 *
 * @param {object} strapi - Strapi instance.
 * @returns {Promise<{migrated: number, skipped: number}>} Counts.
 */
const migrateLegacySessions = (strapi) =>
  withClusterLock(strapi, `store:${LEGACY_STORE_KEY}`, async () => {
    const store = strapi.store({ type: 'plugin', name: 'magic-link' });
    const stored = await store.get({ key: LEGACY_STORE_KEY });
    if (stored === null || stored === undefined) return { migrated: 0, skipped: 0 };
    const legacy = cleanSessions(Array.isArray(stored?.sessions) ? stored.sessions : []);

    let migrated = 0;
    let skipped = 0;
    const seenIds = new Set();
    const seenHashes = new Set();
    for (let start = 0; start < legacy.length; start += MIGRATION_BATCH) {
      const batch = legacy.slice(start, start + MIGRATION_BATCH).map(toRowData);
      const ids = batch.map((row) => row.sessionId);
      const hashes = batch.map((row) => row.jwtTokenHash).filter(Boolean);
      const existing = await sessions(strapi).findMany({
        select: ['sessionId', 'jwtTokenHash'],
        where: {
          $or: [
            { sessionId: { $in: ids } },
            ...(hashes.length > 0 ? [{ jwtTokenHash: { $in: hashes } }] : []),
          ],
        },
      });
      for (const row of existing || []) {
        seenIds.add(row.sessionId);
        if (row.jwtTokenHash) seenHashes.add(row.jwtTokenHash);
      }
      const fresh = batch.filter((row) => {
        if (seenIds.has(row.sessionId) || (row.jwtTokenHash && seenHashes.has(row.jwtTokenHash))) {
          skipped += 1;
          return false;
        }
        seenIds.add(row.sessionId);
        if (row.jwtTokenHash) seenHashes.add(row.jwtTokenHash);
        return true;
      });
      if (fresh.length > 0) {
        await sessions(strapi).createMany({ data: fresh });
        migrated += fresh.length;
      }
    }
    await store.delete({ key: LEGACY_STORE_KEY });
    return { migrated, skipped };
  });

module.exports = {
  AUTO_EXPIRED_REASON,
  DEFAULT_LIST_LIMIT,
  LEGACY_STORE_KEY,
  MAX_PAGE_SIZE,
  MAX_SESSIONS,
  RETENTION_MS,
  SESSION_UID,
  appendJwtSession,
  buildSessionRecord,
  cleanSessions,
  deleteAllSessions,
  expireSessions,
  findSessionByHash,
  findSessionById,
  findUserSessions,
  fromRow,
  listSessions,
  markSessionRestored,
  markSessionsRevoked,
  migrateLegacySessions,
  pruneSessions,
  scrubLegacyToken,
  toRowData,
};
