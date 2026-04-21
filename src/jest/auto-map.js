/**
 * Auto-detect and map mockable core modules
 */

const fs = require('fs');
const path = require('path');

/**
 * Automatically map all mockable core modules
 *
 * @param {Object} options - Configuration options
 * @param {string} options.coreDir - Path to core directory (Jest format: '<rootDir>/core')
 * @param {string[]} options.exclude - Modules to exclude from mocking
 * @returns {Object} Jest moduleNameMapper configuration
 *
 * @example
 * const mappings = autoMapCoreModules({
 *   coreDir: '<rootDir>/core',
 *   exclude: ['logger', 'errors', 'validator']
 * });
 */
function autoMapCoreModules(options = {}) {
  const { coreDir, exclude = [] } = options;

  // Define mockable modules (modules that have mock implementations)
  const mockableModules = [
    'repository-factory',
    'queue',
    'http-request',
    'clickhouse',
    'tigerbeetle',
    'mongoose',
  ].filter((mod) => !exclude.includes(mod));

  const mappings = {};

  // Create mappings for each mockable module
  mockableModules.forEach((moduleName) => {
    const mockName = moduleNameToMockName(moduleName);

    mappings[`^@app-core/${moduleName}$`] = `<rootDir>/node_modules/enmoq/src/core/${mockName}`;
  });

  // Alias mappings — same mock, different package path
  // @nuvion-core/app-core/http-request is the standalone extraction of @app-core/http-request
  if (!exclude.includes('http-request')) {
    mappings[`^@nuvion-core/app-core/http-request$`] = `<rootDir>/node_modules/enmoq/src/core/mock-http`;
  }

  // Third-party package mocks
  // `resend` is used directly (not via @app-core alias) — map it unless excluded
  if (!exclude.includes('resend')) {
    mappings[`^resend$`] = `<rootDir>/node_modules/enmoq/src/core/mock-resend`;
  }

  // `tigerbeetle-node` is used directly (not via @app-core alias)
  if (!exclude.includes('tigerbeetle-node')) {
    mappings[`^tigerbeetle-node$`] = `<rootDir>/node_modules/enmoq/src/core/mock-tigerbeetle`;
  }

  return mappings;
}

/**
 * Convert module name to mock directory name
 *
 * @param {string} moduleName - Module name (e.g., 'repository-factory')
 * @returns {string} Mock directory name (e.g., 'mock-repository')
 */
function moduleNameToMockName(moduleName) {
  const mapping = {
    'repository-factory': 'mock-repository',
    queue: 'mock-queue',
    'http-request': 'mock-http',
    clickhouse: 'mock-clickhouse',
    tigerbeetle: 'mock-tigerbeetle',
    mongoose: 'mock-mongoose',
    resend: 'mock-resend',
    'tigerbeetle-node': 'mock-tigerbeetle',
  };

  return mapping[moduleName] || `mock-${moduleName}`;
}

module.exports = {
  autoMapCoreModules,
  moduleNameToMockName,
};
