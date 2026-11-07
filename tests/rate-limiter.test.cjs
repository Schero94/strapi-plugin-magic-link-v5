'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const createRateLimiter = require('../server/src/services/rate-limiter');

test('rate limits requests while redacting the blocked identifier from logs', async () => {
  const blockedIdentifier = '+49123456789';
  const logs = [];
  const service = createRateLimiter({
    strapi: {
      store: () => ({
        get: async () => ({
          rate_limit_enabled: true,
          rate_limit_max_attempts: 1,
          rate_limit_window_minutes: 1,
        }),
      }),
      log: Object.fromEntries(
        ['debug', 'info', 'warn', 'error'].map((level) => [
          level,
          (...values) => logs.push(values.map(String).join(' ')),
        ])
      ),
    },
  });

  assert.deepEqual(await service.checkRateLimit(blockedIdentifier, 'ip'), {
    allowed: true,
    retryAfter: 0,
  });
  const rejected = await service.checkRateLimit(blockedIdentifier, 'ip');

  assert.equal(rejected.allowed, false);
  assert.ok(rejected.retryAfter > 0);
  assert.equal(logs.join('\n').includes(blockedIdentifier), false);
});

test('cleanup does not clear unexpired counters and reset clears counters without losing settings', async () => {
  const service = createRateLimiter({
    strapi: {
      store: () => ({
        get: async () => ({
          rate_limit_enabled: true,
          rate_limit_max_attempts: 1,
          rate_limit_window_minutes: 5,
        }),
      }),
      log: { debug() {}, info() {}, warn() {}, error() {} },
    },
  });

  assert.equal((await service.checkRateLimit('local-id', 'ip')).allowed, true);
  assert.equal((await service.checkRateLimit('local-id', 'ip')).allowed, false);

  await service.cleanupExpired();
  assert.equal(
    (await service.checkRateLimit('local-id', 'ip')).allowed,
    false,
    'manual cleanup must not erase an unexpired limit'
  );

  await service.resetAll();
  assert.equal(
    (await service.checkRateLimit('local-id', 'ip')).allowed,
    true,
    'explicit reset must clear active in-memory counters'
  );
  assert.equal(
    (await service.getStats()).maxAttempts,
    1,
    'reset must retain the configured limit values'
  );
});

test('code-verification limiter stays on when public rate limiting is disabled (FUN-M02)', async () => {
  const { VERIFY_LIMIT } = createRateLimiter;
  const service = createRateLimiter({
    strapi: {
      store: () => ({
        get: async () => ({
          rate_limit_enabled: false,
          rate_limit_max_attempts: 1,
          rate_limit_window_minutes: 1,
        }),
      }),
      log: { debug() {}, info() {}, warn() {}, error() {} },
    },
  });

  for (let i = 0; i < 5; i += 1) {
    assert.equal((await service.checkRateLimit('198.51.100.20', 'ip')).allowed, true);
    assert.equal((await service.checkRateLimit('login-key', 'login')).allowed, true);
  }

  for (let i = 0; i < VERIFY_LIMIT.points; i += 1) {
    assert.equal((await service.checkRateLimit('verify:up:7', 'verify')).allowed, true);
  }
  const denied = await service.checkRateLimit('verify:up:7', 'verify');
  assert.equal(denied.allowed, false, 'the 11th code check within the window is refused');
  assert.ok(denied.retryAfter > 0);
  assert.equal(
    (await service.checkRateLimit('verify:up:8', 'verify')).allowed,
    true,
    'other accounts keep their own budget'
  );
});
