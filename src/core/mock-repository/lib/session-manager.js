/**
 * SessionManager - Transaction Support for Mock Repository
 *
 * Provides transaction isolation with:
 * - startTransaction(): Begin a transaction
 * - commitTransaction(): Persist all changes
 * - abortTransaction(): Rollback all changes
 * - endSession(): Clean up session resources
 *
 * Isolation Model:
 * - Reads within transaction see uncommitted writes from same transaction
 * - Reads outside transaction don't see uncommitted writes
 * - Writes are buffered until commit
 * - Abort restores original state
 */

const { ulid } = require('../../../utils/randomness');

class SessionManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> session state
  }

  /**
   * Create a new session
   * @returns {Session} Session object
   */
  createSession() {
    const sessionId = ulid();
    const session = {
      id: sessionId,
      inTransaction: false,
      operations: [], // Track all operations for rollback
      pendingWrites: new Map(), // collectionName -> modified documents
      deletedDocs: new Map(), // collectionName -> Set of deleted _ids
      manager: this,
      _store: null, // Will be set when used with repository

      // Convenience methods
      startTransaction: () => this.startTransaction(sessionId),
      commitTransaction: async () => await this.commitTransaction(sessionId),
      abortTransaction: async () => {
        if (!session._store) {
          // No writes were made in this transaction — clear state and return gracefully
          session.inTransaction = false;
          session.operations = [];
          return;
        }
        await this.abortTransaction(sessionId, session._store);
      },
      endSession: () => this.endSession(sessionId),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Start a transaction for a session
   * @param {string} sessionId
   */
  startTransaction(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (session.inTransaction) {
      throw new Error('Transaction already started');
    }

    session.inTransaction = true;
    session.operations = [];
    session.pendingWrites = new Map();
    session.deletedDocs = new Map();
  }

  /**
   * Commit a transaction (no-op in mock - writes already applied)
   * @param {string} sessionId
   */
  async commitTransaction(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (!session.inTransaction) {
      throw new Error('No transaction to commit');
    }

    // In real MongoDB, this would persist the changes
    // In our mock, changes are already in JsonStore, so just clear transaction state
    session.inTransaction = false;
    session.operations = [];
    session.pendingWrites.clear();
    session.deletedDocs.clear();
  }

  /**
   * Abort a transaction and restore original state
   * @param {string} sessionId
   * @param {JsonStore} store - JsonStore instance to restore state
   */
  async abortTransaction(sessionId, store) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (!session.inTransaction) {
      // No-op if transaction not active (matches Mongoose behavior)
      return;
    }

    // Restore original state by replaying operations in reverse
    const operations = [...session.operations].reverse();

    for (const op of operations) {
      switch (op.type) {
        case 'create': {
          // Remove created documents
          const docs = await store.load(op.collection);
          const filtered = docs.filter((d) => !op.documentIds.includes(d._id));
          await store.save(op.collection, filtered);
          break;
        }
        case 'update': {
          // Restore original documents
          const docs = await store.load(op.collection);
          const restored = docs.map((d) => {
            const original = op.originalDocs.find((orig) => orig._id === d._id);
            return original || d;
          });
          await store.save(op.collection, restored);
          break;
        }
        case 'delete': {
          // Restore deleted documents
          const docs = await store.load(op.collection);
          const existingIds = new Set(docs.map((d) => d._id));

          // Only restore documents that don't already exist
          const toRestore = op.originalDocs.filter((orig) => !existingIds.has(orig._id));
          const restored = [...docs, ...toRestore];
          await store.save(op.collection, restored);
          break;
        }
      }
    }

    session.inTransaction = false;
    session.operations = [];
    session.pendingWrites.clear();
    session.deletedDocs.clear();
  }

  /**
   * End a session and clean up
   * @param {string} sessionId
   */
  endSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return; // Already ended
    }
    if (session.inTransaction) {
      throw new Error('Cannot end session with active transaction. Commit or abort first.');
    }

    this.sessions.delete(sessionId);
  }

  /**
   * Track a create operation for rollback
   * @param {string} sessionId
   * @param {string} collection
   * @param {Array} documentIds
   */
  trackCreate(sessionId, collection, documentIds) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.inTransaction) {
      return; // No tracking needed
    }

    session.operations.push({
      type: 'create',
      collection,
      documentIds: Array.isArray(documentIds) ? documentIds : [documentIds],
    });
  }

  /**
   * Track an update operation for rollback
   * @param {string} sessionId
   * @param {string} collection
   * @param {Array} originalDocs - Original documents before update
   */
  trackUpdate(sessionId, collection, originalDocs) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.inTransaction) {
      return;
    }

    session.operations.push({
      type: 'update',
      collection,
      originalDocs: Array.isArray(originalDocs) ? originalDocs : [originalDocs],
    });
  }

  /**
   * Track a delete operation for rollback
   * @param {string} sessionId
   * @param {string} collection
   * @param {Array} originalDocs - Documents being deleted
   */
  trackDelete(sessionId, collection, originalDocs) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.inTransaction) {
      return;
    }

    session.operations.push({
      type: 'delete',
      collection,
      originalDocs: Array.isArray(originalDocs) ? originalDocs : [originalDocs],
    });
  }

  /**
   * Check if session is in transaction
   * @param {string} sessionId
   * @returns {boolean}
   */
  isInTransaction(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.inTransaction : false;
  }

  /**
   * Get session by ID
   * @param {string} sessionId
   * @returns {Session|undefined}
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
}

/**
 * Create a session (exported for compatibility with real repository)
 * @returns {Session}
 */
function createSession() {
  if (!global.__mockSessionManager) {
    global.__mockSessionManager = new SessionManager();
  }
  return global.__mockSessionManager.createSession();
}

module.exports = { SessionManager, createSession };
