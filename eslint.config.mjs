// ESLint flat config (ESLint 9+/10+ style).
//
// Scope: TypeScript across the whole app (main + renderer + shared libs),
// plus React Hooks rules for the renderer/component tree. Kept close to each
// plugin's own "recommended" preset rather than hand-picking rules, since
// this is a first-time introduction of linting to an existing large
// codebase — see CLAUDE.md for the main/renderer/preload split this config
// mirrors.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
      'coverage/**',
      '.claude/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },

  // Base JS + TypeScript recommended rules everywhere.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // TypeScript handles undeclared-variable checking better than ESLint's
  // own no-undef (which doesn't understand TS types/ambient globals and
  // produces false positives); this is the standard pairing recommended by
  // typescript-eslint.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-undef': 'off',
    },
  },

  // Main process, preload, and Node-side scripts/tests run under Node, not
  // a browser.
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'scripts/**/*.js',
      '*.config.{js,ts,mjs,cjs}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Renderer + shared UI code runs in the browser (Electron's renderer
  // process) and additionally gets React Hooks linting.
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // NOTE: intentionally not spreading reactHooks.configs.flat.recommended
      // wholesale. eslint-plugin-react-hooks v7's "recommended" preset bundles
      // in a large set of new React-Compiler-readiness rules (static-components,
      // purity, immutability, set-state-in-render, error-boundaries, gating,
      // refs, ...) that flag long-standing, non-buggy patterns (e.g. a small
      // component declared inline in a render function) as hard *errors*
      // across this codebase, which isn't a React-Compiler target and has no
      // such adoption plan. That would turn "add a linter" into "triage a
      // large rewrite", which is out of scope here. Sticking to the two
      // classic hook-correctness rules that predate the Compiler-oriented
      // preset (and that every prior version of this plugin recommended).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // electron.d.ts and other ambient declaration files intentionally declare
  // globals/interfaces without local usage.
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // Vitest/Playwright test files: Node environment plus Vitest's injected
  // globals (vitest.config.ts sets `globals: true`).
  {
    files: [
      'src/main/tests/**/*.ts',
      'src/test/**/*.ts',
      'test/**/*.ts',
      'e2e/**/*.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
  },
);
