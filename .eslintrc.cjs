module.exports = {
  root: true,
  env: {browser: true, es2020: true, node: true},
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: {jsx: true}},
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  settings: {react: {version: 'detect'}},
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    // TypeScript's own compiler already catches this (see tsconfig.json's
    // noUnusedLocals/noUnusedParameters), and JSX namespace import
    // requirements changed enough across React 17/18 automatic-runtime
    // configs that this rule causes more false positives than it catches.
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
  },
};
