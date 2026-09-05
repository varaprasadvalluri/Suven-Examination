import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import boundaries from 'eslint-plugin-boundaries';

// First lint config this repo has ever had — kept intentionally light (non-type-aware rules
// only, no `parserOptions.project`) so the initial rollout doesn't require reconciling the
// two separate tsconfigs (client `tsconfig.json` vs server `tsconfig.server.json`) into one
// linting pass, and stays fast. Type-aware rules are a reasonable future upgrade once this
// baseline is adopted, not a blocker for having linting at all.
export default tseslint.config(
  {
    ignores: ['dist/**', 'Suven-Examination/**', 'node_modules/**', '*.min.js', 'android/**', 'ios/**']
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
    // HEXAGONAL DEPENDENCY RULE — the architecture, enforced.
    //
    // Layout is not the architecture; the direction of imports is. Without this rule the
    // folders are just folders, and the first deadline-pressure `import { clientDb }` from a
    // service quietly turns the whole thing back into a layered monolith with extra
    // directories. Concretely:
    //
    //   ports        -> ports, shared kernel        (interfaces only, no implementations)
    //   application  -> ports, application, kernel  (never an adapter, never composition)
    //   adapters-in  -> ports, application, composition, kernel   (entry points)
    //   adapters-out -> ports, application, kernel                 (leaves; no composition)
    //   composition  -> everything                  (the only place that names both sides)
    //   shared kernel-> shared kernel               (logger/errors/config depend on no layer)
    //
    // `shared/` (client+server domain rules), `server/config.ts` and node_modules are
    // unclassified and so importable from anywhere — which is what we want for pure domain
    // rules and for configuration.
    files: ['server/**/*.ts'],
    plugins: { boundaries },
    settings: {
      // The bundled node resolver only looks for .js/.jsx, so without this every TypeScript
      // import resolves to nothing, every dependency is classified "unknown", and the rule
      // below silently passes on code that violates it.
      'import/resolver': { node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] } },
      'boundaries/elements': [
        { type: 'composition', pattern: 'server/composition', partialMatch: true },
        // Listed before `application` so the more specific path wins the classification.
        { type: 'ports', pattern: 'server/application/ports', partialMatch: true },
        { type: 'application', pattern: 'server/application', partialMatch: true },
        // Split in/out deliberately: an INBOUND adapter (an HTTP controller) is an entry
        // point and may pull the wired graph from the composition root. An OUTBOUND adapter
        // (Firestore, Cloud Tasks, Cloudinary) may not — it is a leaf, and reaching back into
        // composition from one is how a dependency cycle gets built.
        { type: 'adapters-in', pattern: 'server/adapters/in', partialMatch: true },
        { type: 'adapters-out', pattern: 'server/adapters/out', partialMatch: true },
        // Cross-cutting leaves: logger, errors, retry, circuit breaker, request context.
        // Depended on by every layer, depends on none of them.
        { type: 'shared-kernel', pattern: 'server/lib', partialMatch: true }
      ]
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'ports' } },
              allow: { to: { element: { types: { anyOf: ['ports', 'shared-kernel'] } } } }
            },
            {
              from: { element: { type: 'application' } },
              allow: { to: { element: { types: { anyOf: ['ports', 'application', 'shared-kernel'] } } } }
            },
            {
              from: { element: { type: 'adapters-in' } },
              allow: {
                to: { element: { types: { anyOf: ['ports', 'application', 'adapters-in', 'composition', 'shared-kernel'] } } }
              }
            },
            {
              from: { element: { type: 'adapters-out' } },
              allow: { to: { element: { types: { anyOf: ['ports', 'application', 'adapters-out', 'shared-kernel'] } } } }
            },
            {
              from: { element: { type: 'composition' } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ['ports', 'application', 'adapters-in', 'adapters-out', 'composition', 'shared-kernel'] }
                  }
                }
              }
            },
            {
              from: { element: { type: 'shared-kernel' } },
              allow: { to: { element: { type: 'shared-kernel' } } }
            }
          ]
        }
      ]
    }
  },
  {
    // LEGACY DEBT LIST — routes that still reach Firestore directly instead of going through
    // a DAO port. This is pre-existing drift, not something the hexagonal move introduced:
    // these predate the port layer and each needs its own read moved behind a Dao or the
    // DocumentStore before it can come off this list.
    //
    // This list may only ever get SHORTER. A new file added here should be a deliberate,
    // argued decision, not a way to silence the rule — the point of naming them individually
    // rather than allowing `adapters-in -> adapters-out` wholesale is that the debt stays
    // countable and every new route is held to the rule by default.
    files: [
      'server/adapters/in/http/routes/adminDb.ts',
      'server/adapters/in/http/routes/authRoutes.ts',
      'server/adapters/in/http/routes/db.ts',
      'server/adapters/in/http/routes/exams.ts',
      'server/adapters/in/http/routes/gatekeeper.ts',
      'server/adapters/in/http/routes/gcp.ts',
      'server/adapters/in/http/routes/health.ts',
      'server/adapters/in/http/routes/reports.ts',
      'server/adapters/in/http/routes/v1/ExamQuestionController.ts',
      'server/adapters/in/http/routes/v1/LoginOptionsController.ts',
      'server/adapters/in/http/routes/v1/SchoolController.ts',
      'server/adapters/in/http/routes/v1/StudentController.ts',
      'server/adapters/in/http/routes/v1/createNamedListController.ts'
    ],
    rules: { 'boundaries/dependencies': 'off' }
  },
  {
    // Tests may reach across layers: an adapter's contract test legitimately constructs the
    // use case it falls back to, and a controller test rebuilds the whole graph from fakes.
    // The rule protects production import direction, not test wiring.
    files: ['server/**/*.test.ts'],
    rules: { 'boundaries/dependencies': 'off' }
  },
  {
    // FEATURE BOUNDARY RULE — the frontend counterpart to the hexagonal rule above.
    //
    // A feature owns its screens, hooks and data calls. Other features see only what its
    // index.ts chooses to export. Without this, `features/` is the old flat components/
    // folder with more nesting: the first `import { Thing } from '../staff/components/Big'`
    // welds two features together and neither can be changed or deleted independently again.
    //
    //   features/*   -> its own internals, other features' index.ts, shared, ui, lib
    //   shared, ui   -> shared, ui, lib   (never a feature — that inverts the dependency)
    //   app          -> everything        (composes the features into routes)
    //
    // `app` may reach a feature's internals as well as its index.ts: it is the composition
    // point, and App.tsx lazy-imports screens by path for code splitting.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] } },
      'boundaries/elements': [
        // Each feature folder is its own element, so boundaries can tell one from another.
        // The app shell composes features into routes, so it may import all of them. Kept
        // as its own type rather than lumped into `shared`, because "shared" must never
        // depend on a feature — that inverts the dependency and re-couples everything.
        { type: 'app', pattern: 'src/app', partialMatch: true },
        { type: 'feature', pattern: 'src/features/*', capture: ['featureName'] },
        { type: 'ui', pattern: 'src/components/ui', partialMatch: true },
        { type: 'shared', pattern: 'src/shared', partialMatch: true },
        { type: 'lib', pattern: 'src/lib', partialMatch: true },
        { type: 'lib', pattern: 'src/services', partialMatch: true }
      ]
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'feature' } },
              allow: { to: { element: { types: { anyOf: ['ui', 'shared', 'lib'] } } } }
            },
            // No policy is needed for a feature importing its own internals: boundaries
            // only evaluates dependencies that CROSS an element, so intra-feature imports
            // are never subject to this rule.
            // Across features, only the barrel. A selector may carry `element` OR `file`, not
            // both, so this is expressed purely as "the dependency is an index.ts" — which
            // says exactly what we mean here, since features are the only things with one:
            // `features/staff` resolves to its index.ts and is allowed, while
            // `features/staff/components/AdminExams` is not.
            {
              from: { element: { type: 'feature' } },
              allow: { to: { file: { path: '**/index.ts' } } }
            },
            // Inside its own feature, anything goes.
            {
              from: { element: { types: { anyOf: ['shared', 'ui', 'lib'] } } },
              allow: { to: { element: { types: { anyOf: ['shared', 'ui', 'lib'] } } } }
            },
            {
              from: { element: { type: 'app' } },
              allow: { to: { element: { types: { anyOf: ['app', 'feature', 'shared', 'ui', 'lib'] } } } }
            }
          ]
        }
      ]
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
  },
  {
    // Developer tooling run directly with `node` (ESM, not bundled by Vite or esbuild) —
    // needs Node globals for console/process/Buffer. Only the block above for *.ts/tsx
    // declares globals, so without this every console.log here is a no-undef error.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    }
  }
);
