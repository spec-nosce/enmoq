const path = require('path');
const { appLogger } = require('../../utils/logger');
const config = require('./config');
const BehaviorRegistry = require('./behavior-registry');
const BehaviorContext = require('./behavior-context');
const ResourceRegistry = require('./resource-registry');
const StateManager = require('./state-manager');
const RequestHistory = require('./request-history');

class MockHttpClient {
  constructor(options = {}) {
    this.sessionId = options.sessionId || 'default';
    this.persistencePath = options.persistencePath || null;
    this.statesPath = options.statesPath || null;
    this.historyPath = options.historyPath || null;
    this.behaviorsPath = options.behaviorsPath || null;

    this.behaviorRegistry = new BehaviorRegistry();
    this.resourceRegistry = new ResourceRegistry();
    this.stateManager = new StateManager();
    this.requestHistory = new RequestHistory();
    this.behaviorContext = new BehaviorContext(
      this.resourceRegistry,
      this.stateManager,
      this.requestHistory
    );

    this._initialized = false;
  }

  _ensureInitialized() {
    if (!this._initialized) {
      // Load behaviors from custom path or default internal path
      const behaviorsPath = this.behaviorsPath || path.join(__dirname, 'behaviors');
      this.behaviorRegistry.loadBehaviors(behaviorsPath);

      if (this.persistencePath && config.get('enablePersistence')) {
        this.resourceRegistry.load(this.persistencePath);
      }

      this._initialized = true;
    }
  }

  async request(requestConfig) {
    this._ensureInitialized();

    const method = (requestConfig.method || 'GET').toUpperCase();
    const { url } = requestConfig;
    const data = requestConfig.data || null;
    const headers = requestConfig.headers || {};

    if (config.shouldLog('info')) {
      appLogger.info({ method, url }, 'mock-http-request');
    }

    await this.behaviorContext.applyNetworkSimulation(config.get('networkSimulation'));

    const match = this.behaviorRegistry.find(method, url);

    if (!match) {
      return this._handleNoMatch(method, url, requestConfig);
    }

    const { behavior, urlParams } = match;

    try {
      const request = {
        method,
        url,
        data,
        headers,
        urlParams,
      };

      const response = await behavior.handler(request, this.behaviorContext);

      this.requestHistory.record(request, response, behavior.name);

      if (response.status >= 200 && response.status < 300) {
        return {
          statusCode: response.status,
          status: response.status,
          statusText: this._getStatusText(response.status),
          headers: response.headers || {},
          data: response.body,
          config: requestConfig,
        };
      }
      const error = new Error(`Request failed with status code ${response.status}`);
      error.response = {
        status: response.status,
        statusText: this._getStatusText(response.status),
        headers: response.headers || {},
        data: response.body,
        config: requestConfig,
      };
      error.status = response.status;
      throw error;
    } catch (error) {
      if (error.response) {
        throw error;
      }

      appLogger.error({ error, method, url }, 'mock-http-behavior-error');
      const behaviorError = new Error(`Behavior execution error: ${error.message}`);
      behaviorError.response = {
        status: 500,
        statusText: 'Internal Server Error',
        data: { message: error.message },
      };
      throw behaviorError;
    }
  }

  _handleNoMatch(method, url, requestConfig) {
    const mode = config.getMode();

    if (mode === 'strict') {
      appLogger.error({ method, url, mode }, 'mock-http-no-behavior-match');
      const error = new Error(`No mock behavior found for ${method} ${url}`);
      error.response = {
        status: 501,
        statusText: 'Not Implemented',
        data: { message: `No mock behavior registered for ${method} ${url}` },
      };
      throw error;
    }

    if (mode === 'permissive') {
      appLogger.warn({ method, url, mode }, 'mock-http-no-behavior-match-default');

      // Record in history even without behavior
      const request = {
        method,
        url,
        data: requestConfig.data || null,
        headers: requestConfig.headers || {},
      };
      const response = {
        status: 200,
        body: { message: 'Default mock response' },
        headers: {},
      };
      this.requestHistory.record(request, response, 'default');

      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { message: 'Default mock response' },
        config: requestConfig,
      };
    }

    if (mode === 'passthrough') {
      appLogger.warn({ method, url, mode }, 'mock-http-passthrough-not-implemented');
      throw new Error('Passthrough mode not yet implemented');
    }

    throw new Error(`Invalid mode: ${mode}`);
  }

  _getStatusText(status) {
    const statusTexts = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      500: 'Internal Server Error',
      501: 'Not Implemented',
      503: 'Service Unavailable',
    };
    return statusTexts[status] || 'Unknown';
  }

  async get(url, configOrOptions) {
    const config = typeof configOrOptions === 'object' ? configOrOptions : {};
    return this.request({ ...config, method: 'GET', url });
  }

  async post(url, data, configOrOptions) {
    const config = typeof configOrOptions === 'object' ? configOrOptions : {};
    return this.request({ ...config, method: 'POST', url, data });
  }

  async put(url, data, configOrOptions) {
    const config = typeof configOrOptions === 'object' ? configOrOptions : {};
    return this.request({ ...config, method: 'PUT', url, data });
  }

  async patch(url, data, configOrOptions) {
    const config = typeof configOrOptions === 'object' ? configOrOptions : {};
    return this.request({ ...config, method: 'PATCH', url, data });
  }

  async delete(url, configOrOptions) {
    const config = typeof configOrOptions === 'object' ? configOrOptions : {};
    return this.request({ ...config, method: 'DELETE', url });
  }

  initialize(options = {}) {
    const baseUrl = options.baseUrl || '';
    const defaultHeaders = options.headers || {};
    const timeout = options.timeout || 30000;

    return {
      get: (path, config) =>
        this.get(`${baseUrl}${path}`, {
          ...config,
          headers: { ...defaultHeaders, ...config?.headers },
        }),
      post: (path, data, config) =>
        this.post(`${baseUrl}${path}`, data, {
          ...config,
          headers: { ...defaultHeaders, ...config?.headers },
        }),
      put: (path, data, config) =>
        this.put(`${baseUrl}${path}`, data, {
          ...config,
          headers: { ...defaultHeaders, ...config?.headers },
        }),
      patch: (path, data, config) =>
        this.patch(`${baseUrl}${path}`, data, {
          ...config,
          headers: { ...defaultHeaders, ...config?.headers },
        }),
      delete: (path, config) =>
        this.delete(`${baseUrl}${path}`, {
          ...config,
          headers: { ...defaultHeaders, ...config?.headers },
        }),
    };
  }

  // Testing utilities
  getRequestHistory() {
    return this.requestHistory.getAll();
  }

  getLastRequest() {
    return this.requestHistory.getLast();
  }

  clearHistory() {
    this.requestHistory.clear();
  }

  clearAll() {
    this.requestHistory.clear();
    this.resourceRegistry.clearAll();
    this.stateManager.resetAll();
  }

  clearBehaviors() {
    this.behaviorRegistry.behaviors.clear();
  }

  reset() {
    this.clearAll();
    this.behaviorRegistry.clear();
    this._initialized = false;
  }

  persist() {
    const fs = require('fs');
    const path = require('path');

    if (!this.persistencePath) {
      return;
    }

    // Ensure directory exists
    const dir = path.dirname(this.persistencePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Save resources
    this.resourceRegistry.save(this.persistencePath);

    // Save states
    if (this.statesPath) {
      const states = this.stateManager.getAllStates();
      fs.writeFileSync(this.statesPath, JSON.stringify(states, null, 2), 'utf8');
    }

    // Save history
    if (this.historyPath) {
      const history = this.requestHistory.getAll();
      fs.writeFileSync(this.historyPath, JSON.stringify(history, null, 2), 'utf8');
    }
  }
}

module.exports = MockHttpClient;
