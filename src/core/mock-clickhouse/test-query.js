/**
 * Phase 2 Tests - Query Operations
 *
 * Tests for SELECT queries, WHERE filtering, GROUP BY, aggregations, and date functions.
 */

const ClickHouseMock = require('./index');
const fs = require('fs').promises;
const path = require('path');

// Test utilities
let testCount = 0;
let passedTests = 0;

function assert(condition, message) {
  testCount++;
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
}

function assertEqual(actual, expected, message) {
  testCount++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error('Expected:', expected);
    console.error('Actual:', actual);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
}

async function assertThrows(fn, message) {
  testCount++;
  try {
    await fn();
    throw new Error(`Expected function to throw: ${message}`);
  } catch (error) {
    const expectedMsg = message || 'Expected function to throw';
    if (
      error.message === `Expected function to throw: ${message}` ||
      error.message === expectedMsg
    ) {
      throw error;
    }
    passedTests++;
  }
}

// Setup test data directory
const testDataDir = './playground/clickhouse-data-test-query';

async function setup() {
  const mock = new ClickHouseMock({ dataDir: testDataDir, autoPersist: false });

  // Create account_balances table
  await mock.createTable(`
    CREATE TABLE IF NOT EXISTS account_balances (
      account_id String,
      account_balance_id String,
      payment_id String,
      amount Decimal64(2),
      actual_balance Decimal64(2),
      pending_balance Decimal64(2),
      transaction_time DateTime64(3),
      currency LowCardinality(String),
      context String,
      class String
    )
  `);

  // Insert test data
  const now = new Date('2024-01-15T10:30:00Z');
  const testData = [
    {
      account_id: 'acc1',
      account_balance_id: 'bal1',
      payment_id: 'pay1',
      amount: '100.50',
      actual_balance: '1000.00',
      pending_balance: '50.00',
      transaction_time: new Date('2024-01-15T10:00:00Z').toISOString(),
      currency: 'USD',
      context: 'deposit',
      class: 'credit',
    },
    {
      account_id: 'acc1',
      account_balance_id: 'bal2',
      payment_id: 'pay2',
      amount: '50.25',
      actual_balance: '1050.50',
      pending_balance: '0.00',
      transaction_time: new Date('2024-01-15T11:00:00Z').toISOString(),
      currency: 'USD',
      context: 'withdrawal',
      class: 'debit',
    },
    {
      account_id: 'acc2',
      account_balance_id: 'bal3',
      payment_id: 'pay3',
      amount: '200.00',
      actual_balance: '500.00',
      pending_balance: '0.00',
      transaction_time: new Date('2024-01-16T09:00:00Z').toISOString(),
      currency: 'USD',
      context: 'deposit',
      class: 'credit',
    },
    {
      account_id: 'acc2',
      account_balance_id: 'bal4',
      payment_id: 'pay4',
      amount: '75.50',
      actual_balance: '700.00',
      pending_balance: '0.00',
      transaction_time: new Date('2024-01-16T10:00:00Z').toISOString(),
      currency: 'USD',
      context: 'deposit',
      class: 'credit',
    },
  ];

  for (const row of testData) {
    await mock.insert({ table: 'account_balances', values: row, format: 'JSONEachRow' });
  }

  return mock;
}

async function cleanup() {
  try {
    await fs.rm(testDataDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

// Tests
async function testSelectAll() {
  console.log('Test: SELECT * FROM table');
  const mock = await setup();

  const results = await mock.findMany({
    query: 'SELECT * FROM account_balances',
  });

  assert(results.length === 4, 'Should return all 4 rows');
  assert(results[0].account_id === 'acc1', 'Should have correct data');

  await cleanup();
}

async function testSelectColumns() {
  console.log('Test: SELECT specific columns');
  const mock = await setup();

  const results = await mock.findMany({
    query: 'SELECT account_id, amount, currency FROM account_balances',
  });

  assert(results.length === 4, 'Should return all rows');
  assert(Object.keys(results[0]).length === 3, 'Should have 3 columns');
  assert(results[0].account_id !== undefined, 'Should have account_id');
  assert(results[0].amount !== undefined, 'Should have amount');
  assert(results[0].currency !== undefined, 'Should have currency');

  await cleanup();
}

async function testWhereEquality() {
  console.log('Test: WHERE with equality');
  const mock = await setup();

  const results = await mock.findMany({
    query: "SELECT * FROM account_balances WHERE account_id = 'acc1'",
  });

  assert(results.length === 2, 'Should return 2 rows for acc1');
  assert(
    results.every((r) => r.account_id === 'acc1'),
    'All rows should have account_id = acc1'
  );

  await cleanup();
}

async function testWhereComparison() {
  console.log('Test: WHERE with comparison operators');
  const mock = await setup();

  const results = await mock.findMany({
    query: 'SELECT * FROM account_balances WHERE amount >= 100',
  });

  assert(results.length === 2, 'Should return 2 rows with amount >= 100');
  assert(
    results.every((r) => Number(r.amount) >= 100),
    'All amounts should be >= 100'
  );

  await cleanup();
}

async function testWhereAnd() {
  console.log('Test: WHERE with AND');
  const mock = await setup();

  const results = await mock.findMany({
    query: "SELECT * FROM account_balances WHERE account_id = 'acc1' AND context = 'deposit'",
  });

  assert(results.length === 1, 'Should return 1 row');
  assert(results[0].account_id === 'acc1', 'Should have account_id = acc1');
  assert(results[0].context === 'deposit', 'Should have context = deposit');

  await cleanup();
}

async function testGroupBy() {
  console.log('Test: GROUP BY');
  const mock = await setup();

  const results = await mock.findMany({
    query: 'SELECT account_id, COUNT(*) as count FROM account_balances GROUP BY account_id',
  });

  assert(results.length === 2, 'Should have 2 groups');
  const acc1 = results.find((r) => r.account_id === 'acc1');
  const acc2 = results.find((r) => r.account_id === 'acc2');
  assert(acc1.count === 2, 'acc1 should have 2 transactions');
  assert(acc2.count === 2, 'acc2 should have 2 transactions');

  await cleanup();
}

async function testAggregations() {
  console.log('Test: Aggregation functions (SUM, AVG, MIN, MAX)');
  const mock = await setup();

  const results = await mock.findMany({
    query: `
      SELECT 
        account_id,
        SUM(amount) as total_amount,
        AVG(amount) as avg_amount,
        MIN(amount) as min_amount,
        MAX(amount) as max_amount
      FROM account_balances 
      GROUP BY account_id
    `,
  });

  assert(results.length === 2, 'Should have 2 groups');

  const acc1 = results.find((r) => r.account_id === 'acc1');
  assert(Math.abs(acc1.total_amount - 150.75) < 0.01, 'acc1 total should be 150.75');
  assert(Math.abs(acc1.avg_amount - 75.375) < 0.01, 'acc1 avg should be 75.375');

  await cleanup();
}

async function testArgMax() {
  console.log('Test: argMax function');
  const mock = await setup();

  const results = await mock.findMany({
    query: `
      SELECT 
        account_id,
        argMax(actual_balance, transaction_time) as latest_balance
      FROM account_balances 
      GROUP BY account_id
    `,
  });

  assert(results.length === 2, 'Should have 2 groups');

  const acc1 = results.find((r) => r.account_id === 'acc1');
  assert(
    Math.abs(acc1.latest_balance - 1050.5) < 0.01,
    'Should return balance from latest transaction'
  );

  await cleanup();
}

async function testDateFunction() {
  console.log('Test: toDate function');
  const mock = await setup();

  const results = await mock.findMany({
    query: `
      SELECT 
        toDate(transaction_time) as date,
        COUNT(*) as count
      FROM account_balances 
      GROUP BY toDate(transaction_time)
    `,
  });

  assert(results.length === 2, 'Should have 2 date groups');
  // Verify we have two different dates and each has 2 transactions
  assert(results[0].count === 2, 'First date should have 2 transactions');
  assert(results[1].count === 2, 'Second date should have 2 transactions');
  assert(results[0].date !== results[1].date, 'Should have different dates');

  await cleanup();
}

async function testToMonday() {
  console.log('Test: toMonday function');
  const mock = await setup();

  const results = await mock.findMany({
    query: `
      SELECT 
        toMonday(transaction_time) as week,
        COUNT(*) as count
      FROM account_balances 
      GROUP BY toMonday(transaction_time)
    `,
  });

  assert(results.length === 1, 'All transactions should be in same week');
  assert(results[0].count === 4, 'Should count all 4 transactions');
  assert(results[0].week.startsWith('2024-01'), 'Should return Monday in January 2024');

  await cleanup();
}

async function testToStartOfMonth() {
  console.log('Test: toStartOfMonth function');
  const mock = await setup();

  const results = await mock.findMany({
    query: `
      SELECT 
        toStartOfMonth(transaction_time) as month,
        COUNT(*) as count
      FROM account_balances 
      GROUP BY toStartOfMonth(transaction_time)
    `,
  });

  assert(results.length === 1, 'All transactions should be in same month');
  assert(
    typeof results[0].month === 'string' && results[0].month.endsWith('-01'),
    'Should return first day of month'
  );
  assert(results[0].count === 4, 'Should count all 4 transactions');

  await cleanup();
}

async function testOrderBy() {
  console.log('Test: ORDER BY');
  const mock = await setup();

  const results = await mock.findMany({
    query: 'SELECT account_id, amount FROM account_balances ORDER BY amount DESC',
  });

  assert(results.length === 4, 'Should return all rows');
  assert(Number(results[0].amount) === 200, 'First row should have highest amount');
  assert(Number(results[3].amount) === 50.25, 'Last row should have lowest amount');

  await cleanup();
}

async function testLimit() {
  console.log('Test: LIMIT');
  const mock = await setup();

  const results = await mock.findMany({
    query: 'SELECT * FROM account_balances LIMIT 2',
  });

  assert(results.length === 2, 'Should return only 2 rows');

  await cleanup();
}

async function testQueryParameters() {
  console.log('Test: Query parameters');
  const mock = await setup();

  const results = await mock.findMany({
    query: 'SELECT * FROM account_balances WHERE account_id = {accId: String}',
    queryParams: { accId: 'acc1' },
  });

  assert(results.length === 2, 'Should return 2 rows for acc1');
  assert(
    results.every((r) => r.account_id === 'acc1'),
    'All rows should match parameter'
  );

  await cleanup();
}

async function testComplexQuery() {
  console.log('Test: Complex query with multiple clauses');
  const mock = await setup();

  const results = await mock.findMany({
    query: `
      SELECT 
        account_id,
        toDate(transaction_time) as date,
        SUM(amount) as daily_total,
        COUNT(*) as transaction_count
      FROM account_balances
      WHERE context = 'deposit'
      GROUP BY account_id, toDate(transaction_time)
      ORDER BY daily_total DESC
      LIMIT 5
    `,
  });

  assert(results.length === 2, 'Should return 2 results');
  assert(results[0].daily_total >= results[1].daily_total, 'Should be ordered by daily_total DESC');

  await cleanup();
}

async function testWhereWithDateFunction() {
  console.log('Test: WHERE with date function');
  const mock = await setup();

  const results = await mock.findMany({
    query: "SELECT * FROM account_balances WHERE toDate(transaction_time) >= '2024-01-16'",
  });

  assert(results.length === 2, 'Should return 2 rows from Jan 16');
  assert(
    results.every((r) => r.account_id === 'acc2'),
    'All rows should be from acc2'
  );

  await cleanup();
}

// Run all tests
async function runTests() {
  console.log('=== Phase 2: Query Operations Tests ===\n');

  try {
    await testSelectAll();
    await testSelectColumns();
    await testWhereEquality();
    await testWhereComparison();
    await testWhereAnd();
    await testGroupBy();
    await testAggregations();
    await testArgMax();
    await testDateFunction();
    await testToMonday();
    await testToStartOfMonth();
    await testOrderBy();
    await testLimit();
    await testQueryParameters();
    await testComplexQuery();
    await testWhereWithDateFunction();

    console.log(`\n✓ Passed: ${passedTests}/${testCount}`);
    console.log('All Phase 2 tests passed! 🎉');
  } catch (error) {
    console.error(`\n✗ Failed: Test threw error`);
    console.error(error);
    process.exit(1);
  }
}

runTests();
