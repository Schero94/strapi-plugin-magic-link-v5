'use strict';

/**
 * In-memory Strapi double for the login-core tests. Only synthetic data; no
 * network, no real mail, no database.
 */

const createMagicLinkService = require('../../server/src/services/magic-link');

const TOKEN_UID = 'plugin::magic-link.token';
const USER_UID = 'plugin::users-permissions.user';
const ROLE_UID = 'plugin::users-permissions.role';

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const DURATION = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * Creates an unsigned JWT-shaped string with an exp claim (test only).
 *
 * @param {object} payload - Claims.
 * @param {string} [expiresIn] - e.g. '2h'.
 * @returns {string} Fake JWT.
 */
const fakeJwt = (payload, expiresIn = '30d') => {
  const match = /^(\d+)([smhd])$/.exec(expiresIn);
  const seconds = match ? Number(match[1]) * DURATION[match[2]] : 30 * 86400;
  const iat = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none' })}.${b64({ ...payload, iat, exp: iat + seconds })}.sig${Math.random().toString(36).slice(2)}`;
};

const matchesWhere = (row, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === '$or') return condition.some((sub) => matchesWhere(row, sub));
    const value = row[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('$gt' in condition) return new Date(value).getTime() > new Date(condition.$gt).getTime();
      if ('$lt' in condition) return new Date(value).getTime() < new Date(condition.$lt).getTime();
      if ('$null' in condition) return (value === null || value === undefined) === condition.$null;
    }
    return value === condition;
  });

/**
 * Builds the fake Strapi instance and installs it as global.strapi.
 *
 * @param {object} [options] - Fixture options.
 * @returns {object} Handles for assertions.
 */
const createLoginCoreStrapi = ({
  settings = {},
  advanced = { default_role: 'authenticated', allow_register: false, email_confirmation: false },
  users = [],
  config = {},
  totp = {},
  rateLimit = { allowed: true },
} = {}) => {
  const state = {
    tokens: [],
    users: users.map((user) => ({ ...user })),
    stores: {
      'magic-link': { settings: { ...settings } },
      'users-permissions': { advanced: { ...advanced } },
    },
    mails: [],
    otpMails: [],
    otpCreated: [],
    issued: [],
    upSessions: [],
    revokedUpSessions: [],
    cookies: [],
    edits: [],
    logs: [],
    totpVerifications: [],
  };
  let nextId = 1;

  const tokenDocs = {
    findMany: async ({ filters = {} } = {}) =>
      state.tokens.filter((row) => matchesWhere(row, filters)).map((row) => ({ ...row })),
    create: async ({ data }) => {
      const row = {
        id: nextId,
        documentId: `token-${nextId}`,
        createdAt: new Date().toISOString(),
        ...data,
      };
      nextId += 1;
      state.tokens.push(row);
      return { ...row };
    },
    update: async ({ documentId, data }) => {
      const row = state.tokens.find((candidate) => candidate.documentId === documentId);
      if (row) Object.assign(row, data);
      return row ? { ...row } : null;
    },
  };

  const userDocs = {
    findMany: async ({ filters = {} } = {}) =>
      state.users.filter((row) => matchesWhere(row, filters)).map((row) => ({ ...row })),
    findOne: async ({ documentId }) => {
      const row = state.users.find((candidate) => candidate.documentId === documentId);
      return row ? { ...row } : null;
    },
    create: async ({ data }) => {
      const id = 100 + state.users.length;
      const row = { id, documentId: `user-${id}`, ...data };
      state.users.push(row);
      return { ...row };
    },
  };

  const configValues = {
    'api.rest.prefix': '/api',
    'server.url': 'http://localhost:1337',
    ...config,
  };

  const otpService = {
    getTOTPStatus: async (userId) => totp[userId] || { configured: false, enabled: false },
    verifyTOTP: async (userId, code) => {
      state.totpVerifications.push({ userId, code });
      return { valid: code === '123456' && Boolean(totp[userId]?.enabled) };
    },
    verifySecondFactor: async (userId, { totpCode, backupCode } = {}) => {
      state.totpVerifications.push({ userId, code: totpCode, backupCode });
      if (backupCode) return { valid: false };
      return { valid: totpCode === '123456' && Boolean(totp[userId]?.enabled), method: 'totp' };
    },
    simulateVerification: async () => {},
    createOTP: async (email, type, options) => {
      state.otpCreated.push({ email, type, options });
      return { code: '654321' };
    },
    sendOTPEmail: async (email) => {
      state.otpMails.push(email);
    },
  };

  const strapi = {
    config: { get: (key, fallback) => (key in configValues ? configValues[key] : fallback) },
    store: ({ name }) => ({
      get: async ({ key }) => state.stores[name]?.[key] ?? null,
      set: async ({ key, value }) => {
        state.stores[name] = state.stores[name] || {};
        state.stores[name][key] = JSON.parse(JSON.stringify(value));
      },
    }),
    documents(uid) {
      if (uid === TOKEN_UID) return tokenDocs;
      if (uid === USER_UID) return userDocs;
      if (uid === ROLE_UID) return { findMany: async () => [{ id: 1, type: 'authenticated' }] };
      throw new Error(`Unexpected document ${uid}`);
    },
    db: {
      query(uid) {
        if (uid !== TOKEN_UID) throw new Error(`Unexpected query ${uid}`);
        return {
          updateMany: async ({ where, data }) => {
            const rows = state.tokens.filter((row) => matchesWhere(row, where));
            rows.forEach((row) =>
              Object.assign(row, JSON.parse(JSON.stringify(data)), {
                ...(data.used_at instanceof Date ? { used_at: data.used_at } : {}),
              })
            );
            return { count: rows.length };
          },
          deleteMany: async ({ where }) => {
            const before = state.tokens.length;
            state.tokens = state.tokens.filter((row) => !matchesWhere(row, where));
            return { count: before - state.tokens.length };
          },
        };
      },
    },
    getModel: (uid) =>
      uid === USER_UID
        ? {
            uid,
            attributes: {
              password: { private: true },
              resetPasswordToken: { private: true },
              confirmationToken: { private: true },
              internalNote: { private: true },
            },
          }
        : null,
    contentAPI: {
      sanitize: {
        output: async (entity, model) =>
          Object.fromEntries(
            Object.entries(entity).filter(([key]) => !model.attributes[key]?.private)
          ),
      },
    },
    sessionManager: (origin) => {
      if (origin !== 'users-permissions') throw new Error('unexpected origin');
      return {
        generateRefreshToken: async (userId, deviceId, options) => {
          const sessionId = `up-session-${state.upSessions.length + 1}`;
          state.upSessions.push({ userId, deviceId, options, sessionId });
          return {
            token: `refresh-${sessionId}`,
            sessionId,
            absoluteExpiresAt: new Date(Date.now() + 86400000).toISOString(),
          };
        },
        generateAccessToken: async (refreshToken) => ({
          token: fakeJwt({ refreshToken, type: 'access' }, '10m'),
        }),
        revokeSessionById: async (userId, sessionId) => {
          state.revokedUpSessions.push({ userId, sessionId });
          return true;
        },
      };
    },
    plugin(name) {
      if (name === 'magic-link') {
        return {
          service: (key) =>
            ({
              'magic-link': magicLinkService,
              otp: otpService,
              'rate-limiter': { checkRateLimit: async () => rateLimit },
            })[key],
        };
      }
      if (name === 'users-permissions') {
        return {
          service: (key) =>
            key === 'jwt'
              ? {
                  issue: (payload, options = {}) => {
                    state.issued.push({ payload, options });
                    return fakeJwt(payload, options.expiresIn);
                  },
                }
              : {
                  edit: async (id, data) => {
                    state.edits.push({ id, data });
                    const row = state.users.find((u) => u.id === id);
                    if (row) Object.assign(row, data);
                  },
                },
        };
      }
      if (name === 'email') {
        return {
          service: () => ({
            send: async (mail) => {
              state.mails.push(mail);
            },
          }),
        };
      }
      return undefined;
    },
    log: Object.fromEntries(
      ['debug', 'info', 'warn', 'error'].map((level) => [
        level,
        (...parts) => state.logs.push(`${level}: ${parts.map(String).join(' ')}`),
      ])
    ),
  };

  const magicLinkService = createMagicLinkService({ strapi });
  global.strapi = strapi;
  return {
    strapi,
    state,
    magicLinkService,
    setConfig: (key, value) => {
      configValues[key] = value;
    },
  };
};

/**
 * Builds a Koa-like context.
 *
 * @param {object} [options] - Request parts.
 * @returns {object} Context.
 */
const createCtx = ({
  method = 'GET',
  query = {},
  body,
  headers = {},
  path = '/api/magic-link/login',
} = {}) => {
  const responseHeaders = {};
  const cookies = [];
  return {
    method,
    path,
    query,
    state: {},
    request: {
      body,
      ip: '192.0.2.10',
      header: { 'user-agent': 'synthetic-agent', ...headers },
      headers: { 'user-agent': 'synthetic-agent', ...headers },
    },
    responseHeaders,
    cookies: {
      set: (name, value, options) => cookies.push({ name, value, options }),
      list: cookies,
    },
    set(name, value) {
      responseHeaders[name] = value;
    },
    send(payload) {
      this.status = this.status || 200;
      this.body = payload;
      return payload;
    },
  };
};

module.exports = { createLoginCoreStrapi, createCtx, fakeJwt };
