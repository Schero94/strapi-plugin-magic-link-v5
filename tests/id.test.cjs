'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const createId = require('../server/src/utils/id');
const createMagicLinkService = require('../server/src/services/magic-link');

test('crypto IDs keep the configured length and URL-safe alphabet', () => {
  for (const length of [8, 12, 20, 32]) {
    const id = createId(length);
    assert.equal(id.length, length);
    assert.match(id, /^[A-Za-z0-9_-]+$/);
  }
});

test('crypto IDs do not repeat across a small sample', () => {
  const values = Array.from({ length: 100 }, () => createId(12));
  assert.equal(new Set(values).size, values.length);
});

test('magic-link tokens retain configured length and hashed storage', async () => {
  let created;
  const service = createMagicLinkService({
    strapi: {
      store: () => ({ get: async () => ({ token_length: 24, expire_period: 300 }) }),
      documents: () => ({
        create: async ({ data }) => {
          created = data;
          return { documentId: 'token-doc', ...data };
        },
      }),
    },
  });

  const result = await service.createToken('Person@Example.Test');

  assert.equal(result.token.length, 24);
  assert.match(result.token, /^[A-Za-z0-9_-]+$/);
  assert.equal(created.email, 'person@example.test');
  assert.notEqual(created.token, result.token);
  assert.equal(created.token_prefix, result.token.slice(0, 8));
});
