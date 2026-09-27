// Jest config for the render tests (__tests__/render*.test.tsx): the base
// config, plus transforming ESM dependencies (@solana/*, .mjs) that the
// real screens import. Kept separate so `npm test` is unchanged.
// Run: npm run test:render
const base = require('./jest.config.js');

module.exports = {
  ...base,
  testMatch: ['<rootDir>/__tests__/render*.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {'^.+\\.(js|jsx|ts|tsx|mjs|cjs)$': 'babel-jest'},
  transformIgnorePatterns: [],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json'],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    // web3.js's CJS build requires this package, whose react-native entry can't load under Jest.
    '^rpc-websockets$': '<rootDir>/node_modules/rpc-websockets/dist/index.browser.cjs',
  },
  testTimeout: 60000,
};
