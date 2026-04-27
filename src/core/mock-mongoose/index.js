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

/**
 * SchemaTypes - Stub type constants so model files that destructure
 * SchemaTypes from @app-core/mongoose load cleanly in tests.
 * These values are only referenced during schema definition, never at
 * query time, so symbolic strings are sufficient.
 */
const SchemaTypes = {
  String: 'String',
  Number: 'Number',
  Boolean: 'Boolean',
  Date: 'Date',
  Buffer: 'Buffer',
  Mixed: 'Mixed',
  ObjectId: 'ObjectId',
  Decimal128: 'Decimal128',
  UUID: 'UUID',
  Map: 'Map',
  ULID: 'ULID',
  Array: 'Array',
};

/**
 * DatabaseModel - Stub for @app-core/mongoose DatabaseModel.
 * model() returns a plain object carrying modelName and __appConfig so
 * that repositoryFactory can extract the collection name and paranoid flag.
 */
const DatabaseModel = {
  model(modelName, schema, options = {}) {
    return {
      modelName,
      __appConfig: {
        paranoid: Boolean(options.paranoid),
        supportULIDID: true,
        uniqueFields: [],
      },
    };
  },
};

/**
 * ModelSchema - Stub so model files can call `new ModelSchema(config)` and
 * `.plugin(fn)` without error. Schema definition is irrelevant in the mock.
 */
class ModelSchema {
  constructor(definition) {
    this.definition = definition;
  }

  // No-op — Mongoose plugins (e.g. timestamps) have no effect in the mock.
  plugin() { }

  // No-op — index definitions have no effect in the mock.
  index() { }
}

module.exports = {
  createSession,
  SchemaTypes,
  DatabaseModel,
  ModelSchema,
};
