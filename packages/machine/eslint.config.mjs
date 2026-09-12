// @ts-check
import tseslint from 'typescript-eslint';

// This code runs inside the Cartesi Machine and its output is replayed and
// hash-checked in the browser (see dots-engine's docs/PRD-v5.md §11). The
// same determinism ground rules the engine enforces apply here: no wall
// clock, no randomness, stable iteration order anywhere a result feeds a
// hash, a winner, or a forfeit decision.
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: [tseslint.configs.base],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message:
            'Date.now() is non-deterministic. Take timing from the input-metadata timestamp instead.',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'Math.random() is non-deterministic and must never be used here.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ForInStatement',
          message:
            'for...in does not guarantee insertion order for numeric-like keys. Iterate an array or Map with an explicit, stable order instead.',
        },
      ],
    },
  },
);
