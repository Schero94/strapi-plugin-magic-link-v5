'use strict';

/**
 * In-memory Strapi double for the MFA tests (OTP codes, authenticator
 * enrolments, backup codes). Synthetic data only: no network, no real mail,
 * no database. Implements the subset of the query engine the OTP service
 * uses (where with $gt/$lt/$null/$notNull/$in/$containsi, orderBy, limit,
 * offset, create, findOne, findMany, count, updateMany, deleteMany).
 */

const nodeCrypto = require('node:crypto');

/**
 * Sets synthetic secrets for the crypto utilities (never printed).
 */
const useTestSecrets = () => {
  if (!process.env.MAGIC_LINK_ENCRYPTION_KEY) {
    process.env.MAGIC_LINK_ENCRYPTION_KEY = nodeCrypto.randomBytes(32).toString('hex');
  }
  if (!process.env.MAGIC_LINK_OTP_PEPPER) {
    process.env.MAGIC_LINK_OTP_PEPPER = nodeCrypto.randomBytes(32).toString('hex');
  }
};

const toComparable = (value) => (value instanceof Date ? value.getTime() : value);

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === '$or') return condition.some((sub) => matches(row, sub));
    const value = row[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('$gt' in condition) return new Date(value).getTime() > new Date(condition.$gt).getTime();
      if ('$lt' in condition) return new Date(value).getTime() < new Date(condition.$lt).getTime();
      if ('$null' in condition) return (value === null || value === undefined) === condition.$null;
      if ('$notNull' in condition) return (value !== null && value !== undefined) === condition.$notNull;
      if ('$in' in condition) return condition.$in.includes(value);
      if ('$containsi' in condition) {
        return String(value || '').toLowerCase().includes(String(condition.$containsi).toLowerCase());
      }
      throw new Error(`Unsupported operator in ${JSON.stringify(condition)}`);
    }
    if (condition === null) return value === null || value === undefined;
    return toComparable(value) === toComparable(condition);
  });

const clone = (row) => (row ? structuredClone(row) : row);

/**
 * Creates one in-memory table with the query-engine subset.
 *
 * @param {object[]} [rows] - Initial rows.
 * @returns {object} Table with `rows` and `api`.
 */
const createTable = (rows = []) => {
  const table = { rows: rows.map((row) => ({ ...row })), nextId: 1, calls: [] };
  table.nextId = table.rows.reduce((max, row) => Math.max(max, row.id || 0), 0) + 1;
  const select = (params = {}) => {
    let result = table.rows.filter((row) => matches(row, params.where));
    const orderBy = params.orderBy;
    if (orderBy) {
      const [[field, direction]] = Object.entries(orderBy);
      result = [...result].sort((a, b) => {
        const left = toComparable(a[field] instanceof Date ? a[field] : a[field]);
        const right = toComparable(b[field]);
        const cmp = left < right ? -1 : left > right ? 1 : 0;
        return direction === 'desc' ? -cmp : cmp;
      });
    }
    const offset = params.offset || 0;
    return result.slice(offset, params.limit ? offset + params.limit : undefined);
  };
  table.api = {
    findMany: async (params) => {
      table.calls.push({ op: 'findMany', params });
      return select(params).map(clone);
    },
    findOne: async (params) => clone(select({ ...params, limit: 1 })[0] || null),
    count: async (params) => table.rows.filter((row) => matches(row, params?.where)).length,
    create: async ({ data }) => {
      const now = new Date();
      const row = {
        id: table.nextId,
        documentId: `doc${table.nextId}`,
        createdAt: new Date(now.getTime() + table.nextId),
        updatedAt: now,
        ...structuredClone(data),
      };
      table.nextId += 1;
      table.rows.push(row);
      return clone(row);
    },
    updateMany: async ({ where, data }) => {
      table.calls.push({ op: 'updateMany', where, data });
      const hit = table.rows.filter((row) => matches(row, where));
      hit.forEach((row) => Object.assign(row, structuredClone(data)));
      return { count: hit.length };
    },
    deleteMany: async ({ where }) => {
      const before = table.rows.length;
      table.rows = table.rows.filter((row) => !matches(row, where));
      return { count: before - table.rows.length };
    },
  };
  return table;
};

/**
 * Builds the fake Strapi instance for the OTP service and installs it as
 * global.strapi.
 *
 * @param {object} [options] - { settings, otpCodes, totpConfigs, adminUsers, upUsers }.
 * @returns {object} { strapi, tables, mails, logs }.
 */
const createMfaStrapi = ({ settings = {}, otpCodes = [], totpConfigs = [], adminUsers = [], upUsers = [] } = {}) => {
  const tables = {
    'plugin::magic-link.otp-code': createTable(otpCodes),
    'plugin::magic-link.totp-config': createTable(totpConfigs),
    'admin::user': createTable(adminUsers),
    'plugin::users-permissions.user': createTable(upUsers),
  };
  const mails = [];
  const logs = [];
  const store = { settings: { ...settings } };
  const services = {};
  const strapi = {
    store: () => ({
      get: async ({ key }) => store[key] ?? null,
      set: async ({ key, value }) => {
        store[key] = value;
      },
    }),
    db: {
      query(uid) {
        if (!tables[uid]) throw new Error(`Unexpected query ${uid}`);
        return tables[uid].api;
      },
    },
    plugin(name) {
      if (name === 'email') return { service: () => ({ send: async (mail) => mails.push(mail) }) };
      if (name === 'magic-link') return { service: (key) => services[key] };
      return undefined;
    },
    log: Object.fromEntries(
      ['debug', 'info', 'warn', 'error'].map((level) => [level, (...parts) => logs.push(parts.map(String).join(' '))])
    ),
  };
  global.strapi = strapi;
  return { strapi, tables, mails, logs, store, services };
};

module.exports = { createMfaStrapi, createTable, matches, useTestSecrets };
