'use strict';

/**
 * Real-Strapi HTTP suite. Boots an actual Strapi 5 application (SQLite, no
 * admin panel build) from a separate node_modules directory, loads this
 * plugin from the repository (`dist/`, so run `npm run build` first) and
 * drives the login and revocation flow over HTTP:
 *
 *   magic-link login -> admin lists the session -> admin revokes it ->
 *   the access token is rejected (and, in refresh mode, the refresh token).
 *
 * It exists to prove the @strapi/strapi peer floor: the CI job `strapi-floor`
 * installs exactly that version and runs this file in both users-permissions
 * JWT modes.
 *
 *   ML_HOST_STRAPI_NODE_MODULES=/path/to/host/node_modules \
 *   ML_HOST_JWT_MODE=refresh|legacy-support ML_HOST_REQUIRED=1 \
 *     node --test tests/host/strapi-host.test.cjs
 *
 * The host directory needs @strapi/strapi, @strapi/plugin-users-permissions
 * and better-sqlite3. Without ML_HOST_STRAPI_NODE_MODULES the suite skips
 * with a message; with ML_HOST_REQUIRED=1 a missing host fails instead.
 * Synthetic data only (example.test), loopback only, random secrets.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HOST_MODULES = process.env.ML_HOST_STRAPI_NODE_MODULES;
const REQUIRED = process.env.ML_HOST_REQUIRED === '1';
const MODE = process.env.ML_HOST_JWT_MODE === 'legacy-support' ? 'legacy-support' : 'refresh';

const missing = !HOST_MODULES || !fs.existsSync(path.join(HOST_MODULES, '@strapi', 'strapi'));
if (missing && REQUIRED) {
  throw new Error('ML_HOST_REQUIRED=1 but ML_HOST_STRAPI_NODE_MODULES has no @strapi/strapi');
}
const skip = missing ? 'set ML_HOST_STRAPI_NODE_MODULES to a Strapi host node_modules' : false;

/**
 * Finds a free loopback port.
 *
 * @returns {Promise<number>} The port.
 */
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

/**
 * Writes a minimal JavaScript Strapi project that loads this plugin from the
 * repository and links the host's node_modules.
 *
 * @sideeffect Creates a temporary directory and sets process.env secrets.
 * @param {number} port - Loopback port.
 * @returns {string} The application directory.
 */
const writeApp = (port) => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-host-'));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(appDir, file)), { recursive: true });
    fs.writeFileSync(path.join(appDir, file), text);
  };
  // Strapi loads installed plugins from the app's dependencies.
  const hostVersion = (name) =>
    require(path.join(HOST_MODULES, ...name.split('/'), 'package.json')).version;
  const dependencies = {};
  for (const name of ['@strapi/strapi', '@strapi/plugin-users-permissions']) {
    dependencies[name] = hostVersion(name);
  }
  write(
    'package.json',
    JSON.stringify({ name: 'ml-host', private: true, version: '0.0.0', dependencies })
  );
  write(
    'config/server.js',
    `module.exports = ({ env }) => ({ host: '127.0.0.1', port: ${port}, url: 'http://127.0.0.1:${port}', app: { keys: env.array('APP_KEYS') }, logger: { updates: { enabled: false } } });\n`
  );
  write(
    'config/admin.js',
    "module.exports = ({ env }) => ({ auth: { secret: env('ADMIN_JWT_SECRET') }, apiToken: { salt: env('API_TOKEN_SALT') }, transfer: { token: { salt: env('TRANSFER_TOKEN_SALT') } }, secrets: { encryptionKey: env('ENCRYPTION_KEY') }, serveAdminPanel: false });\n"
  );
  write(
    'config/database.js',
    "const path = require('node:path');\nmodule.exports = () => ({ connection: { client: 'sqlite', connection: { filename: path.join(__dirname, '..', '.tmp', 'host.db') }, useNullAsDefault: true } });\n"
  );
  write(
    'config/plugins.js',
    `module.exports = ({ env }) => ({ 'users-permissions': { config: { jwtSecret: env('JWT_SECRET'), jwtManagement: '${MODE}' } }, 'magic-link': { enabled: true, resolve: ${JSON.stringify(ROOT)} } });\n`
  );
  write('src/index.js', 'module.exports = { register() {}, bootstrap() {} };\n');
  fs.mkdirSync(path.join(appDir, 'public', 'uploads'), { recursive: true });
  write('favicon.png', '');
  fs.symlinkSync(HOST_MODULES, path.join(appDir, 'node_modules'), 'dir');

  const secret = () => crypto.randomBytes(32).toString('base64');
  Object.assign(process.env, {
    APP_KEYS: [secret(), secret()].join(','),
    API_TOKEN_SALT: secret(),
    ADMIN_JWT_SECRET: secret(),
    TRANSFER_TOKEN_SALT: secret(),
    JWT_SECRET: secret(),
    ENCRYPTION_KEY: secret(),
    MAGIC_LINK_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    MAGIC_LINK_OTP_PEPPER: crypto.randomBytes(32).toString('hex'),
    STRAPI_TELEMETRY_DISABLED: 'true',
  });
  return appDir;
};

test(`Magic Link on a real Strapi host (${MODE})`, { skip, timeout: 180_000 }, async (t) => {
  const port = await freePort();
  const appDir = writeApp(port);
  const { createStrapi } = require(path.join(HOST_MODULES, '@strapi', 'strapi'));
  const app = createStrapi({ appDir, distDir: appDir });
  app.log.level = 'error';
  await app.start();
  t.after(async () => {
    await app.destroy();
    fs.rmSync(appDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, { body, token } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json };
  };

  const strapiVersion = require(path.join(HOST_MODULES, '@strapi', 'strapi', 'package.json'));
  t.diagnostic(`Strapi ${strapiVersion.version}, jwtManagement ${MODE}`);

  // First admin (empty database only), password generated and never printed.
  const register = await call('POST', '/admin/register-admin', {
    body: {
      firstname: 'Review',
      lastname: 'Admin',
      email: 'review-admin@example.test',
      password: `Rv1!${crypto.randomBytes(12).toString('base64url')}`,
    },
  });
  assert.equal(register.status, 200, 'register-admin');
  const adminToken = register.json.data.accessToken || register.json.data.token;
  assert.ok(adminToken, 'admin token');

  // Synthetic users-permissions user in the Authenticated role.
  const role = await app.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'authenticated' } });
  await app.db.query('plugin::users-permissions.user').create({
    data: {
      username: 'anna.beispiel',
      email: 'anna.beispiel@example.test',
      provider: 'local',
      confirmed: true,
      blocked: false,
      role: role.id,
    },
  });

  const settings = await call('GET', '/magic-link/settings', { token: adminToken });
  assert.equal(settings.status, 200, 'settings');
  const current = settings.json.settings || settings.json.data || settings.json;
  if (current.enabled === false) {
    const enabled = await call('PUT', '/magic-link/settings', {
      token: adminToken,
      body: { enabled: true },
    });
    assert.equal(enabled.status, 200, 'enable plugin');
  }

  const issue = await call('POST', '/magic-link/tokens', {
    token: adminToken,
    body: { email: 'anna.beispiel@example.test', send_email: false },
  });
  assert.equal(issue.status, 200, 'admin issues a direct login token');
  assert.ok(issue.json.token, 'plaintext token in the direct-delivery response');

  const login = await call('GET', `/api/magic-link/login?loginToken=${issue.json.token}`);
  assert.equal(login.status, 200, 'magic-link login');
  assert.ok(login.json.jwt, 'jwt');
  if (MODE === 'refresh') assert.ok(login.json.refreshToken, 'refresh token in refresh mode');

  const me = await call('GET', '/api/users/me', { token: login.json.jwt });
  assert.equal(me.status, 200, 'the new access token works');

  if (MODE === 'refresh') {
    const refreshed = await call('POST', '/api/auth/refresh', {
      body: { refreshToken: login.json.refreshToken },
    });
    assert.equal(refreshed.status, 200, 'refresh works before revocation');
    login.json.refreshToken = refreshed.json.refreshToken || login.json.refreshToken;
  }

  const sessions = await call('GET', '/magic-link/jwt-sessions', { token: adminToken });
  assert.equal(sessions.status, 200, 'session list');
  const list = sessions.json.data || sessions.json.results || sessions.json;
  const session = (Array.isArray(list) ? list : []).find((row) => !row.isRevoked && !row.revoked);
  assert.ok(session, 'the login is listed');

  const revoke = await call('POST', '/magic-link/revoke-jwt', {
    token: adminToken,
    body: { sessionId: String(session.id) },
  });
  assert.equal(revoke.status, 200, 'admin revokes the session');

  const after = await call('GET', '/api/users/me', { token: login.json.jwt });
  assert.equal(after.status, 401, 'the revoked access token is rejected');

  if (MODE === 'refresh') {
    const refreshAfter = await call('POST', '/api/auth/refresh', {
      body: { refreshToken: login.json.refreshToken },
    });
    assert.equal(refreshAfter.status, 401, 'the revoked refresh token is rejected');
  }
});
