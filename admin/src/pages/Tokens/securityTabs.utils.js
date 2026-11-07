/**
 * Pure helpers shared by the security tabs (OTP codes, JWT sessions, IP bans).
 * No React or DOM here, so the logic is covered by node:test
 * (tests/admin-security-tabs.test.cjs).
 */

/** Page sizes offered by every security tab. The OTP list API caps at 100. */
export const PAGE_SIZES = Object.freeze([10, 25, 50, 100]);

/** The server never returns more than this many OTP codes per request. */
export const OTP_MAX_PAGE_SIZE = 100;

/**
 * @param {unknown} value
 * @returns {Date|null}
 */
const toDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * @param {unknown} value - Date, ISO string or epoch ms
 * @param {number} [now]
 * @returns {boolean} true when the value is a valid date in the past
 */
export const isPast = (value, now = Date.now()) => {
  const date = toDate(value);
  return date ? date.getTime() < now : false;
};

/**
 * Number of pages for a list, never below 1.
 * @param {number} total
 * @param {number} pageSize
 */
export const getPageCount = (total, pageSize) => {
  const size = Number(pageSize) > 0 ? Number(pageSize) : 10;
  const count = Number(total) > 0 ? Number(total) : 0;
  return Math.max(1, Math.ceil(count / size));
};

/**
 * Keeps a page number inside 1..pageCount (after filtering or deleting the
 * last row of a page).
 * @param {number} page
 * @param {number} pageCount
 */
export const clampPage = (page, pageCount) => {
  const last = Math.max(1, Math.floor(Number(pageCount)) || 1);
  const current = Math.floor(Number(page)) || 1;
  return Math.min(Math.max(1, current), last);
};

/**
 * Rows of one page.
 * @template T
 * @param {T[]} rows
 * @param {number} page - already clamped
 * @param {number} pageSize
 * @returns {T[]}
 */
export const paginate = (rows, page, pageSize) => {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
};

/**
 * Page links with ellipses, like the Strapi content manager: first, last,
 * the active page and `siblings` pages on each side.
 *
 *   getPageItems(5, 10) -> [1, 'dots-start', 4, 5, 6, 'dots-end', 10]
 *
 * @param {number} activePage
 * @param {number} pageCount
 * @param {number} [siblings=1]
 * @returns {Array<number|'dots-start'|'dots-end'>}
 */
export const getPageItems = (activePage, pageCount, siblings = 1) => {
  const last = Math.max(1, Math.floor(pageCount) || 1);
  const active = clampPage(activePage, last);
  // first + last + active + 2*siblings + 2 dots
  const slots = siblings * 2 + 5;
  if (last <= slots) return Array.from({ length: last }, (_, index) => index + 1);

  const left = Math.max(active - siblings, 2);
  const right = Math.min(active + siblings, last - 1);
  const showLeftDots = left > 3;
  const showRightDots = right < last - 2;

  if (!showLeftDots) {
    const end = 3 + siblings * 2;
    return [...Array.from({ length: end }, (_, index) => index + 1), 'dots-end', last];
  }
  if (!showRightDots) {
    const start = last - (2 + siblings * 2);
    return [
      1,
      'dots-start',
      ...Array.from({ length: last - start + 1 }, (_, index) => start + index),
    ];
  }
  return [
    1,
    'dots-start',
    ...Array.from({ length: right - left + 1 }, (_, index) => left + index),
    'dots-end',
    last,
  ];
};

/* ------------------------------------------------------------------ */
/* JWT sessions                                                        */
/* ------------------------------------------------------------------ */

/**
 * Derived session state. A revoked session stays "revoked" even after expiry.
 * @param {{revoked?: boolean, isExpired?: boolean, expiresAt?: unknown}} session
 * @param {number} [now]
 * @returns {'revoked'|'expired'|'active'}
 */
export const getSessionStatus = (session, now = Date.now()) => {
  if (session?.revoked) return 'revoked';
  if (session?.isExpired || isPast(session?.expiresAt, now)) return 'expired';
  return 'active';
};

/** Sort order of the derived states (ascending). */
const SESSION_STATUS_RANK = Object.freeze({ active: 0, expired: 1, revoked: 2 });

/**
 * @param {Array<object>} sessions
 * @param {number} [now]
 */
export const getSessionStats = (sessions, now = Date.now()) => {
  const stats = { total: 0, active: 0, expired: 0, revoked: 0 };
  for (const session of sessions || []) {
    stats.total += 1;
    stats[getSessionStatus(session, now)] += 1;
  }
  return stats;
};

/**
 * Case-insensitive search over email, username and IP, plus a status filter.
 * Never mutates the input.
 * @param {Array<object>} sessions
 * @param {{query?: string, status?: 'all'|'active'|'expired'|'revoked', now?: number}} options
 */
export const filterSessions = (sessions, { query = '', status = 'all', now = Date.now() } = {}) => {
  const needle = String(query || '')
    .trim()
    .toLowerCase();
  return (sessions || []).filter((session) => {
    if (status !== 'all' && getSessionStatus(session, now) !== status) return false;
    if (!needle) return true;
    return [session.email, session.username, session.ipAddress].some(
      (value) => typeof value === 'string' && value.toLowerCase().includes(needle)
    );
  });
};

/**
 * Returns a sorted copy. Supported keys: 'username', 'status', 'createdAt',
 * 'expiresAt'. Empty values sort last in both directions.
 * @param {Array<object>} sessions
 * @param {string} sortBy
 * @param {'asc'|'desc'} order
 * @param {number} [now]
 */
export const sortSessions = (sessions, sortBy, order, now = Date.now()) => {
  const direction = order === 'asc' ? 1 : -1;
  const valueOf = (session) => {
    switch (sortBy) {
      case 'status':
        return SESSION_STATUS_RANK[getSessionStatus(session, now)];
      case 'createdAt':
      case 'expiresAt': {
        const date = toDate(session?.[sortBy]);
        return date ? date.getTime() : null;
      }
      case 'username': {
        const name = session?.username || session?.email;
        return typeof name === 'string' && name ? name.toLowerCase() : null;
      }
      default:
        return null;
    }
  };

  return [...(sessions || [])].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (typeof left === 'string' && typeof right === 'string') {
      return left.localeCompare(right) * direction;
    }
    return (left < right ? -1 : 1) * direction;
  });
};

/* ------------------------------------------------------------------ */
/* OTP codes                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {{used?: boolean, expiresAt?: unknown}} code
 * @param {number} [now]
 * @returns {'used'|'expired'|'active'}
 */
export const getOtpStatus = (code, now = Date.now()) => {
  if (code?.used) return 'used';
  if (isPast(code?.expiresAt, now)) return 'expired';
  return 'active';
};

/**
 * Identifier the admin API expects for DELETE /otp/codes/:id. Strapi 5
 * deletes by documentId; the numeric id is only a fallback for old servers.
 * @param {{documentId?: string, id?: number|string}} code
 * @returns {string|null}
 */
export const getOtpDeleteId = (code) => {
  if (typeof code?.documentId === 'string' && code.documentId) return code.documentId;
  if (code?.id !== undefined && code?.id !== null && code.id !== '') return String(code.id);
  return null;
};

/**
 * Short, non-secret reference for a code row (the stored code is a hash and
 * is never shown). Uses the documentId suffix, like the Tokens tab.
 * @param {{documentId?: string, id?: number|string}} code
 */
export const getOtpReference = (code) => {
  const source = typeof code?.documentId === 'string' && code.documentId ? code.documentId : '';
  if (source) return source.slice(-8).toUpperCase();
  return code?.id !== undefined && code?.id !== null ? `#${code.id}` : '-';
};

/**
 * Query parameters for GET /otp/codes. Search goes to the server as `email`
 * and the status as `status` (omitted for "all").
 * @param {{page: number, pageSize: number, search?: string, status?: string}} options
 */
export const buildOtpQuery = ({ page, pageSize, search = '', status = 'all' }) => {
  const params = {
    page: Math.max(1, Math.floor(Number(page)) || 1),
    pageSize: Math.min(OTP_MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(pageSize)) || 10)),
  };
  const email = String(search || '').trim();
  if (email) params.email = email.slice(0, 320);
  if (status && status !== 'all') params.status = status;
  return params;
};

const toIsoOrNull = (value) => {
  const date = toDate(value);
  return date ? date.toISOString() : null;
};

/**
 * Keeps only the display fields of an OTP row. The stored `code` hash and
 * any `magicLinkToken` never reach React state.
 * @param {object} code
 */
export const normalizeOtpCode = (code = {}) => ({
  id: code.id,
  documentId: code.documentId,
  email: typeof code.email === 'string' ? code.email : '',
  type: typeof code.type === 'string' ? code.type : 'email',
  used: Boolean(code.used),
  attempts: Number.isFinite(Number(code.attempts)) ? Number(code.attempts) : 0,
  createdAt: toIsoOrNull(code.createdAt ?? code.created_at),
  expiresAt: toIsoOrNull(code.expiresAt ?? code.expires_at),
});

const toCount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
};

/**
 * Normalises the GET /otp/codes response.
 *
 * - The pagination meta is recomputed from the effective page size (the
 *   server caps it at 100), so pageCount is always right.
 * - When the server does not filter by status yet, the status filter is
 *   applied to the returned rows as a fallback.
 * - `stats` comes from the server when it sends one; otherwise it is computed
 *   locally only if the response holds the complete, unfiltered list.
 *   `null` means "unknown" and the UI shows a dash.
 *
 * @param {any} data
 * @param {{page: number, pageSize: number, status?: string, filtersActive?: boolean, now?: number}} request
 */
export const normalizeOtpListResponse = (
  data,
  { page, pageSize, status = 'all', filtersActive = false, now = Date.now() }
) => {
  const rawCodes = Array.isArray(data?.codes)
    ? data.codes
    : Array.isArray(data?.data)
      ? data.data
      : [];
  const allRows = rawCodes.map(normalizeOtpCode);
  const codes =
    status && status !== 'all'
      ? allRows.filter((code) => getOtpStatus(code, now) === status)
      : allRows;

  const meta = data?.pagination || data?.meta?.pagination || {};
  const effectivePageSize = Math.min(
    OTP_MAX_PAGE_SIZE,
    toCount(meta.pageSize) || toCount(pageSize) || 10,
    toCount(pageSize) || OTP_MAX_PAGE_SIZE
  );
  const total = toCount(meta.total) ?? allRows.length;
  const pageCount = getPageCount(total, effectivePageSize);

  let stats = null;
  if (data?.stats && typeof data.stats === 'object') {
    stats = {
      total: toCount(data.stats.total),
      active: toCount(data.stats.active),
      expired: toCount(data.stats.expired),
      used: toCount(data.stats.used),
    };
  } else if (!filtersActive && total <= allRows.length) {
    stats = { total: allRows.length, active: 0, expired: 0, used: 0 };
    for (const code of allRows) stats[getOtpStatus(code, now)] += 1;
  }

  return {
    codes,
    pagination: {
      page: clampPage(toCount(meta.page) || page, pageCount),
      pageSize: effectivePageSize,
      total,
      pageCount,
    },
    stats,
  };
};

/* ------------------------------------------------------------------ */
/* IP bans                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {string[]} ips
 * @param {string} query
 */
export const filterIps = (ips, query = '') => {
  const needle = String(query || '')
    .trim()
    .toLowerCase();
  const list = (ips || []).filter((ip) => typeof ip === 'string' && ip);
  return needle ? list.filter((ip) => ip.toLowerCase().includes(needle)) : list;
};

/**
 * @param {string[]} ips
 * @returns {{total: number, ipv4: number, ipv6: number}}
 */
export const getIpStats = (ips) => {
  const stats = { total: 0, ipv4: 0, ipv6: 0 };
  for (const ip of ips || []) {
    if (typeof ip !== 'string' || !ip) continue;
    stats.total += 1;
    if (ip.includes(':')) stats.ipv6 += 1;
    else stats.ipv4 += 1;
  }
  return stats;
};

/* ------------------------------------------------------------------ */
/* Bulk actions                                                        */
/* ------------------------------------------------------------------ */

/**
 * Summarises Promise.allSettled results of a bulk action.
 * @param {Array<string|number>} ids - in the same order as `results`
 * @param {PromiseSettledResult<unknown>[]} results
 */
export const summarizeSettled = (ids, results) => {
  const succeededIds = [];
  const failedIds = [];
  results.forEach((result, index) => {
    const ok = result.status === 'fulfilled' && result.value?.data?.success !== false;
    (ok ? succeededIds : failedIds).push(ids[index]);
  });
  return {
    total: ids.length,
    succeeded: succeededIds.length,
    failed: failedIds.length,
    succeededIds,
    failedIds,
  };
};

/**
 * Select-all checkbox state for the visible rows.
 * @param {Array<string|number>} visibleIds
 * @param {Array<string|number>} selectedIds
 * @returns {boolean|'indeterminate'}
 */
export const getSelectAllState = (visibleIds, selectedIds) => {
  if (!visibleIds.length) return false;
  const selected = new Set(selectedIds);
  const count = visibleIds.filter((id) => selected.has(id)).length;
  if (count === 0) return false;
  return count === visibleIds.length ? true : 'indeterminate';
};
