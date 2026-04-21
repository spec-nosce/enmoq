/**
 * Utils
 *
 * Helper functions for Bull mock.
 */

const { ulid } = require('../../utils/randomness');

/**
 * Generate unique job ID
 */
function generateJobId() {
  return ulid();
}

/**
 * Serialize job for storage
 */
function serializeJob(job) {
  return {
    ...job,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
  };
}

/**
 * Deserialize job from storage
 */
function deserializeJob(jobData) {
  return {
    ...jobData,
    timestamp: jobData.timestamp,
    processedOn: jobData.processedOn,
    finishedOn: jobData.finishedOn,
  };
}

/**
 * Format job for display
 */
function formatJob(job) {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    progress: job.progress,
    attempts: `${job.attemptsMade}/${job.opts.attempts}`,
    created: new Date(job.timestamp).toISOString(),
  };
}

module.exports = {
  generateJobId,
  serializeJob,
  deserializeJob,
  formatJob,
};
