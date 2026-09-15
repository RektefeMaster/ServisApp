import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/*.d.ts',
      '**/.next/**',
      '**/.expo/**',
      // Admin panelinin kendi flat config'i var (eslint-config-next).
      '**/apps/admin/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // React Native ekranları: bayat closure ve eksik bağımlılık bu kurallarla
    // yakalanır. Şoför ekranında bayat bir closure, sunucuya hiç ulaşmayan bir
    // "bindi" işareti demektir.
    files: [
      'apps/crew/**/*.tsx',
      'apps/crew/**/*.ts',
      'apps/parent/**/*.tsx',
      'apps/parent/**/*.ts',
    ],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/src/e2e/**', '**/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // Expo iskele dosyaları tsconfig kapsamında değil; tip bilgisi isteyen
    // kurallar bunlarda çalışamaz.
    files: ['**/babel.config.js', '**/metro.config.js', '**/*.config.js'],
    languageOptions: { parserOptions: { projectService: false, project: null } },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-undef': 'off',
      // Metro ve Babel yapılandırması CommonJS olmak zorunda.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
