'use strict';

/**
 * Delivery tracking stage 2: bounce/complaint feedback from Magic Mail
 * events and from the own provider webhooks (SendGrid, Mailgun, SES via SNS,
 * Postmark). Keys and certificates are generated locally; no provider or
 * AWS endpoint is contacted (global fetch is stubbed).
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const test = require('node:test');

const signatures = require('../server/src/utils/webhook-signatures');
const { createWebhookRawBodyMiddleware } = require('../server/src/utils/webhook-raw-body');
const feedbackService = require('../server/src/services/delivery-feedback');
const { trackCleanup, runTrackedCleanups } = require('../server/src/utils/lifecycle');

const ROOT = path.join(__dirname, '..');
const quietLog = { debug() {}, info() {}, warn() {}, error() {} };
const nowSeconds = () => String(Math.floor(Date.now() / 1000));
const TOPIC = 'arn:aws:sns:us-east-1:123456789012:ses-feedback';
const CERT_URL = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem';

const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const SENDGRID_KEY = ec.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const signSendGrid = (ts, body) =>
  crypto
    .sign('sha256', Buffer.concat([Buffer.from(ts), Buffer.from(body)]), {
      key: ec.privateKey,
      dsaEncoding: 'der',
    })
    .toString('base64');
const MAILGUN_KEY = 'synthetic-mailgun-signing-key';
const signMailgun = (ts, token, key = MAILGUN_KEY) =>
  crypto.createHmac('sha256', key).update(`${ts}${token}`).digest('hex');
const POSTMARK = { username: 'postmark', password: 'synthetic-password-123' };

/** Self-signed certificate for SNS tests, generated per run (never committed). */
const snsKeys = (() => {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-sns-'));
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '2',
        '-subj',
        '/CN=sns.us-east-1.amazonaws.com',
        '-keyout',
        path.join(dir, 'key.pem'),
        '-out',
        path.join(dir, 'cert.pem'),
      ],
      { stdio: 'ignore' }
    );
    const keys = {
      key: fs.readFileSync(path.join(dir, 'key.pem'), 'utf8'),
      cert: fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8'),
    };
    fs.rmSync(dir, { recursive: true, force: true });
    return keys;
  } catch {
    return null;
  }
})();

const signSns = (message, version = '2') => {
  const body = { ...message, SignatureVersion: version, SigningCertURL: CERT_URL };
  const stringToSign = signatures.snsStringToSign(body);
  body.Signature = crypto
    .sign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256', Buffer.from(stringToSign), snsKeys.key)
    .toString('base64');
  return body;
};

/**
 * Strapi double: tokens in memory, plugin config for deliveryWebhooks.
 */
const createStrapi = ({ tokens = [], webhooks = {}, magicMail = false } = {}) => {
  const listeners = new Map();
  const strapi = {
    log: quietLog,
    tokens,
    config: {
      get: (key, fallback) => (key === 'plugin::magic-link.deliveryWebhooks' ? webhooks : fallback),
    },
    plugin: (name) => (name === 'magic-mail' && magicMail ? {} : null),
    eventHub: {
      on(name, listener) {
        listeners.set(name, listener);
        return () => listeners.delete(name);
      },
      async emit(name, payload) {
        if (listeners.has(name)) await listeners.get(name)(payload);
      },
      listeners,
    },
    db: {
      query: () => ({
        findMany: async ({ where }) =>
          tokens.filter((token) =>
            where.$or.some((clause) => {
              const value = token.delivery_message_id || '';
              const cond = clause.delivery_message_id;
              if (cond.$in) return cond.$in.includes(value);
              return value.startsWith(cond.$startsWith);
            })
          ),
      }),
    },
    documents: () => ({
      update: async ({ documentId, data }) => {
        Object.assign(
          tokens.find((token) => token.documentId === documentId),
          data
        );
      },
    }),
  };
  return strapi;
};

const token = (documentId, messageId, status = 'sent') => ({
  id: documentId,
  documentId,
  delivery_status: status,
  delivery_message_id: messageId,
});

test.beforeEach(() => feedbackService.__test__.reset());

test('SendGrid, Mailgun and Basic-auth checks accept only genuine requests', () => {
  const ts = nowSeconds();
  const body = Buffer.from('[{"event":"bounce"}]');
  const sig = signSendGrid(ts, body);
  assert.equal(
    signatures.verifySendGridSignature({
      publicKey: SENDGRID_KEY,
      rawBody: body,
      signature: sig,
      timestamp: ts,
    }),
    true
  );
  assert.equal(
    signatures.verifySendGridSignature({
      publicKey: SENDGRID_KEY,
      rawBody: Buffer.from('[{"event": "bounce"}]'),
      signature: sig,
      timestamp: ts,
    }),
    false
  );
  const token = 'b'.repeat(50);
  assert.equal(
    signatures.verifyMailgunSignature({
      signingKey: MAILGUN_KEY,
      timestamp: ts,
      token,
      signature: signMailgun(ts, token),
    }),
    true
  );
  assert.equal(
    signatures.verifyMailgunSignature({
      signingKey: MAILGUN_KEY,
      timestamp: '1000000000',
      token,
      signature: signMailgun('1000000000', token),
    }),
    false
  );
  const header = `Basic ${Buffer.from(`${POSTMARK.username}:${POSTMARK.password}`).toString('base64')}`;
  assert.equal(signatures.verifyBasicAuth(header, POSTMARK), true);
  assert.equal(
    signatures.verifyBasicAuth(
      `Basic ${Buffer.from('postmark:wrong').toString('base64')}`,
      POSTMARK
    ),
    false
  );
  assert.equal(
    signatures.verifyBasicAuth(header, { username: 'postmark', password: 'short' }),
    false
  );
  assert.equal(signatures.verifyBasicAuth(undefined, POSTMARK), false);
});

test('SNS URLs must be HTTPS on an SNS host and subscribe links must match the topic', () => {
  assert.ok(signatures.toSnsUrl(CERT_URL));
  for (const bad of [
    'http://sns.us-east-1.amazonaws.com/a.pem',
    'https://sns.us-east-1.amazonaws.com.evil.test/a.pem',
    'https://evil.test/sns.us-east-1.amazonaws.com/a.pem',
    'https://user:pw@sns.us-east-1.amazonaws.com/a.pem',
    'https://sns.us-east-1.amazonaws.com:8443/a.pem',
  ]) {
    assert.equal(signatures.toSnsUrl(bad), null, bad);
  }
  const subscribe = `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(TOPIC)}&Token=abc`;
  assert.equal(
    signatures.snsSubscribeUrl({ SubscribeURL: subscribe, TopicArn: TOPIC }),
    new URL(subscribe).href
  );
  assert.equal(
    signatures.snsSubscribeUrl({ SubscribeURL: subscribe, TopicArn: `${TOPIC}-other` }),
    null
  );
  assert.equal(
    signatures.snsSubscribeUrl({
      SubscribeURL: 'https://evil.test/?Action=ConfirmSubscription',
      TopicArn: TOPIC,
    }),
    null
  );
});

test(
  'SNS signatures (v1 and v2) are verified against the fetched certificate and topic list',
  { skip: !snsKeys },
  async () => {
    const fetchCertificate = async (url) => {
      assert.equal(url, CERT_URL);
      return snsKeys.cert;
    };
    const base = {
      Type: 'Notification',
      MessageId: 'sns-1',
      TopicArn: TOPIC,
      Message: '{"notificationType":"Bounce"}',
      Timestamp: new Date().toISOString(),
    };
    for (const version of ['1', '2']) {
      const message = signSns(base, version);
      assert.equal(
        await signatures.verifySnsMessage(message, { allowedTopicArns: [TOPIC], fetchCertificate }),
        true
      );
      assert.equal(
        await signatures.verifySnsMessage(
          { ...message, Message: '{"notificationType":"Complaint"}' },
          { allowedTopicArns: [TOPIC], fetchCertificate }
        ),
        false
      );
    }
    const message = signSns(base);
    assert.equal(
      await signatures.verifySnsMessage(message, {
        allowedTopicArns: ['arn:aws:sns:us-east-1:123456789012:other'],
        fetchCertificate,
      }),
      false
    );
    assert.equal(
      await signatures.verifySnsMessage(
        { ...message, SigningCertURL: 'https://evil.test/cert.pem' },
        { allowedTopicArns: [TOPIC], fetchCertificate }
      ),
      false
    );
    const old = signSns({
      ...base,
      Timestamp: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    });
    assert.equal(
      await signatures.verifySnsMessage(old, { allowedTopicArns: [TOPIC], fetchCertificate }),
      false
    );
  }
);

test('every webhook provider is off until its secret is configured', async () => {
  const service = feedbackService({ strapi: createStrapi() });
  for (const provider of ['sendgrid', 'mailgun', 'ses', 'postmark', 'unknown']) {
    const result = await service.handleWebhook({
      provider,
      rawBody: Buffer.from('{}'),
      headers: {},
      ip: '198.51.100.1',
    });
    assert.equal(result.status, 401, provider);
  }
});

test('SendGrid feedback moves sent tokens to bounced/complained by message id', async () => {
  const tokens = [token('t1', 'SGid1'), token('t2', 'SGid2'), token('t3', 'SGid3', 'rejected')];
  const strapi = createStrapi({ tokens, webhooks: { sendgrid: { publicKey: SENDGRID_KEY } } });
  const service = feedbackService({ strapi });
  const body = JSON.stringify([
    {
      event: 'bounce',
      type: 'bounce',
      status: '5.1.1',
      email: 'person@example.test',
      sg_event_id: 'e1',
      sg_message_id: 'SGid1.filter-1',
    },
    { event: 'spamreport', sg_event_id: 'e2', sg_message_id: 'SGid2.filter-2' },
    { event: 'dropped', sg_event_id: 'e3', sg_message_id: 'SGid3.filter-3' },
    { event: 'delivered', sg_event_id: 'e4', sg_message_id: 'SGid1.filter-4' },
  ]);
  const ts = nowSeconds();
  const headers = {
    'x-twilio-email-event-webhook-signature': signSendGrid(ts, body),
    'x-twilio-email-event-webhook-timestamp': ts,
  };
  const result = await service.handleWebhook({
    provider: 'sendgrid',
    rawBody: Buffer.from(body),
    headers,
    ip: '198.51.100.2',
  });
  assert.deepEqual(result, { status: 200, applied: 2 });
  assert.equal(tokens[0].delivery_status, 'bounced');
  assert.equal(tokens[0].delivery_reason, 'SENDGRID_BOUNCE_500');
  assert.equal(tokens[1].delivery_status, 'complained');
  assert.equal(tokens[2].delivery_status, 'rejected', 'never-accepted tokens keep their status');
  assert.doesNotMatch(JSON.stringify(tokens), /example\.test/);
  const replay = await service.handleWebhook({
    provider: 'sendgrid',
    rawBody: Buffer.from(body),
    headers,
    ip: '198.51.100.2',
  });
  assert.deepEqual(replay, { status: 200, applied: 0 });
});

test('Mailgun feedback matches bracketed stage-1 ids and ignores temporary failures and replays', async () => {
  const tokens = [token('m1', '<20261107.abc@mg.example.test>')];
  const service = feedbackService({
    strapi: createStrapi({ tokens, webhooks: { mailgun: { signingKey: MAILGUN_KEY } } }),
  });
  const make = (tokenValue, data) => {
    const ts = nowSeconds();
    return Buffer.from(
      JSON.stringify({
        signature: { timestamp: ts, token: tokenValue, signature: signMailgun(ts, tokenValue) },
        'event-data': data,
      })
    );
  };
  const temporary = {
    id: 'mg-1',
    event: 'failed',
    severity: 'temporary',
    message: { headers: { 'message-id': '20261107.abc@mg.example.test' } },
  };
  assert.deepEqual(
    await service.handleWebhook({
      provider: 'mailgun',
      rawBody: make('c'.repeat(50), temporary),
      ip: '198.51.100.3',
    }),
    { status: 200, applied: 0 }
  );
  assert.equal(tokens[0].delivery_status, 'sent');
  const permanent = {
    ...temporary,
    id: 'mg-2',
    severity: 'permanent',
    reason: 'bounce',
    'delivery-status': { code: 550 },
  };
  const body = make('d'.repeat(50), permanent);
  assert.deepEqual(
    await service.handleWebhook({ provider: 'mailgun', rawBody: body, ip: '198.51.100.3' }),
    { status: 200, applied: 1 }
  );
  assert.equal(tokens[0].delivery_reason, 'MAILGUN_BOUNCE_550');
  assert.deepEqual(
    await service.handleWebhook({ provider: 'mailgun', rawBody: body, ip: '198.51.100.3' }),
    { status: 200, applied: 0 }
  );
  const forged = JSON.parse(body.toString());
  forged.signature.token = 'e'.repeat(50);
  assert.equal(
    (
      await service.handleWebhook({
        provider: 'mailgun',
        rawBody: Buffer.from(JSON.stringify(forged)),
        ip: '198.51.100.3',
      })
    ).status,
    401
  );
});

test(
  'Amazon SES via SNS: permanent bounces apply, subscription is confirmed only for the allowed topic',
  { skip: !snsKeys },
  async (t) => {
    const tokens = [token('s1', '<0100abc@email.amazonses.com>'), token('s2', 'other')];
    const service = feedbackService({
      strapi: createStrapi({ tokens, webhooks: { ses: { topicArns: [TOPIC] } } }),
    });
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        text: async () => (String(url).endsWith('.pem') ? snsKeys.cert : '<ok/>'),
      };
    });
    const confirm = signSns({
      Type: 'SubscriptionConfirmation',
      MessageId: 'sub-1',
      Token: 'tok',
      TopicArn: TOPIC,
      Message: 'confirm',
      SubscribeURL: `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(TOPIC)}&Token=tok`,
      Timestamp: new Date().toISOString(),
    });
    assert.deepEqual(
      await service.handleWebhook({
        provider: 'ses',
        rawBody: Buffer.from(JSON.stringify(confirm)),
        ip: '198.51.100.4',
      }),
      { status: 200, applied: 0 }
    );
    assert.ok(calls.some((url) => url.includes('Action=ConfirmSubscription')));

    const bounce = signSns({
      Type: 'Notification',
      MessageId: 'sns-bounce-1',
      TopicArn: TOPIC,
      Message: JSON.stringify({
        notificationType: 'Bounce',
        mail: { messageId: '0100abc', destination: ['person@example.test'] },
        bounce: {
          bounceType: 'Permanent',
          bounceSubType: 'General',
          bouncedRecipients: [{ emailAddress: 'person@example.test' }],
        },
      }),
      Timestamp: new Date().toISOString(),
    });
    assert.deepEqual(
      await service.handleWebhook({
        provider: 'ses',
        rawBody: Buffer.from(JSON.stringify(bounce)),
        ip: '198.51.100.4',
      }),
      { status: 200, applied: 1 }
    );
    assert.equal(tokens[0].delivery_status, 'bounced');
    assert.equal(tokens[0].delivery_reason, 'SES_BOUNCE_GENERAL');
    assert.equal(tokens[1].delivery_status, 'sent');

    const foreign = signSns({
      ...bounce,
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:other',
      Signature: undefined,
    });
    assert.equal(
      (
        await service.handleWebhook({
          provider: 'ses',
          rawBody: Buffer.from(JSON.stringify(foreign)),
          ip: '198.51.100.4',
        })
      ).status,
      401
    );
  }
);

test('Postmark: Basic auth required, hard bounces and spam complaints apply', async () => {
  const tokens = [token('p1', 'pm-1'), token('p2', 'pm-2', 'bounced')];
  const service = feedbackService({
    strapi: createStrapi({ tokens, webhooks: { postmark: POSTMARK } }),
  });
  const auth = `Basic ${Buffer.from(`${POSTMARK.username}:${POSTMARK.password}`).toString('base64')}`;
  const send = (payload, authorization = auth) =>
    service.handleWebhook({
      provider: 'postmark',
      rawBody: Buffer.from(JSON.stringify(payload)),
      headers: { authorization },
      ip: '198.51.100.5',
    });
  assert.equal(
    (
      await send(
        { RecordType: 'Bounce', Type: 'HardBounce', MessageID: 'pm-1', ID: 1 },
        'Basic eDp5'
      )
    ).status,
    401
  );
  assert.deepEqual(
    await send({ RecordType: 'Bounce', Type: 'SoftBounce', MessageID: 'pm-1', ID: 2 }),
    { status: 200, applied: 0 }
  );
  assert.deepEqual(
    await send({ RecordType: 'Bounce', Type: 'HardBounce', MessageID: 'pm-1', ID: 3 }),
    { status: 200, applied: 1 }
  );
  assert.equal(tokens[0].delivery_reason, 'POSTMARK_HARDBOUNCE');
  assert.deepEqual(await send({ RecordType: 'SpamComplaint', MessageID: 'pm-2', ID: 4 }), {
    status: 200,
    applied: 0,
  });
  assert.equal(tokens[1].delivery_status, 'bounced', 'a complaint never replaces a bounce');
});

test('webhook route is rate limited per address', async () => {
  const service = feedbackService({ strapi: createStrapi() });
  let last;
  for (let i = 0; i < 601; i += 1) {
    last = await service.handleWebhook({
      provider: 'sendgrid',
      rawBody: Buffer.from('[]'),
      ip: '203.0.113.9',
    });
  }
  assert.equal(last.status, 429);
  assert.equal(
    (
      await service.handleWebhook({
        provider: 'sendgrid',
        rawBody: Buffer.from('[]'),
        ip: '203.0.113.10',
      })
    ).status,
    401
  );
});

test('Magic Mail events update tokens when Magic Mail is installed, and unsubscribe on destroy', async () => {
  const tokens = [token('mm1', 'SGmm.filter')];
  const fakeStrapi = createStrapi({ tokens, magicMail: true });
  const service = feedbackService({ strapi: fakeStrapi });
  const off = service.subscribeToMagicMail();
  assert.equal(typeof off, 'function');
  trackCleanup(fakeStrapi, off);
  tokens[0].delivery_message_id = 'SGmm';
  await fakeStrapi.eventHub.emit('magic-mail.delivery.bounced', {
    provider: 'sendgrid',
    messageId: 'SGmm',
    reasonCode: 'SENDGRID_BOUNCE_500',
  });
  assert.equal(tokens[0].delivery_status, 'bounced');
  assert.equal(runTrackedCleanups(fakeStrapi), 1);
  assert.equal(fakeStrapi.eventHub.listeners.size, 0);

  const withoutMagicMail = feedbackService({ strapi: createStrapi() });
  assert.equal(withoutMagicMail.subscribeToMagicMail(), null);
});

test('untrusted reason codes from events are replaced by a generic code', async () => {
  const tokens = [token('r1', 'id-1')];
  const service = feedbackService({ strapi: createStrapi({ tokens }) });
  await service.applyFeedback({
    provider: 'magic-mail',
    messageId: 'id-1',
    kind: 'complained',
    reasonCode: 'spam from person@example.test',
  });
  assert.equal(tokens[0].delivery_reason, 'MAGIC_MAIL_COMPLAINED');
});

test('raw body middleware is mounted in register for the delivery-webhooks prefix only', async () => {
  const mounted = [];
  require('../server/src/register')({
    strapi: { server: { use: (m) => mounted.push(m) }, config: { get: (k, f) => f } },
  });
  assert.equal(mounted.length, 1);
  const req = Readable.from([Buffer.from('{"a": 1}')]);
  req.headers = { 'content-type': 'application/json' };
  const ctx = {
    method: 'POST',
    path: '/api/magic-link/delivery-webhooks/sendgrid',
    req,
    state: {},
    get: () => undefined,
  };
  await mounted[0](ctx, async () => {});
  assert.equal(ctx.state.magicLinkWebhookRaw.toString(), '{"a": 1}');
  const other = {
    method: 'POST',
    path: '/api/magic-link/login',
    req: Readable.from([]),
    state: {},
    get: () => undefined,
  };
  other.req.headers = { 'content-type': 'application/json' };
  await mounted[0](other, async () => {});
  assert.equal(other.state.magicLinkWebhookRaw, undefined);
  const limited = createWebhookRawBodyMiddleware({ pathPrefix: '/x/', limit: 4 });
  const big = {
    method: 'POST',
    path: '/x/y',
    req: Readable.from([Buffer.from('123456')]),
    state: {},
    get: () => undefined,
  };
  big.req.headers = {};
  await limited(big, async () => {});
  assert.equal(big.status, 413);
});

test('route, schema, config validator and UI cover the new statuses', () => {
  const routes = require('../server/src/routes/content-api').routes;
  const route = routes.find((r) => r.path === '/delivery-webhooks/:provider');
  assert.equal(route.method, 'POST');
  assert.equal(route.config.auth, false);
  assert.deepEqual(route.config.policies, ['plugin::magic-link.ip-ban-check']);
  const config = require('../server/src/config');
  assert.throws(
    () => config.validator({ deliveryWebhooks: { postmark: { password: 'short' } } }),
    /12 characters/
  );
  assert.throws(
    () => config.validator({ deliveryWebhooks: { ses: { topicArns: 'x' } } }),
    /topicArns/
  );
  config.validator({
    deliveryWebhooks: { sendgrid: { publicKey: SENDGRID_KEY }, ses: { topicArns: [TOPIC] } },
  });
  const status = fs.readFileSync(
    path.join(ROOT, 'admin/src/pages/Tokens/components/TokenStatus.jsx'),
    'utf8'
  );
  assert.match(status, /bounced: 'danger'/);
  assert.match(status, /complained: 'danger'/);
  for (const locale of ['en', 'de', 'fr', 'es', 'pt']) {
    const messages = require(`../admin/src/translations/${locale}.json`);
    assert.ok(messages['magic-link.tokens.delivery.bounced'], locale);
    assert.ok(messages['magic-link.tokens.delivery.complained'], locale);
  }
});
