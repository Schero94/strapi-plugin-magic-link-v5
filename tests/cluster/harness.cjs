'use strict';

/**
 * Minimal Strapi for the multi-process concurrency tests: the real
 * @strapi/database 5.61 Database (knex, transactions with AsyncLocalStorage,
 * query engine) and the real core store from @strapi/core 5.61, plus the
 * plugin's JWT session table, on SQLite
 * (better-sqlite3) or PostgreSQL (pg). Only synthetic data.
 *
 * Environment:
 *   ML_CLUSTER_DB      sqlite (default) | postgres
 *   ML_CLUSTER_SQLITE  SQLite file path (set by run.cjs)
 *   ML_CLUSTER_PG_URL  postgres://user@host:port/database (postgres only)
 */

const crypto = require('node:crypto');
const path = require('node:path');
const { Database } = require('@strapi/database');

const corePath = path.dirname(require.resolve('@strapi/core/package.json'));
// Deep import: the core store is not exported from @strapi/core's entry.
const { coreStoreModel, createCoreStore } = require(
  path.join(corePath, 'dist', 'services', 'core-store.js')
);

const sessionSchema = require('../../server/src/content-types/jwt-session/schema.json');
const { SESSION_UID } = require('../../server/src/utils/jwt-session-store');

/**
 * Database model of the JWT session content type, built like
 * @strapi/core 5.61 transformContentTypesToModels does for a content type
 * without relations: id, documentId, the schema attributes (scalar, so they
 * pass through unchanged), the timestamps and publishedAt, and the schema
 * `indexes`. Creator relations are left out (no admin::user table here).
 */
const sessionModel = {
  uid: SESSION_UID,
  singularName: sessionSchema.info.singularName,
  tableName: sessionSchema.collectionName,
  attributes: {
    id: { type: 'increments' },
    documentId: { type: 'string', default: () => crypto.randomUUID() },
    ...sessionSchema.attributes,
    createdAt: { type: 'datetime' },
    updatedAt: { type: 'datetime' },
    publishedAt: { type: 'datetime' },
  },
  indexes: sessionSchema.indexes,
};

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * Database connection config for the selected client.
 *
 * @returns {object} Strapi database connection config.
 */
const connectionConfig = () => {
  if ((process.env.ML_CLUSTER_DB || 'sqlite') === 'postgres') {
    if (!process.env.ML_CLUSTER_PG_URL) throw new Error('ML_CLUSTER_PG_URL is required');
    const url = new URL(process.env.ML_CLUSTER_PG_URL);
    return {
      client: 'postgres',
      connection: {
        host: url.hostname,
        port: Number(url.port) || 5432,
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password) || undefined,
        database: url.pathname.slice(1),
        schema: 'public',
      },
      pool: { min: 0, max: 5 },
    };
  }
  return {
    client: 'sqlite',
    connection: { filename: process.env.ML_CLUSTER_SQLITE },
    useNullAsDefault: true,
  };
};

/**
 * Creates the Strapi double and installs it as global.strapi.
 *
 * @param {{sync?: boolean, config?: object}} [options] - `sync` creates the tables.
 * @returns {Promise<object>} Strapi double.
 */
const createClusterStrapi = async ({ sync = false, config = {} } = {}) => {
  const db = new Database({
    connection: connectionConfig(),
    settings: { runMigrations: false, migrations: { dir: path.join(__dirname, 'no-migrations') } },
    logger: silentLogger,
  });
  const strapi = {
    db,
    log: silentLogger,
    store: createCoreStore({ db }),
    config: { get: (key, fallback) => (key in config ? config[key] : fallback) },
    plugin: () => null,
  };
  global.strapi = strapi;
  await db.init({ models: [coreStoreModel, sessionModel] });
  if (sync) await db.schema.sync();
  return strapi;
};

module.exports = { createClusterStrapi };
