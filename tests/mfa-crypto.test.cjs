'use strict';

/**
 * Secret rules for MAGIC_LINK_ENCRYPTION_KEY / MAGIC_LINK_OTP_PEPPER and key
 * rotation (AUTH-23). Synthetic, runtime-generated keys only.
 */

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const test = require('node:test');

const cryptoUtils = require('../server/src/utils/crypto');
const createOtpService = require('../server/src/services/otp');
const { createMfaStrapi } = require('./helpers/mfa-strapi.cjs');

const ENV_KEYS = [
  'NODE_ENV',
  'MAGIC_LINK_ENCRYPTION_KEY',
  'MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS',
  'MAGIC_LINK_OTP_PEPPER',
  'OTP_PEPPER',
  'MAGIC_LINK_ALLOW_DEV_SECRETS',
];
const randomKey = () => nodeCrypto.randomBytes(32).toString('hex');

/**
 * Runs fn with a controlled environment and restores it afterwards.
 *
 * @param {object} env - Variables to set (undefined deletes).
 * @param {Function} fn - Body.
 * @returns {Promise<void>}
 */
const withEnv = async (env, fn) => {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
};

test('missing secrets stop the start unless development secrets are explicitly allowed', async () => {
  await withEnv({}, () => {
    assert.throws(
      () => cryptoUtils.assertSecretsConfigured(),
      /MAGIC_LINK_ENCRYPTION_KEY is required/
    );
  });
  await withEnv({ NODE_ENV: 'staging', MAGIC_LINK_ENCRYPTION_KEY: randomKey() }, () => {
    assert.throws(() => cryptoUtils.assertSecretsConfigured(), /MAGIC_LINK_OTP_PEPPER is required/);
  });
  await withEnv({ NODE_ENV: 'development', MAGIC_LINK_ALLOW_DEV_SECRETS: 'true' }, () => {
    assert.doesNotThrow(() => cryptoUtils.assertSecretsConfigured());
    assert.equal(cryptoUtils.decrypt(cryptoUtils.encrypt('value')), 'value');
  });
  await withEnv({ NODE_ENV: 'production', MAGIC_LINK_ALLOW_DEV_SECRETS: 'true' }, () => {
    assert.throws(
      () => cryptoUtils.assertSecretsConfigured(),
      /required/,
      'production ignores the dev escape hatch'
    );
  });
});

test('short keys and peppers are rejected', async () => {
  await withEnv(
    { MAGIC_LINK_ENCRYPTION_KEY: 'short-key', MAGIC_LINK_OTP_PEPPER: randomKey() },
    () => {
      assert.throws(() => cryptoUtils.assertSecretsConfigured(), /at least 32 characters/);
    }
  );
  await withEnv(
    { MAGIC_LINK_ENCRYPTION_KEY: randomKey(), MAGIC_LINK_OTP_PEPPER: 'sixteen-chars-xx' },
    () => {
      assert.throws(() => cryptoUtils.assertSecretsConfigured(), /min 32 characters/);
    }
  );
  await withEnv(
    { MAGIC_LINK_ENCRYPTION_KEY: randomKey(), MAGIC_LINK_OTP_PEPPER: randomKey() },
    () => {
      assert.doesNotThrow(() => cryptoUtils.assertSecretsConfigured());
    }
  );
});

test('key rotation: the previous key still decrypts and bootstrap re-encrypts TOTP secrets', async () => {
  const oldKey = 'legacy-short-passphrase';
  const newKey = randomKey();
  const pepper = randomKey();
  let legacyCiphertext;
  await withEnv(
    {
      MAGIC_LINK_ALLOW_DEV_SECRETS: 'true',
      MAGIC_LINK_ENCRYPTION_KEY: oldKey,
      MAGIC_LINK_OTP_PEPPER: pepper,
    },
    () => {
      legacyCiphertext = cryptoUtils.encrypt('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
    }
  );

  await withEnv({ MAGIC_LINK_ENCRYPTION_KEY: newKey, MAGIC_LINK_OTP_PEPPER: pepper }, () => {
    assert.throws(
      () => cryptoUtils.decrypt(legacyCiphertext),
      'without the previous key the old ciphertext fails'
    );
  });

  await withEnv(
    {
      MAGIC_LINK_ENCRYPTION_KEY: newKey,
      MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS: oldKey,
      MAGIC_LINK_OTP_PEPPER: pepper,
    },
    async () => {
      assert.deepEqual(cryptoUtils.decryptWithInfo(legacyCiphertext), {
        value: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        usedPreviousKey: true,
      });
      const { strapi, tables } = createMfaStrapi({
        totpConfigs: [
          {
            id: 1,
            principalType: 'users-permissions',
            principalKey: 'up:1',
            userId: 1,
            email: 'a@example.test',
            secret: legacyCiphertext,
            enabled: true,
          },
        ],
      });
      const stats = await createOtpService({ strapi }).migrateTotpConfigs();
      assert.equal(stats.reencrypted, 1);
      const row = tables['plugin::magic-link.totp-config'].rows[0];
      assert.notEqual(row.secret, legacyCiphertext);
      assert.deepEqual(cryptoUtils.decryptWithInfo(row.secret), {
        value: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        usedPreviousKey: false,
      });
    }
  );
});

test('keyed hashes depend on the pepper and the purpose', async () => {
  await withEnv(
    { MAGIC_LINK_ENCRYPTION_KEY: randomKey(), MAGIC_LINK_OTP_PEPPER: randomKey() },
    () => {
      const a = cryptoUtils.keyedHash('backup-code', 'up:1:CODE');
      assert.match(a, /^[0-9a-f]{64}$/);
      assert.notEqual(a, cryptoUtils.keyedHash('totp-setup', 'up:1:CODE'));
      assert.notEqual(a, nodeCrypto.createHash('sha256').update('up:1:CODE').digest('hex'));
    }
  );
});
