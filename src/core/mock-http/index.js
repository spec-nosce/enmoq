const config = require('./config');
const MockHttpClient = require('./mock-client');

let clientInstance = null;

function getClient() {
  if (!clientInstance) {
    const path = require('path');
    const { getMockDataDir } = require('../mock-mode');

    // Get session from environment
    const sessionId = process.env.TEST_SESSION_DIR || 'default';
    const persistencePath = path.join(getMockDataDir(), 'http', 'resources.json');
    const statesPath = path.join(getMockDataDir(), 'http', 'states.json');
    const historyPath = path.join(getMockDataDir(), 'http', 'history.json');

    // Allow custom behaviors path from environment
    const behaviorsPath = process.env.MOCK_HTTP_BEHAVIORS_PATH || null;

    clientInstance = new MockHttpClient({
      sessionId,
      persistencePath,
      statesPath,
      historyPath,
      behaviorsPath,
    });
  }
  return clientInstance;
}

function resetClient() {
  clientInstance = null;
}

// Export functions matching axios interface
module.exports = {
  request: (requestConfig) => getClient().request(requestConfig),
  get: (url, configOrOptions) => getClient().get(url, configOrOptions),
  post: (url, data, configOrOptions) => getClient().post(url, data, configOrOptions),
  put: (url, data, configOrOptions) => getClient().put(url, data, configOrOptions),
  patch: (url, data, configOrOptions) => getClient().patch(url, data, configOrOptions),
  delete: (url, configOrOptions) => getClient().delete(url, configOrOptions),
  initialize: (options) => getClient().initialize(options),

  // Testing utilities
  mockHttp: {
    getRequestHistory: () => getClient().getRequestHistory(),
    getLastRequest: () => getClient().getLastRequest(),
    clearHistory: () => getClient().clearHistory(),
    clearAll: () => getClient().clearAll(),
    clearBehaviors: () => getClient().clearBehaviors(),
    reset: () => getClient().reset(),
    resetClient: () => resetClient(),
    persist: () => getClient().persist(),
    setBehaviorsPath: (path) => {
      process.env.MOCK_HTTP_BEHAVIORS_PATH = path;
      resetClient(); // Reset to pick up new path
    },
    get resourceRegistry() {
      return getClient().resourceRegistry;
    },
    get stateManager() {
      return getClient().stateManager;
    },
    get behaviorRegistry() {
      return getClient().behaviorRegistry;
    },
    config,
  },
};
