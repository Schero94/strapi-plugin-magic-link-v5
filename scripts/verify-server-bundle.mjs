import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const outputs = [
  ['CommonJS', require('../dist/server/index.js')],
  ['ESM', await import('../dist/server/index.mjs')],
];

for (const [format, loaded] of outputs) {
  const plugin = loaded.default || loaded;
  assert.equal(typeof plugin.controllers.auth.sendLink, 'function', `${format} auth controller is missing`);
  assert.equal(typeof plugin.services['magic-link'], 'function', `${format} magic-link service is missing`);
  assert.equal(typeof plugin.services['rate-limiter'], 'function', `${format} rate-limiter is missing`);
  assert.equal(plugin.controllers.whatsapp, undefined, `${format} includes the removed controller`);
  assert.equal(plugin.services.whatsapp, undefined, `${format} includes the removed transport`);
  assert.equal(plugin.routes.admin.routes.some((route) => route.path.startsWith('/whatsapp/')), false);
}

console.log('Magic Link server bundles load and expose email/auth services without local WhatsApp ownership');
