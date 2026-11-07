'use strict';

/**
 * Merges duplicate plugin-store rows.
 *
 * `strapi_core_store_settings` has no unique index on `key`, and the core
 * store's `set` reads with findOne and creates the row when none exists
 * (@strapi/core 5.61 dist/services/core-store.js). Two processes writing a
 * key that did not exist yet could therefore both insert it. Later reads use
 * findOne without ORDER BY and may return either row, so a revocation or ban
 * written to one row could be invisible to processes that read the other.
 *
 * All plugin writes now run under a cluster-wide lock (utils/cluster.js), so
 * no new duplicates appear. This startup step repairs rows duplicated by
 * earlier releases: list keys are merged (union), every other key keeps the
 * oldest row.
 */

const { withClusterLock } = require('./cluster');

const CORE_STORE_UID = 'strapi::core-store';
const KEY_PREFIX = 'plugin_magic-link_';

/**
 * Parses a core-store row value like the core store does.
 *
 * @param {{value: string, type: string}} row - Stored row.
 * @returns {any} Parsed value or undefined.
 */
const parseRow = (row) => {
  if (!row || !['object', 'array', 'boolean', 'string'].includes(row.type)) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
};

/**
 * Blocklist union: one entry per token hash (a permanent block wins, else
 * the later expiry), user flags are kept distinct.
 *
 * @param {Array<any>} values - Parsed values.
 * @returns {{tokens: Array<object>}} Merged blocklist.
 */
const mergeBlocklists = (values) => {
  const byHash = new Map();
  const others = new Map();
  for (const value of values) {
    for (const entry of Array.isArray(value?.tokens) ? value.tokens : []) {
      if (!entry || typeof entry !== 'object') continue;
      if (!entry.tokenHash) {
        others.set(JSON.stringify(entry), entry);
        continue;
      }
      const existing = byHash.get(entry.tokenHash);
      if (!existing) {
        byHash.set(entry.tokenHash, { ...entry });
        continue;
      }
      if (entry.permanent) Object.assign(existing, { permanent: true, expiresAt: null });
      else if (!existing.permanent && String(entry.expiresAt) > String(existing.expiresAt || '')) {
        existing.expiresAt = entry.expiresAt;
      }
      if (entry.upUserId) existing.upUserId = entry.upUserId;
    }
  }
  return { tokens: [...byHash.values(), ...others.values()] };
};

/**
 * Legacy (pre-6.2) session list union by record id; a revoked copy wins
 * (fail safe). The merged list is then moved into the session table by
 * migrateLegacySessions (utils/jwt-session-store.js).
 *
 * @param {Array<any>} values - Parsed values.
 * @returns {{sessions: Array<object>}} Merged list, oldest first.
 */
const mergeSessions = (values) => {
  const byId = new Map();
  for (const value of values) {
    for (const session of Array.isArray(value?.sessions) ? value.sessions : []) {
      if (!session?.id) continue;
      const existing = byId.get(session.id);
      if (!existing || (session.isRevoked && !existing.isRevoked)) byId.set(session.id, session);
    }
  }
  return {
    sessions: [...byId.values()].sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    ),
  };
};

/**
 * IP ban list union.
 *
 * @param {Array<any>} values - Parsed values.
 * @returns {{ips: string[]}} Merged list.
 */
const mergeBans = (values) => ({
  ips: [...new Set(values.flatMap((value) => (Array.isArray(value?.ips) ? value.ips : [])))].filter(
    (ip) => typeof ip === 'string'
  ),
});

const MERGERS = {
  blocked_jwt_tokens: mergeBlocklists,
  jwt_sessions: mergeSessions,
  banned_ips: mergeBans,
};

/**
 * Merged value for duplicate rows of one key.
 *
 * @param {string} key - Plugin key (without prefix).
 * @param {Array<object>} rows - Rows, oldest first.
 * @returns {any} Value to keep.
 */
const mergeRows = (key, rows) => {
  const merge = MERGERS[key];
  if (!merge) return parseRow(rows[0]);
  return merge(rows.map(parseRow));
};

/**
 * Merges duplicate rows of every magic-link plugin-store key.
 *
 * @param {object} strapi - Strapi instance.
 * @returns {Promise<number>} Number of deleted duplicate rows.
 */
const dedupeStoreKeys = async (strapi) => {
  if (typeof strapi?.db?.query !== 'function') return 0;
  const query = () => strapi.db.query(CORE_STORE_UID);
  const rows = await query().findMany({
    where: { key: { $startsWith: KEY_PREFIX } },
    select: ['id', 'key', 'environment', 'tag'],
    orderBy: { id: 'asc' },
  });
  const counts = new Map();
  for (const row of rows || []) {
    const group = `${row.key}\u0000${row.environment ?? ''}\u0000${row.tag ?? ''}`;
    counts.set(group, (counts.get(group) || 0) + 1);
  }
  const duplicated = [...counts.entries()].filter(([, count]) => count > 1);

  let removed = 0;
  for (const [group] of duplicated) {
    const [fullKey, environment, tag] = group.split('\u0000');
    const key = fullKey.slice(KEY_PREFIX.length);
    removed += await withClusterLock(strapi, `store:${key}`, async () => {
      const current = await query().findMany({
        where: { key: fullKey, environment: environment || null, tag: tag || null },
        orderBy: { id: 'asc' },
      });
      if (!current || current.length < 2) return 0;
      const value = mergeRows(key, current);
      if (value !== undefined) {
        await query().updateMany({
          where: { id: current[0].id },
          data: { value: JSON.stringify(value), type: typeof value },
        });
      }
      const extra = current.slice(1).map((row) => row.id);
      await query().deleteMany({ where: { id: { $in: extra } } });
      return extra.length;
    });
  }
  return removed;
};

module.exports = { dedupeStoreKeys, mergeBlocklists, mergeBans, mergeSessions, KEY_PREFIX };
