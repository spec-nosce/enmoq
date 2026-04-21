# HTTP Request Mocking

enmoq replaces `@app-core/http-request` with a fully in-memory mock client. No network calls are ever made during tests. Every request is matched against a registry of **behaviors**, the response is returned (or thrown for 4xx/5xx), and the call is recorded to a history log.

> For project setup, jest config, and general test-writing rules, see the [usage guide](../usage-guide.md).

---

## Wiring

In `jest.config.js`, map your HTTP client alias to the enmoq mock:

```js
moduleNameMapper: {
  '^@app-core/http-request$': '<rootDir>/node_modules/enmoq/src/core/mock-http',
}
```

That single line is enough. Any `require('@app-core/http-request')` inside your services — no matter how deep — resolves to the mock automatically.

---

## Accessing the Mock in Tests

Use `useMocks()` at the top of the test file:

```js
const { useMocks } = require('enmoq');
const { http } = useMocks();

// All utilities live under http.mockHttp
http.mockHttp.getRequestHistory();
http.mockHttp.behaviorRegistry.register(/* ... */);
```

If you import `HttpRequest` directly (uncommon — only needed when calling the mock client itself in a test), utilities are at `HttpRequest.mockHttp.*`:

```js
const HttpRequest = require('@app-core/http-request');
HttpRequest.mockHttp.getRequestHistory();
```

See the [usage guide → `useMocks`](../usage-guide.md#queue-assertions-usemocks) for the full accessor table.

---

## Behavior Registration

A *behavior* maps a method + URL pattern to a handler function. There are two styles.

### Style A — External behavior file (recommended for shared or complex behaviors)

```js
// tests/behaviors/my-service/create-account.js
module.exports = {
  name: 'my-service-create-account',   // registry key; re-registering with the same key overwrites
  method: 'POST',
  urlPattern: 'api\\.example\\.com/accounts$', // treated as a RegExp source string

  handler(request, context) {
    const { issuer_code } = request.data || {};
    if (!issuer_code) {
      return { status: 400, body: { code: 'INVALID_ISSUER' } };
    }
    const id = context.generateULID();
    context.storeResource('accounts', id, { id, issuer_code });
    return { status: 200, body: { data: { id } } };
  },

  // Extra exports are ignored by the registry — useful as test fixtures
  fixture: { data: { id: 'PRESET_ID' } },
};
```

Load the directory in `beforeAll`:

```js
const path = require('path');

beforeAll(() => {
  http.mockHttp.setBehaviorsPath(path.resolve(__dirname, 'behaviors'));
});
```

> **Important:** `setBehaviorsPath` replaces the active behaviors directory entirely. Built-in enmoq behaviors (account-issuing, payouts, etc.) are no longer loaded unless you re-export them from your behaviors directory. If you only need a few built-in behaviors, use Style B instead.

**When to use:** behaviors shared across multiple test files, fixtures co-located with their handler, or anything complex enough to deserve its own file.

### Style B — Inline programmatic registration

```js
const { useMocks } = require('enmoq');
const { http } = useMocks();

describe('myService', () => {
  beforeAll(() => {
    http.mockHttp.behaviorRegistry.register(
      'GET',
      'api\\.example\\.com/rates',
      () => ({ status: 200, body: { rate: 1.18 } }),
      'rates-convert'           // optional label — re-registering the same label overwrites
    );
  });

  describe('when the rate API fails', () => {
    beforeEach(() => {
      http.mockHttp.behaviorRegistry.register(
        'GET',
        'api\\.example\\.com/rates',
        () => ({ status: 503, body: { message: 'Service Unavailable' } }),
        'rates-convert'         // same key → overwrites
      );
    });
  });
});
```

**When to use:** one-off overrides scoped to a single test file, quick error-case injection.

---

## URL Pattern Matching

`urlPattern` is compiled as `new RegExp(urlPattern)` and tested against the full URL string.

```js
// Matches anywhere in the URL
urlPattern: 'api\\.example\\.com/accounts'
// ✓ https://api.example.com/accounts
// ✓ https://api.example.com/accounts?page=1

// Anchor to end to prevent prefix collisions
urlPattern: 'api\\.example\\.com/accounts$'
// ✓ https://api.example.com/accounts
// ✗ https://api.example.com/accounts/01ABC

// Capture a path segment
urlPattern: 'api\\.example\\.com/accounts/([^/]+)$'
// request.urlParams[0] → the captured ID
```

When multiple patterns match the same URL, the longest full match wins (most specific).

---

## Handler Response Shape

```js
// Success (status 200–299) — client returns this object
return { status: 200, headers: { 'Content-Type': 'application/json' }, body: { data: { id } } };
// caller receives: { status, statusText, headers, data: body, config }

// Error (status ≥ 400) — client throws
return { status: 404, body: { message: 'Not found' } };
// error.response.status === 404
// error.response.data  === { message: 'Not found' }

// Network error (no response at all) — throw directly from handler
throw new Error('Request timeout');
```

---

## Built-in Behaviors

enmoq ships behaviors for common service categories. They activate automatically — no registration needed — as long as you have not called `setBehaviorsPath`.

### Account Issuing

| Endpoint | Method | URL pattern |
|---|---|---|
| Create account | POST | `.*/accounts$` |
| Get account | GET | `.*/accounts/:id` |
| Lookup counterparty | POST | `.*/counterparty-lookups$` |
| Get lookup | GET | `.*/counterparty-lookups/:id` |
| Verify transaction | POST | `.*/transaction-verifications$` |

**Issuer code magic values (create account):**

| `issuer_code` | Behavior |
|---|---|
| `TESTBANK`, `FASTBANK`, `OKBANK` | Instant approval, status `active` |
| `PENDING_BANK`, `SLOWBANK` | Returns status `pending` |
| `ERROR_BANK` | 500 provider error |
| `TIMEOUT_BANK` | Network timeout (throws) |
| `INVALID_BANK` | 400 invalid issuer |

**Transaction verification magic values:**

| `provider_reference` prefix | Behavior |
|---|---|
| `VERIFY_SUCCESS_` | Verified transaction |
| `VERIFY_NOTFOUND_` | 404 transaction not found |
| `VERIFY_MISMATCH_` | 400 account mismatch |
| `VERIFY_TIMEOUT_` | 504 gateway timeout |

### Payments (Nuvion Payouts)

| Endpoint | Method | URL pattern |
|---|---|---|
| Create payment | POST | `.*/payments$` |
| Get payment | GET | `.*/payments/:id` |

**Test cards (card_number in counterparty):**

| Card number | Behavior |
|---|---|
| `4111111111111111` | Visa — success |
| `5555555555554444` | Mastercard — success |
| `4000000000000002` | Declined — insufficient funds |
| `4000000000000069` | Declined — expired card |
| `4000000000000127` | Declined — incorrect CVC |
| `4000000000000119` | Error — processing error |
| `4000000000000341` | Error — lost/stolen card |
| `4000002500003155` | Requires 3DS authentication |
| `4000000000006975` | Timeout error |

**Amount magic values:**

| Condition | Behavior |
|---|---|
| `amount > 1_000_000` | 400 `AMOUNT_TOO_HIGH` |
| `amount < 100` | 400 `AMOUNT_TOO_LOW` |
| `amount % 666 === 0` | Fraud detection triggered |
| `amount === 13` | Bad luck error |

**Reference prefix magic values:**

| `unique_reference` prefix | Behavior |
|---|---|
| `DUP_` | 400 duplicate reference |
| `INVALID_` | 400 invalid reference |
| `TIMEOUT_` | Network timeout |
| `ERROR_` | Processing error |

### Email (NNS)

| Endpoint | Method | URL pattern |
|---|---|---|
| Send email | POST | `.*/messages$` |
| Get email status | GET | `.*/messages/:id` |

**Magic values:**

| Field | Value | Behavior |
|---|---|---|
| `template_id` | `test-success` | Success |
| `template_id` | `test-invalid` | 404 template not found |
| `template_id` | `test-timeout` | 504 gateway timeout |
| `to` | `bounce@test.com` | 400 email bounce |
| `to` | `spam@test.com` | 400 spam rejection |

### PDF / Asset Generation (Odysy)

| Endpoint | Method | URL pattern |
|---|---|---|
| Create asset | POST | `.*/assets$` |
| Get asset | GET | `.*/assets/:id` |

**Magic values:**

| Field | Value | Behavior |
|---|---|---|
| `reference` | `test-error` | 500 generation error |
| `reference` | `test-timeout` | 504 gateway timeout |
| `reference` | `test-invalid-html` | 400 invalid HTML |
| `data_token` | `test-expired` | 401 token expired |

### Webhooks

Matched when the URL contains `webhook-`:

| URL segment | Behavior |
|---|---|
| `webhook-success` or any other | 200 OK with echo |
| `webhook-timeout` | 504 timeout |
| `webhook-unauthorized` | 401 unauthorized |
| `webhook-servererror` | 500 server error |
| `webhook-badrequest` | 400 bad request |

Webhook calls are stored in the resource registry under the `webhook_calls` type for post-call assertions.

---

## Cross-Request Persistence (Create → Lookup)

The resource registry keeps data alive for the lifetime of a test, making create-then-fetch flows work without any extra wiring:

```js
// Service calls POST /accounts → mock stores the new account
const created = await myService.createAccount({ issuer_code: 'TESTBANK', kyc: { first_name: 'Jane' } });
const accountId = created.account_id;

// Service later calls GET /accounts/:id → mock retrieves the same account
const retrieved = await myService.getAccount(accountId);
expect(retrieved.id).toBe(accountId);
expect(retrieved.status).toBe('active');
```

> **Do not call `clearAll()` between a create and its lookup.** That wipes the resource registry. Use `clearBehaviors()` or `clearHistory()` for partial resets. See [Isolation](#per-test-isolation) below.

### Direct registry access

```js
const account = http.mockHttp.resourceRegistry.get('accounts', accountId);
expect(account.status).toBe('active');

// Inspect everything in a type
const allAccounts = http.mockHttp.resourceRegistry.getAllResources('accounts');
```

---

## State Progression

The state manager lets behaviors return different responses for repeated requests to the same resource — without resetting the whole mock. The payments behavior uses this for status polling:

```js
// First GET → pending
const check1 = await myService.getPayment('payment_123');
expect(check1.status).toBe('pending');

// Second GET → processing
const check2 = await myService.getPayment('payment_123');
expect(check2.status).toBe('processing');

// Third GET → completed
const check3 = await myService.getPayment('payment_123');
expect(check3.status).toBe('completed');
```

This works because the behavior calls `context.getNextStatus(key, sequence)`, which advances an internal counter on each call.

**Debugging state:**

```js
const allStates = http.mockHttp.stateManager.getAllStates();
```

---

## Request History

Every call is recorded — even those that throw — so you can assert on failed requests:

```js
const history = http.mockHttp.getRequestHistory();
// Each entry: { method, url, data, headers, response, timestamp }

const last = http.mockHttp.getLastRequest();
expect(last.url).toContain('/accounts');
expect(last.method).toBe('POST');

// Assert on a call that throws
try { await myService.createPayment(badPayload); } catch (_) {}
expect(http.mockHttp.getRequestHistory()).toHaveLength(1);
```

---

## Per-Test Isolation

enmoq clears HTTP history automatically before each test when `autoReset.http: true` (the default). See [usage guide → `enmoq.config.js`](../usage-guide.md#enmoqconfigjs) for reset options.

For manual control within a file:

| Method | What it clears |
|---|---|
| `clearHistory()` | Request history only |
| `clearBehaviors()` | Registered behaviors only (keeps history and registry) |
| `clearAll()` | History + behaviors + resource registry + states |

**Recommended pattern:**

```js
// usage-guide.md rule: enmoq manages beforeAll/afterAll — don't write your own
// For HTTP-specific cleanup, use afterEach with clearBehaviors only:

afterEach(() => {
  http.mockHttp.clearBehaviors();
  // do NOT call clearAll() here — enmoq persist runs after each test and needs history intact
});
```

---

## Simulating Errors

### Return a non-2xx status from a handler

```js
http.mockHttp.behaviorRegistry.register(
  'POST',
  '/v1/payments',
  async () => ({ status: 503, body: { message: 'Service Unavailable' } }),
  'payments-down'
);

await expect(myService.createPayment(payload)).rejects.toMatchObject({
  // same shape as a real axios error
  response: { status: 503, data: { message: 'Service Unavailable' } },
});
```

### Simulate a network error

Throw directly from the handler — no `response` property will be present:

```js
http.mockHttp.behaviorRegistry.register(
  'GET',
  '/v1/rates',
  () => { throw new Error('ECONNREFUSED'); },
  'rates-network-error'
);
```

---

## Network Simulation

For latency and flakiness testing, enable network simulation programmatically:

```js
http.mockHttp.config.enableNetworkSimulation({
  baseDelay: 100,    // added to every response (ms)
  jitter: 50,        // random ±jitter per request
  failureRate: 0.05, // 5% of requests fail with a network error
});

// Disable again after the test
afterEach(() => {
  http.mockHttp.config.disableNetworkSimulation();
});
```

Mode can also be changed at runtime:

```js
http.mockHttp.config.setMode('permissive'); // returns a default response when no behavior matches
http.mockHttp.config.setMode('strict');     // throws when no behavior matches (default)
```

---

## Disk Persistence

With `autoReset.persistHttp: true` (default), enmoq writes history to disk after every test. Files land in the session directory:

```
.mock-data/
  <session-id>/
    http/
      history.json    ← outbound calls from the last test
      resources.json  ← resource registry snapshot
      states.json     ← state manager snapshot
```

Use the CLI to inspect a session:

```bash
npx enmoq inspect
```

Add `.mock-data/` to `.gitignore`. See [usage guide → mock data on disk](../usage-guide.md#mock-data-on-disk) for full path details.

---

## Environment Variables

| Variable | Description |
|---|---|
| `USE_MOCK_HTTP_REQUEST=true` | Enable mock mode (set automatically by enmoq setup) |
| `MOCK_HTTP_MODE` | `strict` (default) \| `permissive` |
| `MOCK_HTTP_LOG_LEVEL` | `error` \| `warn` \| `info` \| `debug` |
| `MOCK_HTTP_BEHAVIORS_PATH` | Custom behaviors directory (same as `setBehaviorsPath`) |
| `MOCK_HTTP_ENABLE_PERSISTENCE` | `true` to save registry to file |
| `MOCK_HTTP_PERSISTENCE_PATH` | File path for registry persistence |

---

## Troubleshooting

**Request not matching any behavior**
1. Check the URL pattern regex against the full URL string.
2. Verify the method is correct (`GET`, `POST`, etc.).
3. Enable debug logging: `MOCK_HTTP_LOG_LEVEL=debug`.
4. Inspect what is registered: `http.mockHttp.behaviorRegistry.list()`.

**Lookup fails after create**
1. Verify the resource was stored: `http.mockHttp.resourceRegistry.getAllResources()`.
2. Ensure `clearAll()` was not called between the create and the lookup.
3. Confirm the resource type and ID in the get-handler match what the create-handler stored.

**State not progressing**
1. Check that a state was initialized: `http.mockHttp.stateManager.getAllStates()`.
2. Confirm the state key matches the resource ID used at creation time.
3. Ensure the behavior calls `context.getNextStatus()` rather than returning a fixed status string.

**Built-in behaviors not working after `setBehaviorsPath`**
`setBehaviorsPath` replaces the behaviors directory. Re-export any built-in behavior you still need from your custom directory, or switch to inline `behaviorRegistry.register()` calls for those endpoints.
