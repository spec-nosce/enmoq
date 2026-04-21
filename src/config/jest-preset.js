/**
 * Jest preset configuration for enmoq
 *
 * Usage:
 * // jest.config.js
 * const { jestPreset } = require('enmoq');
 *
 * module.exports = {
 *   ...jestPreset,
 *   // your overrides
 * };
 */

module.exports = {
  testEnvironment: 'node',

  setupFilesAfterEnv: ['<rootDir>/node_modules/enmoq/src/jest/setup.js'],

  modulePathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.mock-data/'],

  testPathIgnorePatterns: ['/node_modules/'],

  testTimeout: 30000,
};
