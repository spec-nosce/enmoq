# enmoq

> Zero-boilerplate mock infrastructure for Node.js integration tests

## Overview

enmoq provides drop-in mock implementations for every common backend dependency — repository, queue, HTTP, TigerBeetle, ClickHouse — wired automatically into Jest so your test files contain nothing but test logic.

**What makes enmoq different:**

- `setupMocks` / `teardownMocks` / auto-reset run automatically via lifecycle hooks — no `beforeAll`/`afterAll` in your test files
- `useMocks()` gives you typed accessors to every mock instance, sharing the same singletons your services use internally
- HTTP history is persisted to disk after every test automatically — inspect it without adding any code
- Zero network calls, zero external processes

## Installation

```bash
npm install --save-dev enmoq
```

## Setup

### 1. jest.config.js

```javascript
module.exports = {
  testEnvironment: 'node',

  // enmoq registers beforeAll / afterAll / beforeEach automatically
  setupFilesAfterEnv: ['enmoq/src/jest/setup.js'],

  moduleNameMapper: {
    // Route @app-core/* to enmoq mocks
    '^@app-core/repository-factory$': '<rootDir>/node_modules/enmoq/src/core/mock-repository',
    '^@app-core/queue$': '<rootDir>/node_modules/enmoq/src/core/mock-queue',
    '^@app-core/http-request$': '<rootDir>/node_modules/enmoq/src/core/mock-http',
    '^tigerbeetle-node$': '<rootDir>/node_modules/enmoq/src/core/mock-tigerbeetle',

    // Real modules (not mocked)
    '^@app-core/validator$': '<rootDir>/core/validator-vsl',
    '^@app-core/errors$': '<rootDir>/core/errors',
    '^@app-core/logger$': '<rootDir>/core/logger',

    // App aliases
    '^@app/repository/(.*)$': '<rootDir>/repository/$1',
    '^@app/messages/(.*)$': '<rootDir>/messages/$1',
  },

  testTimeout: 30000,
};
```

### 2. enmoq.config.js (project root — optional)

enmoq auto-discovers this file by walking up from `process.cwd()`. All fields are optional.

```javascript
// enmoq.config.js
module.exports = {
  /** Where mock data files are written. Default: .mock-data */
  dataDir: '.mock-data',

  autoReset: {
    /** Clear all queue singletons before each test. Default: true */
    queue: true,

    /** Clear HTTP request history before each test. Default: true */
    http: true,

    /** Persist HTTP history to disk after each test (before clearing).
     *  Writes .mock-data/<session>/http/history.json. Default: true */
    persistHttp: true,

    // All false by default — repository data accumulates across tests in a suite
    repository: false,
    clickhouse: false,
    tigerbeetle: false,
  },
};
```

You can also point to a config file explicitly via the `ENMOQ_CONFIG` environment variable (absolute or cwd-relative path).

## Writing tests

No `beforeAll` / `afterAll` / `beforeEach` needed. enmoq registers them for you.

```javascript
const { useMocks } = require('enmoq');
const createOrder = require('../services/create-order');

const { queue, repository } = useMocks();

describe('createOrder', () => {
  it('creates the record and enqueues a job', async () => {
    const result = await createOrder({ customer_id: '...', item_id: '...', quantity: 1 });

    // Assert what landed in the repository
    const stored = await repository().findOne({ query: { _id: result.id } });
    expect(stored.status).toBe('pending');

    // Assert the queue job
    const jobs = queue('orders').getJobs(['waiting']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data.order_id).toBe(result.id);
  });
});
```

## `useMocks()`

Call once at the top of a test file (module scope). Returns accessors that share the same singleton instances your services hold internally.

```javascript
const { queue, http, repository, clickhouse, tigerbeetle } = useMocks();
```

| Accessor        | Returns                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `queue(name)`   | The `BullMock` singleton for queue name `name` — same object `createQueue({ queueName: name })` returns |
| `http`          | The `MockHttpRequest` module (static interface)                                                         |
| `repository()`  | The `MockRepository` session created during setup                                                       |
| `clickhouse()`  | The `MockClickHouse` instance                                                                           |
| `tigerbeetle()` | The `MockTigerBeetle` instance                                                                          |

## Repository mock

Drop-in replacement for `@app-core/repository-factory`. Backed by an in-memory JSON store scoped per test session.

```javascript
const { repository } = useMocks();

// findOne, findMany, create, update, delete — same API as the real factory
const record = await repository().findOne({ query: { status: 'pending' } });
```

**Supported query operators:** `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$or`, `$and`, `$ne`  
**Supported update operators:** `$set`, `$inc`, `$push`, `$pull`, `$unset`  
**Also supports:** aggregation pipeline, sessions, transactions, soft-delete (`paranoid` flag)

If a Mongoose model matching the collection name exists in `@app/models`, enmoq reads its `__appConfig` (paranoid, uniqueFields, defaults) automatically.

## Queue mock

Drop-in replacement for `@app-core/queue`. Singletons are keyed by queue name and cleared between tests (`autoReset.queue: true`).

```javascript
const { queue } = useMocks();

// Access the same singleton your service used
const jobs = queue('notifications').getJobs(['waiting']);

// Process jobs manually during tests
await queue('notifications').processJobs();

// Register a processor to test job execution
queue('orders').process('process-order', async (job) => {
  // handler body
});
```

**Key queue methods:**

| Method                   | Description                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| `getJobs(statusArray)`   | Returns jobs filtered by status (`waiting`, `active`, `completed`, `failed`) |
| `getJobCounts()`         | Returns counts per status                                                    |
| `processJobs(limit?)`    | Manually triggers processing for waiting jobs                                |
| `process(name, handler)` | Registers a job processor                                                    |
| `empty()`                | Clears in-memory jobs (does not write to disk)                               |
| `pause()` / `resume()`   | Pause/resume processing                                                      |

## HTTP mock

Drop-in replacement for `@app-core/http-request`. Register per-test responses using `behaviorRegistry`, then assert what was called via `getRequestHistory()`.

```javascript
const { http } = useMocks();

// Register a response (same pattern key = overwrites previous)
http.mockHttp.behaviorRegistry.register(
  'GET',
  '/v1/convert', // regex matched against the full URL
  async () => ({ status: 200, body: { rate: 1.18 } }),
  'rates-convert' // name — optional, used for overwriting
);

// Assert what was sent
const history = http.mockHttp.getRequestHistory();
// history entries are flat: { method, url, headers, data, response, timestamp }

const last = http.mockHttp.getLastRequest();
expect(last.url).toContain('from=USD');
```

**`mockHttp` utility methods:**

| Method                                                          | Description                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `behaviorRegistry.register(method, urlPattern, handler, name?)` | Register a mock response. `urlPattern` is used as a regex.                               |
| `getRequestHistory()`                                           | Returns all recorded requests as `{ method, url, headers, data, response, timestamp }[]` |
| `getLastRequest()`                                              | Returns the most recent history entry                                                    |
| `clearHistory()`                                                | Wipe request history only                                                                |
| `clearBehaviors()`                                              | Remove all registered behaviors (leaves history intact — use in `afterEach`)             |
| `clearAll()`                                                    | History + resource registry + state (not behaviors)                                      |
| `reset()`                                                       | Full reset — `clearAll()` + remove behaviors + re-initialize                             |
| `persist()`                                                     | Write history to `.mock-data/<session>/http/history.json`                                |

**HTTP history persistence:**

With `autoReset.persistHttp: true` (default), enmoq's `afterEach` automatically calls `persist()` before the next `beforeEach` clears history. You get a live snapshot of each test's outbound calls at:

```
.mock-data/<session>/http/history.json   ← last test's requests
.mock-data/<session>/http/resources.json
.mock-data/<session>/http/states.json
```

**Per-test behavior isolation:**

Use `clearBehaviors()` in your test file's `afterEach` to prevent registered handlers bleeding between tests. Don't use `clearAll()` here — that wipes history before enmoq can persist it.

```javascript
afterEach(() => {
  http.mockHttp.clearBehaviors();
});
```

**Simulating errors:**

```javascript
http.mockHttp.behaviorRegistry.register(
  'POST',
  '/v1/payments',
  async () => ({ status: 503, body: { message: 'Service Unavailable' } }),
  'payments-down'
);
```

The mock client throws with `error.response.status` set — same shape as a real axios error.

## Data directory

All mock data is written under `dataDir` (default `.mock-data`), scoped by session:

```
.mock-data/
  <session-id>/
    repository/     ← JSON files per collection
    queue/
      <name>/       ← jobs.json per queue
    http/
      history.json  ← persisted request history
      resources.json
      states.json
    clickhouse/
    tigerbeetle/
```

Each Jest run gets a unique session ID (`session-<timestamp>`) unless you set `TEST_SESSION_DIR` explicitly.

## Environment variables

| Variable           | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `ENMOQ_CONFIG`     | Absolute or cwd-relative path to the config file (overrides auto-discovery) |
| `ENMOQ_DEBUG=true` | Log session ID on startup                                                   |
| `MOCK_DATA_DIR`    | Override the data directory without a config file                           |
| `TEST_SESSION_DIR` | Pin the session ID (useful for multi-file test suites that share data)      |
| `RATES_API_URL`    | Example — real services read their base URLs from env; point them anywhere  |

## Exports

```javascript
const {
  // Lifecycle (called automatically by jest/setup.js)
  setupMocks,
  teardownMocks,
  resetMocks,
  getMockInstances,
  getMockDataPath,

  // DX accessor
  useMocks,

  // Raw mock classes (for advanced use)
  MockRepository,
  MockQueue,
  MockHttp,
  MockClickHouse,
  MockTigerBeetle,

  // Jest helpers
  generateJestMappings,
  autoMapCoreModules,
  jestPreset,

  // Session management
  SessionManager,
} = require('enmoq');
```

## License

ISC
