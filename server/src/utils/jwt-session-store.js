'use strict';

const cryptoUtils = require('./crypto');

/**
 * JWT session store helper for the magic-link plugin.
 *
 * Persists a small audit record per JWT issue (hash + metadata) into the
 * plugin store. Growth is capped at `MAX_SESSIONS` entries and expired
 * records are pruned on every write so the underlying JSON blob stays small.
 *
 * This is NOT a replacement for a proper session store (use
 * magic-sessionmanager for that) — it's a lightweight audit trail.
 */

const STORE_KEY = 'jwt_sessions';
const MAX_SESSIONS = 1000;

/**
 * Appends a new JWT audit record and prunes expired/excess entries.
 *
 * @param {object} strapi
 * @param {object} record - Session data to persist
 * @returns {Promise<void>}
 */
async function appendJwtSession(strapi, record) {
  try {
    const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
    const existing = (await pluginStore.get({ key: STORE_KEY })) || { sessions: [] };
    const sessions = Array.isArray(existing.sessions) ? existing.sessions : [];

    const now = Date.now();
    const pruned = sessions.filter((s) => {
      if (!s || !s.expiresAt) return false;
      const exp = new Date(s.expiresAt).getTime();
      return Number.isFinite(exp) && exp > now;
    });

    pruned.push(record);

    const capped = pruned.length > MAX_SESSIONS
      ? pruned.slice(pruned.length - MAX_SESSIONS)
      : pruned;

    await pluginStore.set({ key: STORE_KEY, value: { sessions: capped } });
  } catch (err) {
    strapi.log.error('[magic-link] Failed to persist JWT session record:', err.message);
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
  const { nanoid } = require('nanoid');
  return {
    id: `session_${Date.now()}_${nanoid(12)}`,
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
  MAX_SESSIONS,
};
