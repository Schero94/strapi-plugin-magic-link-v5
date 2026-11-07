/**
 * ESLint flat config for strapi-plugin-magic-link-v5 (ESLint 10).
 *
 * - @eslint/js recommended rules for every file.
 * - Admin (React, browser, ESM): JSX parsing and the eslint-plugin-react-hooks
 *   recommended preset (rules-of-hooks, exhaustive-deps and the React Compiler
 *   rules shipped in 7.x).
 * - Server (Node, CommonJS): node globals and `strapi` as a readonly global.
 * - Tests and scripts: node globals.
 * - eslint-config-prettier last, so ESLint never fights Prettier.
 *
 * eslint-plugin-jsx-a11y is not used: its latest release (6.10.2, 2024-10)
 * declares peer support only up to ESLint 9, so it is not compatible with the
 * ESLint 10 toolchain. Accessibility is covered by the admin source-guard
 * tests in tests/admin-*.test.cjs instead.
 */

import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';

const unusedVars = [
  'error',
  {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_',
  },
];

export default defineConfig([
  globalIgnores(['dist/**', 'node_modules/**', 'pics/**', 'coverage/**', '.strapi/**']),

  {
    name: 'magic-link/recommended',
    files: ['**/*.{js,jsx,mjs,cjs}'],
    extends: [js.configs.recommended],
    rules: {
      'no-unused-vars': unusedVars,
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    name: 'magic-link/admin',
    files: ['admin/**/*.{js,jsx,mjs}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
  },

  {
    name: 'magic-link/server',
    files: ['server/**/*.js', 'strapi-server.js', 'strapi-admin.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        // Strapi provides this global to every plugin module at runtime.
        strapi: 'readonly',
      },
    },
  },

  {
    name: 'magic-link/node-tooling',
    files: ['tests/**/*.{js,cjs,mjs}', 'scripts/**/*.{js,cjs,mjs}', '*.config.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.node },
    },
  },

  eslintConfigPrettier,
]);
