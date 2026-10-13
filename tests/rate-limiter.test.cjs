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
        get: async () => ({ rate_limit_enabled: true, rate_limit_max_attempts: 1, rate_limit_window_minutes: 1 }),
      }),
      log: Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [
        level,
        (...values) => logs.push(values.map(String).join(' ')),
      ])),
    },
  });

  assert.deepEqual(await service.checkRateLimit(blockedIdentifier, 'ip'), { allowed: true, retryAfter: 0 });
  const rejected = await service.checkRateLimit(blockedIdentifier, 'ip');

  assert.equal(rejected.allowed, false);
  assert.ok(rejected.retryAfter > 0);
  assert.equal(logs.join('\n').includes(blockedIdentifier), false);
});
