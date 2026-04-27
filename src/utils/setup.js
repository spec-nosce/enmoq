/**
 * Setup utilities for initializing mocks
 *
 * Adapted from tests/fixtures/setup-mocks.js
 */

const path = require('path');
const defaultConfig = require('../config/default-config');

// Mock instances (initialized in setupMocks)
let mockInstances = null;

/**
 * Generate session ID
 */
function generateSessionId() {
  return `session-${Date.now()}`;
}

/**
 * Setup all mocks with optional configuration
 *
 * @param {Object} options - Configuration options
 * @param {string} options.sessionId - Session ID (default: auto-generated)
 * @param {string} options.dataDir - Data directory (default: ./.mock-data)
 * @param {boolean} options.autoPersist - Enable auto-persistence (default: true)
 * @param {Object} options.repository - Repository mock config
 * @param {Object} options.queue - Queue mock config
 * @param {Object} options.http - HTTP mock config
 * @param {Object} options.clickhouse - ClickHouse mock config
 * @param {Object} options.tigerbeetle - TigerBeetle mock config
 * @returns {Promise<Object>} Mock session object
 */
async function setupMocks(options = {}) {
  if (mockInstances) return mockInstances;

  const config = { ...defaultConfig, ...options };

  const sessionId = options.sessionId || generateSessionId();
  const dataDir = options.dataDir || config.dataDir;
  const autoPersist = options.autoPersist !== undefined ? options.autoPersist : config.autoPersist;

  // Set environment variables for mock-mode functions
  // Resolve dataDir from the caller's context (process.cwd())
  const resolvedDataDir = path.isAbsolute(dataDir) ? dataDir : path.resolve(process.cwd(), dataDir);

  process.env.TEST_SESSION_DIR = sessionId;
  process.env.MOCK_DATA_DIR = resolvedDataDir;

  // Import mocks
  const MockRepository = require('../core/mock-repository');
  const BullMock = require('../core/mock-queue');
  const MockHttpRequest = require('../core/mock-http');
  const ClickHouseMock = require('../core/mock-clickhouse');
  const { TigerBeetleMock } = require('../core/mock-tigerbeetle');

  // Set custom HTTP behaviors path if provided
  if (options.http && options.http.behaviorsPath) {
    process.env.MOCK_HTTP_BEHAVIORS_PATH = path.resolve(process.cwd(), options.http.behaviorsPath);
  }

  // Reset HTTP mock singleton to pick up new environment variables
  MockHttpRequest.mockHttp.resetClient();

  // Initialize repository mock
  const repositorySession = MockRepository.createSession({
    sessionId,
    dataDir: path.join(dataDir, sessionId, 'repository'),
    autoPersist,
    ...config.repository,
  });

  // Initialize queue mock
  // IMPORTANT: spread config.queue FIRST so explicit options override defaults.
  // If ...config.queue is last, its dataDir ('./.mock-data/{session}/queue')
  // overwrites the correctly computed path built above.
  const queueSession = new BullMock('default-queue', {
    ...config.queue,
    sessionId,
    dataDir: path.join(dataDir, sessionId, 'queue'),
    autoPersist,
  });

  // Initialize HTTP mock (singleton)
  const httpSession = MockHttpRequest;

  // Initialize ClickHouse mock
  // IMPORTANT: spread config.clickhouse FIRST so explicit options override defaults.
  // If ...config.clickhouse is last, its dataDir ('./.mock-data/{session}/clickhouse')
  // overwrites the correctly computed path built above.
  const clickhouseSession = new ClickHouseMock({
    ...config.clickhouse,
    sessionId,
    dataDir: path.join(dataDir, sessionId, 'clickhouse'),
    autoPersist,
    persistDebounce: 0, // immediate persistence for tests
  });

  // Wire the singleton used by createClient() (and therefore by imported helpers
  // like `findMany` / `insert`) to the same instance created here.
  ClickHouseMock.setSharedInstance(clickhouseSession);

  // Initialize TigerBeetle mock
  // IMPORTANT: spread config.tigerbeetle FIRST so explicit options override defaults.
  // If ...config.tigerbeetle is last, its persistenceDir ('./.mock-data/{session}/tigerbeetle')
  // overwrites the correctly computed path built above.
  const tigerbeetleSession = new TigerBeetleMock({
    ...config.tigerbeetle,
    sessionId,
    persistenceDir: path.join(dataDir, sessionId, 'tigerbeetle'),
    autoPersist,
  });

  // Wire the singleton used by createClient() to the same instance created here.
  const { setSharedInstance: setTbSharedInstance } = require('../core/mock-tigerbeetle');
  setTbSharedInstance(tigerbeetleSession);

  // Auto-restore: load any state already on disk for this session.
  // Enables state accumulation across test files without any developer action.
  // Disable via restoreOnInit: false in the tigerbeetle block of enmoq.config.js.
  const restoreOnInit = config.tigerbeetle && config.tigerbeetle.restoreOnInit !== false;
  if (restoreOnInit) {
    await tigerbeetleSession.restore();
  }

  // Store instances
  mockInstances = {
    sessionId,
    dataDir,
    repository: repositorySession,
    queue: queueSession,
    http: httpSession,
    clickhouse: clickhouseSession,
    tigerbeetle: tigerbeetleSession,
  };

  // Make available globally for convenience
  global.mockSession = mockInstances;

  return mockInstances;
}

/**
 * Get current mock instances
 * @returns {Object} Mock instances
 */
function getMockInstances() {
  if (!mockInstances) {
    throw new Error('Mocks not initialized. Call setupMocks() first.');
  }
  return mockInstances;
}

/**
 * Get the path to persisted mock data
 * @returns {string|null} Path to mock data directory
 */
function getMockDataPath() {
  if (!mockInstances) {
    return null;
  }
  return mockInstances.dataDir;
}

module.exports = {
  setupMocks,
  getMockInstances,
  getMockDataPath,
};
