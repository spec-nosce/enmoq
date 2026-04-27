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
  initialize: (options = {}) => {
    const baseUrl = options.baseUrl || '';
    const defaultHeaders = options.headers || {};
    // Return closures that resolve getClient() at request time so that a
    // resetClient() call in setupMocks() does not leave callers pointing at
    // a stale instance.
    return {
      get: (path, config) =>
        getClient().get(`${baseUrl}${path}`, {
          ...config,
          headers: { ...defaultHeaders, ...config?.headers },
        }),
      post: (path, data, config) =>
        getClient().post(`${baseUrl}${path}`, data, {
          ...config,
          headers: { ...defaultHeaders, ...config?.headers },
        }),
      put: (path, data, config) =>
        getClient().put(`${baseUrl}${path}`, data, {
          ...config,
          headers: { ...defaultHeaders, ...config?.headers },
        }),
      patch: (path, data, config) =>
        getClient().patch(`${baseUrl}${path}`, data, {
          ...config,
          headers: { ...defaultHeaders, ...config?.headers },
        }),
      delete: (path, config) =>
        getClient().delete(`${baseUrl}${path}`, {
          ...config,
          headers: { ...defaultHeaders, ...config?.headers },
        }),
    };
  },

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
