/**
 * Default configuration for enmoq
 */

module.exports = {
  // Global settings
  mode: process.env.NODE_ENV === 'test' ? 'test' : 'development',
  dataDir: './.mock-data',
  sessionDir: 'default',
  autoPersist: true,

  // Repository mock
  repository: {
    enabled: true,
    dataDir: './.mock-data/{session}/repository',
    autoPersist: true,
  },

  // Queue mock
  queue: {
    enabled: true,
    dataDir: './.mock-data/{session}/queue',
    processMode: 'manual', // 'manual' | 'auto'
    autoPersist: true,
  },

  // HTTP mock
  http: {
    enabled: true,
    mode: 'strict', // 'strict' | 'permissive' | 'passthrough'
    logLevel: 'info', // 'debug' | 'info' | 'warn' | 'error' | 'silent'
    enablePersistence: false,
    persistencePath: './.mock-data/{session}/http-registry.json',
    behaviorsDir: null, // Allow custom behaviors
  },

  // ClickHouse mock
  clickhouse: {
    enabled: true,
    dataDir: './.mock-data/{session}/clickhouse',
    autoPersist: true,
  },

  // TigerBeetle mock
  tigerbeetle: {
    enabled: true,
    persistenceDir: './.mock-data/{session}/tigerbeetle',
    autoPersist: true,
    persistOnOperation: ['createAccounts', 'createTransfers'],
    persistDebounceMs: 0, // No debounce for tests
    restoreOnInit: true,  // Auto-load prior session data on startup — state accumulates across files
  },
};
