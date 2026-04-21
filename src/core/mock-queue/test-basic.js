/**
 * Phase 1 Tests - Basic Operations
 *
 * Tests for queue creation, job scheduling, and persistence.
 */

const BullMock = require('./index');
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
const testDataDir = './playground/bull-data-test-basic';

async function cleanup() {
  try {
    await fs.rm(testDataDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

// Tests
async function testCreateQueue() {
  console.log('Test: Create Bull queue');
  const queue = new BullMock('test-queue', { dataDir: testDataDir, processMode: 'manual' });

  assert(queue.queueName === 'test-queue', 'Queue name should be set');
  assert(queue.jobs.size === 0, 'Queue should start empty');
  assert(queue.processors.size === 0, 'No processors initially');

  await queue.close();
  await cleanup();
}

async function testAddSingleJob() {
  console.log('Test: Add single job');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  const job = await queue.add('test-job', { userId: '123' });

  assert(job.id !== undefined, 'Job should have ID');
  assert(job.name === 'test-job', 'Job name should match');
  assert(job.data.userId === '123', 'Job data should be preserved');
  assert(job.status === 'waiting', 'Job should be waiting');
  assert(queue.jobs.size === 1, 'Queue should have 1 job');

  await queue.close();
  await cleanup();
}

async function testAddMultipleJobs() {
  console.log('Test: Add multiple jobs');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  await queue.add('job1', { data: 1 });
  await queue.add('job2', { data: 2 });
  await queue.add('job3', { data: 3 });

  assert(queue.jobs.size === 3, 'Queue should have 3 jobs');

  const jobs = queue.getJobs(['waiting']);
  assert(jobs.length === 3, 'All jobs should be waiting');

  await queue.close();
  await cleanup();
}

async function testJobOptions() {
  console.log('Test: Job with options');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  const job = await queue.add(
    'test-job',
    { userId: '123' },
    {
      attempts: 5,
      delay: 1000,
      priority: 10,
      backoff: { type: 'exponential', delay: 2000 },
    }
  );

  assert(job.opts.attempts === 5, 'Attempts should be 5');
  assert(job.opts.delay === 1000, 'Delay should be 1000');
  assert(job.opts.priority === 10, 'Priority should be 10');
  assert(job.opts.backoff.type === 'exponential', 'Backoff type should be exponential');

  await queue.close();
  await cleanup();
}

async function testJobIdGeneration() {
  console.log('Test: Job ID generation (unique ULIDs)');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  const job1 = await queue.add('test', {});
  const job2 = await queue.add('test', {});
  const job3 = await queue.add('test', {});

  assert(job1.id !== job2.id, 'Job IDs should be unique');
  assert(job2.id !== job3.id, 'Job IDs should be unique');
  assert(job1.id.length === 26, 'Job ID should be ULID (26 chars)');

  await queue.close();
  await cleanup();
}

async function testGetJob() {
  console.log('Test: Get job by ID');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  const addedJob = await queue.add('test-job', { userId: '123' });
  const retrievedJob = queue.getJob(addedJob.id);

  assert(retrievedJob !== null, 'Job should be found');
  assert(retrievedJob.id === addedJob.id, 'Job ID should match');
  assert(retrievedJob.data.userId === '123', 'Job data should match');

  await queue.close();
  await cleanup();
}

async function testGetJobsByStatus() {
  console.log('Test: Get jobs by status');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  await queue.add('job1', {});
  await queue.add('job2', {});
  await queue.add('job3', {});

  const waitingJobs = queue.getJobs(['waiting']);
  assert(waitingJobs.length === 3, 'All jobs should be waiting');

  const completedJobs = queue.getJobs(['completed']);
  assert(completedJobs.length === 0, 'No completed jobs yet');

  await queue.close();
  await cleanup();
}

async function testAutoPersist() {
  console.log('Test: Auto-persist saves to disk');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: true,
  });

  await queue.add('test-job', { userId: '123' });

  // Wait for debounce
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Check file exists
  const jobsPath = path.join(testDataDir, 'runtime', 'test-queue', 'jobs.json');
  const content = await fs.readFile(jobsPath, 'utf8');
  const data = JSON.parse(content);

  assert(data.jobs.length === 1, 'Job should be persisted');
  assert(data.jobs[0].data.userId === '123', 'Job data should be persisted');

  await queue.close();
  await cleanup();
}

async function testSessionSave() {
  console.log('Test: Session save');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
    sessionId: 'test-session',
  });

  await queue.add('job1', { data: 1 });
  await queue.add('job2', { data: 2 });

  await queue.persist();

  // Verify session file
  const sessionPath = path.join(testDataDir, 'sessions', 'test-session.json');
  const content = await fs.readFile(sessionPath, 'utf8');
  const data = JSON.parse(content);

  assert(data.queues['test-queue'] !== undefined, 'Queue should be in session');
  assert(data.queues['test-queue'].jobs.length === 2, 'Both jobs should be saved');

  await queue.close();
  await cleanup();
}

async function testSessionRestore() {
  console.log('Test: Session restore');

  // Create and save session
  const queue1 = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
    sessionId: 'restore-test',
  });

  await queue1.add('job1', { value: 100 });
  await queue1.add('job2', { value: 200 });
  await queue1.persist();
  await queue1.close();

  // Restore in new queue
  const queue2 = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
    sessionId: 'restore-test',
  });

  const restored = await queue2.restore();

  assert(restored === true, 'Session should be restored');
  assert(queue2.jobs.size === 2, 'Both jobs should be restored');

  const jobs = Array.from(queue2.jobs.values());
  assert(jobs[0].data.value === 100, 'First job data should match');
  assert(jobs[1].data.value === 200, 'Second job data should match');

  await queue2.close();
  await cleanup();
}

async function testFixtureSave() {
  console.log('Test: Fixture save');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  await queue.add('job1', { test: true });
  await queue.saveFixture('test-fixture');

  // Verify fixture file
  const fixturePath = path.join(testDataDir, 'fixtures', 'test-fixture.json');
  const content = await fs.readFile(fixturePath, 'utf8');
  const data = JSON.parse(content);

  assert(data.queues['test-queue'] !== undefined, 'Queue should be in fixture');
  assert(data.queues['test-queue'].jobs.length === 1, 'Job should be saved');

  await queue.close();
  await cleanup();
}

async function testFixtureLoad() {
  console.log('Test: Fixture load');

  // Create and save fixture
  const queue1 = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  await queue1.add('job1', { fixture: 'data' });
  await queue1.saveFixture('load-test');
  await queue1.close();

  // Load in new queue
  const queue2 = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  const loaded = await queue2.loadFixture('load-test');

  assert(loaded === true, 'Fixture should be loaded');
  assert(queue2.jobs.size === 1, 'Job should be loaded');

  const job = Array.from(queue2.jobs.values())[0];
  assert(job.data.fixture === 'data', 'Job data should match');

  await queue2.close();
  await cleanup();
}

async function testEmptyQueue() {
  console.log('Test: Empty queue');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  await queue.add('job1', {});
  await queue.add('job2', {});
  assert(queue.jobs.size === 2, 'Queue should have 2 jobs');

  await queue.empty();
  assert(queue.jobs.size === 0, 'Queue should be empty');

  await queue.close();
  await cleanup();
}

async function testPauseResume() {
  console.log('Test: Pause and resume queue');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  assert(queue.isPaused === false, 'Queue should not be paused initially');

  queue.pause();
  assert(queue.isPaused === true, 'Queue should be paused');

  queue.resume();
  assert(queue.isPaused === false, 'Queue should be resumed');

  await queue.close();
  await cleanup();
}

async function testGetSnapshot() {
  console.log('Test: Get snapshot');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  await queue.add('job1', {});
  await queue.add('job2', {});

  const snapshot = queue.getSnapshot();

  assert(snapshot.queueName === 'test-queue', 'Queue name in snapshot');
  assert(snapshot.jobCount === 2, 'Job count in snapshot');
  assert(snapshot.jobs.waiting === 2, 'Waiting jobs count');

  await queue.close();
  await cleanup();
}

// Run all tests
async function runTests() {
  console.log('=== Phase 1: Basic Operations Tests ===\n');

  try {
    await testCreateQueue();
    await testAddSingleJob();
    await testAddMultipleJobs();
    await testJobOptions();
    await testJobIdGeneration();
    await testGetJob();
    await testGetJobsByStatus();
    await testAutoPersist();
    await testSessionSave();
    await testSessionRestore();
    await testFixtureSave();
    await testFixtureLoad();
    await testEmptyQueue();
    await testPauseResume();
    await testGetSnapshot();

    console.log(`\n✓ Passed: ${passedTests}/${testCount}`);
    console.log('All Phase 1 tests passed! 🎉');
  } catch (error) {
    console.error(`\n✗ Failed: Test threw error`);
    console.error(error);
    process.exit(1);
  }
}

runTests();
