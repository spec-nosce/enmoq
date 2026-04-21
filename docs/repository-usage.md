# Repository Mocking

enmoq replaces `@app-core/repository-factory` (and `@app-core/mongoose`) with an in-memory, file-backed repository that faithfully replicates MongoDB semantics — timestamps, ULID IDs, paranoid soft-delete, unique constraints, transactions, and aggregation pipelines. No database is ever touched during tests.

> For project setup, jest config, and general test-writing rules, see the [usage guide](../usage-guide.md).

---

## Wiring

In `jest.config.js`, map your repository alias to the enmoq mock:

```js
moduleNameMapper: {
  '^@app-core/repository-factory$': '<rootDir>/node_modules/enmoq/src/core/mock-repository',
  '^@app-core/mongoose$':           '<rootDir>/node_modules/enmoq/src/core/mock-repository',
}
```

That is all the setup required. Any `require('@app-core/repository-factory')` inside your services resolves to the mock automatically.

---

## How it works

The mock stores every collection as a JSON file on disk inside the active session directory:

```
.mock-data/
  <session-id>/
    repository/
      User.json
      Order.json
      ...
```

The filename is the **exact string passed to `repositoryFactory()`** (case-sensitive). Data persists between test runs by design — see [Cross-test persistence](#cross-test-persistence).

Each Jest run gets a unique session ID. Add `.mock-data/` to `.gitignore`.

---

## Using Repositories in Tests

You do not need to import or configure the mock repository directly. Require your service as normal — its internal repository imports are intercepted at the module-mapper level:

```js
const createThing = require('../../services/things/create-thing');
const ThingRepository = require('../../repository/thing'); // same mock instance

it('creates a record', async () => {
  const result = await createThing({ name: 'Widget', owner_id: ulid() });
  expect(typeof result._id).toBe('string');

  const stored = await ThingRepository.findOne({ query: { _id: result._id } });
  expect(stored.name).toBe('Widget');
});
```

See [usage guide → assertions](../usage-guide.md#assertions) for the full pattern (return shape, persistence, related-entity checks).

---

## `useMocks` accessor

```js
const { useMocks } = require('enmoq');
const { repository } = useMocks();

// Access the shared session directly
const session = repository();
```

This gives you the same singleton instance your services hold internally. See [usage guide → `useMocks`](../usage-guide.md#queue-assertions-usemocks) for the full accessor table.

---

## CRUD Methods

All methods mirror the real `repository-factory` interface exactly.

### `findOne({ query, options? })`

Returns the first matching document, or `null`.

```js
const user = await UserRepository.findOne({
  query: { email: 'alice@example.com' },
});

// With projection
const user = await UserRepository.findOne({
  query: { _id: userId },
  options: { projection: { name: 1, email: 1 } },
});

// With operators
const user = await UserRepository.findOne({
  query: { age: { $gte: 18 }, status: { $in: ['active', 'pending'] } },
});
```

### `findMany({ query, options? })`

Returns an array of matching documents (empty array if none).

```js
const active = await UserRepository.findMany({
  query: { status: 'active' },
  options: {
    sort: { created: -1 },
    limit: 10,
    skip: 20,
  },
});
```

### `create(data, options?)`

Creates a document and persists it to disk. Auto-generates `_id` (ULID), `created`, and `updated` timestamps based on the model's `__appConfig`.

```js
const doc = await ThingRepository.create({
  name: 'Widget',
  owner_id: ulid(),
  status: 'active',
});
// doc._id — ULID string
// doc.created, doc.updated — Unix ms timestamps
```

**Strict mode:** Fields not declared in the Mongoose schema are silently dropped — identical to production Mongoose strict mode. If a service passes an undeclared field, it will not appear in the stored document. This has caught real schema-mismatch bugs; if `findOne` returns `null` unexpectedly, check that your service writes match your model schema.

**Unique constraints:** If the model declares `uniqueFields`, attempting to create a duplicate throws with an `E11000`-style message.

```js
// Model: uniqueFields: ['email', 'client_id']
await IdentityRepository.create({ email: 'a@example.com', client_id: 'app-1' }); // ✓
await IdentityRepository.create({ email: 'a@example.com', client_id: 'app-1' }); // ✗ throws
await IdentityRepository.create({ email: 'a@example.com', client_id: 'app-2' }); // ✓ different compound key
```

### `createMany({ entries }, options?)`

Bulk-creates an array of documents.

```js
const docs = await ThingRepository.createMany({
  entries: [
    { name: 'A', owner_id: ulid() },
    { name: 'B', owner_id: ulid() },
  ],
});
```

### `updateOne({ query, updateValues, options? })`

Updates the first matching document. Returns `{ modifiedCount: 1 }` — **not** the updated document. Use a subsequent `findOne` if you need the updated record.

```js
// Direct field assignment
await UserRepository.updateOne({
  query: { _id: userId },
  updateValues: { status: 'verified' },
});

// Update operators
await UserRepository.updateOne({
  query: { _id: userId },
  updateValues: {
    $inc: { login_count: 1 },
    $set: { last_login: Date.now() },
    $push: { login_history: { timestamp: Date.now() } },
  },
});

// Upsert
await UserRepository.updateOne({
  query: { email: 'new@example.com' },
  updateValues: { name: 'New User' },
  options: { upsert: true },
});
```

### `updateMany({ query, updateValues, options? })`

Updates all matching documents. Returns the count of updated documents.

```js
const count = await UserRepository.updateMany({
  query: { status: 'pending' },
  updateValues: { status: 'approved' },
});
```

### `deleteOne({ query, options? })`

Deletes the first matching document. Behaviour depends on the model's `paranoid` setting.

**Paranoid model (soft delete):**
- Sets `deleted` to the current timestamp
- Prefixes all `uniqueFields` values with `{timestamp}_` so a new record with the same unique key can be created immediately
- The document stays in the JSON file but is excluded from all future queries

**Non-paranoid model (hard delete):**
- Physically removes the document from the JSON file

```js
await UserRepository.deleteOne({ query: { _id: userId } });

// Paranoid: unique field released for re-use
await UserRepository.create({ email: 'alice@example.com' }); // ✓ works after soft-delete
```

### `deleteMany({ query, options? })`

Deletes all matching documents. Returns the count. Same paranoid/hard-delete logic as `deleteOne`.

```js
const count = await UserRepository.deleteMany({ query: { status: 'inactive' } });
```

---

## Query Operators

The mock query engine supports the standard MongoDB operator set.

### Comparison

| Operator | Meaning |
|---|---|
| `$eq` | Equals (implicit with bare values) |
| `$ne` | Not equals |
| `$gt` / `$gte` | Greater than / greater than or equal |
| `$lt` / `$lte` | Less than / less than or equal |
| `$in` | Value in array |
| `$nin` | Value not in array |

```js
{ age: { $gt: 25, $lte: 50 } }
{ status: { $in: ['active', 'pending'] } }
{ role: { $ne: 'admin' } }
```

### Logical

```js
{ $and: [{ age: { $gte: 18 } }, { verified: true }] }
{ $or:  [{ status: 'active' }, { status: 'pending' }] }
{ age: { $not: { $lt: 18 } } }
{ $nor: [{ status: 'banned' }, { status: 'deleted' }] }
```

### Element

```js
{ phone:   { $exists: true } }
{ deleted: { $exists: false } }
{ age:     { $type: 'number' } } // 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'
```

### Array

```js
{ roles:       { $all: ['user', 'verified'] } }
{ tags:        { $in: ['featured', 'premium'] } }
{ name:        { $regex: /^alice/i } }  // also supports string pattern
{ items: { $elemMatch: { product_id: 'prod_123', quantity: { $gt: 1 } } } }
{ tags: { $size: 3 } }
```

---

## Update Operators

### Field operators

| Operator | Effect |
|---|---|
| `$set` | Assign field values |
| `$unset` | Remove fields |
| `$inc` | Increment a number |
| `$mul` | Multiply a number |
| `$rename` | Rename a field |

```js
updateValues: {
  $set:   { status: 'verified', verified_at: Date.now() },
  $inc:   { login_count: 1 },
  $unset: { temp_token: '' },
}
```

### Array operators

| Operator | Effect |
|---|---|
| `$push` | Append an element |
| `$pull` | Remove matching elements |
| `$addToSet` | Append only if not present |
| `$pop` | Remove first (`-1`) or last (`1`) element |

```js
updateValues: {
  $push:     { login_history: { ts: Date.now(), ip: '127.0.0.1' } },
  $addToSet: { roles: 'verified' },
  $pull:     { tags: 'draft' },
}
```

---

## Aggregation Pipeline

```js
const results = await OrderRepository.aggregate([
  { $match: { status: 'completed' } },
  { $group: {
      _id: '$user_id',
      total: { $sum: '$amount' },
      count: { $sum: 1 },
  }},
  { $sort: { total: -1 } },
  { $limit: 10 },
]);
```

**Supported stages:** `$match`, `$project`, `$group`, `$sort`, `$limit`, `$skip`, `$lookup`.

```js
// Join example
const results = await OrderRepository.aggregate([
  { $match: { status: 'pending' } },
  { $lookup: {
      from: 'users',
      localField: 'user_id',
      foreignField: '_id',
      as: 'user',
  }},
  { $unwind: '$user' },
  { $project: { order_id: '$_id', user_email: '$user.email', amount: 1 } },
]);
```

---

## Transactions

```js
const { createSession } = require('enmoq/src/core/mock-repository');

const session = await createSession();
await session.startTransaction();

try {
  const user = await UserRepository.create({ name: 'Bob' }, { session });
  await OrderRepository.create({ user_id: user._id, amount: 500 }, { session });
  await session.commitTransaction();
} catch (error) {
  await session.abortTransaction();
  throw error;
} finally {
  await session.endSession();
}
```

If your services accept an `options` parameter, thread the session through:

```js
// In a test
const session = await createSession();
await session.startTransaction();
await createUser({ name: 'Bob' }, { session });
await session.commitTransaction();
await session.endSession();
```

---

## Cross-test Persistence

Repository data accumulates across tests in a suite by design. `repository: false` in `enmoq.config.js` is intentional — do not change it. This enables:

- **Uniqueness tests** — create a record in one `it()`, attempt to create a duplicate in the next
- **Read-after-write assertions** — verify that a record created by one service is visible to another
- **Multi-step flows** — a record created early in a suite is readable by all later tests

```js
// enmoq.config.js — intentional default
autoReset: {
  repository: false,  // data accumulates across tests in a suite
}
```

See [usage guide → `enmoq.config.js`](../usage-guide.md#enmoqconfigjs) for the full explanation.

### Session isolation

Each test file can write to its own independent store by setting `TEST_SESSION_DIR` **synchronously at the very top of the file**, before any `require()`:

```js
// tests/things/create-thing.test.js — must be before any require()
process.env.TEST_SESSION_DIR = 'create-thing-session';

const createThing = require('../../services/things/create-thing');
// All repository writes go to .mock-data/create-thing-session/repository/
```

Running multiple test files in parallel produces completely independent stores with zero cross-contamination.

---

## Model Configuration (`__appConfig`)

The mock reads each model's `__appConfig` to replicate its production behaviour. Declare it on the Mongoose schema:

```js
// models/user.js
schema.statics.__appConfig = {
  paranoid: true,              // soft-delete: sets deleted timestamp instead of removing
  supportULIDID: true,         // auto-generate ULID _id on create
  uniqueFields: ['email'],     // unique constraint fields (compound array also supported)
  timestamps: {
    created: 'created',        // field names for auto-timestamps
    updated: 'updated',
    deleted: 'deleted',
  },
};
```

If `__appConfig` is absent the mock falls back to defaults: `paranoid: false`, `supportULIDID: true`, no unique fields.

---

## Pagination (Cursor-based)

`findMany` supports the fetch-limit-plus-one pattern for cursor-based pagination. ULIDs are lexicographically sortable so `$lt` / `$gt` comparisons work correctly against `_id`:

```js
const limit = 50;
const results = await ThingRepository.findMany({
  query: {
    ...(cursor && { _id: { $lt: cursor } }),
    deleted: 0,
  },
  options: { sort: { _id: -1 }, limit: limit + 1 },
});

const hasMore = results.length > limit;
const items = hasMore ? results.slice(0, limit) : results;
const nextCursor = hasMore ? items[items.length - 1]._id : null;
```

---

## Disk Layout

```
.mock-data/
  <session-id>/
    repository/
      User.json       ← filename = exact string passed to repositoryFactory()
      Order.json
      Thing.json
```

> The filename mirrors the `repositoryFactory()` argument exactly — capitalisation included. `repositoryFactory('User')` writes to `User.json`, not `users.json`.

Use the CLI to inspect a session:

```bash
npx enmoq inspect
```

See [usage guide → mock data on disk](../usage-guide.md#mock-data-on-disk) for the full directory layout.

---

## Troubleshooting

**`findOne` returns `null` after `create`**
The most likely cause is a strict-mode field mismatch. The service passed a field that is not declared in the Mongoose schema, so the mock silently dropped it. Inspect `.mock-data/<session>/repository/<Model>.json` to see what was actually saved, and compare to what your `findOne` query targets.

**Unique constraint throws unexpectedly**
Data from a previous test run may still exist on disk. Delete `.mock-data/` to start fresh, or use `TEST_SESSION_DIR` to isolate your suite.

**Old data appearing in tests**
Data persists across runs by design. If you need a clean slate, either delete `.mock-data/`, or set a unique `TEST_SESSION_DIR` per run (e.g. `process.env.TEST_SESSION_DIR = Date.now().toString()`).

**Transaction not rolling back**
Ensure you call `await session.abortTransaction()` inside the `catch` block and `await session.endSession()` inside `finally`. Failing to end the session leaves the transaction open.

**Missing `_id` or timestamps on created document**
Verify that `__appConfig` on the model has `supportULIDID: true` and that the timestamp fields (`created`, `updated`) are declared in the Mongoose schema — the mock reads the schema paths to populate `allowedFields`.
