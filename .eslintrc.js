const prettierrc = require('./.prettierrc.js')

module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  ignorePatterns: [
    'dist',
    // Who watches the watchers?
    '.eslintrc.js',
  ],
  rules: {
    // VS Code linting will not respect the `.prettierrc` options unless injected here:
    'prettier/prettier': ['warn', prettierrc],
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
}
