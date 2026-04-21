const { appLogger } = require('../../utils/logger');

class Configuration {
  constructor() {
    this.config = {
      enabled: process.env.USE_MOCK_HTTP_REQUEST === 'true',
      mode: process.env.MOCK_HTTP_MODE || 'permissive', // strict, permissive, passthrough
      logLevel: process.env.MOCK_HTTP_LOG_LEVEL || 'info',
      enablePersistence: process.env.MOCK_HTTP_ENABLE_PERSISTENCE === 'true',
      persistencePath: process.env.MOCK_HTTP_PERSISTENCE_PATH || './mock-data-registry.json',
      networkSimulation: {
        enabled: false,
        baseDelay: 0,
        jitter: 0,
        failureRate: 0,
      },
    };
  }

  isEnabled() {
    return this.config.enabled;
  }

  getMode() {
    return this.config.mode;
  }

  get(key) {
    return this.config[key];
  }

  set(key, value) {
    this.config[key] = value;
  }

  setMode(mode) {
    if (!['strict', 'permissive', 'passthrough'].includes(mode)) {
      appLogger.error({ mode }, 'invalid-mock-mode');
      throw new Error(`Invalid mode: ${mode}. Must be strict, permissive, or passthrough`);
    }
    this.config.mode = mode;
  }

  enableNetworkSimulation(options) {
    this.config.networkSimulation = {
      enabled: true,
      baseDelay: options.baseDelay || 100,
      jitter: options.jitter || 50,
      failureRate: options.failureRate || 0,
    };
  }

  disableNetworkSimulation() {
    this.config.networkSimulation.enabled = false;
  }

  shouldLog(level) {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    return levels[level] <= levels[this.config.logLevel];
  }
}

module.exports = new Configuration();
