module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: [
    require.resolve('@react-native/jest-preset/jest/setup.js'),
  ],
  moduleNameMapper: {
    // Same fix as mango-mobile's jest.config.js: @react-native-async-
    // storage/async-storage v3 moved its test mock to an ESM module whose
    // default export is a ready-to-use in-memory store — has to be wired
    // in as the module resolution itself, not just required as a setupFile.
    '^@react-native-async-storage/async-storage$': '@react-native-async-storage/async-storage/jest',
  },
  // The render tests need extra transforms — they run via jest.render.config.js (npm run test:render).
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/render'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-async-storage)/)',
  ],
};
