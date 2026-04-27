# Coverage Reports

enmoq tests run under Jest. Coverage works exactly as it does in any Jest project — enmoq doesn't interfere with any coverage options, and the mocks count as real execution paths for your service code.

> For project setup, jest config, and general test-writing rules, see the [usage guide](../usage-guide.md).

---

## Basic Setup

Tell Jest which files to instrument. Without `collectCoverageFrom`, Jest only collects coverage for files that were actually `require`d during the test run — it won't report on files that no test touched at all.

Add these to your `jest.config.js`:

```js
// jest.config.js
module.exports = {
  // ...your existing enmoq config...

  collectCoverageFrom: [
    'services/**/*.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['html', 'text'],
};
```

Add a dedicated script to `package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:coverage": "jest --coverage"
  }
}
```

Regular `npm test` stays fast. Coverage is only collected when you run `npm run test:coverage`.

---

## Scoping to a Domain or Feature

To measure coverage for a specific part of your codebase — e.g. one domain during a PR review — pass `--collectCoverageFrom` on the CLI without changing `jest.config.js`:

```bash
# Only payment services
npx jest --coverage --collectCoverageFrom="services/payments/**/*.js"

# A single service file
npx jest --coverage --collectCoverageFrom="services/payments/create-payment.js"

# Multiple directories at once
npx jest --coverage --collectCoverageFrom="{services/payments,services/accounts}/**/*.js"
```

---

## HTML Report

The `html` reporter writes a browsable report to `coverage/index.html`:

```bash
npm run test:coverage
open coverage/index.html        # macOS
xdg-open coverage/index.html   # Linux
start coverage/index.html      # Windows
```

The report shows:
- **Summary table** — statements, branches, functions, lines per file
- **File drilldown** — click any filename for line-by-line highlighting
  - Green — executed
  - Red — never reached
  - Yellow — partially covered branch (one side of an `if` was never taken)

This is most useful for finding untested error branches. A service that validates input and throws might show 90% statement coverage but 40% branch coverage if tests never trigger the failure path. The HTML drilldown shows exactly which `if` arm was skipped.

---

## Coverage Providers

```js
// jest.config.js
coverageProvider: 'v8',   // default is 'babel'
```

| Provider | Notes |
|----------|-------|
| `babel` (default) | Standard for most projects. Instruments source via Babel transforms. |
| `v8` | Uses V8's built-in coverage. More accurate branch detection for `&&`/`\|\|` short-circuit logic. |

---

## Output Formats

`coverageReporters` accepts multiple formats in a single run:

```js
coverageReporters: ['html', 'text', 'lcov'],
```

| Reporter | Output | Useful for |
|----------|--------|------------|
| `text` | Terminal table | Quick CLI check |
| `text-summary` | Single-line terminal summary | CI log noise reduction |
| `html` | Browsable report | Drilldown into uncovered lines |
| `lcov` | LCOV file | Codecov, Coveralls, SonarQube |
| `json` | Machine-readable JSON | Custom tooling |
| `cobertura` | XML | GitLab CI, Jenkins |

---

## Thresholds

Fail the CI build automatically if coverage drops below a minimum:

```js
// jest.config.js
coverageThreshold: {
  global: {
    statements: 80,
    branches: 70,
    functions: 80,
    lines: 80,
  },
},
```

Jest exits with a non-zero code when any threshold is breached. You can also enforce stricter thresholds on critical service files:

```js
coverageThreshold: {
  global: { statements: 80 },
  './services/payments/create-payment.js': {
    statements: 95,
    branches: 90,
  },
},
```

---

## What Coverage Tells You (and What It Doesn't)

Coverage measures which lines ran — not whether they ran correctly. A test that calls your service but makes no assertions will show 100% coverage.

Use coverage to find **gaps** — code paths that no test exercises at all. Common gaps in service tests:

- Error branches — `if (!user) throw new Error(...)` — did any test trigger this?
- Conditional logic — `amount > 1000 ? formatLarge() : formatSmall()` — was both sides ever taken?
- Early returns on missing optional fields
- Catch blocks in try/catch

Once you find an uncovered branch in the HTML report, write a test that hits it. enmoq's mocks handle the database, queue, and HTTP state automatically — the only new thing you need is the input that triggers that branch.

---

## Full `jest.config.js` Example

```js
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  rootDir: __dirname,

  setupFilesAfterEnv: ['enmoq/src/jest/setup.js'],

  moduleNameMapper: {
    '^@app-core/repository-factory$': '<rootDir>/node_modules/enmoq/src/core/mock-repository',
    '^@app-core/mongoose$':           '<rootDir>/node_modules/enmoq/src/core/mock-mongoose',
    '^@app-core/queue$':              '<rootDir>/node_modules/enmoq/src/core/mock-queue',
    '^@app-core/http-request$':       '<rootDir>/node_modules/enmoq/src/core/mock-http',
    '^tigerbeetle-node$':             '<rootDir>/node_modules/enmoq/src/core/mock-tigerbeetle',
  },

  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 30000,

  // Coverage
  collectCoverageFrom: [
    'services/**/*.js',
    '!**/node_modules/**',
  ],
  coverageProvider: 'v8',
  coverageDirectory: 'coverage',
  coverageReporters: ['html', 'text'],
  coverageThreshold: {
    global: { statements: 80, branches: 70, functions: 80, lines: 80 },
  },
};
```

Run:

```bash
npm run test:coverage
open coverage/index.html
```
