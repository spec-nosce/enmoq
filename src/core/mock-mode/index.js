/**
 * Mock Mode Switcher
 *
 * Enables running the entire application with mock implementations
 * for testing and development purposes.
 *
 * Usage:
 *   USE_MOCKS=true node app.js
 *   NODE_ENV=test npm test
 */

const path = require('path');

const isMockMode = process.env.NODE_ENV === 'test' || process.env.USE_MOCKS === 'true';

/**
 * Get mock or real implementation based on environment
 * @param {string} mockPath - Path to mock implementation (relative to project root)
 * @param {string} realPath - Path to real implementation (relative to project root)
 * @returns {any} - The required module
 */
function getMockOrReal(mockPath, realPath) {
  if (isMockMode) {
    const resolvedMockPath = path.resolve(__dirname, '../..', mockPath);
    return require(resolvedMockPath);
  }

  const resolvedRealPath = path.resolve(__dirname, '../..', realPath);
  return require(resolvedRealPath);
}

/**
 * Get mock or real module with custom loader
 * @param {Function} mockLoader - Function that returns mock implementation
 * @param {Function} realLoader - Function that returns real implementation
 * @returns {any} - The loaded module
 */
function getMockOrRealWithLoader(mockLoader, realLoader) {
  if (isMockMode) {
    return mockLoader();
  }
  return realLoader();
}

/**
 * Check if currently in mock mode
 * @returns {boolean}
 */
function isInMockMode() {
  return isMockMode;
}

/**
 * Get mock session ID for current test/run
 * @returns {string}
 */
function getMockSessionId() {
  return process.env.MOCK_SESSION_ID || `session-${Date.now()}`;
}

/**
 * Get mock data directory with session support
 * @returns {string}
 */
function getMockDataDir() {
  const baseDir = process.env.MOCK_DATA_DIR || path.resolve(__dirname, '../../.mock-data');
  const sessionDir = process.env.TEST_SESSION_DIR || 'default';
  return path.join(baseDir, sessionDir);
}

/**
 * Get test session directory name
 * @returns {string}
 */
function getTestSessionDir() {
  return process.env.TEST_SESSION_DIR || 'default';
}

module.exports = {
  isMockMode,
  isInMockMode,
  getMockOrReal,
  getMockOrRealWithLoader,
  getMockSessionId,
  getMockDataDir,
  getTestSessionDir,
};
