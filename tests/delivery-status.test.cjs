'use strict';

/**
 * Login e-mail delivery status (stage 1): classification of provider
 * errors, persistence on the token for every send path (with and without
 * Magic Mail), the admin serializer and the Tokens view. Synthetic data
 * only; no network.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createLoginCoreStrapi } = require('./helpers/login-core-strapi.cjs');
const { loadAdminModule, ROOT } = require('./helpers/load-admin-module.cjs');
const {
  classifyDeliveryError,
  sanitizeMessageId,
  messageIdOf,
  toDeliveryAttributes,
  toReasonCode,
} = require('../server/src/utils/delivery-status');

const EMAIL = 'delivery.person@example.test';
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const withMagicMail = (strapi, send) => {
  const base = strapi.plugin.bind(strapi);
  strapi.plugin = (name) =>
    name === 'magic-mail'
      ? { service: (key) => (key === 'email-router' ? { send } : { findOne: async () => null }) }
      : base(name);
};

const withEmailPlugin = (strapi, send) => {
  const base = strapi.plugin.bind(strapi);
  strapi.plugin = (name) => (name === 'email' ? { service: () => ({ send }) } : base(name));
};

const coded = (props, message = `refused for ${EMAIL}`) => Object.assign(new Error(message), props);

test('classification: recipient refusals are rejected, transport problems failed', () => {
  const cases = [
    [coded({ code: 'EENVELOPE', responseCode: 550 }), 'rejected', 'SMTP_550'],
    [coded({ code: 'EENVELOPE' }), 'rejected', 'EENVELOPE'],
    [coded({ code: 'EMESSAGE', responseCode: 554 }), 'rejected', 'SMTP_554'],
    [coded({ code: 'EPROTOCOL', responseCode: 503 }), 'failed', 'SMTP_503'],
    [coded({ code: 'EENVELOPE', responseCode: 452 }), 'failed', 'SMTP_452'],
    [coded({ code: 'EAUTH', responseCode: 535 }), 'failed', 'EAUTH'],
    [coded({ code: 'ECONNECTION' }), 'failed', 'ECONNECTION'],
    [coded({ code: 'ETIMEDOUT' }), 'failed', 'ETIMEDOUT'],
    [coded({ code: 'MAGIC_MAIL_VALIDATION' }), 'rejected', 'MAGIC_MAIL_VALIDATION'],
    [coded({ code: 'MAGIC_MAIL_NO_ACCOUNT' }), 'failed', 'MAGIC_MAIL_NO_ACCOUNT'],
    [coded({ code: 'INVALID_RECIPIENT' }), 'rejected', 'INVALID_RECIPIENT'],
    [coded({ status: 400 }), 'rejected', 'HTTP_400'],
    [coded({ statusCode: 422 }), 'rejected', 'HTTP_422'],
    [coded({ status: 401 }), 'failed', 'HTTP_401'],
    [coded({ status: 504 }), 'failed', 'HTTP_504'],
    [new Error(`Template rendering failed: ${EMAIL}`), 'failed', 'TEMPLATE_RENDERING'],
    [new Error(`socket hang up ${EMAIL}`), 'failed', 'UNKNOWN'],
    [null, 'failed', 'UNKNOWN'],
    [coded({ code: `bad ${EMAIL}` }), 'failed', 'UNKNOWN'],
  ];
  for (const [error, status, reason] of cases) {
    assert.deepEqual(classifyDeliveryError(error), { status, reason }, reason);
  }
});

test('reason codes and message ids are bounded and never carry free text', () => {
  assert.equal(toReasonCode('smtp 550 / user unknown'), 'SMTP_550_USER_UNKNOWN');
  assert.equal(toReasonCode('x'.repeat(200)).length, 64);
  assert.equal(toReasonCode(''), null);
  assert.equal(toReasonCode(42), null);
  assert.equal(sanitizeMessageId('<abc.123@mail.example.test>'), '<abc.123@mail.example.test>');
  assert.equal(sanitizeMessageId('with space'), null);
  assert.equal(sanitizeMessageId('a'.repeat(256)), null);
  assert.equal(sanitizeMessageId('line\nbreak'), null);
  assert.equal(messageIdOf({ messageId: '<m1@example.test>' }), '<m1@example.test>');
  assert.equal(messageIdOf([{ messageId: 'sg-1' }]), 'sg-1');
  assert.equal(messageIdOf(undefined), null);
  const attributes = toDeliveryAttributes({ status: 'odd', channel: 'pigeon', reason: null });
  assert.equal(attributes.delivery_status, 'failed');
  assert.equal(attributes.delivery_channel, null);
  assert.ok(attributes.delivery_updated_at instanceof Date);
});

test('without Magic Mail: a provider-accepted mail is recorded as sent via the e-mail plugin', async () => {
  const { strapi, magicLinkService, state } = createLoginCoreStrapi();
  withEmailPlugin(strapi, async () => ({ messageId: '<native-1@example.test>' }));
  const token = await magicLinkService.createToken(EMAIL, {});
  await magicLinkService.sendLoginLink(token, {});
  const row = state.tokens.find((candidate) => candidate.documentId === token.documentId);
  assert.equal(row.delivery_status, 'sent');
  assert.equal(row.delivery_channel, 'email');
  assert.equal(row.delivery_reason, null);
  assert.equal(row.delivery_message_id, '<native-1@example.test>');
  assert.ok(row.delivery_updated_at instanceof Date);
});

test('without Magic Mail: an SMTP recipient refusal is recorded as rejected and re-thrown', async () => {
  const { strapi, magicLinkService, state } = createLoginCoreStrapi();
  withEmailPlugin(strapi, async () => {
    throw coded({ code: 'EENVELOPE', responseCode: 550 });
  });
  const token = await magicLinkService.createToken(EMAIL, {});
  await assert.rejects(magicLinkService.sendLoginLink(token, {}), /refused/);
  const row = state.tokens.find((candidate) => candidate.documentId === token.documentId);
  assert.equal(row.delivery_status, 'rejected');
  assert.equal(row.delivery_reason, 'SMTP_550');
  assert.equal(row.delivery_channel, 'email');
  assert.equal(JSON.stringify(row).includes('refused for'), false, 'no provider message stored');
});

test('with Magic Mail: success stores the Magic Mail message id', async () => {
  const { strapi, magicLinkService, state } = createLoginCoreStrapi({
    settings: { use_magic_mail: true },
  });
  withMagicMail(strapi, async () => ({ success: true, messageId: 'mm-42' }));
  const token = await magicLinkService.createToken(EMAIL, {});
  await magicLinkService.sendLoginLink(token, {});
  const row = state.tokens.find((candidate) => candidate.documentId === token.documentId);
  assert.equal(row.delivery_status, 'sent');
  assert.equal(row.delivery_channel, 'magic-mail');
  assert.equal(row.delivery_message_id, 'mm-42');
});

test('with Magic Mail: an ambiguous failure is recorded as failed on the magic-mail channel', async () => {
  const { strapi, magicLinkService, state } = createLoginCoreStrapi({
    settings: { use_magic_mail: true },
  });
  withMagicMail(strapi, async () => {
    throw coded({ status: 504, magicMailRetryable: false });
  });
  const token = await magicLinkService.createToken(EMAIL, {});
  await assert.rejects(magicLinkService.sendLoginLink(token, {}));
  const row = state.tokens.find((candidate) => candidate.documentId === token.documentId);
  assert.equal(row.delivery_status, 'failed');
  assert.equal(row.delivery_channel, 'magic-mail');
  assert.equal(row.delivery_reason, 'HTTP_504');
});

test('with Magic Mail: a pre-send failure that falls back records the fallback channel', async () => {
  const { strapi, magicLinkService, state } = createLoginCoreStrapi({
    settings: { use_magic_mail: true },
  });
  withMagicMail(strapi, async () => {
    throw coded({ code: 'MAGIC_MAIL_NO_ACCOUNT' });
  });
  const token = await magicLinkService.createToken(EMAIL, {});
  await magicLinkService.sendLoginLink(token, {});
  const row = state.tokens.find((candidate) => candidate.documentId === token.documentId);
  assert.equal(row.delivery_status, 'sent');
  assert.equal(row.delivery_channel, 'email');
});

test('an invalid recipient is rejected before any provider is called', async () => {
  const { strapi, magicLinkService, state } = createLoginCoreStrapi();
  let calls = 0;
  withEmailPlugin(strapi, async () => {
    calls += 1;
  });
  const token = await magicLinkService.createToken(EMAIL, {});
  token.email = 'no-at-sign';
  await assert.rejects(magicLinkService.sendLoginLink(token, {}), /Invalid email configuration/);
  assert.equal(calls, 0);
  const row = state.tokens.find((candidate) => candidate.documentId === token.documentId);
  assert.equal(row.delivery_status, 'rejected');
  assert.equal(row.delivery_reason, 'INVALID_RECIPIENT');
});

test('a failure to store the status never changes the send result', async () => {
  const { strapi, magicLinkService, state } = createLoginCoreStrapi();
  const token = await magicLinkService.createToken(EMAIL, {});
  const documents = strapi.documents.bind(strapi);
  strapi.documents = (uid) => {
    const api = documents(uid);
    return {
      ...api,
      update: async () => {
        throw new Error('database locked');
      },
    };
  };
  await magicLinkService.sendLoginLink(token, {});
  assert.equal(state.mails.length, 1);
  assert.ok(state.logs.some((line) => line.includes('Delivery status could not be stored')));
});

test('schema: delivery attributes are optional and the message id is private', () => {
  const schema = JSON.parse(read('server/src/content-types/token/schema.json'));
  const { attributes } = schema;
  assert.deepEqual(attributes.delivery_status.enum, [
    'sent',
    'rejected',
    'failed',
    'queued',
    'bounced',
    'complained',
  ]);
  assert.deepEqual(attributes.delivery_channel.enum, ['magic-mail', 'email-designer', 'email']);
  for (const key of [
    'delivery_status',
    'delivery_channel',
    'delivery_reason',
    'delivery_message_id',
    'delivery_updated_at',
  ]) {
    assert.notEqual(attributes[key].required, true, `${key} stays optional`);
  }
  assert.equal(attributes.delivery_message_id.private, true);
  assert.equal(attributes.delivery_reason.maxLength, 64);
});

test('admin serializer exposes the status but never the provider message id', () => {
  const source = read('server/src/controllers/tokens.js');
  const block = source.slice(
    source.indexOf('const toAdminToken'),
    source.indexOf('});', source.indexOf('const toAdminToken'))
  );
  for (const key of [
    'delivery_status',
    'delivery_channel',
    'delivery_reason',
    'delivery_updated_at',
  ]) {
    assert.ok(block.includes(`${key}:`), key);
  }
  assert.equal(block.includes('delivery_message_id'), false);
});

test('tokens view: delivery state, filter, column and details', () => {
  const model = loadAdminModule('admin/src/pages/Tokens/tokenModel.js');
  assert.deepEqual(
    [...model.DELIVERY_FILTERS],
    ['all', 'sent', 'rejected', 'failed', 'queued', 'bounced', 'complained', 'unknown']
  );
  assert.equal(model.getDeliveryState({ delivery_status: 'bounced' }), 'bounced');
  assert.equal(model.getDeliveryState({ delivery_status: 'complained' }), 'complained');
  assert.equal(model.getDeliveryState({ delivery_status: 'sent' }), 'sent');
  assert.equal(model.getDeliveryState({ delivery_status: null }), 'unknown');
  assert.equal(model.getDeliveryState({}), 'unknown');

  const base = { is_active: true, expires_at: '2999-01-01T00:00:00.000Z' };
  const tokens = [
    { ...base, id: 1, email: 'a@example.test', delivery_status: 'sent' },
    { ...base, id: 2, email: 'b@example.test', delivery_status: 'rejected' },
    { ...base, id: 3, email: 'c@example.test' },
  ];
  assert.deepEqual(
    model.filterAndSortTokens(tokens, { delivery: 'rejected' }).map((t) => t.id),
    [2]
  );
  assert.deepEqual(
    model.filterAndSortTokens(tokens, { delivery: 'unknown' }).map((t) => t.id),
    [3]
  );
  assert.equal(model.filterAndSortTokens(tokens, {}).length, 3);

  const table = read('admin/src/pages/Tokens/components/TokensTable.jsx');
  assert.match(
    table,
    /<VisuallyHidden>\{labels\.delivery\}:<\/VisuallyHidden>/,
    'named for screen readers'
  );
  assert.match(table, /<DeliveryStatusBadge state=\{getDeliveryState\(token\)\} \/>/);
  assert.match(table, /const columns = canManage \? 7 : 6;/, 'no eighth column (1024px fit)');

  const filter = read('admin/src/pages/Tokens/components/TokensFilterBar.jsx');
  assert.match(filter, /aria-label=\{t\('tokens\.filter\.delivery'/);

  const details = read('admin/src/pages/Tokens/components/TokenDetailsModal.jsx');
  assert.match(details, /tokens\.details\.delivery/);
  assert.match(details, /token\.delivery_reason/);

  const status = read('admin/src/pages/Tokens/components/TokenStatus.jsx');
  assert.match(status, /sent: 'success'/);
  assert.match(status, /rejected: 'warning'/);
  assert.match(status, /failed: 'danger'/);
  assert.match(status, /unknown: 'neutral'/);
});

test('delivery strings exist in all five locales', () => {
  const keys = [
    'tokens.table.delivery',
    'tokens.details.delivery',
    'tokens.delivery.sent',
    'tokens.delivery.rejected',
    'tokens.delivery.failed',
    'tokens.delivery.unknown',
    'tokens.delivery.unknownHint',
    'tokens.delivery.reason',
    'tokens.delivery.channel.magicMail',
    'tokens.delivery.channel.emailDesigner',
    'tokens.delivery.channel.email',
    'tokens.filter.delivery',
    'tokens.filter.allDeliveries',
  ];
  for (const locale of ['en', 'de', 'es', 'fr', 'pt']) {
    const messages = JSON.parse(read(`admin/src/translations/${locale}.json`));
    for (const key of keys) {
      assert.ok(messages[`magic-link.${key}`], `${locale}: ${key}`);
    }
  }
  const de = JSON.parse(read('admin/src/translations/de.json'));
  const germanText = Object.entries(de)
    .filter(([key]) => key.includes('.delivery') || key.includes('Deliveries'))
    .map(([, value]) => value)
    .join(' ');
  assert.equal(/\b(Sie|Ihr|Ihre|du|dein)\b/.test(germanText), false, 'no forms of address');
});

test('login mails are never tracked', () => {
  const source = read('server/src/services/magic-link.js');
  assert.match(source, /enableTracking: false/);
  assert.match(source, /skipLinkTracking: true/);
});
