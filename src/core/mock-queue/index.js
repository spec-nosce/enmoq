/**
 * Bull Mock
 *
 * A file-based Bull (job queue) implementation for testing without Redis dependency.
 * Provides automatic JSON persistence with atomic writes.
 */

const { EventEmitter } = require('events');
const Storage = require('./storage');
const PersistenceManager = require('./persistence');
const { generateJobId, serializeJob, deserializeJob } = require('./utils');

class BullMock extends EventEmitter {
  constructor(queueName, options = {}) {
    super();

    this.queueName = queueName || 'default';
    this.dataDir = options.dataDir || null;
    this.storage = new Storage(this.dataDir);
    this.persistence = new PersistenceManager(this.dataDir);

    // Job storage
    this.jobs = new Map(); // jobId -> job
    this.processors = new Map(); // processorName -> { processor, concurrency }

    // Configuration
    this.processMode = options.processMode || 'sync'; // 'sync', 'async', 'manual'
    this.autoPersist = options.autoPersist !== false;
    this.persistDebounce = options.persistDebounce || 100;
    this.sessionId = options.sessionId || null;

    // State
    this.isPaused = false;
    this.isClosed = false;
    this.processingInterval = null;
    this._persistTimer = null;

    // Initialize async processing if needed
    if (this.processMode === 'async') {
      this._startAsyncProcessing();
    }
  }

  /**
   * Add a job to the queue
   */
  async add(name, data, opts = {}) {
    if (this.isClosed) {
      throw new Error('Queue is closed');
    }

    const job = {
      id: generateJobId(),
      name,
      data: data || {},
      opts: {
        attempts: opts.attempts || 1,
        delay: opts.delay || 0,
        priority: opts.priority || 0,
        backoff: opts.backoff || { type: 'exponential', delay: 1000 },
        removeOnComplete: opts.removeOnComplete || false,
        ...opts,
      },
      status: 'waiting',
      progress: 0,
      attemptsMade: 0,
      timestamp: Date.now(),
      processedOn: null,
      finishedOn: null,
      failedReason: null,
      returnvalue: null,
      logs: [],
    };

    this.jobs.set(job.id, job);

    // Auto-persist
    if (this.autoPersist) {
      this._debouncedPersist();
    }

    // Process immediately in sync mode
    if (this.processMode === 'sync' && !this.isPaused) {
      await this._processSingleJob(job);
    }

    return job;
  }

  /**
   * Register a processor for jobs
   */
  process(name, concurrency, processor) {
    // Handle overloads: process(name, processor) or process(name, concurrency, processor)
    if (typeof concurrency === 'function') {
      processor = concurrency;
      concurrency = 1;
    }

    if (typeof processor !== 'function') {
      throw new Error('Processor must be a function');
    }

    this.processors.set(name, { processor, concurrency: concurrency || 1 });
  }

  /**
   * Process a single job
   */
  async _processSingleJob(job) {
    // Check if job is ready
    if (job.status !== 'waiting') {
      return;
    }

    // Check delay
    const now = Date.now();
    const effectiveDelay = job.delay !== undefined ? job.delay : job.opts.delay;
    if (job.timestamp + effectiveDelay > now) {
      return; // Job not ready yet
    }

    // Get processor
    const processorConfig = this.processors.get(job.name);
    if (!processorConfig) {
      return; // No processor registered
    }

    const { processor } = processorConfig;

    // Update job status
    job.status = 'active';
    job.processedOn = Date.now();
    job.attemptsMade += 1;
    this.emit('active', job);

    try {
      // Execute processor
      const result = await processor(job);

      // Job completed successfully
      job.status = 'completed';
      job.finishedOn = Date.now();
      job.returnvalue = result;

      this.emit('completed', job, result);

      // Auto-remove if configured
      if (job.opts.removeOnComplete) {
        this.jobs.delete(job.id);
      }

      // Persist changes
      if (this.autoPersist) {
        this._debouncedPersist();
      }
    } catch (error) {
      // Job failed
      job.failedReason = error.message;

      // Check if we should retry
      if (job.attemptsMade < job.opts.attempts) {
        // Calculate backoff delay
        const backoffDelay = this._calculateBackoff(job);
        job.status = 'waiting';
        job.timestamp = Date.now();
        job.delay = backoffDelay;
      } else {
        // No more retries
        job.status = 'failed';
        job.finishedOn = Date.now();
      }

      this.emit('failed', job, error);

      // Persist changes
      if (this.autoPersist) {
        this._debouncedPersist();
      }

      // Re-throw in sync mode for test assertions
      if (this.processMode === 'sync') {
        throw error;
      }
    }
  }

  /**
   * Calculate backoff delay
   */
  _calculateBackoff(job) {
    const { backoff } = job.opts;

    if (!backoff || backoff.type === 'fixed') {
      return backoff?.delay !== undefined ? backoff.delay : 1000;
    }

    if (backoff.type === 'exponential') {
      const baseDelay = backoff.delay !== undefined ? backoff.delay : 1000;
      return baseDelay * 2 ** (job.attemptsMade - 1);
    }

    return 1000;
  }

  /**
   * Process jobs manually (for manual mode)
   */
  async processJobs(limit = 10) {
    if (this.isPaused || this.isClosed) {
      return;
    }

    const waitingJobs = Array.from(this.jobs.values())
      .filter((job) => job.status === 'waiting')
      .sort((a, b) => {
        // Sort by priority (desc) then timestamp (asc)
        if (b.opts.priority !== a.opts.priority) {
          return b.opts.priority - a.opts.priority;
        }
        return a.timestamp - b.timestamp;
      })
      .slice(0, limit);

    for (const job of waitingJobs) {
      try {
        await this._processSingleJob(job);
      } catch (error) {
        // Continue processing other jobs
      }
    }
  }

  /**
   * Start async processing
   */
  _startAsyncProcessing() {
    if (this.processingInterval) {
      return;
    }

    this.processingInterval = setInterval(async () => {
      if (!this.isPaused && !this.isClosed) {
        await this.processJobs(10);
      }
    }, 100);
  }

  /**
   * Stop async processing
   */
  _stopAsyncProcessing() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  /**
   * Debounced persist
   *
   * Snapshots jobs at call time so that a subsequent empty() clearing the
   * in-memory Map does not affect what gets written to disk. This ensures
   * that fire-and-forget add() calls leave an observable artifact on disk
   * without requiring an explicit persist() call from the consumer.
   */
  _debouncedPersist() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
    }

    // Capture now — not inside the callback — so empty() cannot clobber this.
    const snapshot = Array.from(this.jobs.values());

    this._persistTimer = setTimeout(async () => {
      await this.storage.saveJobs(this.queueName, snapshot);
      this._persistTimer = null;
    }, this.persistDebounce);
  }

  /**
   * Get job by ID
   */
  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get jobs by status
   */
  getJobs(types = ['waiting', 'active', 'completed', 'failed']) {
    return Array.from(this.jobs.values()).filter((job) => types.includes(job.status));
  }

  /**
   * Get job counts
   */
  async getJobCounts() {
    const jobs = Array.from(this.jobs.values());
    return {
      waiting: jobs.filter((j) => j.status === 'waiting').length,
      active: jobs.filter((j) => j.status === 'active').length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      delayed: jobs.filter((j) => j.status === 'waiting' && j.opts.delay > 0).length,
    };
  }

  /**
   * Pause queue
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume queue
   */
  resume() {
    this.isPaused = false;
  }

  /**
   * Empty queue (remove all jobs)
   *
   * Clears the in-memory job Map only. Does NOT write to disk — that would
   * overwrite the snapshot written by the most recent _debouncedPersist(),
   * erasing the observable artifact before engineers can inspect it.
   */
  async empty() {
    this.jobs.clear();
  }

  /**
   * Close queue
   */
  async close() {
    this.isClosed = true;
    this._stopAsyncProcessing();
    this.removeAllListeners();

    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
  }

  /**
   * Persist - Save current session
   */
  async persist(sessionId) {
    const sid = sessionId || this.sessionId;
    if (!sid) {
      throw new Error('Session ID required. Provide sessionId parameter or set in constructor.');
    }

    const queueData = {
      queueName: this.queueName,
      jobs: Array.from(this.jobs.values()),
      processors: Array.from(this.processors.keys()), // Save processor names only
    };

    await this.persistence.saveSession(sid, { [this.queueName]: queueData });
  }

  /**
   * Restore - Load session
   */
  async restore(sessionId) {
    const sid = sessionId || this.sessionId;
    if (!sid) {
      throw new Error('Session ID required. Provide sessionId parameter or set in constructor.');
    }

    const queuesData = await this.persistence.loadSession(sid);
    if (!queuesData) {
      return false;
    }

    const queueData = queuesData[this.queueName];
    if (!queueData) {
      return false;
    }

    // Restore jobs
    this.jobs.clear();
    for (const job of queueData.jobs || []) {
      this.jobs.set(job.id, job);
    }

    return true;
  }

  /**
   * Clear session
   */
  async clearSession(sessionId) {
    const sid = sessionId || this.sessionId;
    if (!sid) {
      throw new Error('Session ID required.');
    }

    await this.persistence.deleteSession(sid);
    await this.empty();
  }

  /**
   * Save fixture
   */
  async saveFixture(fixtureName) {
    const queueData = {
      queueName: this.queueName,
      jobs: Array.from(this.jobs.values()),
      processors: Array.from(this.processors.keys()),
    };

    return await this.persistence.saveFixture(fixtureName, { [this.queueName]: queueData });
  }

  /**
   * Load fixture
   */
  async loadFixture(fixturePathOrName) {
    // Handle object input
    if (typeof fixturePathOrName === 'object') {
      const queueData = fixturePathOrName[this.queueName];
      if (queueData) {
        this.jobs.clear();
        for (const job of queueData.jobs || []) {
          this.jobs.set(job.id, job);
        }
      }
      return true;
    }

    // Load from file
    const queuesData = await this.persistence.loadFixture(fixturePathOrName);
    if (!queuesData) {
      return false;
    }

    const queueData = queuesData[this.queueName];
    if (!queueData) {
      return false;
    }

    this.jobs.clear();
    for (const job of queueData.jobs || []) {
      this.jobs.set(job.id, job);
    }

    return true;
  }

  /**
   * List sessions
   */
  async listSessions() {
    return await this.persistence.listSessions();
  }

  /**
   * List fixtures
   */
  async listFixtures() {
    return await this.persistence.listFixtures();
  }

  /**
   * Get snapshot (for debugging)
   */
  getSnapshot() {
    return {
      queueName: this.queueName,
      jobCount: this.jobs.size,
      processorCount: this.processors.size,
      processors: Array.from(this.processors.keys()),
      jobs: {
        waiting: this.getJobs(['waiting']).length,
        active: this.getJobs(['active']).length,
        completed: this.getJobs(['completed']).length,
        failed: this.getJobs(['failed']).length,
      },
      sampleJobs: Array.from(this.jobs.values()).slice(0, 5),
    };
  }
}

// Singleton queue instances for createQueue pattern
const queueInstances = new Map();

/**
 * createQueue function - mimics @app-core/queue createQueue API
 * Returns singleton instance per queue name
 */
function createQueue(config = {}) {
  const path = require('path');
  const { getMockDataDir } = require('../mock-mode');

  const queueName = config.queueName || 'default';

  // Return existing instance if already created
  if (queueInstances.has(queueName)) {
    return queueInstances.get(queueName);
  }

  // Get session name from environment (set by setup.js)
  const sessionId = process.env.TEST_SESSION_DIR || 'default';

  // Create new instance with session-based directory
  const queue = new BullMock(queueName, {
    ...config,
    sessionId,
    dataDir: path.join(getMockDataDir(), 'queue', queueName),
    autoPersist: config.autoPersist !== undefined ? config.autoPersist : true,
    persistDebounce: config.persistDebounce !== undefined ? config.persistDebounce : 0,
    processMode: config.processMode || 'manual',
  });
  queueInstances.set(queueName, queue);

  return queue;
}

/**
 * clearAllQueues - empty and remove all singleton queue instances
 * Called by jest/setup.js beforeEach when autoReset.queue is true
 */
function clearAllQueues() {
  // Only empty job lists — do NOT clear the map. Workers capture queue references
  // at module load time via createWorker(); clearing the map would break those
  // references so that queue('name') returns a different object than the worker holds.
  const promises = Array.from(queueInstances.values()).map((q) => q.empty());
  return Promise.all(promises);
}

/**
 * createWorker - mirrors the @app-core/queue createWorker API
 *
 * Wraps createQueue + queue.process() and returns { scheduleJob(data, opts) },
 * matching the contract used by every worker in the codebase:
 *
 *   const worker = createWorker({ processor, processor_name, queue_options, scheduler_options });
 *   worker.scheduleJob(data, opts);   // called from services
 *
 * In tests, processMode defaults to 'manual' so jobs are queued but not
 * executed automatically — use processQueueJobs() / queue.processJobs() to
 * drain the queue when needed.
 */
function createWorker(workerConfig) {
  const {
    processor,
    processor_name: processorName = 'default',
    queue_options: queueOptions = {},
    scheduler_options: schedulerOpts = {},
  } = workerConfig;

  const queue = createQueue(queueOptions);

  // Guard: if createQueue returned nothing (no queueName configured), return a
  // no-op worker so services don't crash when the queue isn't configured.
  if (!queue) {
    return { scheduleJob: () => Promise.resolve(null) };
  }

  if (typeof processor !== 'function') {
    throw new Error('createWorker: processor must be a function');
  }

  // Register the processor so queue.processJobs() can execute it.
  queue.process(processorName, async (job) => {
    return processor(job);
  });

  /**
   * Schedule a job — equivalent to queue.add(processorName, data, opts).
   * @param {object} jobData
   * @param {object} [opts] - Bull JobOptions (attempts, delay, priority, …)
   * @returns {Promise<Job>}
   */
  function scheduleJob(jobData, opts = {}) {
    return queue.add(processorName, jobData, {
      ...(schedulerOpts || {}),
      ...opts,
    });
  }

  return { scheduleJob, queue };
}

module.exports = BullMock;
module.exports.BullMock = BullMock;
module.exports.createQueue = createQueue;
module.exports.createWorker = createWorker;
module.exports.clearAllQueues = clearAllQueues;
