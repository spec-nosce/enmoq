/**
 * Helper utilities for working with mocks in tests
 */

const { getMockInstances } = require('./setup');

/**
 * Process pending queue jobs
 * Useful after operations that schedule background jobs
 *
 * @param {string} queueName - Name of the queue to process
 * @param {number} limit - Maximum number of jobs to process (default: 1000)
 * @returns {Promise<number>} Number of jobs processed
 */
async function processQueueJobs(queueName = 'default', limit = 1000) {
  const mockInstances = getMockInstances();
  const { queue } = mockInstances;

  if (!queue) {
    throw new Error(`Queue not available`);
  }

  if (typeof queue.processJobs === 'function') {
    return await queue.processJobs(limit);
  }

  // Fallback for manual processing
  const processed = 0;
  // Implementation depends on queue mock API
  return processed;
}

/**
 * Seed mock data for testing
 *
 * @param {Object} seedData - Data to seed
 * @param {Object} seedData.repository - Repository collections to seed
 * @param {Object} seedData.tigerbeetle - TigerBeetle accounts to seed
 * @param {Object} seedData.clickhouse - ClickHouse data to seed
 * @param {Object} seedData.http - HTTP behaviors to register
 */
async function seedMockData(seedData = {}) {
  const mocks = getMockInstances();

  // Seed TigerBeetle accounts
  if (seedData.tigerbeetle) {
    for (const account of seedData.tigerbeetle.accounts || []) {
      await mocks.tigerbeetle.createAccount(account);
    }
  }

  // Seed ClickHouse data
  if (seedData.clickhouse) {
    for (const [tableName, rows] of Object.entries(seedData.clickhouse)) {
      for (const row of rows) {
        await mocks.clickhouse.insert(tableName, row);
      }
    }
  }

  // Register HTTP behaviors
  if (seedData.http && seedData.http.behaviors) {
    for (const behavior of seedData.http.behaviors) {
      mocks.http.registerBehavior(behavior.pattern, behavior.handler);
    }
  }
}

/**
 * Clear all mock data (destructive)
 */
async function clearAllMockData() {
  const mocks = getMockInstances();

  // Clear repository data
  if (mocks.repository && mocks.repository.clear) {
    await mocks.repository.clear();
  }

  // Clear queue jobs
  if (mocks.queue && mocks.queue.clear) {
    await mocks.queue.clear();
  }

  // Clear HTTP history
  if (mocks.http && mocks.http.clearAll) {
    mocks.http.clearAll();
  }

  // Clear ClickHouse data
  if (mocks.clickhouse && mocks.clickhouse.clear) {
    await mocks.clickhouse.clear();
  }

  // Clear TigerBeetle data
  if (mocks.tigerbeetle && mocks.tigerbeetle.reset) {
    await mocks.tigerbeetle.reset();
  }
}

/**
 * Get mock statistics
 *
 * @returns {Object} Statistics for all mocks
 */
function getMockStatistics() {
  const mocks = getMockInstances();
  const stats = {
    sessionId: mocks.sessionId,
    dataDir: mocks.dataDir,
  };

  // HTTP request count
  if (mocks.http && mocks.http.getRequestHistory) {
    stats.httpRequests = mocks.http.getRequestHistory().length;
  }

  // Queue job count
  if (mocks.queue && mocks.queue.getJobCount) {
    stats.queueJobs = mocks.queue.getJobCount();
  }

  return stats;
}

module.exports = {
  processQueueJobs,
  seedMockData,
  clearAllMockData,
  getMockStatistics,
};
