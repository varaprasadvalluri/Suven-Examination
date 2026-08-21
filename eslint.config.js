import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

// First lint config this repo has ever had — kept intentionally light (non-type-aware rules
// only, no `parserOptions.project`) so the initial rollout doesn't require reconciling the
// two separate tsconfigs (client `tsconfig.json` vs server `tsconfig.server.json`) into one
// linting pass, and stays fast. Type-aware rules are a reasonable future upgrade once this
// baseline is adopted, not a blocker for having linting at all.
export default tseslint.config(
  {
    ignores: ['dist/**', 'Suven-Examination/**', 'node_modules/**', '*.min.js']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // This codebase leans on `any` deliberately in a lot of Firestore-doc-shaped code
      // (raw documents don't have a fixed TS shape at the boundary) — enforcing this now,
      // on a first lint pass with zero prior linting, would be hundreds of pre-existing
      // warnings with no immediate fix, not a real signal. Revisit once the codebase has
      // had a chance to adopt stricter typing incrementally.
      '@typescript-eslint/no-explicit-any': 'off',
      // Same reasoning — a first-pass rollout shouldn't hard-fail on every unused catch-
      // block variable or work-in-progress import; downgraded to a warning instead of off
      // so it's visible without blocking `eslint .` on a fresh clone.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    // Standalone Node CLI script (see its own header comment) — plain CommonJS, run directly
    // via `node load-test.cjs`, not part of the Vite/tsx build. Needs Node globals + require().
    files: ['load-test.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      // `const { URL } = require('url')` shadows the ambient Node global of the same name —
      // completely normal/intentional in a CommonJS script, not an actual redeclaration bug.
      'no-redeclare': 'off'
    }
  },
  {
    // k6 load-test script — runs inside the k6 binary's own JS runtime, not Node or a
    // browser, so it has its own globals (__ENV/__VU/__ITER) that neither globals.node nor
    // globals.browser know about.
    files: ['k6-load-test.js'],
    languageOptions: {
      globals: { ...globals.node, __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' }
    }
  }
);
