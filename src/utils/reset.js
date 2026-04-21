/**
 * Reset utilities for clearing mock data between tests
 *
 * Adapted from tests/fixtures/setup-mocks.js
 */

const { getMockInstances } = require('./setup');

/**
 * Reset mock state between tests
 * Call this in beforeEach() or between test cases
 *
 * Note: Data is NOT cleared to preserve persistence.
 * Tests should use unique identifiers (timestamps, ULIDs) to avoid conflicts.
 *
 * @returns {Promise<void>}
 */
async function resetMocks() {
  const mockInstances = getMockInstances();

  // Reset stateless mock behaviors
  if (mockInstances.http && mockInstances.http.reset) {
    mockInstances.http.reset();
  }

  // Other mocks maintain their data for persistence debugging
  // If you need to clear data, use teardownMocks() and setupMocks()
}

module.exports = {
  resetMocks,
};
