/**
 * Phase 2 Tests - Job Processing
 *
 * Tests for job processing, concurrency, events, retries, and backoff.
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

const testDataDir = './playground/bull-data-test-processing';

async function cleanup() {
  try {
    await fs.rm(testDataDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

// Tests
async function testProcessorRegistration() {
  console.log('Test: Register processor');
  const queue = new BullMock('test-queue', { dataDir: testDataDir, processMode: 'manual' });

  const processor = async (job) => ({ processed: true });

  queue.process('test-job', processor);

  assert(queue.processors.has('test-job'), 'Processor should be registered');
  assert(
    queue.processors.get('test-job').processor === processor,
    'Processor function should match'
  );

  await queue.close();
  await cleanup();
}

async function testSyncProcessing() {
  console.log('Test: Sync processing');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'sync',
    autoPersist: false,
  });

  let processedData = null;

  queue.process('test-job', async (job) => {
    processedData = job.data;
    return { result: 'success' };
  });

  await queue.add('test-job', { userId: '123' });

  // In sync mode, job should be processed immediately
  assert(processedData !== null, 'Job should be processed');
  assert(processedData.userId === '123', 'Job data should match');

  await queue.close();
  await cleanup();
}

async function testManualProcessing() {
  console.log('Test: Manual processing');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  let processed = false;

  queue.process('test-job', async (job) => {
    processed = true;
    return { result: 'ok' };
  });

  await queue.add('test-job', { data: 'test' });

  assert(processed === false, 'Job should not be processed yet');

  await queue.processJobs();

  assert(processed === true, 'Job should be processed after manual call');

  await queue.close();
  await cleanup();
}

async function testJobCompletion() {
  console.log('Test: Job completion status');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  queue.process('test-job', async (job) => ({ result: 'done' }));

  const job = await queue.add('test-job', {});
  assert(job.status === 'waiting', 'Job should be waiting');

  await queue.processJobs();

  const completedJob = queue.getJob(job.id);
  assert(completedJob.status === 'completed', 'Job should be completed');
  assert(completedJob.returnvalue.result === 'done', 'Return value should be saved');

  await queue.close();
  await cleanup();
}

async function testJobFailure() {
  console.log('Test: Job failure handling');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  queue.process('test-job', async (job) => {
    throw new Error('Processing failed');
  });

  const job = await queue.add('test-job', {}, { attempts: 1 });
  await queue.processJobs();

  const failedJob = queue.getJob(job.id);
  assert(failedJob.status === 'failed', 'Job should be failed');
  assert(failedJob.failedReason === 'Processing failed', 'Failure reason should be saved');

  await queue.close();
  await cleanup();
}

async function testRetryMechanism() {
  console.log('Test: Retry mechanism');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  let attemptCount = 0;

  queue.process('test-job', async (job) => {
    attemptCount++;
    if (attemptCount <= 2) {
      throw new Error('Not ready yet');
    }
    return { success: true };
  });

  const job = await queue.add(
    'test-job',
    {},
    { attempts: 5, backoff: { type: 'fixed', delay: 0 } }
  );

  // Process multiple times
  await queue.processJobs(); // Attempt 1 - fails
  await queue.processJobs(); // Attempt 2 - fails
  await queue.processJobs(); // Attempt 3 - succeeds

  const completedJob = queue.getJob(job.id);
  assert(completedJob.status === 'completed', 'Job should eventually succeed');
  assert(completedJob.attemptsMade === 3, 'Should have made 3 attempts');

  await queue.close();
  await cleanup();
}

async function testExponentialBackoff() {
  console.log('Test: Exponential backoff calculation');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  let attemptCount = 0;

  queue.process('test-job', async (job) => {
    attemptCount++;
    throw new Error('Always fails');
  });

  const job = await queue.add(
    'test-job',
    {},
    {
      attempts: 4,
      backoff: { type: 'exponential', delay: 1000 },
    }
  );

  await queue.processJobs(); // Attempt 1
  let currentJob = queue.getJob(job.id);
  assert(currentJob.delay === 1000, 'First retry delay should be 1000ms');

  // Clear delay to allow immediate reprocessing
  currentJob.timestamp = Date.now() - 2000;

  await queue.processJobs(); // Attempt 2
  currentJob = queue.getJob(job.id);
  assert(currentJob.delay === 2000, 'Second retry delay should be 2000ms');

  // Clear delay to allow immediate reprocessing
  currentJob.timestamp = Date.now() - 3000;

  await queue.processJobs(); // Attempt 3
  currentJob = queue.getJob(job.id);
  assert(currentJob.delay === 4000, 'Third retry delay should be 4000ms');

  await queue.close();
  await cleanup();
}

async function testFixedBackoff() {
  console.log('Test: Fixed backoff calculation');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  queue.process('test-job', async (job) => {
    throw new Error('Always fails');
  });

  const job = await queue.add(
    'test-job',
    {},
    {
      attempts: 3,
      backoff: { type: 'fixed', delay: 5000 },
    }
  );

  await queue.processJobs(); // Attempt 1
  let currentJob = queue.getJob(job.id);
  assert(currentJob.delay === 5000, 'First retry delay should be 5000ms');

  await queue.processJobs(); // Attempt 2
  currentJob = queue.getJob(job.id);
  assert(currentJob.delay === 5000, 'Second retry delay should still be 5000ms');

  await queue.close();
  await cleanup();
}

async function testCompletedEvent() {
  console.log('Test: Completed event emission');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  let eventFired = false;
  let eventJob = null;
  let eventResult = null;

  queue.on('completed', (job, result) => {
    eventFired = true;
    eventJob = job;
    eventResult = result;
  });

  queue.process('test-job', async (job) => ({ status: 'done' }));

  await queue.add('test-job', { test: true });
  await queue.processJobs();

  assert(eventFired === true, 'Completed event should fire');
  assert(eventJob.data.test === true, 'Event should include job');
  assert(eventResult.status === 'done', 'Event should include result');

  await queue.close();
  await cleanup();
}

async function testFailedEvent() {
  console.log('Test: Failed event emission');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  let eventFired = false;
  let eventError = null;

  queue.on('failed', (job, error) => {
    eventFired = true;
    eventError = error;
  });

  queue.process('test-job', async (job) => {
    throw new Error('Test error');
  });

  await queue.add('test-job', {}, { attempts: 1 });
  await queue.processJobs();

  assert(eventFired === true, 'Failed event should fire');
  assert(eventError.message === 'Test error', 'Event should include error');

  await queue.close();
  await cleanup();
}

async function testActiveEvent() {
  console.log('Test: Active event emission');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  let eventFired = false;
  let eventJob = null;

  queue.on('active', (job) => {
    eventFired = true;
    eventJob = job;
  });

  queue.process('test-job', async (job) => ({ ok: true }));

  await queue.add('test-job', { active: true });
  await queue.processJobs();

  assert(eventFired === true, 'Active event should fire');
  assert(eventJob.data.active === true, 'Event should include job');

  await queue.close();
  await cleanup();
}

async function testPriorityProcessing() {
  console.log('Test: Priority-based processing');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  const processedOrder = [];

  queue.process('test-job', async (job) => {
    processedOrder.push(job.data.priority);
    return { ok: true };
  });

  // Add jobs with different priorities
  await queue.add('test-job', { priority: 1 }, { priority: 1 });
  await queue.add('test-job', { priority: 10 }, { priority: 10 });
  await queue.add('test-job', { priority: 5 }, { priority: 5 });

  // Process all
  await queue.processJobs();

  // Higher priority should be processed first
  assert(processedOrder[0] === 10, 'Highest priority first');
  assert(processedOrder[1] === 5, 'Medium priority second');
  assert(processedOrder[2] === 1, 'Lowest priority last');

  await queue.close();
  await cleanup();
}

async function testConcurrency() {
  console.log('Test: Concurrency control');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  const processing = [];

  queue.process('test-job', 2, async (job) => {
    processing.push(job.id);
    // Simulate work
    await new Promise((resolve) => setTimeout(resolve, 10));
    processing.splice(processing.indexOf(job.id), 1);
    return { ok: true };
  });

  // Add multiple jobs
  await queue.add('test-job', { n: 1 });
  await queue.add('test-job', { n: 2 });
  await queue.add('test-job', { n: 3 });

  // Process with limit
  await queue.processJobs(2);

  const counts = await queue.getJobCounts();
  assert(counts.completed === 2, 'Should process exactly 2 jobs');
  assert(counts.waiting === 1, 'Should have 1 waiting job');

  await queue.close();
  await cleanup();
}

async function testDelayedJobs() {
  console.log('Test: Delayed job processing');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  let processed = false;

  queue.process('test-job', async (job) => {
    processed = true;
    return { ok: true };
  });

  const now = Date.now();
  const job = await queue.add('test-job', {}, { delay: 5000 });

  assert(job.opts.delay === 5000, 'Job should have delay set');

  // Try processing immediately
  await queue.processJobs();
  assert(processed === false, 'Delayed job should not process yet');

  // Simulate time passing by clearing delay
  const delayedJob = queue.getJob(job.id);
  delayedJob.opts.delay = 0;

  await queue.processJobs();
  assert(processed === true, 'Job should process after delay');

  await queue.close();
  await cleanup();
}

async function testPausePreventsProcessing() {
  console.log('Test: Paused queue prevents processing');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  let processed = false;

  queue.process('test-job', async (job) => {
    processed = true;
    return { ok: true };
  });

  queue.pause();
  await queue.add('test-job', {});

  await queue.processJobs();

  assert(processed === false, 'Paused queue should not process jobs');

  queue.resume();
  await queue.processJobs();

  assert(processed === true, 'Resumed queue should process jobs');

  await queue.close();
  await cleanup();
}

async function testRemoveOnComplete() {
  console.log('Test: Remove on complete');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  queue.process('test-job', async (job) => ({ ok: true }));

  const job = await queue.add('test-job', {}, { removeOnComplete: true });
  await queue.processJobs();

  const removedJob = queue.getJob(job.id);
  assert(removedJob === null, 'Job should be removed after completion');

  await queue.close();
  await cleanup();
}

async function testMultipleProcessors() {
  console.log('Test: Multiple processors for different job types');
  const queue = new BullMock('test-queue', {
    dataDir: testDataDir,
    processMode: 'manual',
    autoPersist: false,
  });

  const results = {};

  queue.process('type-a', async (job) => {
    results.typeA = job.data.value;
    return { type: 'a' };
  });

  queue.process('type-b', async (job) => {
    results.typeB = job.data.value;
    return { type: 'b' };
  });

  await queue.add('type-a', { value: 'A' });
  await queue.add('type-b', { value: 'B' });

  await queue.processJobs();

  assert(results.typeA === 'A', 'Type A processor should handle type-a jobs');
  assert(results.typeB === 'B', 'Type B processor should handle type-b jobs');

  await queue.close();
  await cleanup();
}

// Run all tests
async function runTests() {
  console.log('=== Phase 2: Job Processing Tests ===\n');

  try {
    await testProcessorRegistration();
    await testSyncProcessing();
    await testManualProcessing();
    await testJobCompletion();
    await testJobFailure();
    await testRetryMechanism();
    await testExponentialBackoff();
    await testFixedBackoff();
    await testCompletedEvent();
    await testFailedEvent();
    await testActiveEvent();
    await testPriorityProcessing();
    await testConcurrency();
    await testDelayedJobs();
    await testPausePreventsProcessing();
    await testRemoveOnComplete();
    await testMultipleProcessors();

    console.log(`\n✓ Passed: ${passedTests}/${testCount}`);
    console.log('All Phase 2 tests passed! 🎉');
  } catch (error) {
    console.error(`\n✗ Failed: Test threw error`);
    console.error(error);
    process.exit(1);
  }
}

runTests();
