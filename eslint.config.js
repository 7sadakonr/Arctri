import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'poc/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      // Child processes are only ever started with an argv array; shell strings are not allowed.
      'no-restricted-properties': [
        'error',
        { object: 'child_process', property: 'exec', message: 'Use execFile/spawn with an argv array.' },
        { object: 'child_process', property: 'execSync', message: 'Use execFile/spawn with an argv array.' }
      ],
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'child_process', importNames: ['exec', 'execSync'], message: 'Use execFile/spawn with an argv array.' },
                  { name: 'node:child_process', importNames: ['exec', 'execSync'], message: 'Use execFile/spawn with an argv array.' }] }
      ]
    }
  }
);
