# TigerBeetle Mocking

enmoq ships an in-memory double-entry ledger that replicates TigerBeetle's API for testing. No TigerBeetle process or network connection is needed. The mock enforces the same balance rules, error codes, and transfer semantics as the real client — including linked (atomic) transfers and two-phase commit.

> For project setup, jest config, and general test-writing rules, see the [usage guide](../usage-guide.md).

---

## Wiring

There are two ways to wire the TigerBeetle mock. The **jest config approach is the default** — it requires no changes to service code and gives true zero-boilerplate operation.

---

### Flavor 1 — jest config (recommended)

Add one line to `moduleNameMapper` in `jest.config.js`:

```js
'^tigerbeetle-node$': '<rootDir>/node_modules/enmoq/src/core/mock-tigerbeetle',
```

This is already included in the recommended `jest.config.js` in the [usage guide](../usage-guide.md#jestconfigjs). With it in place, any service that does `require('tigerbeetle-node')` receives the mock automatically — including the standard client module pattern:

```js
// your-app/tigerbeetle/client.js (unchanged)
const { createClient, id, AccountFlags, TransferFlags } = require('tigerbeetle-node');

const client = createClient({ cluster_id: 0n, replica_addresses: ['3000'] });
module.exports = { client, getId: id, AccountFlags, TransferFlags };
```

No code changes needed. `createClient` returns the shared `TigerBeetleMock` singleton. Services continue importing `client` normally and tests work without a running TigerBeetle process.

To inspect or assert against the mock instance in tests, use `useMocks()`:

```js
const { useMocks } = require('enmoq');
const { tigerbeetle } = useMocks();
const tb = tigerbeetle(); // same singleton your services hold
```

---

### Flavor 2 — manual injection (no jest config change)

If your architecture injects the TigerBeetle client through options or a DI layer instead of importing it directly, you can skip the mapper and pass the mock instance explicitly:

```js
const { useMocks } = require('enmoq');
const { tigerbeetle } = useMocks();
const tb = tigerbeetle();

// Pass the mock wherever your service expects a client
await myService({ tbClient: tb, ...payload });
```

---

## Quick Start

```js
const { useMocks } = require('enmoq');
const { ulid } = require('ulid');
const { LEDGER_MAP } = require('enmoq/src/core/mock-tigerbeetle/utils');

const { tigerbeetle } = useMocks();
const tb = tigerbeetle();

// Create accounts
const account1 = { id: ulid(), ledger: LEDGER_MAP.NGN, code: 0 };
const account2 = { id: ulid(), ledger: LEDGER_MAP.NGN, code: 0 };
await tb.createAccounts([account1, account2]);

// Fund account1 directly (test setup only)
tb.accounts.get(account1.id).credits_posted = 10000n;

// Transfer
const errors = await tb.createTransfers([{
  id: ulid(),
  debit_account_id: account1.id,
  credit_account_id: account2.id,
  amount: 5000n,
  ledger: LEDGER_MAP.NGN,
  code: 0,
  flags: 0,
}]);

expect(errors).toHaveLength(0);

const [acc1, acc2] = await tb.lookupAccounts([account1.id, account2.id]);
expect(acc1.debits_posted).toBe(5000n);
expect(acc2.credits_posted).toBe(5000n);
```

---

## Account Operations

### `createAccounts(accounts)`

Creates one or more accounts. Returns an array of errors — empty on full success.

```js
const errors = await tb.createAccounts([
  {
    id: ulid(),                      // required
    ledger: LEDGER_MAP.NGN,          // required — see Ledger Map below
    code: 0,                         // required — account type code
    flags: 0,                        // optional
    debits_posted: 0n,               // BigInt, default 0n
    credits_posted: 0n,
    debits_pending: 0n,
    credits_pending: 0n,
    user_data_128: 0n,               // BigInt metadata (used for wallet type)
    user_data_64: 0n,
    user_data_32: 0,
  },
]);
// [] on success
// [{ index: 0, code: 'exists' }] on failure
```

### `lookupAccounts(ids)`

Returns accounts for the given IDs (missing IDs are silently omitted).

```js
const accounts = await tb.lookupAccounts([id1, id2]);
```

### `queryAccounts(filter)`

Filters accounts. `ledger` is required. All other fields are optional and match by exact equality.

```js
const accounts = await tb.queryAccounts({
  ledger: LEDGER_MAP.NGN,        // required
  user_data_128: 1n,             // optional BigInt
  user_data_64: 0n,              // optional BigInt
  code: 100,                     // optional number
  flags: 0,                      // optional number
  timestamp_min: someTimestamp,  // optional BigInt
  timestamp_max: someTimestamp,  // optional BigInt
  limit: 10,                     // optional
});
```

### Ledger Map

```js
const { LEDGER_MAP } = require('enmoq/src/core/mock-tigerbeetle/utils');
```

| Constant | Value | Currency |
|---|---|---|
| `LEDGER_MAP.NGN` | 1 | Nigerian Naira |
| `LEDGER_MAP.USD` | 2 | US Dollar |
| `LEDGER_MAP.GBP` | 3 | British Pound |
| `LEDGER_MAP.EUR` | 4 | Euro |
| `LEDGER_MAP.KES` | 5 | Kenyan Shilling |
| `LEDGER_MAP.GHS` | 6 | Ghanaian Cedi |
| `LEDGER_MAP.ZAR` | 7 | South African Rand |

---

## Transfer Operations

### `createTransfers(transfers)`

Creates one or more transfers. Returns an array of errors — empty on full success.

#### Direct transfer

```js
const errors = await tb.createTransfers([{
  id: ulid(),
  debit_account_id: fromId,
  credit_account_id: toId,
  amount: 1000n,           // BigInt — required
  ledger: LEDGER_MAP.NGN,  // must match both accounts
  code: 0,
  flags: 0,
}]);
```

#### Linked transfers (atomic chain)

All linked transfers succeed or all fail. Mark every transfer in the chain with `TransferFlags.linked` **except the last one**:

```js
const { TransferFlags } = require('enmoq/src/core/mock-tigerbeetle/index');
// or construct the flag directly: 1 << 3

const errors = await tb.createTransfers([
  {
    id: ulid(), debit_account_id: a.id, credit_account_id: b.id,
    amount: 1000n, ledger: LEDGER_MAP.NGN, code: 0,
    flags: 1 << 3,   // TransferFlags.linked
  },
  {
    id: ulid(), debit_account_id: b.id, credit_account_id: c.id,
    amount: 1000n, ledger: LEDGER_MAP.NGN, code: 0,
    flags: 0,        // last in chain — not linked
  },
]);
// Both succeed or both fail — balances are rolled back if any transfer errors
```

#### Two-phase commit (pending → post / void)

```js
// Step 1: reserve funds
const pendingErrors = await tb.createTransfers([{
  id: pendingId,
  debit_account_id: fromId,
  credit_account_id: toId,
  amount: 500n,
  ledger: LEDGER_MAP.NGN,
  code: 0,
  flags: 1 << 0,  // TransferFlags.pending
}]);
// Moves amount into debits_pending / credits_pending

// Step 2a: post (complete)
await tb.createTransfers([{
  id: ulid(),
  pending_id: pendingId,
  flags: 1 << 1,  // TransferFlags.post_pending_transfer
  ledger: LEDGER_MAP.NGN,
  code: 0,
}]);
// Moves from pending → posted

// Step 2b: void (cancel, returns funds)
await tb.createTransfers([{
  id: ulid(),
  pending_id: pendingId,
  flags: 1 << 2,  // TransferFlags.void_pending_transfer
  ledger: LEDGER_MAP.NGN,
  code: 0,
}]);
// Clears pending balances
```

### `lookupTransfers(ids)`

Returns transfers by ID. Checks both posted and pending maps.

```js
const transfers = await tb.lookupTransfers([transferId]);
```

---

## Balance Utilities

```js
const { getAvailableBalance, getPendingBalance, getPostedBalance } = require('enmoq/src/core/mock-tigerbeetle/utils');

const account = (await tb.lookupAccounts([id]))[0];

getAvailableBalance(account); // credits_posted − debits_posted − debits_pending
getPendingBalance(account);   // credits_posted + credits_pending − debits_posted − debits_pending
getPostedBalance(account);    // credits_posted − debits_posted
```

---

## Special Wallet Helpers

The mock provides shorthand accessors for system wallets that use `user_data_128` as a type flag:

```js
// Clearing wallet (user_data_128 = 1)
const clearing = await tb.getClearingWallet(LEDGER_MAP.NGN);

// Revenue wallet (user_data_128 = 2)
const revenue = await tb.getRevenueWallet(LEDGER_MAP.NGN);

// Provider wallet (user_data_128 = 100 + ASCII code of first char of providerCode)
const mtn = await tb.getProviderWallet(LEDGER_MAP.GHS, 'MTN');
// user_data_128 = 100n + BigInt('M'.charCodeAt(0)) = 177n
```

To set up a special wallet in test setup, create an account with the appropriate `user_data_128`:

```js
await tb.createAccounts([{
  id: clearingId,
  ledger: LEDGER_MAP.NGN,
  code: 0,
  user_data_128: 1n,          // marks this as clearing wallet
}]);
tb.accounts.get(clearingId).credits_posted = 10_000_000n; // fund it
```

---

## Error Codes

`createAccounts` and `createTransfers` return an array of `{ index, code }` objects.

```js
const { ErrorCode } = require('enmoq/src/core/mock-tigerbeetle/error-codes');
```

| Code | Trigger |
|---|---|
| `exists` | ID already used |
| `invalid_ledger` | Ledger not in range 1–7 |
| `exceeds_credits` | Insufficient available balance |
| `accounts_must_be_different` | Debit and credit account are the same |
| `ledger_must_match` | Accounts are on different ledgers |
| `accounts_not_found` | One or both account IDs not found |
| `pending_transfer_not_found` | `pending_id` not in pending map |
| `pending_transfer_already_posted` | Pending transfer already posted |
| `pending_transfer_already_voided` | Pending transfer already voided |

```js
const errors = await tb.createTransfers([transfer]);
if (errors.length > 0) {
  expect(errors[0].code).toBe(ErrorCode.exceeds_credits);
}
```

---

## Cross-File State Accumulation

enmoq automatically restores the persisted session state when each test file initialises (`restoreOnInit: true` by default). This means every account and transfer created in one file is visible in all subsequent files — no setup code required.

```js
// file-a.test.js — creates two accounts
const { useMocks } = require('enmoq');
const { ulid } = require('ulid');
const { LEDGER_MAP } = require('enmoq/src/core/mock-tigerbeetle/utils');

const { tigerbeetle } = useMocks();
let tb;

beforeAll(() => { tb = tigerbeetle(); });

it('creates accounts', async () => {
  await tb.createAccounts([
    { id: ulid(), ledger: LEDGER_MAP.NGN, code: 100, flags: 0 },
    { id: ulid(), ledger: LEDGER_MAP.NGN, code: 100, flags: 0 },
  ]);
});
```

```js
// file-b.test.js — sees file-a's accounts automatically
beforeAll(() => { tb = tigerbeetle(); });

it('sees accounts from file-a', async () => {
  const accounts = await tb.queryAccounts({ ledger: LEDGER_MAP.NGN });
  expect(accounts.length).toBeGreaterThanOrEqual(2); // file-a's accounts are here
});
```

This requires `maxWorkers: 1` in `jest.config.js` (serial execution) to prevent concurrent file writes colliding on the same JSON. Parallel workers would race on the persistence layer.

To opt out and get standard Jest isolation (each file starts empty), set `restoreOnInit: false` in `enmoq.config.js`:

```js
// enmoq.config.js
module.exports = {
  tigerbeetle: {
    restoreOnInit: false,  // each file starts with an empty ledger
  },
};
```

---

## Per-Test Isolation

enmoq does **not** auto-reset the TigerBeetle mock between tests (`autoReset.tigerbeetle: false` by default). State accumulates across tests within a file — exactly as it would on a real ledger.

If a test genuinely requires a clean slate, call `reset()` explicitly. See [`reset()`](#reset) below for what that means when cross-file accumulation is active.

---

## `reset()`

`reset()` clears in-memory state. Its exact behaviour depends on whether `restoreOnInit` is active:

**With `restoreOnInit: true` (default):** `reset()` reverts to the baseline that was loaded from disk at file startup — discarding only this file's in-memory changes. Prior files' persisted data is untouched on disk and will be available to the next file.

**With `restoreOnInit: false`:** `reset()` clears everything — a full wipe to empty.

```js
await tb.reset();
```

Pass `{ persist: true }` to flush the current state to disk before clearing:

```js
await tb.reset({ persist: true });
```

> **Avoid calling `reset()` across test files when `restoreOnInit` is true.** It will revert the ledger to this file's entry state, and the next file will restore from that point — which is usually what you want. If you call `reset()` between tests within a file, you are wiping everything added so far in that file only.

---

## Inspecting Persisted Data

All operations are written to disk immediately (no debounce). After a test run, the full ledger state is readable in:

```
<dataDir>/<sessionId>/tigerbeetle/
  accounts.json
  transfers.json
  pending-transfers.json
  metadata.json
```

Every account, transfer, and balance value is there for post-mortem inspection without any extra calls.

---

## BigInt Notes

All amount and balance fields are `BigInt`. Use the `n` suffix in test code:

```js
amount: 1000n
credits_posted: 0n

// Arithmetic
const balance = account.credits_posted - account.debits_posted; // BigInt result
expect(balance).toBe(5000n);

// Comparison
expect(account.debits_posted).toBe(1000n);
```

Do not mix `BigInt` with `Number` — it throws a `TypeError`. Use `BigInt(someNumber)` to convert.
