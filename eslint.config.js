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
);
