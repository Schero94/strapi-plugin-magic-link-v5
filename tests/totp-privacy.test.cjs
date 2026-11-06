'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createOtpService = require('../server/src/services/otp');

test('TOTP setup does not write the principal ID or email to logs', async () => {
  const messages = [];
  const strapi = {
    store: () => ({ get: async () => ({}) }),
    log: Object.fromEntries(['info', 'warn', 'error', 'debug'].map((level) => [
      level, (...args) => messages.push(args.join(' ')),
    ])),
    documents: () => ({
      findMany: async () => [],
      create: async () => ({}),
    }),
  };
  const service = createOtpService({ strapi });

  await service.setupTOTP(932781, 'private-person@example.test');

  assert.doesNotMatch(messages.join('\n'), /932781|private-person@example\.test/);
});
