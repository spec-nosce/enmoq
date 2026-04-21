# Queue Mocking

enmoq replaces `@app-core/queue` with an in-memory Bull-compatible mock. No Redis connection is needed. Jobs run through the same lifecycle as real Bull — waiting → active → completed / failed — and every operation is recorded for assertion.

> For project setup, jest config, and general test-writing rules, see the [usage guide](../usage-guide.md).

---

## Wiring

In `jest.config.js`, map your queue alias to the enmoq mock:

```js
moduleNameMapper: {
  '^@app-core/queue$': '<rootDir>/node_modules/enmoq/src/core/mock-queue',
}
```

---

## Accessing the Mock in Tests

Use `useMocks()` at the top of the test file:

```js
const { useMocks } = require('enmoq');
const { queue } = useMocks();

// queue(name) returns the BullMock singleton for that queue name
const notificationsQueue = queue('notifications');
```

`queue(name)` always returns the exact same singleton your services hold internally. See [usage guide → `useMocks`](../usage-guide.md#queue-assertions-usemocks) for the full accessor table.

---

## Processing Modes

The mock runs in one of three modes. The mode determines what happens when a job is added.

### `'manual'` (default in tests)

Jobs land in `waiting` and are not processed until you call `processJobs()`. This is the most useful mode for tests — you decide exactly when processing happens.

```js
queue('jobs').process('send-email', async (job) => {
  return { sent: true };
});

await myService(payload);               // service calls queue.add() internally

const waiting = queue('jobs').getJobs(['waiting']);
expect(waiting).toHaveLength(1);
expect(waiting[0].data.user_id).toBe(payload.user_id);

await queue('jobs').processJobs();      // run the processor

const completed = queue('jobs').getJobs(['completed']);
expect(completed).toHaveLength(1);
```

### `'sync'`

Jobs are processed inside `add()` before it returns. The job object already has `status: 'completed'` (or `'failed'`) by the time the service call resolves. If the processor throws, the error propagates out of `add()`.

### `'async'`

A `setInterval` polls every 100ms and processes jobs automatically. Not recommended in tests — the non-deterministic timing makes assertions flaky.

---

## Registering Processors

```js
// Simple — concurrency defaults to 1
queue('payments').process('charge-card', async (job) => {
  const { amount, userId } = job.data;
  return { charged: amount, userId };
});

// With concurrency (stored but not enforced — single-threaded JS)
queue('images').process('resize', 3, async (job) => {
  return { resized: job.data.imageId };
});
```

- `name` must match the first argument of `add()` in the service
- The processor return value becomes `job.returnvalue`
- If no processor is registered for a job name, the job stays in `'waiting'` forever

---

## Adding Jobs

Services call `queue.add()` internally. The full job shape is:

```js
{
  id: 'ulid-string',
  name: 'job-name',
  data: { /* service payload */ },
  opts: { attempts, delay, priority, backoff, removeOnComplete },
  status: 'waiting',       // → 'active' → 'completed' | 'failed'
  progress: 0,
  attemptsMade: 0,
  timestamp: 1709000000000,
  processedOn: null,       // set when job becomes 'active'
  finishedOn: null,        // set when job reaches terminal status
  failedReason: null,      // error.message on failure
  returnvalue: null,       // processor return value on success
  logs: [],
}
```

### Job options

| Option | Type | Default | Description |
|---|---|---|---|
| `attempts` | number | `1` | Total attempts before permanently failing |
| `delay` | number | `0` | Ms to wait before the job is eligible |
| `priority` | number | `0` | Higher values are processed first |
| `backoff` | object | `{ type: 'exponential', delay: 1000 }` | Retry backoff strategy |
| `removeOnComplete` | boolean | `false` | Delete job from map after success |

---

## Job Lifecycle

```
waiting
  │
  ├─ processJobs() (or add() in sync mode)
  ▼
active  (emits 'active')
  │
  ├─ processor succeeds ──────► completed  (emits 'completed', job.returnvalue = result)
  │
  └─ processor throws
       ├─ attemptsMade < opts.attempts ──► waiting  (emits 'failed', re-queued with backoff)
       └─ attemptsMade >= opts.attempts ─► failed   (emits 'failed', terminal, job.failedReason set)
```

---

## Inspecting Jobs

```js
// By status — pass one or more status strings
const waiting   = queue('notifications').getJobs(['waiting']);
const completed = queue('notifications').getJobs(['completed']);
const failed    = queue('notifications').getJobs(['failed']);

// Counts per status
const counts = await queue('notifications').getJobCounts();
// { waiting: N, active: N, completed: N, failed: N, delayed: N }

// Single job by ID
const job = queue('notifications').getJob(jobId); // null if not found

// Debug snapshot
const snap = queue('notifications').getSnapshot();
// { queueName, jobCount, processorCount, processors, jobs: { waiting, active, ... }, sampleJobs }
```

### Common assertion patterns

```js
it('enqueues a notification job', async () => {
  await createUser(basePayload());

  const jobs = queue('notifications').getJobs(['waiting']);
  expect(jobs).toHaveLength(1);
  expect(jobs[0].data.user_id).toBeDefined();
  expect(jobs[0].name).toBe('send-welcome-email');
});

it('does not enqueue when user already exists', async () => {
  await expect(createUser(duplicatePayload())).rejects.toThrow();
  expect(queue('notifications').getJobs(['waiting'])).toHaveLength(0);
});
```

---

## Processing Jobs Manually

```js
await queue('payments').processJobs();          // process up to 10 waiting jobs
await queue('payments').processJobs(50);        // custom limit
```

`processJobs()` selects waiting jobs sorted by:
1. `priority` descending (higher = first)
2. `timestamp` ascending (FIFO within same priority)

Jobs whose delay has not elapsed are skipped. `processJobs()` is a no-op if the queue is paused or closed.

---

## Retry

```js
queue('jobs').process('flaky', async (job) => {
  if (someCondition) throw new Error('not ready');
  return { done: true };
});

await serviceUnderTest(payload);

// With attempts: 3 and backoff.delay: 0 (immediate retries)
await queue('jobs').processJobs(); // attempt 1 — fails, re-queues
await queue('jobs').processJobs(); // attempt 2 — fails, re-queues
await queue('jobs').processJobs(); // attempt 3 — completes (or permanently fails)
```

### Backoff types

| Type | Delay formula |
|---|---|
| `'fixed'` | `backoff.delay` ms every time |
| `'exponential'` | `backoff.delay × 2^(attemptsMade − 1)` |

> After a retry the backoff is stored on `job.delay` (top-level), not `job.opts.delay`. `getJobCounts().delayed` checks `job.opts.delay > 0` and therefore **does not count retrying jobs as delayed** — they appear in `waiting` only.

---

## Events

```js
queue('notifications').on('active',    (job)         => { /* job became active */ });
queue('notifications').on('completed', (job, result) => { /* job succeeded */ });
queue('notifications').on('failed',    (job, error)  => { /* job failed or will retry */ });
```

Events fire synchronously during `processJobs()`, so assertions immediately after `await processJobs()` are safe.

> `close()` calls `removeAllListeners()`. Re-register listeners if you close and recreate the queue.

---

## Queue Control

```js
queue('jobs').pause();          // processJobs() becomes a no-op
queue('jobs').resume();         // processing re-enabled
await queue('jobs').empty();    // remove all jobs from memory
await queue('jobs').close();    // stop async polling, remove listeners, prevent new adds
```

---

## Per-Test Isolation

enmoq clears queue state automatically before each test when `autoReset.queue: true` (the default). See [usage guide → `enmoq.config.js`](../usage-guide.md#enmoqconfigjs).

For manual control within a file:

```js
afterEach(async () => {
  await queue('notifications').empty();
});
```

---

## Disk Persistence

Each `add()` triggers a debounced write to disk. The file is written asynchronously — **do not assert on disk state immediately after `add()` returns**.

`empty()` is the exception: it awaits the disk write synchronously.

```
.mock-data/
  <session-id>/
    queue/
      notifications/
        jobs.json     ← written after each add() / completion (debounced)
```

Explicit session save (uses the `sessionId` set at construction):

```js
await queue('notifications').persist();
```

Use the CLI to inspect saved queue state:

```bash
npx enmoq inspect
```

See [usage guide → mock data on disk](../usage-guide.md#mock-data-on-disk).
