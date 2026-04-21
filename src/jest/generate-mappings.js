/**
 * Generate Jest moduleNameMapper entries for enmoq
 */

/**
 * Generate Jest module mappings for specified modules
 *
 * @param {Object} options - Configuration options
 * @param {string} options.projectRoot - Project root directory
 * @param {string[]} options.modules - Array of module names to map
 * @returns {Object} Jest moduleNameMapper configuration
 *
 * @example
 * const mappings = generateJestMappings({
 *   projectRoot: __dirname,
 *   modules: ['repository-factory', 'queue', 'http-request']
 * });
 */
function generateJestMappings(options = {}) {
  const { modules = [], projectRoot = process.cwd() } = options;

  const mappings = {};

  // Map each specified module to its enmoq implementation
  modules.forEach((moduleName) => {
    // Convert module name to mock directory name
    const mockName = moduleNameToMockName(moduleName);

    // Create Jest mapping
    mappings[`^@app-core/${moduleName}$`] = `<rootDir>/node_modules/enmoq/src/core/${mockName}`;
  });

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
  generateJestMappings,
  moduleNameToMockName,
};
