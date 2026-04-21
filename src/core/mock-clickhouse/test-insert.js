/**
 * Test: Insert Operations
 *
 * Tests table creation, schema validation, insert operations, and persistence.
 */

const path = require('path');
const ClickHouseMock = require('./index');

// Test counter
let passed = 0;
let failed = 0;

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      passed++;
      console.log(`✓ ${name}`);
    } catch (error) {
      failed++;
      console.error(`✗ ${name}`);
      console.error(`  ${error.message}`);
      if (error.stack) {
        console.error(`  ${error.stack.split('\n').slice(1, 3).join('\n')}`);
      }
    }
  })();
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message || 'Assertion failed'}\n  Expected: ${JSON.stringify(expected)}\n  Actual: ${JSON.stringify(actual)}`
    );
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(message || 'Expected true, got false');
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(message || 'Expected false, got true');
  }
}

async function assertThrows(fn, message) {
  try {
    await fn();
    throw new Error(message || 'Expected function to throw');
  } catch (error) {
    const expectedMsg = message || 'Expected function to throw';
    if (error.message === expectedMsg || error.message.includes(expectedMsg)) {
      throw error;
    }
    // Error was thrown as expected (different error message)
  }
}

async function runTests() {
  console.log('\n🧪 Testing: Insert Operations\n');

  const testDataDir = path.join(__dirname, '..', 'clickhouse-data', 'test-insert');

  // Test 1: Create ClickHouseMock instance
  await test('Create ClickHouseMock instance', async () => {
    const mock = new ClickHouseMock({ dataDir: testDataDir });
    assertTrue(mock instanceof ClickHouseMock);
    await mock.reset(); // Clean up
  });

  // Test 2: Ping returns success
  await test('Ping returns success', async () => {
    const mock = new ClickHouseMock({ dataDir: testDataDir });
    const result = await mock.ping();
    assertEqual(result.success, true);
    await mock.reset();
  });

  // Test 3: Create table
  await test('Create table with schema', async () => {
    const mock = new ClickHouseMock({ dataDir: testDataDir, autoPersist: false });

    await mock.createTable(`
      CREATE TABLE IF NOT EXISTS test_table (
        id String,
        name String,
        age Int32
      )
      ENGINE = MergeTree()
      ORDER BY id
    `);

    assertTrue(mock.tables.has('test_table'));
    assertEqual(mock.tables.get('test_table').schema.length, 3);
    await mock.reset();
  });

  // Test 4: Create table with IF NOT EXISTS (no error if exists)
  await test('Create table IF NOT EXISTS (idempotent)', async () => {
    const mock = new ClickHouseMock({ dataDir: testDataDir, autoPersist: false });

    await mock.createTable(`
      CREATE TABLE IF NOT EXISTS test_table (
        id String,
        name String
      )
      ENGINE = MergeTree()
    `);

    await mock.createTable(`
      CREATE TABLE IF NOT EXISTS test_table (
        id String,
        name String
      )
      ENGINE = MergeTree()
    `);

    assertTrue(mock.tables.has('test_table'));
    await mock.reset();
  });

  // Test 5: Insert single row
  await test('Insert single row', async () => {
    const mock = new ClickHouseMock({ dataDir: testDataDir, autoPersist: false });

    await mock.createTable(`
      CREATE TABLE test_table (
        id String,
        name String
      )
      ENGINE = MergeTree()
    `);

    await mock.insert({
      table: 'test_table',
      values: { id: '123', name: 'Alice' },
      format: 'JSONEachRow',
    });

    const table = mock.tables.get('test_table');
    assertEqual(table.rows.length, 1);
    assertEqual(table.rows[0].id, '123');
    assertEqual(table.rows[0].name, 'Alice');
    await mock.reset();
  });

  // Test 6: Insert multiple rows
  await test('Insert multiple rows', async () => {
    const mock = new ClickHouseMock({ dataDir: testDataDir, autoPersist: false });

    await mock.createTable(`
      CREATE TABLE test_table (
        id String,
        name String
      )
      ENGINE = MergeTree()
    `);

    await mock.insert({
      table: 'test_table',
      values: [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
        { id: '3', name: 'Charlie' },
      ],
      format: 'JSONEachRow',
    });

    const table = mock.tables.get('test_table');
    assertEqual(table.rows.length, 3);
    await mock.reset();
  });

  // Test 7: Insert with Decimal types
  await test('Insert with Decimal64 type', async () => {
    const mock = new ClickHouseMock({ dataDir: testDataDir, autoPersist: false });

    await mock.createTable(`
      CREATE TABLE test_table (
        id String,
        amount Decimal64(2)
      )
      ENGINE = MergeTree()
    `);

    await mock.insert({
      table: 'test_table',
      values: { id: '1', amount: 12.34 },
      format: 'JSONEachRow',
    });

    const table = mock.tables.get('test_table');
    assertEqual(table.rows[0].amount, 12.34);
    await mock.reset();
  });

  // Test 8: Insert with DateTime64 type
  await test('Insert with DateTime64 type', async () => {
    const mock = new ClickHouseMock({ dataDir: testDataDir, autoPersist: false });

    await mock.createTable(`
      CREATE TABLE test_table (
        id String,
        created_at DateTime64(3)
      )
      ENGINE = MergeTree()
    `);

    const now = new Date();
    await mock.insert({
      table: 'test_table',
      values: { id: '1', created_at: now.toISOString() },
      format: 'JSONEachRow',
    });

    const table = mock.tables.get('test_table');
    assertTrue(table.rows[0].created_at instanceof Date);
    await mock.reset();
  });

  // Test 9: Insert into non-existent table throws error
  await test('Insert into non-existent table throws error', async () => {
    const mock = new ClickHouseMock({ dataDir: testDataDir, autoPersist: false });

    await assertThrows(async () => {
      await mock.insert({
        table: 'nonexistent',
        values: { id: '1' },
        format: 'JSONEachRow',
      });
    });
    await mock.reset();
  });

  // Test 10: Reset clears all tables
  await test('Reset clears all tables', async () => {
    const mock = new ClickHouseMock({ dataDir: testDataDir, autoPersist: false });

    await mock.createTable(`
      CREATE TABLE test_table (id String) ENGINE = MergeTree()
    `);

    await mock.insert({
      table: 'test_table',
      values: { id: '1' },
      format: 'JSONEachRow',
    });

    await mock.reset();
    assertFalse(mock.tables.has('test_table'));
  });

  // Test 11: Auto-persist saves to disk
  await test('Auto-persist saves to disk', async () => {
    const mock = new ClickHouseMock({
      dataDir: testDataDir,
      autoPersist: true,
      persistDebounce: 50,
    });

    await mock.createTable(`
      CREATE TABLE test_table (
        id String,
        name String
      )
      ENGINE = MergeTree()
    `);

    await mock.insert({
      table: 'test_table',
      values: { id: '1', name: 'Alice' },
      format: 'JSONEachRow',
    });

    // Wait for debounced persist
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Create new mock instance and load from disk
    const mock2 = new ClickHouseMock({ dataDir: testDataDir });
    const tableData = await mock2.storage.loadTable('test_table');

    assertTrue(tableData !== null);
    assertEqual(tableData.rows.length, 1);
    assertEqual(tableData.rows[0].id, '1');

    await mock.reset();
    await mock2.reset();
  });

  // Test 12: GetSnapshot returns table overview
  await test('GetSnapshot returns table overview', async () => {
    const mock = new ClickHouseMock({ dataDir: testDataDir, autoPersist: false });

    await mock.createTable(`
      CREATE TABLE test_table (id String) ENGINE = MergeTree()
    `);

    await mock.insert({
      table: 'test_table',
      values: [{ id: '1' }, { id: '2' }],
      format: 'JSONEachRow',
    });

    const snapshot = mock.getSnapshot();
    assertTrue(snapshot.test_table);
    assertEqual(snapshot.test_table.rowCount, 2);
    await mock.reset();
  });

  // Test 13: account_balances table schema
  await test('Create account_balances table', async () => {
    const mock = new ClickHouseMock({ dataDir: testDataDir, autoPersist: false });

    await mock.createTable(`
      CREATE TABLE IF NOT EXISTS account_balances (
        account_id String,
        account_balance_id String,
        payment_id String,
        amount Decimal64(2),
        actual_balance Decimal256(2),
        pending_balance Decimal256(2),
        transaction_time DateTime64(3),
        currency LowCardinality(String),
        context String,
        class String
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMMDD(transaction_time)
      ORDER BY (account_id, transaction_time)
    `);

    assertTrue(mock.tables.has('account_balances'));
    assertEqual(mock.tables.get('account_balances').schema.length, 10);
    await mock.reset();
  });

  // Test 14: Insert into account_balances
  await test('Insert into account_balances', async () => {
    const mock = new ClickHouseMock({ dataDir: testDataDir, autoPersist: false });

    await mock.createTable(`
      CREATE TABLE IF NOT EXISTS account_balances (
        account_id String,
        account_balance_id String,
        payment_id String,
        amount Decimal64(2),
        actual_balance Decimal256(2),
        pending_balance Decimal256(2),
        transaction_time DateTime64(3),
        currency LowCardinality(String),
        context String,
        class String
      )
      ENGINE = MergeTree()
    `);

    await mock.insert({
      table: 'account_balances',
      values: {
        account_id: '01ABCDEFGHIJKLMNOPQRSTUV',
        account_balance_id: '123456789012345678901234567890',
        payment_id: '01WXYZ1234567890ABCDEFGH',
        amount: 5000.0,
        actual_balance: 100000.0,
        pending_balance: 100000.0,
        transaction_time: new Date().toISOString(),
        currency: 'NGN',
        context: 'payment_credit',
        class: 'credit',
      },
      format: 'JSONEachRow',
    });

    const table = mock.tables.get('account_balances');
    assertEqual(table.rows.length, 1);
    assertEqual(table.rows[0].currency, 'NGN');
    assertEqual(table.rows[0].amount, 5000.0);
    await mock.reset();
  });

  // Print summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✓ Passed: ${passed}`);
  if (failed > 0) {
    console.log(`✗ Failed: ${failed}`);
  }
  console.log(`${'='.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
