# CLI

enmoq ships an `enmoq` binary for inspecting and managing the mock data that accumulates on disk during test runs.

> Mock data is written to `.mock-data/` by default (configurable via `dataDir` in `enmoq.config.js`). Each Jest run writes into a named session directory. See the [usage guide](../usage-guide.md) for how sessions are configured.

---

## Installation

The CLI is available after installing enmoq:

```bash
npm install --save-dev enmoq
```

Run it with `npx`:

```bash
npx enmoq --help
```

Or add a shortcut to `package.json`:

```json
{
  "scripts": {
    "mock:inspect":  "enmoq inspect",
    "mock:sessions": "enmoq sessions",
    "mock:clear":    "enmoq clear"
  }
}
```

---

## Commands

### `enmoq sessions`

Lists all session directories that exist in `.mock-data/`, with creation time, last-modified time, and item count.

```bash
npx enmoq sessions
```

Example output:

```
Found 3 session(s):

  test-session-abc123
    Created: 2026-04-21T10:00:00.000Z
    Modified: 2026-04-21T10:01:45.000Z
    Items: 4

  payments-suite
    Created: 2026-04-20T09:12:00.000Z
    Modified: 2026-04-20T09:13:10.000Z
    Items: 7
```

"Items" counts collections across all mock types in that session (repository files, queue directories, HTTP files, ClickHouse tables, TigerBeetle files).

---

### `enmoq inspect`

Prints a summary of all mock data in the most recent session, or in a named session.

```bash
# Summary of all mocks in the default session
npx enmoq inspect

# Summary for a specific session
npx enmoq inspect --session=payments-suite
```

Example output:

```
Mock Data (Session: payments-suite)
=====================================

Repository Collections:
  User                           (12 records)
  Payment                        (8 records)

Queues:
  notifications                  (3 jobs)

HTTP:
  history.json                   (15 entries)
  resources.json                 (2 entries)

TigerBeetle:
  accounts.json                  (4 records)
  transfers.json                 (6 records)
```

#### Inspecting a specific collection

Pass a collection name to print the full JSON contents:

```bash
# Repository collection
npx enmoq inspect User

# ClickHouse table
npx enmoq inspect transactions

# Queue
npx enmoq inspect notifications

# TigerBeetle file
npx enmoq inspect accounts

# HTTP history
npx enmoq inspect history

# With session flag
npx enmoq inspect Payment --session=payments-suite
```

enmoq searches repository, ClickHouse, queue, HTTP, and TigerBeetle in that order and prints the first match. If nothing is found, it falls back to the full summary view.

---

### `enmoq clear`

Deletes session data from `.mock-data/`.

```bash
# Clear all sessions
npx enmoq clear

# Clear a specific session only
npx enmoq clear --session=payments-suite
```

`clear` without `--session` removes every session directory under `.mock-data/`. The `.mock-data/` directory itself is not removed.

> **Note:** enmoq creates a new session directory on every Jest run (based on `TEST_SESSION_DIR`). Old sessions accumulate until you clear them. Run `enmoq clear` in CI after each pipeline run, or as a `pretest` script locally.

---

## Session Names

Sessions are controlled by the `TEST_SESSION_DIR` environment variable set at the top of `jest.config.js`:

```js
process.env.TEST_SESSION_DIR = 'payments-suite';
```

The CLI `--session` flag uses the same name. If you don't set `TEST_SESSION_DIR`, data lands in a `default` session.

---

## Data Directory

By default the CLI reads from `.mock-data/` in `process.cwd()`. Override it with the `MOCK_DATA_DIR` environment variable:

```bash
MOCK_DATA_DIR=/tmp/test-data npx enmoq inspect
```

This is useful when your `dataDir` in `enmoq.config.js` is set to something other than the default.
