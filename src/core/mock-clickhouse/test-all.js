/**
 * Run all test suites
 */

const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

async function runAllTests() {
  console.log('=== ClickHouse Mock - All Tests ===\n');

  const tests = [
    { name: 'Phase 1: Insert Operations', command: 'node test-insert.js' },
    { name: 'Phase 2: Query Operations', command: 'node test-query.js' },
  ];

  let totalPassed = 0;
  let totalFailed = 0;

  for (const test of tests) {
    console.log(`\nRunning: ${test.name}`);
    console.log('─'.repeat(50));

    try {
      const { stdout, stderr } = await execPromise(test.command);
      console.log(stdout);
      if (stderr) console.error(stderr);

      // Extract pass count from output
      const match = stdout.match(/✓ Passed: (\d+)/);
      if (match) {
        totalPassed += parseInt(match[1]);
      }
    } catch (error) {
      console.error(`✗ ${test.name} failed`);
      console.error(error.stdout || error.message);
      totalFailed++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('📊 Summary');
  console.log('='.repeat(50));
  console.log(`Total Tests Passed: ${totalPassed}`);

  if (totalFailed > 0) {
    console.log(`Test Suites Failed: ${totalFailed}`);
    process.exit(1);
  } else {
    console.log('✅ All test suites passed!');
  }
}

runAllTests();
