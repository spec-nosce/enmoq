/**
 * Teardown utilities for cleaning up mocks
 *
 * Adapted from tests/fixtures/setup-mocks.js
 */

const { getMockInstances } = require('./setup');

/**
 * Teardown all mocks and clean up resources
 * Call this in afterAll() or at the end of your test file
 *
 * @returns {Promise<void>}
 */
async function teardownMocks() {
  let mockInstances;

  try {
    mockInstances = getMockInstances();
  } catch (error) {
    // Mocks not initialized, nothing to teardown
    return;
  }

  try {
    // Repository uses endSession to cleanup
    if (mockInstances.repository && mockInstances.repository.endSession) {
      mockInstances.repository.endSession();
    }

    // Queue uses close()
    if (mockInstances.queue && mockInstances.queue.close) {
      await mockInstances.queue.close();
    }

    // HTTP uses reset()
    if (mockInstances.http && mockInstances.http.reset) {
      mockInstances.http.reset();
    }

    // ClickHouse uses reset()
    if (mockInstances.clickhouse && mockInstances.clickhouse.reset) {
      await mockInstances.clickhouse.reset();
    }

    // TigerBeetle uses reset()
    if (mockInstances.tigerbeetle && mockInstances.tigerbeetle.reset) {
      await mockInstances.tigerbeetle.reset();
    }

    // Remove global reference
    delete global.mockSession;
  } catch (error) {
    console.error('[enmoq] Error during teardown:', error);
    throw error;
  }
}

module.exports = {
  teardownMocks,
};
