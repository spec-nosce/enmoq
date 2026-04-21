# ClickHouse Mocking

enmoq ships an in-memory ClickHouse replacement that supports table creation, inserts, and SQL SELECT queries including `WHERE`, `GROUP BY`, aggregations, date functions, and query parameter substitution. No ClickHouse server or network connection is needed.

> For project setup, jest config, and general test-writing rules, see the [usage guide](../usage-guide.md).

---

## Wiring

In `jest.config.js`, map your ClickHouse alias to the enmoq mock:

```js
moduleNameMapper: {
  '^@app-core/clickhouse$': '<rootDir>/node_modules/enmoq/src/core/mock-clickhouse',
}
```

The mock exports a `createClient()` function that matches the real `@app-core/clickhouse` API.

---

## Accessing the Mock in Tests

Use `useMocks()` at the top of the test file:

```js
const { useMocks } = require('enmoq');
const { clickhouse } = useMocks();

const ch = clickhouse(); // shared ClickHouseMock singleton
```

See [usage guide → `useMocks`](../usage-guide.md#queue-assertions-usemocks) for the full accessor table.

---

## Table Creation

```js
await ch.createTable(`
  CREATE TABLE IF NOT EXISTS account_balances (
    account_id   String,
    amount       Decimal64(2),
    currency     LowCardinality(String),
    event_time   DateTime64(3)
  )
  ENGINE = MergeTree()
  ORDER BY (account_id, event_time)
`);
```

`IF NOT EXISTS` is respected — calling `createTable` on an existing table is a no-op.

### Supported column types

| Type | Description |
|---|---|
| `String` | Variable-length string |
| `LowCardinality(String)` | Optimised string for low-cardinality values |
| `Decimal64(scale)` | 64-bit decimal |
| `Decimal256(scale)` | 256-bit decimal |
| `DateTime64(precision)` | DateTime with millisecond precision |
| `Int8` / `Int16` / `Int32` / `Int64` | Signed integers |
| `UInt8` / `UInt16` / `UInt32` / `UInt64` | Unsigned integers |

---

## Inserting Data

```js
// Single row
await ch.insert({
  table: 'account_balances',
  values: {
    account_id: ulid(),
    amount: 5000.00,
    currency: 'NGN',
    event_time: new Date().toISOString(),
  },
  format: 'JSONEachRow',  // only supported format
});

// Multiple rows
await ch.insert({
  table: 'account_balances',
  values: [
    { account_id: 'acc1', amount: 1000, currency: 'NGN', event_time: '2026-01-01T00:00:00Z' },
    { account_id: 'acc2', amount: 2000, currency: 'USD', event_time: '2026-01-02T00:00:00Z' },
  ],
  format: 'JSONEachRow',
});
```

Each row is validated against the table schema. Inserting a column with the wrong type throws:

```
Error: Invalid type for column amount. Expected Decimal64(2), got string
```

---

## Querying Data

### `findMany({ query, queryParams? })`

Executes a SQL SELECT and returns the matching rows as an array of objects.

```js
// All rows
const rows = await ch.findMany({
  query: 'SELECT * FROM account_balances',
});

// WHERE clause
const rows = await ch.findMany({
  query: "SELECT * FROM account_balances WHERE currency = 'NGN'",
});

// WITH query parameters (preferred — avoids SQL injection)
const rows = await ch.findMany({
  query: 'SELECT * FROM account_balances WHERE account_id = {accId: String}',
  queryParams: { accId: 'acc1' },
});
```

### `query({ query, query_params?, format? })`

Alias for `findMany`, matching the real ClickHouse client's `query()` method signature:

```js
const rows = await ch.query({
  query: 'SELECT * FROM account_balances WHERE account_id = {accId: String}',
  query_params: { accId: 'acc1' },
  format: 'JSONEachRow',
});
```

---

## Supported SQL Features

### SELECT

```sql
-- All columns
SELECT * FROM my_table

-- Specific columns
SELECT account_id, amount FROM my_table
```

### WHERE

Comparison operators: `=`, `!=`, `<`, `>`, `<=`, `>=`  
Logical operators: `AND`, `OR`

```sql
WHERE amount > 1000 AND currency = 'NGN'
WHERE account_id = 'acc1' OR account_id = 'acc2'
```

### GROUP BY with aggregations

```sql
SELECT
  account_id,
  SUM(amount)   AS total,
  COUNT(*)      AS count,
  AVG(amount)   AS average,
  MIN(amount)   AS min_amount,
  MAX(amount)   AS max_amount,
  argMax(amount, event_time) AS latest_amount
FROM account_balances
GROUP BY account_id
```

Supported aggregation functions: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `argMax`.

### Date functions

```sql
SELECT toDate(event_time)           AS day   FROM t GROUP BY day
SELECT toMonday(event_time)         AS week  FROM t GROUP BY week
SELECT toStartOfMonth(event_time)   AS month FROM t GROUP BY month
```

### ORDER BY and LIMIT

```sql
SELECT * FROM account_balances ORDER BY event_time DESC LIMIT 100
```

### Query parameters

Substituted before parsing. The type hint after `:` is used for validation:

```sql
WHERE account_id = {accId: String}
WHERE amount > {minAmount: Decimal64}
```

---

## Full Example

```js
describe('balance reporting service', () => {
  beforeEach(async () => {
    // Tables persist across tests; clear if isolation is needed
    await ch.reset();

    await ch.createTable(`
      CREATE TABLE IF NOT EXISTS transactions (
        account_id String,
        amount     Decimal64(2),
        currency   LowCardinality(String),
        event_time DateTime64(3)
      ) ENGINE = MergeTree() ORDER BY (account_id, event_time)
    `);

    await ch.insert({
      table: 'transactions',
      values: [
        { account_id: 'acc1', amount: 1000, currency: 'NGN', event_time: '2026-01-01T00:00:00Z' },
        { account_id: 'acc1', amount: 500,  currency: 'NGN', event_time: '2026-01-02T00:00:00Z' },
        { account_id: 'acc2', amount: 2000, currency: 'USD', event_time: '2026-01-01T00:00:00Z' },
      ],
      format: 'JSONEachRow',
    });
  });

  it('returns total balance per account', async () => {
    const result = await balanceService.getSummary();

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account_id: 'acc1', total: 1500 }),
        expect.objectContaining({ account_id: 'acc2', total: 2000 }),
      ])
    );
  });

  it('queries by account id', async () => {
    const rows = await ch.findMany({
      query: 'SELECT * FROM transactions WHERE account_id = {id: String}',
      queryParams: { id: 'acc1' },
    });
    expect(rows).toHaveLength(2);
  });
});
```

---

## `reset()`

Clears all tables and rows from memory and disk:

```js
await ch.reset();
```

---

## Per-Test Isolation

enmoq does **not** auto-reset the ClickHouse mock between tests (`autoReset.clickhouse: false` by default). Tables and rows persist across `it()` blocks within a suite.

Options for isolation:
- Call `await ch.reset()` in `beforeEach` for a completely clean slate
- Recreate only the rows in `beforeEach` and rely on `IF NOT EXISTS` for table creation
- Use the snapshot methods below to save and restore state

See [usage guide → `enmoq.config.js`](../usage-guide.md#enmoqconfigjs).

---

## Snapshots and Debugging

```js
// Inspect current in-memory state
const snap = ch.getSnapshot();
// {
//   transactions: {
//     schema: [...],
//     rowCount: 3,
//     sampleRows: [...]   // first 5 rows
//   }
// }
```

---

## Disk Persistence

With `autoPersist: true` (the default), every `insert` writes to disk after a short debounce:

```
.mock-data/
  <session-id>/
    clickhouse/
      transactions.json
      account_balances.json
```

Session save / restore:

```js
await ch.persist();                       // save current state to session file
const ok = await ch.restore();            // restore (returns false if session not found)
```

Fixtures:

```js
await ch.saveFixture('baseline-data');    // save to fixtures directory
await ch.loadFixture('baseline-data');    // restore from fixture
```

Use the CLI to inspect saved state:

```bash
npx enmoq inspect
```

See [usage guide → mock data on disk](../usage-guide.md#mock-data-on-disk).
