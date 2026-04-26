/**
 * Minimal ESLint flat config for strapi-plugin-magic-link-v5.
 *
 * Goal: catch *correctness* bugs at build time without drowning the codebase
 * in style noise. The most important rule is `no-undef` — that single rule
 * would have prevented issue #17 (`emailTemplates is not defined`) from ever
 * shipping.
 *
 * If you ever want to expand this (recommended set, hooks deps, etc.),
 * just enable more rules below; this config is intentionally conservative
 * so it stays green on the existing codebase.
 */

import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';

const correctnessRules = {
  // The bug class issue #17 belongs to: referencing a variable / state hook
  // that was never declared. Catching this once is worth the entire setup.
  'no-undef': 'error',

  // Other "you almost certainly meant something else" bugs.
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-redeclare': 'error',
  'no-self-assign': 'error',
  'no-cond-assign': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  // Warn on unused vars but don't block the build — too noisy for legacy code.
  'no-unused-vars': [
    'warn',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    },
  ],
};

export default [
  // ---------------------------------------------------------------------------
  // Global ignores (must be a config object containing ONLY `ignores`)
  // ---------------------------------------------------------------------------
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'pics/**',
      // Legacy backup file kept for reference, not part of the build:
      'admin/src/pages/Settings/index.jsx.old',
      // Local dev helper, not shipped:
      'test-magic-link.js',
    ],
  },

  // ---------------------------------------------------------------------------
  // Admin panel (React, browser, ESM)
  // ---------------------------------------------------------------------------
  {
    files: ['admin/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: {
      react: { version: '18.3' },
    },
    rules: {
      ...correctnessRules,
      // Without these two, `no-undef` / `no-unused-vars` would misreport
      // identifiers that are used only inside JSX (e.g. <MyComp />).
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
    },
  },

  // ---------------------------------------------------------------------------
  // Server (Node.js, CommonJS)
  // ---------------------------------------------------------------------------
  {
    files: ['server/**/*.js', 'strapi-server.js', 'strapi-admin.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2022,
        // Strapi injects this global into every plugin module at runtime.
        strapi: 'readonly',
      },
    },
    rules: correctnessRules,
  },
];
