'use strict';

const { randomBytes } = require('node:crypto');

const URL_SAFE_ALPHABET = '_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Generate a cryptographically random, URL-safe identifier. */
module.exports = (size = 21) => {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError('Identifier size must be a non-negative safe integer');
  }

  const bytes = randomBytes(size);
  let id = '';
  for (const byte of bytes) id += URL_SAFE_ALPHABET[byte & 63];
  return id;
};
