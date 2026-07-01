import { defineConfig } from 'eslint/config'
import importPlugin from 'eslint-plugin-import'
import prettierPlugin from 'eslint-plugin-prettier/recommended'
import tseslint from 'typescript-eslint'

import prettierrc from './.prettierrc.js'

export default defineConfig(tseslint.configs.recommended, prettierPlugin, {
  plugins: { import: importPlugin },
  rules: {
    'prettier/prettier': ['error', prettierrc],
    '@typescript-eslint/no-explicit-any': 'off',
    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/no-duplicates': 'error',
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', ['parent', 'sibling', 'index']],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
  },
})
