'use strict';

const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const auth = require('../server/src/controllers/auth');
const createMagicWhatsAppProvider = require('../server/src/services/magic-whatsapp-provider');

const createContext = (body) => ({
  request: {
    body,
    ip: '127.0.0.1',
    header: { 'user-agent': 'test' },
  },
  send(payload) {
    this.response = payload;
    return payload;
  },
  tooManyRequests(message) {
    this.response = { error: message };
    return this.response;
  },
  badRequest(message) {
    this.response = { error: message };
    return this.response;
  },
});

const configureStrapi = ({
  user = { id: 4, email: 'person@example.test' },
  settings = {},
  magicWhatsApp,
  rateLimit = { allowed: true },
} = {}) => {
  const sentEmails = [];
  const createdTokens = [];
  const logs = [];
  const services = {
    'magic-link': {
      settings: async () => settings,
      user: async () => user,
      createToken: async (email) => {
        const token = { email, _plaintextToken: 'fake-token', expires_at: new Date(Date.now() + 300_000) };
        createdTokens.push(token);
        return token;
      },
      sendLoginLink: async (token) => sentEmails.push(token.email),
    },
    'rate-limiter': { checkRateLimit: async () => rateLimit },
  };

  global.strapi = {
    plugin(name) {
      if (name === 'magic-link') {
        return { service: (serviceName) => services[serviceName] };
      }
      if (name === 'magic-whatsapp') return magicWhatsApp;
      throw new Error(`Unexpected plugin access: ${name}`);
    },
    documents(uid) {
      assert.equal(uid, 'plugin::users-permissions.user');
      return { findMany: async () => (user ? [user] : []) };
    },
    log: Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...values) => logs.push(values.map(String).join(' ')),
    ])),
  };

  return { sentEmails, createdTokens, logs };
};

test('email magic-link delivery stays available without Magic WhatsApp', async () => {
  const { sentEmails } = configureStrapi();
  const ctx = createContext({ email: 'Person@Example.Test' });

  await auth.sendLink(ctx);

  assert.deepEqual(sentEmails, ['person@example.test']);
  assert.equal(ctx.response.delivery, 'email');
  assert.equal(ctx.response.sent, true);
});

test('unknown email keeps the generic non-enumerating response and sends nothing', async () => {
  const { sentEmails } = configureStrapi({ user: null });
  const ctx = createContext({ email: 'unknown@example.test' });

  await auth.sendLink(ctx);

  assert.deepEqual(sentEmails, []);
  assert.deepEqual(ctx.response, {
    email: 'unknown@example.test',
    username: null,
    sent: true,
    delivery: 'email',
  });
});

test('email requests remain rate limited before user lookup or token creation', async () => {
  const { sentEmails, createdTokens } = configureStrapi({ rateLimit: { allowed: false, retryAfter: 30 } });
  const ctx = createContext({ email: 'person@example.test' });
  let tooManyRequests = false;
  ctx.tooManyRequests = () => {
    tooManyRequests = true;
  };

  await auth.sendLink(ctx);

  assert.equal(tooManyRequests, true);
  assert.deepEqual(sentEmails, []);
  assert.deepEqual(createdTokens, []);
});

test('Magic WhatsApp provider forwards the login-link contract only when connected', async () => {
  const calls = [];
  const whatsapp = {
    getStatus: () => ({ isConnected: true }),
    sendMagicLink: async (payload) => {
      calls.push(payload);
      return { success: true };
    },
  };
  const provider = createMagicWhatsAppProvider({
    strapi: { plugin: (name) => name === 'magic-whatsapp' ? { service: () => whatsapp } : undefined },
  });
  const payload = {
    phoneNumber: '+49123456789',
    loginUrl: 'https://example.test/login?loginToken=fake',
    expiresInSeconds: 300,
  };

  assert.deepEqual(await provider.sendMagicLink(payload), { success: true });
  assert.deepEqual(calls, [payload]);
});

test('send-link keeps WhatsApp delivery and delegates the one-time URL to Magic WhatsApp', async () => {
  const calls = [];
  const magicWhatsApp = {
    service: () => ({
      getStatus: () => ({ isConnected: true }),
      sendMagicLink: async (payload) => {
        calls.push(payload);
        return { success: true };
      },
    }),
  };
  configureStrapi({
    settings: { confirmationUrl: 'https://example.test/login', expire_period: 900 },
    magicWhatsApp,
  });
  const ctx = createContext({
    email: 'person@example.test',
    phoneNumber: '+49123456789',
    delivery: 'whatsapp',
  });

  await auth.sendLink(ctx);

  assert.equal(ctx.response.delivery, 'whatsapp');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].phoneNumber, '+49123456789');
  assert.match(calls[0].loginUrl, /^https:\/\/example\.test\/login\?loginToken=/);
  assert.equal(calls[0].expiresInSeconds, 300);
});

test('requested WhatsApp delivery fails with 503 instead of silently falling back to email', async () => {
  const { sentEmails } = configureStrapi();
  const ctx = createContext({
    email: 'person@example.test',
    phoneNumber: '+49123456789',
    delivery: 'whatsapp',
  });

  await auth.sendLink(ctx);

  assert.equal(ctx.status, 503);
  assert.deepEqual(sentEmails, []);
});

test('WhatsApp delivery failures never log or return recipient, link, message, or provider error', async () => {
  const phoneNumber = '+49123456789';
  const providerDetail = 'raw provider failure with private transport data';
  const messageBody = 'Magic Link Login: private message text';
  const magicWhatsApp = {
    service: () => ({
      getStatus: () => ({ isConnected: true }),
      sendMagicLink: async ({ loginUrl }) => {
        assert.match(loginUrl, /fake-token/);
        throw new Error(`${providerDetail}; ${phoneNumber}; ${loginUrl}; ${messageBody}`);
      },
    }),
  };
  const { logs } = configureStrapi({ magicWhatsApp });
  const ctx = createContext({ email: 'person@example.test', phoneNumber, delivery: 'whatsapp' });

  await auth.sendLink(ctx);

  const logOutput = logs.join('\n');
  const responseOutput = JSON.stringify(ctx.body);
  for (const secret of [phoneNumber, 'fake-token', providerDetail, messageBody]) {
    assert.equal(logOutput.includes(secret), false, `log leaked sensitive value: ${secret}`);
    assert.equal(responseOutput.includes(secret), false, `response leaked sensitive value: ${secret}`);
  }
  assert.equal(ctx.status, 503);
  assert.equal(ctx.body.error.details.code, 'MAGIC_WHATSAPP_SEND_FAILED');
});

test('Magic WhatsApp provider fails closed when disabled or disconnected', async (t) => {
  const cases = [
    ['disabled', { strapi: { plugin: () => undefined } }],
    ['disabled service accessor', {
      strapi: { plugin: () => ({ service: () => { throw new Error('service is disabled'); } }) },
    }],
    ['disconnected', {
      strapi: { plugin: () => ({ service: () => ({ getStatus: () => ({ isConnected: false }) }) }) },
    }],
  ];

  for (const [state, strapi] of cases) {
    await t.test(state, async () => {
      const provider = createMagicWhatsAppProvider(strapi);
      await assert.rejects(
        provider.sendMagicLink({
          phoneNumber: '+49123456789',
          loginUrl: 'https://example.test/login?loginToken=fake',
          expiresInSeconds: 300,
        }),
        (error) => error.code === 'MAGIC_WHATSAPP_UNAVAILABLE'
      );
    });
  }
});

test('Magic Link has no local WhatsApp ownership, routes, settings UI, or Baileys dependency', () => {
  const server = require('../server/src');
  const controllers = require('../server/src/controllers');
  const services = require('../server/src/services');
  const adminRoutes = require('../server/src/routes/admin').routes;
  const adminSource = readFileSync(path.join(__dirname, '../admin/src/index.js'), 'utf8');
  const settingsSource = readFileSync(path.join(__dirname, '../admin/src/pages/Settings/SettingsModern.jsx'), 'utf8');
  const packageJson = require('../package.json');
  const packageLock = require('../package-lock.json');

  assert.equal(server.services.whatsapp, undefined);
  assert.equal(controllers.whatsapp, undefined);
  assert.equal(services.whatsapp, undefined);
  assert.equal(adminRoutes.some((route) => route.path.startsWith('/whatsapp/')), false);
  assert.equal(adminSource.includes("./pages/WhatsApp"), false);
  assert.equal(settingsSource.includes('WhatsApp Settings'), false);
  assert.equal(/whatsapp_(?:enabled|debug|app_name|message_template)/i.test(settingsSource), false);
  assert.equal(existsSync(path.join(__dirname, '../admin/src/pages/WhatsApp/index.jsx')), false);
  assert.equal('@whiskeysockets/baileys' in packageJson.dependencies, false);
  assert.equal('pino' in packageJson.dependencies, false);
  assert.equal(packageJson.peerDependencies['react-intl'], '^6.6.2');
  assert.equal(packageJson.devDependencies['react-intl'], '^6.8.9');
  assert.equal(Object.keys(packageLock.packages).some((key) => /baileys|libsignal/i.test(key)), false);
});
