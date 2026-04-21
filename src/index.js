/**
 * enmoq - Comprehensive Mock Testing Infrastructure
 *
 * Main entry point for the package
 */

// Mode control
const mockMode = require('./core/mock-mode');

// Mock implementations
const MockRepository = require('./core/mock-repository');
const MockQueue = require('./core/mock-queue');
const MockHttp = require('./core/mock-http');
const MockClickHouse = require('./core/mock-clickhouse');
const { TigerBeetleMock: MockTigerBeetle } = require('./core/mock-tigerbeetle');

// Utilities
const { setupMocks, getMockInstances, getMockDataPath } = require('./utils/setup');
const { teardownMocks } = require('./utils/teardown');
const { resetMocks } = require('./utils/reset');
const SessionManager = require('./utils/session-manager');
const { useMocks } = require('./utils/use-mocks');
const {
  processQueueJobs,
  seedMockData,
  clearAllMockData,
  getMockStatistics,
} = require('./utils/helpers');

// Jest integration
const { generateJestMappings } = require('./jest/generate-mappings');
const { autoMapCoreModules } = require('./jest/auto-map');
const jestPreset = require('./config/jest-preset');

module.exports = {
  // Mode control
  mockMode,
  isInMockMode: mockMode.isInMockMode,
  getMockSessionId: mockMode.getMockSessionId,
  getMockDataDir: mockMode.getMockDataDir,

  // Mock implementations
  MockRepository,
  MockQueue,
  MockHttp,
  MockClickHouse,
  MockTigerBeetle,

  // Utilities
  setupMocks,
  teardownMocks,
  resetMocks,
  getMockInstances,
  getMockDataPath,
  SessionManager,
  useMocks,

  // Helpers
  processQueueJobs,
  seedMockData,
  clearAllMockData,
  getMockStatistics,

  // Jest integration
  generateJestMappings,
  autoMapCoreModules,
  jestPreset,
};
