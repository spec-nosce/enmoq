/**
 * Jest setup file for enmoq
 *
 * Loaded via Jest's `setupFilesAfterFramework` (or `setupFilesAfterEnv`).
 * The synchronous module-level code runs before any test file is required,
 * so env vars set here are visible to top-level require() calls in tests.
 *
 * Lifecycle hooks (beforeAll / afterAll / beforeEach) are registered
 * automatically — consumers do NOT need to call setupMocks() themselves.
 *
 * Configuration is read from `enmoq.config.js` in the project root
 * (or via the ENMOQ_CONFIG environment variable).
 *
 * @example enmoq.config.js
 * module.exports = {
 *   dataDir: 'test-data',
 *   autoReset: { queue: true, http: true },
 * };
 */

const path = require('path');
const { loadConfig } = require('../utils/config-loader');
const { setupMocks, teardownMocks } = require('..');
const MockHttpRequest = require('../core/mock-http');
const { clearAllQueues } = require('../core/mock-queue');

// ---------------------------------------------------------------------------
// Synchronous initialisation — runs before any test module is loaded
// ---------------------------------------------------------------------------

process.env.USE_MOCKS = 'true';
process.env.NODE_ENV = 'test';

const projectConfig = loadConfig();

const defaultAutoReset = {
  queue: true,
  http: true,
  repository: false,
  clickhouse: false,
  tigerbeetle: false,
  // Persist HTTP history to disk after each test before clearing.
  // Produces .mock-data/<session>/http/history.json for post-mortem inspection.
  persistHttp: true,
};
const autoReset = { ...defaultAutoReset, ...(projectConfig.autoReset || {}) };

const DATA_DIR = path.resolve(
  process.cwd(),
  projectConfig.dataDir || process.env.MOCK_DATA_DIR || '.mock-data'
);
process.env.MOCK_DATA_DIR = DATA_DIR;

if (!process.env.TEST_SESSION_DIR) {
  process.env.TEST_SESSION_DIR = `session-${Date.now()}`;
}

if (!global.mockSession) {
  global.mockSession = {
    id: process.env.TEST_SESSION_DIR,
    startTime: new Date().toISOString(),
  };
}

if (process.env.ENMOQ_DEBUG === 'true') {
  // eslint-disable-next-line no-console
  console.log('[enmoq] mock environment initialised — session:', global.mockSession.id);
}

// ---------------------------------------------------------------------------
// Jest lifecycle hooks — registered automatically for every test file
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await setupMocks({
    ...projectConfig,
    sessionId: process.env.TEST_SESSION_DIR,
    dataDir: DATA_DIR,
  });
});

afterAll(async () => {
  await teardownMocks();
});

afterEach(() => {
  // Persist HTTP history BEFORE clearing so devs can inspect it on disk.
  // The file is rewritten after every test — the last test's history survives.
  // Set autoReset.persistHttp: false in enmoq.config.js to disable.
  if (autoReset.persistHttp) {
    MockHttpRequest.mockHttp.persist();
  }
});

beforeEach(async () => {
  if (autoReset.queue) {
    await clearAllQueues();
  }
  if (autoReset.http) {
    MockHttpRequest.mockHttp.clearHistory();
  }
});
