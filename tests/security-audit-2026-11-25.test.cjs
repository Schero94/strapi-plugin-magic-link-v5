'use strict';

/**
 * Regression tests for the security audit of 2026-11-25. One block per
 * finding (ML-SEC-01..04). Synthetic data only; no network and no e-mail.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const auth = require('../server/src/controllers/auth');
const { createLoginCoreStrapi, createCtx } = require('./helpers/login-core-strapi.cjs');
const { createPlainTextVersion } = require('../server/src/utils/email-helpers');
const { toReasonCode } = require('../server/src/utils/delivery-status');
const { toSnsUrl, snsSubscribeUrl } = require('../server/src/utils/webhook-signatures');

const USER = {
  id: 7,
  documentId: 'user-doc',
  email: 'anna.beispiel@example.test',
  username: 'anna',
  confirmed: true,
  blocked: false,
};

const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const elapsedMs = (fn) => {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
};

// ─── ML-SEC-01: GET /login must not consume the link for page navigations ───

test('ML-SEC-01: a browser or link scanner GET shows a confirm page and does not consume the link', async () => {
  const { magicLinkService } = createLoginCoreStrapi({ users: [USER] });
  const token = await magicLinkService.createToken(USER.email, {});
  const loginToken = token._plaintextToken;

  for (const headers of [
    { accept: BROWSER_ACCEPT },
    { accept: '*/*', 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' },
    { accept: 'text/html' },
  ]) {
    const ctx = createCtx({ query: { loginToken }, headers });
    await auth.login(ctx);
    assert.equal(ctx.status, 200, JSON.stringify(headers));
    assert.match(String(ctx.type), /html/);
    assert.equal(typeof ctx.body, 'string');
    assert.doesNotMatch(ctx.body, /"jwt"/);
    assert.match(ctx.body, /<form method="post" action="\/api\/magic-link\/login">/);
    assert.match(ctx.body, /name="loginToken"/);
    assert.equal(ctx.responseHeaders['Cache-Control'], 'no-store');
    assert.equal(ctx.responseHeaders['Referrer-Policy'], 'no-referrer');
  }

  // The link is still unused: the confirmed POST logs the user in once.
  const confirm = createCtx({ method: 'POST', body: { loginToken } });
  await auth.login(confirm);
  assert.equal(confirm.status, 200);
  assert.ok(confirm.body.jwt, 'the user gets the session after confirming');

  const again = createCtx({ method: 'POST', body: { loginToken } });
  await auth.login(again);
  assert.equal(again.status, 400, 'still single use');
});

test('ML-SEC-01: API clients that do not ask for HTML keep the GET exchange (compatibility)', async () => {
  const { magicLinkService } = createLoginCoreStrapi({ users: [USER] });
  for (const headers of [{}, { accept: '*/*' }, { accept: 'application/json' }]) {
    const token = await magicLinkService.createToken(USER.email, {});
    const ctx = createCtx({ query: { loginToken: token._plaintextToken }, headers });
    await auth.login(ctx);
    assert.equal(ctx.status, 200, JSON.stringify(headers));
    assert.ok(ctx.body.jwt, JSON.stringify(headers));
  }
});

test('ML-SEC-01: the confirm page escapes the token and never reflects markup', async () => {
  createLoginCoreStrapi({ users: [USER] });
  const hostile = '"><script>alert(1)</script>';
  const ctx = createCtx({ query: { loginToken: hostile }, headers: { accept: BROWSER_ACCEPT } });
  await auth.login(ctx);
  assert.equal(ctx.status, 200);
  // The page has no script element at all (any case, any attributes).
  assert.equal(ctx.body.toLowerCase().includes('<script'), false);
  assert.match(ctx.body, /&quot;&gt;&lt;script&gt;/);
});

// ─── ML-SEC-02: plain-text fallback of the login e-mail (CodeQL 5-8) ───

test('ML-SEC-02: createPlainTextVersion runs in linear time on adversarial markup', () => {
  for (const input of [
    '<style'.repeat(50_000),
    '<script'.repeat(50_000),
    '<'.repeat(200_000),
    '<style>'.repeat(50_000),
  ]) {
    const ms = elapsedMs(() => createPlainTextVersion(input));
    assert.ok(ms < 200, `${input.slice(0, 8)}... took ${ms.toFixed(1)} ms`);
  }
});

test('ML-SEC-02: createPlainTextVersion decodes entities exactly once and drops script/style bodies', () => {
  assert.equal(createPlainTextVersion('<p>x&amp;lt;b&amp;gt;y</p>'), 'x&lt;b&gt;y');
  assert.equal(
    createPlainTextVersion('<p>Tom &amp; Jerry&nbsp;&quot;ok&quot;</p>'),
    'Tom & Jerry "ok"'
  );
  assert.equal(
    createPlainTextVersion('a<style>p{color:red}</style>b<SCRIPT type="x">alert(1)</script >c'),
    'a b c'
  );
  assert.equal(createPlainTextVersion('a<script>never closed'), 'a');
  assert.equal(createPlainTextVersion('a<b'), 'a');
  assert.equal(
    createPlainTextVersion(
      '<p>Hello</p>\n\n<p><a href="https://example.test/x?a=1&amp;b=2">Log in</a></p>'
    ),
    'Hello Log in'
  );
  assert.equal(createPlainTextVersion(''), '');
});

// ─── ML-SEC-03: reason codes (CodeQL 3) ───

test('ML-SEC-03: toReasonCode stays linear on long underscore runs and keeps its output', () => {
  const ms = elapsedMs(() => toReasonCode(`A${'_'.repeat(50_000)}A`));
  assert.ok(ms < 200, `took ${ms.toFixed(1)} ms`);
  assert.equal(toReasonCode('__smtp 550 / user unknown__'), 'SMTP_550_USER_UNKNOWN');
  assert.equal(toReasonCode('___'), null);
  assert.equal(toReasonCode('x'.repeat(200)).length, 64);
});

// ─── ML-SEC-04: SNS certificate and subscribe URL host allow-list ───

test('ML-SEC-04: only regional SNS endpoints are accepted, not S3 or other AWS hosts', () => {
  for (const host of [
    'sns.us-east-1.amazonaws.com',
    'sns.eu-central-1.amazonaws.com',
    'sns.ap-southeast-7.amazonaws.com',
    'sns.us-gov-west-1.amazonaws.com',
    'sns.cn-north-1.amazonaws.com.cn',
    'sns.cn-northwest-1.amazonaws.com.cn',
  ]) {
    assert.ok(toSnsUrl(`https://${host}/SimpleNotificationService-abc.pem`), host);
  }
  for (const host of [
    // S3 virtual-hosted bucket "sns" (exists, owned by a third party).
    'sns.s3.amazonaws.com',
    'sns.s3-us-west-2.amazonaws.com',
    'sns.s3-website-us-east-1.amazonaws.com',
    'sns.execute-api.amazonaws.com',
    'sns.amazonaws.com',
    'sns.us-east-1.amazonaws.com.evil.test',
  ]) {
    assert.equal(toSnsUrl(`https://${host}/x.pem`), null, host);
  }
  assert.equal(
    snsSubscribeUrl({
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:t',
      SubscribeURL:
        'https://sns.s3.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:us-east-1:123456789012:t',
    }),
    null
  );
});
