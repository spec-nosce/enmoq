/**
 * useMocks - ergonomic accessor for mock instances inside test files
 *
 * Call useMocks() once at the top of a test file to get typed references
 * to every mock.  Queue instances are singletons — calling
 * `useMocks().queue('notifications')` returns the same BullMock object
 * that the production service obtained via createQueue({ queueName }).
 *
 * @example
 * const { useMocks } = require('enmoq');
 * const { queue, http, repository } = useMocks();
 *
 * it('sends a notification', async () => {
 *   await createNotificationService({ ... });
 *   const jobs = queue('notifications').getJobs(['waiting']);
 *   expect(jobs).toHaveLength(1);
 * });
 */

const { getMockInstances } = require('./setup');
const { createQueue } = require('../core/mock-queue');
const MockHttpRequest = require('../core/mock-http');

/**
 * Returns an object of mock accessors.
 *
 * @returns {{
 *   queue: (name: string) => import('../core/mock-queue').BullMock,
 *   http: typeof MockHttpRequest,
 *   repository: () => import('../core/mock-repository'),
 *   clickhouse: () => object,
 *   tigerbeetle: () => object,
 * }}
 */
function useMocks() {
  return {
    /**
     * Get (or create) a queue singleton by name.
     * @param {string} name - Queue name passed to createQueue({ queueName })
     */
    queue: (name) => createQueue({ queueName: name }),

    /**
     * The MockHttpRequest module (static interface — no call needed).
     * Use mockHttp.clearHistory(), mockHttp.addMock(), etc.
     */
    http: MockHttpRequest,

    /**
     * The MockRepository instance created during setupMocks().
     */
    repository: () => getMockInstances().repository,

    /**
     * The MockClickHouse instance created during setupMocks().
     */
    clickhouse: () => getMockInstances().clickhouse,

    /**
     * The MockTigerBeetle instance created during setupMocks().
     */
    tigerbeetle: () => getMockInstances().tigerbeetle,
  };
}

module.exports = { useMocks };
