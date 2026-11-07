'use strict';

/**
 * Bundles an admin source module (JSX/ESM) with esbuild and loads it as CommonJS,
 * so admin helpers can be tested behaviourally under node:test.
 * npm packages stay external and resolve from the plugin's node_modules;
 * `stubs` replaces selected package imports (e.g. '@strapi/strapi/admin').
 */
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..', '..');

const buildOptions = (entry) => ({
  entryPoints: [entry],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  // admin/jsconfig.json says "jsx": "react"; Strapi's Vite build uses the automatic runtime.
  tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
  loader: { '.js': 'jsx', '.jsx': 'jsx', '.json': 'json' },
  packages: 'external',
  logLevel: 'silent',
});

/**
 * @param {string} relativePath - path from the plugin root, e.g. 'admin/src/utils/theme.js'
 * @param {{stubs?: Record<string, unknown>}} [options]
 * @returns {any} module.exports of the bundled module
 */
function loadAdminModule(relativePath, { stubs = {} } = {}) {
  const entry = path.join(ROOT, relativePath);
  const result = esbuild.buildSync(buildOptions(entry));
  return evaluateBundle(result.outputFiles[0].text, entry, stubs);
}

/**
 * Async variant that can keep relative imports matching `externalPattern`
 * out of the bundle (they resolve to `stubs[importPath]` at runtime).
 * @param {string} relativePath
 * @param {{stubs?: Record<string, unknown>, externalPattern?: RegExp}} [options]
 */
async function loadAdminModuleAsync(relativePath, { stubs = {}, externalPattern } = {}) {
  const entry = path.join(ROOT, relativePath);
  const plugins = externalPattern
    ? [
        {
          name: 'external-relative',
          setup(build) {
            build.onResolve({ filter: externalPattern }, (args) => ({
              path: args.path,
              external: true,
            }));
          },
        },
      ]
    : [];
  const result = await esbuild.build({ ...buildOptions(entry), plugins });
  return evaluateBundle(result.outputFiles[0].text, entry, stubs);
}

function evaluateBundle(code, entry, stubs) {
  const baseRequire = Module.createRequire(entry);
  const stubbedRequire = (request) =>
    Object.hasOwn(stubs, request) ? stubs[request] : baseRequire(request);

  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(
    stubbedRequire,
    mod,
    mod.exports,
    entry,
    path.dirname(entry)
  );
  return mod.exports;
}

/**
 * WCAG 2.x contrast ratio between two #rrggbb colours.
 * @param {string} a
 * @param {string} b
 */
function contrastRatio(a, b) {
  const luminance = (hex) => {
    const value = hex.replace('#', '');
    const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
    const [r, g, bl] = channels.map((c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

module.exports = { loadAdminModule, loadAdminModuleAsync, contrastRatio, ROOT };
