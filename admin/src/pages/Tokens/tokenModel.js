/**
 * Pure helpers for the Magic Link tokens view (no React, no DS imports), so
 * they can be unit tested under node:test.
 *
 * Token state is derived from the stored attributes only. The token content
 * type has no `status` attribute (server/src/content-types/token/schema.json):
 *
 * | state     | rule                                                |
 * |-----------|-----------------------------------------------------|
 * | used      | is_active === false and is_used === true            |
 * | blocked   | is_active === false and is_used !== true            |
 * | expired   | is_active === true and expires_at in the past       |
 * | active    | is_active === true and not expired                  |
 */

export const TOKEN_STATES = Object.freeze(['active', 'expired', 'used', 'blocked']);
export const STATUS_FILTERS = Object.freeze(['all', ...TOKEN_STATES]);
export const PAGE_SIZES = Object.freeze([10, 25, 50, 100]);

/**
 * Login e-mail outcome per token (server/src/utils/delivery-status.js).
 * `bounced` and `complained` arrive later from provider feedback
 * (server/src/services/delivery-feedback.js). `unknown` covers tokens issued
 * without e-mail and rows from before 6.x delivery tracking (delivery_status
 * is empty).
 */
export const DELIVERY_STATES = Object.freeze([
  'sent',
  'rejected',
  'failed',
  'bounced',
  'complained',
  'unknown',
]);
const KNOWN_DELIVERY = new Set(DELIVERY_STATES.filter((state) => state !== 'unknown'));
export const DELIVERY_FILTERS = Object.freeze(['all', ...DELIVERY_STATES]);

/** Admin-chosen link lifetime in hours (create form). The server applies the same bound. */
export const TTL_LIMITS = Object.freeze({ min: 1, max: 720 });
/** Extension in days (extend form). The server applies the same bound. */
export const EXTEND_LIMITS = Object.freeze({ min: 1, max: 365 });
export const EXTEND_PRESETS = Object.freeze([1, 7, 30, 90]);

/**
 * Context keys the server owns (challenge state, expiry and user data written
 * by tokens.create and login). They are never sent back from the admin UI.
 */
export const RESERVED_CONTEXT_KEYS = Object.freeze([
  'otpVerified',
  'totpVerified',
  'mfaVerified',
  'requiresOTP',
  'requiresTOTP',
  'userId',
  'userDocumentId',
  'user',
  'ttl',
  'expires_at',
  'expiry_formatted',
  'challenge',
]);

const RESERVED_LOOKUP = new Set(RESERVED_CONTEXT_KEYS.map((key) => key.toLowerCase()));

/**
 * @param {unknown} value - Date, ISO string or epoch milliseconds
 * @returns {Date|null}
 */
export const toDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * @param {unknown} value
 * @param {number} [now]
 * @returns {boolean} true when the value is a valid date in the past
 */
export const isPast = (value, now = Date.now()) => {
  const date = toDate(value);
  return date ? date.getTime() < now : false;
};

/**
 * Normalises one token from GET /magic-link/tokens (SQLite returns 0/1 booleans).
 * @param {object} token
 */
export const normalizeToken = (token = {}) => {
  const iso = (value) => toDate(value)?.toISOString() ?? null;
  return {
    ...token,
    is_active: Boolean(token.is_active),
    is_used: Boolean(token.is_used),
    createdAt: iso(token.createdAt ?? token.created_at),
    expires_at: iso(token.expires_at),
    used_at: iso(token.used_at),
    last_used_at: iso(token.last_used_at),
    delivery_updated_at: iso(token.delivery_updated_at),
  };
};

/**
 * @param {object} token
 * @returns {'sent'|'rejected'|'failed'|'bounced'|'complained'|'unknown'}
 */
export const getDeliveryState = (token) => {
  const status = token?.delivery_status;
  return KNOWN_DELIVERY.has(status) ? status : 'unknown';
};

/**
 * @param {object} token - normalised token
 * @param {number} [now]
 * @returns {'active'|'expired'|'used'|'blocked'}
 */
export const getTokenState = (token, now = Date.now()) => {
  if (!token?.is_active) return token?.is_used ? 'used' : 'blocked';
  return isPast(token.expires_at, now) ? 'expired' : 'active';
};

/**
 * Which actions a token offers, derived from its state.
 * @param {object} token
 * @param {number} [now]
 */
export const getTokenActions = (token, now = Date.now()) => {
  const state = getTokenState(token, now);
  return {
    state,
    canExtend: (state === 'active' || state === 'expired') && !token?.is_used,
    canBlock: state === 'active' || state === 'expired',
    canActivate: state === 'blocked',
    canReissue: state !== 'active',
  };
};

/** Stable id used for API calls: documentId first (Strapi 5), numeric id as fallback. */
export const getTokenKey = (token) => String(token?.documentId ?? token?.id ?? '');

/** Short, non-secret reference shown in the table (last 8 chars of the documentId). */
export const getTokenReference = (token) =>
  token?.documentId ? String(token.documentId).slice(-8) : String(token?.id ?? '');

/**
 * @param {object[]} tokens
 * @param {number} [now]
 */
export const computeTokenStats = (tokens = [], now = Date.now()) => {
  const stats = { total: tokens.length, active: 0, expired: 0, used: 0, blocked: 0 };
  for (const token of tokens) stats[getTokenState(token, now)] += 1;
  return stats;
};

/**
 * Case-insensitive search over email, reference and login IP.
 * @param {object} token
 * @param {string} query
 */
export const matchesSearch = (token, query) => {
  const needle = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!needle) return true;
  return [token?.email, getTokenReference(token), token?.documentId, token?.ip_address]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
};

const STATE_RANK = Object.freeze({ active: 0, expired: 1, used: 2, blocked: 3 });

/**
 * @param {object} token
 * @param {string} field - 'email' | 'status' | 'createdAt' | 'expires_at'
 * @param {number} now
 */
const sortValue = (token, field, now) => {
  if (field === 'status') return STATE_RANK[getTokenState(token, now)];
  if (field === 'createdAt' || field === 'expires_at') {
    return toDate(token?.[field])?.getTime() ?? Number.NEGATIVE_INFINITY;
  }
  return String(token?.[field] ?? '').toLowerCase();
};

/**
 * Filters and sorts without mutating the input array.
 * @param {object[]} tokens
 * @param {{search?: string, status?: string, delivery?: string, sortBy?: string, sortOrder?: 'asc'|'desc', now?: number}} options
 */
export const filterAndSortTokens = (
  tokens = [],
  {
    search = '',
    status = 'all',
    delivery = 'all',
    sortBy = 'createdAt',
    sortOrder = 'desc',
    now = Date.now(),
  } = {}
) => {
  const direction = sortOrder === 'asc' ? 1 : -1;
  return tokens
    .filter((token) => matchesSearch(token, search))
    .filter((token) => status === 'all' || getTokenState(token, now) === status)
    .filter((token) => delivery === 'all' || getDeliveryState(token) === delivery)
    .map((token, index) => ({ token, index, value: sortValue(token, sortBy, now) }))
    .sort((a, b) => {
      if (a.value === b.value) return a.index - b.index;
      return a.value > b.value ? direction : -direction;
    })
    .map(({ token }) => token);
};

/**
 * @param {number} page
 * @param {number} pageCount
 * @returns {number} page clamped to 1..max(1, pageCount)
 */
export const clampPage = (page, pageCount) => {
  const last = Math.max(1, Math.floor(Number(pageCount) || 0));
  const current = Math.floor(Number(page) || 1);
  return Math.min(Math.max(1, current), last);
};

/**
 * Page links with ellipses: first, last, and one neighbour on each side of the
 * active page. Example (5 of 12): [1, 'dots', 4, 5, 6, 'dots', 12].
 * @param {number} activePage
 * @param {number} pageCount
 * @returns {Array<number|'dots'>}
 */
export const getPaginationItems = (activePage, pageCount) => {
  const last = Math.max(1, Math.floor(Number(pageCount) || 0));
  const active = clampPage(activePage, last);
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);

  const pages = new Set([1, last, active - 1, active, active + 1]);
  if (active <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (active >= last - 2) [last - 3, last - 2, last - 1].forEach((p) => pages.add(p));

  const sorted = [...pages].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
  const items = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) items.push('dots');
    items.push(page);
  });
  return items;
};

/**
 * Keyboard activation for buttons in a table cell that holds several buttons.
 *
 * DS 2.2.4 RawCell calls preventDefault() on every keydown in such a cell (it
 * moves focus between the buttons with the arrow keys), which also cancels
 * the native Enter and Space activation of the focused button. Run the action
 * here instead; the cell then only handles the arrow keys.
 *
 * @param {() => void} action
 * @returns {(event: import('react').KeyboardEvent) => void}
 */
export const activateOnEnterOrSpace = (action) => (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  if (!event.repeat) action();
};

/**
 * Removes server-owned keys (see RESERVED_CONTEXT_KEYS) from a token context.
 * @param {unknown} context
 * @returns {Record<string, unknown>}
 */
export const toUserContext = (context) => {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return {};
  return Object.fromEntries(
    Object.entries(context).filter(([key]) => !RESERVED_LOOKUP.has(key.toLowerCase()))
  );
};

/**
 * Parses the optional JSON context typed in the create form.
 * @param {string} text
 * @returns {{ok: true, value: Record<string, unknown>, reservedKeys: string[]} | {ok: false, error: 'json'|'object'|'reserved', reservedKeys: string[]}}
 */
export const parseContextInput = (text) => {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { ok: true, value: {}, reservedKeys: [] };
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'json', reservedKeys: [] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'object', reservedKeys: [] };
  }
  const reservedKeys = Object.keys(parsed).filter((key) => RESERVED_LOOKUP.has(key.toLowerCase()));
  if (reservedKeys.length > 0) return { ok: false, error: 'reserved', reservedKeys };
  return { ok: true, value: parsed, reservedKeys: [] };
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @param {string} value */
export const isValidEmail = (value) => {
  const email = String(value ?? '').trim();
  return email.length > 0 && email.length <= 254 && EMAIL_PATTERN.test(email);
};

/**
 * Validates the create-token form.
 * @param {{email?: string, ttl?: number, contextText?: string}} form
 * @returns {{errors: {email?: 'required'|'format', ttl?: 'range', context?: 'json'|'object'|'reserved'}, context: Record<string, unknown>, reservedKeys: string[]}}
 */
export const validateCreateForm = (form = {}) => {
  const errors = {};
  const email = String(form.email ?? '').trim();
  if (!email) errors.email = 'required';
  else if (!isValidEmail(email)) errors.email = 'format';
  if (!isIntegerInRange(form.ttl, TTL_LIMITS)) errors.ttl = 'range';
  const parsed = parseContextInput(form.contextText);
  if (!parsed.ok) errors.context = parsed.error;
  return { errors, context: parsed.ok ? parsed.value : {}, reservedKeys: parsed.reservedKeys };
};

/**
 * @param {unknown} value
 * @param {{min: number, max: number}} limits
 * @returns {boolean} true for an integer within the limits
 */
export const isIntegerInRange = (value, { min, max }) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/**
 * Default TTL in hours from the settings expire_period (seconds), clamped to TTL_LIMITS.
 * @param {unknown} expirePeriodSeconds
 * @param {number} [fallback]
 */
export const defaultTtlFromSettings = (expirePeriodSeconds, fallback = 24) => {
  const seconds = Number(expirePeriodSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  const hours = Math.round(seconds / 3600);
  return Math.min(TTL_LIMITS.max, Math.max(TTL_LIMITS.min, hours));
};

/**
 * New expiry after extending, mirroring the server: an expired token (or one
 * without expiry) is extended from now, otherwise from its current expiry.
 * @param {unknown} expiresAt
 * @param {number} days
 * @param {number} [now]
 * @returns {Date}
 */
export const computeExtendedExpiry = (expiresAt, days, now = Date.now()) => {
  const current = toDate(expiresAt);
  const base = current && current.getTime() >= now ? new Date(current.getTime()) : new Date(now);
  base.setDate(base.getDate() + days);
  return base;
};

/**
 * The login link for a newly created token. Prefers the server-built
 * `loginUrl` (same helper as the email). Otherwise it mirrors the server's
 * precedence: frontend_url + frontend_login_path, then confirmationUrl, then
 * the API login route on the admin origin.
 *
 * @param {{loginUrl?: string, token?: string, settings?: object|null, origin?: string}} input
 * @returns {string}
 */
export const buildLoginUrl = ({ loginUrl, token, settings, origin } = {}) => {
  if (typeof loginUrl === 'string' && /^https?:\/\//i.test(loginUrl)) return loginUrl;
  if (!token) return '';

  let base = '';
  if (settings?.frontend_url) {
    const path = settings.frontend_login_path || '/auth/magic-link';
    base = `${String(settings.frontend_url).replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
  } else if (settings?.confirmationUrl) {
    base = String(settings.confirmationUrl);
  } else if (origin) {
    base = `${String(origin).replace(/\/+$/, '')}/api/magic-link/login`;
  }
  if (!base) return '';

  try {
    const url = new URL(base);
    url.searchParams.set('loginToken', token);
    return url.toString();
  } catch {
    return '';
  }
};

/**
 * POST /magic-link/tokens body for the create form. `ttl` (hours) is a
 * top-level field; the context carries only user keys.
 * @param {{email: string, ttl: number, context?: object, sendEmail: boolean}} payload
 */
export const buildCreateTokenBody = ({ email, ttl, context, sendEmail }) => ({
  email: String(email ?? '').trim(),
  ttl,
  send_email: sendEmail === true,
  context: toUserContext(context),
});

/**
 * POST /magic-link/tokens body for "New token" from the details dialog:
 * same email, user context only (no stale challenge or expiry keys), the
 * default TTL, and the email is sent (the confirmation dialog says so).
 * @param {{email: string, context?: object}} token
 */
export const buildReissueTokenBody = (token) => ({
  email: token?.email,
  send_email: true,
  context: toUserContext(token?.context),
});

/**
 * Summarises Promise.allSettled results of a bulk action.
 * @param {string[]} ids
 * @param {PromiseSettledResult<unknown>[]} results
 */
export const summarizeBulkResults = (ids, results) => {
  const succeeded = [];
  const failed = [];
  results.forEach((result, index) => {
    (result.status === 'fulfilled' ? succeeded : failed).push(ids[index]);
  });
  return { succeeded, failed, total: ids.length };
};
