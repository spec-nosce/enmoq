/**
 * Mock Mongoose - Drop-in replacement for @app-core/mongoose
 *
 * Provides a createSession() function that returns a session object backed by
 * the same SessionManager used by MockRepository, enabling full transaction
 * isolation across multi-model operations in tests.
 *
 * Usage (identical to the real @app-core/mongoose):
 *
 *   const { createSession } = require('@app-core/mongoose');
 *   const session = await createSession();
 *   session.startTransaction();
 *   await repo.create(data, { session });
 *   await session.commitTransaction();
 *   await session.endSession();
 */

const { SessionManager } = require('../mock-repository/lib/session-manager');

// Share the global SessionManager singleton with mock-repository so that
// sessions created here are visible to every MockRepository instance.
function getSessionManager() {
  if (!global.__mockSessionManager) {
    global.__mockSessionManager = new SessionManager();
  }
  return global.__mockSessionManager;
}

/**
 * Create a new Mongoose-compatible session for use in transactions.
 *
 * The returned session object is intentionally async-compatible:
 * the real Mongoose createSession() returns a Promise<ClientSession>,
 * so callers use `await createSession()`.
 *
 * @returns {Promise<Session>}
 */
async function createSession() {
  return getSessionManager().createSession();
}

module.exports = {
  createSession,
};
