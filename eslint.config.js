import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'public/build/**',
      '.npm-cache/**',
      'drizzle/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Node build/test scripts run outside the browser lint profile.
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
);
