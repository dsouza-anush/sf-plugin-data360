import eslint from '@eslint/js';
import sfPlugin from 'eslint-plugin-sf-plugin';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: {
      'sf-plugin': sfPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './test/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'sf-plugin/dash-o': 'error',
      'sf-plugin/no-duplicate-short-characters': 'error',
      'sf-plugin/no-h-short-char': 'error',
      'sf-plugin/no-hardcoded-messages-commands': 'error',
      'sf-plugin/no-hardcoded-messages-flags': 'error',
      'sf-plugin/no-json-flag': 'error',
      'sf-plugin/no-missing-messages': 'error',
      'sf-plugin/only-extend-SfCommand': 'error',
    },
  },
  {
    files: ['testbed/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        clearTimeout: 'readonly',
        performance: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    ignores: ['lib/**', 'coverage/**', 'node_modules/**', 'references/**'],
  }
);
