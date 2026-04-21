# enmoq Usage Guide

Zero-boilerplate mock infrastructure for Node.js integration tests. Replaces Mongoose, Bull queue, and HTTP client dependencies with in-memory fakes that are wired into Jest automatically — no `beforeAll`/`afterAll` in your test files.

**Feature-specific guides:**
- [docs/http-usage.md](docs/http-usage.md) — HTTP request mocking, built-in behaviors, magic values
- [docs/repository-usage.md](docs/repository-usage.md) — Repository (MongoDB) mocking, CRUD, query operators, transactions
- [docs/queue-usage.md](docs/queue-usage.md) — Bull queue mocking, processing modes, retry, events
- [docs/tigerbeetle-usage.md](docs/tigerbeetle-usage.md) — TigerBeetle ledger mocking, transfers, two-phase commit
- [docs/clickhouse-usage.md](docs/clickhouse-usage.md) — ClickHouse mocking, SQL queries, aggregations

---

## Installation

```bash
npm install --save-dev enmoq
```

**Peer dependency:** Jest 27+

---

## Setup

Two files to create at the project root. Both are one-time setup.

### jest.config.js

```javascript
module.exports = {
  testEnvironment: 'node',
  rootDir: __dirname,

  // enmoq registers beforeAll / afterAll / beforeEach automatically.
  // No lifecycle hooks needed in test files.
  setupFilesAfterEnv: ['enmoq/src/jest/setup.js'],

  moduleNameMapper: {
    // ── Mock intercepts ────────────────────────────────────────────────────
    '^@app-core/repository-factory$': '<rootDir>/node_modules/enmoq/src/core/mock-repository',
    '^@app-core/mongoose$':           '<rootDir>/node_modules/enmoq/src/core/mock-repository',
    '^@app-core/queue$':              '<rootDir>/node_modules/enmoq/src/core/mock-queue',
    '^@app-core/http-request$':       '<rootDir>/node_modules/enmoq/src/core/mock-http',
    '^tigerbeetle-node$':             '<rootDir>/node_modules/enmoq/src/core/mock-tigerbeetle',

    // ── Real modules (not mocked) ──────────────────────────────────────────
    '^@app-core/validator$':   '<rootDir>/core/validator-vsl',
    '^@app-core/errors$':      '<rootDir>/core/errors',
    '^@app-core/logger$':      '<rootDir>/core/logger',
    '^@app-core/randomness$':  '<rootDir>/core/randomness',

    // ── App aliases ────────────────────────────────────────────────────────
    '^@app/repository/(.*)$':  '<rootDir>/repository/$1',
    '^@app/messages/(.*)$':    '<rootDir>/messages/$1',
    '^@app/services/(.*)$':    '<rootDir>/services/$1',
  },

  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/prompts/'],
  testTimeout: 30000,
};
```

### enmoq.config.js

Optional. enmoq auto-discovers this file from `process.cwd()`. All fields have defaults.

> `autoReset` controls per-mock reset behaviour before each test. See the feature guides for what each flag affects: [repository](docs/repository-usage.md#cross-test-persistence), [HTTP](docs/http-usage.md#per-test-isolation), [queue](docs/queue-usage.md#per-test-isolation), [ClickHouse](docs/clickhouse-usage.md#per-test-isolation), [TigerBeetle](docs/tigerbeetle-usage.md#per-test-isolation).

```javascript
// enmoq.config.js
module.exports = {
  /** Directory for persisted mock data. Default: .mock-data */
  dataDir: '.mock-data',

  autoReset: {
    queue:       true,   // Clear all queue singletons before each test
    http:        true,   // Clear HTTP request history before each test
    persistHttp: true,   // Write HTTP history to disk after each test (for inspection)
    repository:  false,  // INTENTIONAL — repository data accumulates across tests in a suite
    clickhouse:  false,
    tigerbeetle: false,
  },
};
```

> **Why `repository: false`?** Tests within a suite share in-memory state by design. A record created in one test is readable in the next — this enables uniqueness constraint tests and cross-entity assertions without extra seed setup. See [docs/repository-usage.md → Cross-test persistence](docs/repository-usage.md#cross-test-persistence) for a full explanation.

---

## Running Tests

```bash
# All tests
npm run test:jest

# Single file
npx jest --config=jest.config.js tests/admin/create-trivia.test.js
```

---

## Test Coverage Reports

Two options — pick whichever fits your workflow.

### Option 1 — CLI flag (recommended)

Add a dedicated script to your project's `package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:coverage": "jest --coverage"
  }
}
```

Then run:

```bash
npm run test:coverage
```

Coverage is only collected when you explicitly call that script. Regular `npm test` runs stay fast.

### Option 2 — Always-on via `jest.config.js`

Set `collectCoverage: true` directly in your config:

```javascript
// jest.config.js
module.exports = {
  // ...your existing jest config...
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  collectCoverageFrom: ['services/**/*.js', '!**/__tests__/**'],
};
```

This runs coverage on every `jest` invocation, which adds overhead. Prefer Option 1 unless CI always needs the report.

> **enmoq.config.js is not involved.** Jest resolves its own config before any setup files run, so coverage settings cannot be passed through `enmoq.config.js`. Set them directly in your `jest.config.js` as shown above — enmoq does not interfere with any coverage options.

---

## Writing Tests

### File placement

Mirror the `services/` directory structure under `tests/`:

```
tests/
  admin/
    create-trivia.test.js
    edit-trivia.test.js
  [domain]/
    [service-name].test.js
```

### Imports

```javascript
const { ulid } = require('ulid');

const createThing = require('../../services/[domain]/[service]');
const ThingRepository = require('../../repository/[thing]');
const ThingMessages = require('../../messages/[thing]');
```

- Import the **service under test** directly
- Import **repository modules** for post-call persistence assertions
- Import **message files** for error matching — never hardcode error strings

### No lifecycle hooks

enmoq registers `beforeAll`, `afterAll`, and `beforeEach` automatically. Never write them yourself.

```javascript
// ❌ Don't do this
beforeAll(async () => { ... });
afterAll(async () => { ... });

// ✅ Just write describe/it blocks
describe('createThing', () => {
  it('creates a thing', async () => { ... });
});
```

### basePayload factory

Always use a `basePayload()` factory with an `overrides` parameter:

```javascript
const id = () => ulid();

function basePayload(overrides = {}) {
  return {
    title: 'Default Title',
    slug: `thing-${id().toLowerCase()}`,
    user_id: id(),
    ...overrides,
  };
}
```

> If the validator spec applies a `lowercase` transform to a field, the test value must also be lowercase — use `id().toLowerCase()` for ULID-based slugs.

### File structure

```javascript
describe('[serviceName]', () => {
  describe('happy path', () => {
    it('returns the created record with the correct shape', async () => { ... });
    it('persists the record to the repository', async () => { ... });
  });

  describe('[feature group]', () => { ... });

  describe('[constraint] uniqueness', () => {
    it('throws DUPLICATE_RECORD when [field] already exists', async () => { ... });
    it('allows two records with different [field]s', async () => { ... });
  });

  describe('validation errors', () => {
    // one it() per error branch
  });
});
```

---

## Assertions

### Return shape

```javascript
const result = await createThing(payload);

expect(result).toMatchObject({
  title: payload.title,
  slug: payload.slug,
});
expect(typeof result._id).toBe('string');
expect(result._id.length).toBeGreaterThan(0);
expect(result.created).toBeGreaterThan(0);
```

### Repository persistence

Always read back from the repository to verify what was actually stored. For the full repository API — query operators, update operators, aggregation, transactions, and soft-delete behaviour — see [docs/repository-usage.md](docs/repository-usage.md).

```javascript
const result = await createThing(payload);

const stored = await ThingRepository.findOne({ query: { _id: result._id } });

expect(stored).not.toBeNull();
expect(stored.title).toBe(payload.title);
```

### Error assertion

Match against message file constants — never hardcode strings. Use the **resolved string value** of the error code, not the property name:

```javascript
await expect(createThing(invalidPayload)).rejects.toMatchObject({
  isApplicationError: true,
  message: ThingMessages.SOME_ERROR_KEY,
  errorCode: 'RESOURCE_NOT_FOUND', // resolved value of ERROR_CODE.NOTFOUND
});
```

Common `errorCode` resolved values:

| Constant            | Resolved string       |
| ------------------- | --------------------- |
| `ERROR_CODE.NOTFOUND`     | `'RESOURCE_NOT_FOUND'`  |
| `ERROR_CODE.DUPLICATE`    | `'DUPLICATE_RECORD'`    |
| `ERROR_CODE.UNPROCESSABLE`| `'UNPROCESSABLE_ENTITY'`|
| `ERROR_CODE.FORBIDDEN`    | `'FORBIDDEN'`           |

### Related-entity assertion

When a service creates child records alongside the main document:

```javascript
const winners = await WinnersRepository.findMany({
  query: { trivia_id: result._id.toString() },
  options: { sort: { rank: 1 } },
});

expect(winners).toHaveLength(3);
expect(winners[0]).toMatchObject({ rank: 1, prize: 5000 });
winners.forEach((w) => expect(w.winner_id).toBeUndefined());
```

---

## Queue assertions (`useMocks`)

When a service enqueues jobs, use `useMocks()` to inspect them. For the full queue API — processing modes, retry, events, and disk persistence — see [docs/queue-usage.md](docs/queue-usage.md).

```javascript
const { useMocks } = require('enmoq');

const { queue } = useMocks();

it('enqueues a notification job', async () => {
  await createThing(basePayload());

  const jobs = queue('notifications').getJobs(['waiting']);
  expect(jobs).toHaveLength(1);
  expect(jobs[0].data.thing_id).toBeDefined();
});
```

Call `useMocks()` once at the module scope (top of the test file). It returns accessors that share the exact same singleton instances your services hold internally.

```javascript
const { queue, http, repository } = useMocks();
```

| Accessor        | Returns                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| `queue(name)`   | The `BullMock` singleton for that queue name                                    |
| `http`          | The `MockHttpRequest` module (static interface)                                 |
| `repository()`  | The `MockRepository` session                                                    |
| `clickhouse()`  | The `MockClickHouse` instance                                                   |
| `tigerbeetle()` | The `MockTigerBeetle` instance                                                  |

### Key queue methods

| Method                   | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `getJobs(statusArray)`   | Returns jobs by status (`waiting`, `active`, `completed`, `failed`) |
| `getJobCounts()`         | Returns counts per status                                      |
| `processJobs(limit?)`    | Manually triggers processing of waiting jobs                   |
| `process(name, handler)` | Registers a job processor                                      |
| `empty()`                | Clears in-memory jobs                                          |

See [docs/queue-usage.md](docs/queue-usage.md) for the full method reference.

---

## HTTP assertions (`useMocks`)

Register mock responses and assert outbound calls. For the full HTTP mock API — built-in behaviors, magic values, URL pattern matching, state progression, and network simulation — see [docs/http-usage.md](docs/http-usage.md).

```javascript
const { http } = useMocks();

// Register a response before calling the service
http.mockHttp.behaviorRegistry.register(
  'GET',
  '/v1/convert',          // matched as a regex against the full URL
  async () => ({ status: 200, body: { rate: 1.18 } }),
  'rates-convert'         // optional name — used to overwrite later
);

await myService(payload);

// Assert what was sent
const last = http.mockHttp.getLastRequest();
expect(last.url).toContain('from=USD');
expect(last.method).toBe('GET');
```

### Simulating errors

```javascript
http.mockHttp.behaviorRegistry.register(
  'POST',
  '/v1/payments',
  async () => ({ status: 503, body: { message: 'Service Unavailable' } }),
  'payments-down'
);
```

The mock throws with `error.response.status` set — same shape as a real axios error.

### Per-test isolation

Use `clearBehaviors()` in `afterEach` to prevent registered handlers bleeding between tests. Do not use `clearAll()` here — that wipes history before enmoq can persist it.

```javascript
afterEach(() => {
  http.mockHttp.clearBehaviors();
});
```

### HTTP mock methods

| Method                                                          | Description                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| `behaviorRegistry.register(method, urlPattern, handler, name?)` | Register a mock response                                   |
| `getRequestHistory()`                                           | All recorded requests as `{ method, url, headers, data, response, timestamp }[]` |
| `getLastRequest()`                                              | Most recent history entry                                  |
| `clearHistory()`                                                | Wipe request history only                                  |
| `clearBehaviors()`                                              | Remove all registered behaviors (keep history intact)      |
| `persist()`                                                     | Write history to `.mock-data/<session>/http/history.json`  |

For the full reference including the resource registry, state manager, and network simulation, see [docs/http-usage.md](docs/http-usage.md).

---

## Mock data on disk

With `autoReset.persistHttp: true` (default), enmoq writes HTTP history to disk after every test for post-mortem inspection. Each mock stores its data in a subdirectory under the session — see the feature guides for the exact layout: [HTTP](docs/http-usage.md#disk-persistence), [repository](docs/repository-usage.md#disk-layout), [queue](docs/queue-usage.md#disk-persistence), [ClickHouse](docs/clickhouse-usage.md#disk-persistence), [TigerBeetle](docs/tigerbeetle-usage.md#fixtures).

```
.mock-data/
  <session-id>/
    repository/       ← JSON files per collection
    queue/
      <name>/         ← jobs.json per queue
    http/
      history.json    ← last test's outbound HTTP calls
      resources.json
      states.json
```

Each Jest run gets a unique session ID (`session-<timestamp>`). Add `.mock-data/` to `.gitignore`.

---

## Environment variables

| Variable           | Description                                                       |
| ------------------ | ----------------------------------------------------------------- |
| `ENMOQ_CONFIG`     | Absolute or cwd-relative path to config file (overrides auto-discovery) |
| `ENMOQ_DEBUG=true` | Log session ID on startup                                         |
| `MOCK_DATA_DIR`    | Override the data directory without a config file                 |
| `TEST_SESSION_DIR` | Pin the session ID (useful for multi-file suites sharing data)    |

---

## Coverage checklist

Every service test suite must cover:

| Category             | What to test                                                    |
| -------------------- | --------------------------------------------------------------- |
| **Happy path**       | Return shape, repository persistence, all computed fields       |
| **Related entities** | Any records the service creates in other collections            |
| **Uniqueness**       | Duplicate throws `DUPLICATE_RECORD`; different values succeed   |
| **Validation**       | One `it()` per error branch in the service                      |
| **Business rules**   | Edge cases specific to the service's domain logic               |

---

## Critical rules

1. No `console.log` in test files
2. Always use `ulid()` for IDs and slugs — never hardcode
3. Use message file constants for error matching — never hardcode strings
4. No manual lifecycle hooks — enmoq manages setup/teardown automatically
5. Mirror `services/` directory structure under `tests/`
6. Always read back from the repository to assert persistence
7. `repository: false` in `enmoq.config.js` is intentional — do not change it

---

## Further reading

| Guide | What it covers |
| ----- | -------------- |
| [docs/http-usage.md](docs/http-usage.md) | HTTP mocking: behaviors, magic values, built-in service mocks, state progression |
| [docs/repository-usage.md](docs/repository-usage.md) | Repository: full CRUD, query/update operators, aggregation, transactions, soft-delete |
| [docs/queue-usage.md](docs/queue-usage.md) | Queue: processing modes, retry, events, priority, delayed jobs |
| [docs/tigerbeetle-usage.md](docs/tigerbeetle-usage.md) | Ledger: accounts, transfers, linked transfers, two-phase commit, special wallets |
| [docs/clickhouse-usage.md](docs/clickhouse-usage.md) | ClickHouse: table creation, inserts, SELECT/GROUP BY/aggregations, query params |
