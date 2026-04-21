/**
 * Storage
 *
 * Handles JSON file operations for Bull mock with atomic writes and caching.
 */

const fs = require('fs').promises;
const path = require('path');
const { isInMockMode, getMockDataDir } = require('../mock-mode');

class Storage {
  constructor(dataDir) {
    if (dataDir) {
      this.dataDir = dataDir;
    } else if (isInMockMode()) {
      this.dataDir = path.join(getMockDataDir(), 'queue');
    } else {
      this.dataDir = path.join(process.cwd(), 'playground', 'bull-data');
    }
    this.runtimeDir = path.join(this.dataDir, 'runtime');
    this.cache = new Map();
  }

  /**
   * Get queue directory
   */
  _getQueueDir(queueName) {
    return path.join(this.runtimeDir, queueName);
  }

  /**
   * Get jobs file path
   */
  _getJobsPath(queueName) {
    return path.join(this._getQueueDir(queueName), 'jobs.json');
  }

  /**
   * Save jobs to file
   */
  async saveJobs(queueName, jobs) {
    const queueDir = this._getQueueDir(queueName);
    const jobsPath = this._getJobsPath(queueName);

    // Ensure directory exists
    await fs.mkdir(queueDir, { recursive: true });

    const data = {
      jobs,
      metadata: {
        queueName,
        jobCount: jobs.length,
        lastModified: new Date().toISOString(),
        version: '1.0.0',
      },
    };

    // Atomic write: write to temp file, then rename.
    // Silently swallow ENOENT — the session directory was removed by teardownMocks
    // before this debounce-delayed callback had a chance to run.  All tests have
    // already passed at that point so losing the write is harmless.
    const tempPath = `${jobsPath}.tmp`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tempPath, jobsPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
      return; // session cleaned up — skip cache update too
    }

    // Update cache
    this.cache.set(queueName, jobs);
  }

  /**
   * Load jobs from file
   */
  async loadJobs(queueName) {
    // Check cache first
    if (this.cache.has(queueName)) {
      return this.cache.get(queueName);
    }

    const jobsPath = this._getJobsPath(queueName);

    try {
      const content = await fs.readFile(jobsPath, 'utf8');
      const data = JSON.parse(content);

      // Restore Date objects
      const jobs = data.jobs.map((job) => ({
        ...job,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      }));

      // Update cache
      this.cache.set(queueName, jobs);

      return jobs;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return []; // No jobs file yet
      }
      throw error;
    }
  }

  /**
   * Delete queue
   */
  async deleteQueue(queueName) {
    const queueDir = this._getQueueDir(queueName);

    try {
      await fs.rm(queueDir, { recursive: true, force: true });
      this.cache.delete(queueName);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * List all queues
   */
  async listQueues() {
    try {
      const entries = await fs.readdir(this.runtimeDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = Storage;
