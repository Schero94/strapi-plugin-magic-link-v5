'use strict';

/**
 * In-memory double of the Query Engine repository for the JWT session table
 * (`plugin::magic-link.jwt-session`). Implements the calls and `where`
 * operators the session store uses, with the unique constraints of the
 * schema (session_id, jwt_token_hash) and createdAt defaults like the
 * timestamps lifecycle. Only synthetic data. The real database runs in
 * tests/cluster/run.cjs.
 */

const { SESSION_UID, fromRow, toRowData } = require('../../server/src/utils/jwt-session-store');

const UNIQUE = ['sessionId', 'jwtTokenHash'];

/**
 * Comparable value (dates as ms, the rest unchanged).
 *
 * @param {any} value - Column or filter value.
 * @returns {any} Comparable value.
 */
const comparable = (value) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return Date.parse(value);
  return value;
};

/**
 * Query Engine `where` semantics for the operators the store uses.
 *
 * @param {object} row - Stored row.
 * @param {object} [where] - Filter.
 * @returns {boolean} Whether the row matches.
 */
const matches = (row, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === '$or') return condition.some((sub) => matches(row, sub));
    if (key === '$and') return condition.every((sub) => matches(row, sub));
    const value = row[key] ?? null;
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      return Object.entries(condition).every(([op, operand]) => {
        const a = comparable(value);
        const b = comparable(operand);
        switch (op) {
          case '$null':
            return (value === null) === Boolean(operand);
          case '$notNull':
            return (value !== null) === Boolean(operand);
          case '$in':
            return operand.map(comparable).includes(a);
          case '$eq':
            return a === b;
          case '$ne':
            // SQL: `column <> value` is not true for NULL.
            return value !== null && a !== b;
          case '$lt':
            return value !== null && a < b;
          case '$lte':
            return value !== null && a <= b;
          case '$gt':
            return value !== null && a > b;
          case '$gte':
            return value !== null && a >= b;
          default:
            throw new Error(`Unsupported operator ${op}`);
        }
      });
    }
    if (condition === null) return value === null;
    return comparable(value) === comparable(condition);
  });

/**
 * Normalises row data like the database would (dates to ISO strings).
 *
 * @param {object} data - Data to store.
 * @returns {object} Stored data.
 */
const normalise = (data) =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value === undefined ? null : value,
    ])
  );

/**
 * Creates a session table double.
 *
 * @returns {{uid: string, rows: Array<object>, query: object, records: () => Array<object>,
 *   seed: (records: Array<object>) => void, calls: Array<string>}} Table handles.
 */
const createSessionTable = () => {
  const rows = [];
  const calls = [];
  let nextId = 1;

  const assertUnique = (data, ignore) => {
    for (const column of UNIQUE) {
      if (data[column] === null || data[column] === undefined) continue;
      if (rows.some((row) => row !== ignore && row[column] === data[column])) {
        throw new Error(`unique constraint failed: ${column}`);
      }
    }
  };

  const insert = (data) => {
    const now = new Date().toISOString();
    const row = normalise({
      createdAt: now,
      updatedAt: now,
      ...data,
      id: nextId,
      documentId: `jwt-session-${nextId}`,
    });
    assertUnique(row);
    nextId += 1;
    rows.push(row);
    return { ...row };
  };

  const select = (row, fields) =>
    Array.isArray(fields) ? Object.fromEntries(fields.map((f) => [f, row[f]])) : { ...row };

  const sorted = (list, orderBy) => {
    const [field, direction] = Object.entries(orderBy || { id: 'asc' })[0];
    const sign = direction === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => (comparable(a[field]) > comparable(b[field]) ? sign : -sign));
  };

  const query = {
    async findOne({ where, select: fields } = {}) {
      calls.push('findOne');
      const row = rows.find((candidate) => matches(candidate, where));
      return row ? select(row, fields) : null;
    },
    async findMany({ where, orderBy, offset = 0, limit, select: fields } = {}) {
      calls.push('findMany');
      const found = sorted(
        rows.filter((row) => matches(row, where)),
        orderBy
      );
      const page = found.slice(offset, limit === undefined ? undefined : offset + limit);
      return page.map((row) => select(row, fields));
    },
    async count({ where } = {}) {
      calls.push('count');
      return rows.filter((row) => matches(row, where)).length;
    },
    async create({ data }) {
      calls.push('create');
      return insert(data);
    },
    async createMany({ data }) {
      calls.push('createMany');
      data.forEach(insert);
      return { count: data.length };
    },
    async updateMany({ where, data }) {
      calls.push('updateMany');
      const found = rows.filter((row) => matches(row, where));
      for (const row of found) {
        const next = { ...row, ...normalise(data), updatedAt: new Date().toISOString() };
        assertUnique(next, row);
        Object.assign(row, next);
      }
      return { count: found.length };
    },
    async deleteMany({ where } = {}) {
      calls.push('deleteMany');
      const keep = rows.filter((row) => !matches(row, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    },
  };

  return {
    uid: SESSION_UID,
    rows,
    calls,
    query,
    /** Session records in the pre-6.2 shape, oldest first. */
    records: () => rows.map((row) => fromRow({ ...row })),
    /** Inserts records in the pre-6.2 shape. */
    seed: (records) => records.forEach((record) => insert(toRowData(record))),
  };
};

module.exports = { createSessionTable, SESSION_UID };
