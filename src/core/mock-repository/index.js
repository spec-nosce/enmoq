/**
 * Mock Repository Factory - Drop-in replacement for @app-core/repository-factory
 *
 * Phase 1: Basic CRUD with equality queries
 * Phase 2: Query operators ($gt, $in, $or, etc.)
 * Phase 3: Update operators ($set, $inc, $push, etc.)
 * Phase 4: Aggregation pipeline ($match, $group, $project, $sort, $limit, $lookup)
 * Phase 5: Sessions and Transactions (isolation, rollback, commit)
 */

const path = require('path');
const JsonStore = require('./lib/json-store');
const QueryEngine = require('./lib/query-engine');
const UpdateEngine = require('./lib/update-engine');
const AggregationEngine = require('./lib/aggregation-engine');
const { SessionManager } = require('./lib/session-manager');
const SchemaValidator = require('./lib/schema-validator');
const { extractModelConfig, addAutoFields } = require('./lib/model-config');
const { getMockDataDir } = require('../mock-mode');

// Get runtime directory dynamically
function getRuntimeDir() {
  return path.join(getMockDataDir(), 'repository');
}

// Global instances (singleton pattern for shared state)
// These are lazily initialized to allow TEST_SESSION_DIR to be set first
function getSharedStore() {
  const runtimeDir = getRuntimeDir();

  // If store doesn't exist or directory changed, create new store
  if (!global.__mockJsonStore || global.__mockJsonStore.basePath !== runtimeDir) {
    global.__mockJsonStore = new JsonStore(runtimeDir);
  }
  return global.__mockJsonStore;
}

function getSessionManager() {
  if (!global.__mockSessionManager) {
    global.__mockSessionManager = new SessionManager();
  }
  return global.__mockSessionManager;
}

function getSchemaValidator() {
  if (!global.__mockSchemaValidator) {
    global.__mockSchemaValidator = new SchemaValidator();
  }
  return global.__mockSchemaValidator;
}

/**
 * Create a mock repository for a model
 * @param {string|object} model - Model name string (e.g., 'Identity') or Mongoose model object
 * @param {object} options - Repository options (unused in mock, for compatibility)
 * @returns {object} Repository interface
 */
function mockRepositoryFactory(model, options = {}) {
  // Extract model name if a Mongoose model object was passed
  let modelName;
  if (typeof model === 'string') {
    modelName = model;
  } else if (model && model.modelName) {
    // Mongoose model has modelName property
    modelName = model.modelName;
  } else if (model && model.name) {
    // Fallback to function name
    modelName = model.name;
  } else {
    throw new Error('Invalid model parameter: must be string or Mongoose model');
  }

  const store = getSharedStore(); // Use shared store instance (lazy initialization)
  const queryEngine = new QueryEngine();
  const updateEngine = new UpdateEngine();
  const aggregationEngine = new AggregationEngine(store);
  const sessionManager = getSessionManager(); // Use getter for lazy init
  const schemaValidator = getSchemaValidator(); // Use getter for lazy init
  const modelConfig = extractModelConfig(modelName);

  // Register model config with store for unique validation
  store.registerModel(modelName, modelConfig);

  /**
   * Resolve populate directives against the shared store.
   * Supports both `{ path: 'field' }` and `[{ path: 'field' }, ...]` forms.
   */
  async function applyPopulate(docs, populate) {
    const directives = Array.isArray(populate) ? populate : [populate];
    let result = docs.map((d) => ({ ...d }));

    for (const directive of directives) {
      const fieldName = directive.path;
      const collectionName = modelConfig.refs[fieldName];
      if (!collectionName) continue; // no ref registered — skip

      const refDocs = await store.load(collectionName);
      const refById = new Map(refDocs.map((d) => [String(d._id), d]));

      result = result.map((doc) => {
        const refId = doc[fieldName];
        if (refId == null) return doc;
        const resolved = refById.get(String(refId));
        return resolved ? { ...doc, [fieldName]: resolved } : doc;
      });
    }

    return result;
  }

  return {
    /**
     * Find one document
     * @param {object} params
     * @param {object} params.query - MongoDB query
     * @param {Array|object} [params.projections] - Field projections (top-level shorthand)
     * @param {object} [params.options] - Query options (projection, sort, populate, etc.)
     * @returns {Promise<object|null>}
     */
    async findOne({ query = {}, projections, options = {} }) {
      let documents = await store.load(modelName);

      // Apply paranoid filter (exclude soft-deleted), unless withDeleted is requested
      if (modelConfig.paranoid && !options.withDeleted) {
        documents = documents.filter((doc) => doc.deleted === 0);
      }

      // Match query
      let matched = queryEngine.match(documents, query);
      if (matched.length === 0) {
        return null;
      }

      // Apply sort before picking the first result
      if (options.sort) {
        matched = queryEngine.sort(matched, options.sort);
      }

      // Populate referenced documents
      if (options.populate) {
        matched = await applyPopulate(matched, options.populate);
      }

      let result = matched[0];

      // Apply projection — accept top-level `projections` or `options.projection`
      const projection = projections ?? options.projection;
      if (projection) {
        const projected = queryEngine.project([result], projection);
        result = projected[0];
      }

      return result;
    },

    /**
     * Find many documents
     * @param {object} params
     * @param {object} params.query - MongoDB query
     * @param {Array|object} [params.projections] - Field projections (top-level shorthand)
     * @param {object} [params.options] - Query options (projection, sort, limit, populate, etc.)
     * @returns {Promise<Array>}
     */
    async findMany({ query = {}, projections, options = {} }) {
      let documents = await store.load(modelName);

      // Apply paranoid filter, unless withDeleted is requested
      if (modelConfig.paranoid && !options.withDeleted) {
        documents = documents.filter((doc) => doc.deleted === 0);
      }

      // Match query
      let results = queryEngine.match(documents, query);

      // Apply sort
      if (options.sort) {
        results = queryEngine.sort(results, options.sort);
      }

      // Apply limit
      if (options.limit) {
        results = queryEngine.limit(results, options.limit);
      }

      // Populate referenced documents
      if (options.populate) {
        results = await applyPopulate(results, options.populate);
      }

      // Apply projection — accept top-level `projections` or `options.projection`
      const projection = projections ?? options.projection;
      if (projection) {
        results = queryEngine.project(results, projection);
      }

      return results;
    },

    /**
     * Create a new document
     * @param {object} data - Document data
     * @param {object} [options] - Create options (session, etc.)
     * @returns {Promise<object>}
     */
    async create(data, options = {}) {
      // Validate against schema
      const validation = schemaValidator.validate(modelName, data);
      if (!validation.valid) {
        const error = new Error('Schema validation failed');
        error.code = 'SCHEMA_VALIDATION_ERROR';
        error.errors = validation.errors;
        throw error;
      }

      // Associate session with store if provided
      if (options.session && !options.session._store) {
        options.session._store = store;
      }

      const documents = await store.load(modelName);

      // Add auto fields (ULID, timestamps)
      const newDoc = addAutoFields(data, modelConfig, 'create');

      // Validate unique constraints before saving
      store.validateUniqueConstraints(modelName, documents, newDoc, false);

      // Save
      const updated = [...documents, newDoc];
      await store.save(modelName, updated);

      // Track operation for rollback if in transaction
      if (options.session) {
        sessionManager.trackCreate(options.session.id, modelName, newDoc._id);
      }

      return newDoc;
    },

    /**
     * Create many documents
     * @param {object} params
     * @param {Array} params.entries - Array of documents to create
     * @param {object} [options] - Create options
     * @returns {Promise<Array>}
     */
    async createMany({ entries, options: inlineOpts = {} }, secondOpts = {}) {
      // Support options passed inside the first argument object (codebase pattern)
      const options = Object.keys(secondOpts).length ? secondOpts : inlineOpts;
      const documents = await store.load(modelName);

      // Add auto fields to all entries
      const newDocs = entries.map((entry) => addAutoFields(entry, modelConfig, 'create'));

      // Save with unique validation
      const updated = [...documents, ...newDocs];
      await store.save(modelName, updated);

      // Track operation for rollback if in transaction
      if (options.session) {
        const docIds = newDocs.map((d) => d._id);
        sessionManager.trackCreate(options.session.id, modelName, docIds);
      }

      return newDocs;
    },

    /**
     * Update one document
     * @param {object} params
     * @param {object} params.query - MongoDB query to find document
     * @param {object} params.updateValues - Fields to update (or update operators)
     * @param {object} [options] - Update options
     * @returns {Promise<object|null>}
     */
    async updateOne({ query = {}, updateValues = {}, options: inlineOpts = {} }, secondOpts = {}) {
      // Support options passed inside the first argument object (codebase pattern)
      const options = Object.keys(secondOpts).length ? secondOpts : inlineOpts;
      // Check if update uses operators
      const hasOperators = Object.keys(updateValues).some((key) => key.startsWith('$'));

      // Extract actual values for validation (only for operators that set direct values)
      let valuesToValidate = {};
      if (hasOperators) {
        // Only validate direct value-setting operators
        const directValueOperators = ['$set', '$setOnInsert', '$rename'];
        for (const [operator, fields] of Object.entries(updateValues)) {
          if (directValueOperators.includes(operator)) {
            if (typeof fields === 'object' && !Array.isArray(fields)) {
              Object.assign(valuesToValidate, fields);
            }
          }
        }
        // Skip validation for numeric/array operators ($inc, $mul, $push, etc.)
        // as they transform existing values and can't be validated pre-operation
      } else {
        valuesToValidate = updateValues;
      }

      // Validate against schema (partial update) only if we have values to validate
      if (Object.keys(valuesToValidate).length > 0) {
        const validation = schemaValidator.validate(modelName, valuesToValidate, true);
        if (!validation.valid) {
          const error = new Error('Schema validation failed');
          error.code = 'SCHEMA_VALIDATION_ERROR';
          error.errors = validation.errors;
          throw error;
        }
      }

      // Associate session with store if provided
      if (options.session && !options.session._store) {
        options.session._store = store;
      }

      let documents = await store.load(modelName);

      // Apply paranoid filter
      if (modelConfig.paranoid) {
        documents = documents.filter((doc) => doc.deleted === 0);
      }

      // Find document
      const matched = queryEngine.match(documents, query);
      if (matched.length === 0) {
        return null;
      }

      const docToUpdate = matched[0];
      const allDocuments = await store.load(modelName);
      const docIndex = allDocuments.findIndex((d) => d._id === docToUpdate._id);

      // Track original for rollback if in transaction
      if (options.session) {
        sessionManager.trackUpdate(options.session.id, modelName, allDocuments[docIndex]);
      }

      let updatedDoc;
      if (hasOperators) {
        // Use UpdateEngine for operator-based updates
        updatedDoc = { ...allDocuments[docIndex] };
        updateEngine.applyUpdate(updatedDoc, updateValues);
      } else {
        // Simple field replacement
        updatedDoc = {
          ...allDocuments[docIndex],
          ...updateValues,
        };
      }

      // Update auto-fields (timestamp)
      addAutoFields(updatedDoc, modelConfig, 'update');

      // Replace in array and save
      allDocuments[docIndex] = updatedDoc;
      await store.save(modelName, allDocuments);

      // Return MongoDB-style result
      return { modifiedCount: 1 };
    },

    /**
     * Update many documents
     * @param {object} params
     * @param {object} params.query - MongoDB query
     * @param {object} params.updateValues - Fields to update (or update operators)
     * @param {object} [options] - Update options
     * @returns {Promise<number>} Number of documents updated
     */
    async updateMany({ query = {}, updateValues = {}, options: inlineOpts = {} }, secondOpts = {}) {
      // Support options passed inside the first argument object (codebase pattern)
      const options = Object.keys(secondOpts).length ? secondOpts : inlineOpts;
      // Associate session with store if provided
      if (options.session && !options.session._store) {
        options.session._store = store;
      }

      const documents = await store.load(modelName);

      // Apply paranoid filter for matching
      let visibleDocs = documents;
      if (modelConfig.paranoid) {
        visibleDocs = documents.filter((doc) => doc.deleted === 0);
      }

      // Find matching documents
      const matched = queryEngine.match(visibleDocs, query);
      if (matched.length === 0) {
        return 0;
      }

      // Track originals for rollback if in transaction
      if (options.session) {
        const matchedIds = new Set(matched.map((d) => d._id));
        const originals = documents.filter((d) => matchedIds.has(d._id));
        sessionManager.trackUpdate(options.session.id, modelName, originals);
      }

      // Check if update uses operators
      const hasOperators = Object.keys(updateValues).some((key) => key.startsWith('$'));

      // Update each matched document
      const matchedIds = new Set(matched.map((d) => d._id));
      const updated = documents.map((doc) => {
        if (matchedIds.has(doc._id)) {
          let updatedDoc;
          if (hasOperators) {
            // Use UpdateEngine for operator-based updates
            updatedDoc = { ...doc };
            updateEngine.applyUpdate(updatedDoc, updateValues);
          } else {
            // Simple field replacement
            updatedDoc = { ...doc, ...updateValues };
          }
          addAutoFields(updatedDoc, modelConfig, 'update');
          return updatedDoc;
        }
        return doc;
      });

      await store.save(modelName, updated);
      return matched.length;
    },

    /**
     * Delete one document (soft delete if paranoid)
     * @param {object} params
     * @param {object} params.query - MongoDB query
     * @param {object} [options] - Delete options
     * @returns {Promise<object|null>}
     */
    async deleteOne({ query = {} }, options = {}) {
      // Associate session with store if provided
      if (options.session && !options.session._store) {
        options.session._store = store;
      }

      const documents = await store.load(modelName);

      // Apply paranoid filter for finding
      let visibleDocs = documents;
      if (modelConfig.paranoid) {
        visibleDocs = documents.filter((doc) => doc.deleted === 0);
      }

      // Find document
      const matched = queryEngine.match(visibleDocs, query);
      if (matched.length === 0) {
        return null;
      }

      const docToDelete = matched[0];
      const docIndex = documents.findIndex((d) => d._id === docToDelete._id);

      // Track original for rollback if in transaction
      if (options.session) {
        sessionManager.trackDelete(options.session.id, modelName, documents[docIndex]);
      }

      if (modelConfig.paranoid) {
        // Soft delete - use the returned object
        documents[docIndex] = addAutoFields({ ...documents[docIndex] }, modelConfig, 'delete');
      } else {
        // Hard delete
        documents.splice(docIndex, 1);
      }

      await store.save(modelName, documents);

      // Return MongoDB-style result
      return { deletedCount: 1 };
    },

    /**
     * Delete many documents (soft delete if paranoid)
     * @param {object} params
     * @param {object} params.query - MongoDB query
     * @param {object} [options] - Delete options
     * @returns {Promise<number>} Number of documents deleted
     */
    async deleteMany({ query = {} }, options = {}) {
      // Associate session with store if provided
      if (options.session && !options.session._store) {
        options.session._store = store;
      }

      let documents = await store.load(modelName);

      // Apply paranoid filter for matching
      let visibleDocs = documents;
      if (modelConfig.paranoid) {
        visibleDocs = documents.filter((doc) => doc.deleted === 0);
      }

      // Find matching documents
      const matched = queryEngine.match(visibleDocs, query);
      if (matched.length === 0) {
        return 0;
      }

      const matchedIds = new Set(matched.map((d) => d._id));

      // Track originals for rollback if in transaction
      if (options.session) {
        const originals = documents.filter((d) => matchedIds.has(d._id));
        sessionManager.trackDelete(options.session.id, modelName, originals);
      }

      if (modelConfig.paranoid) {
        // Soft delete all matched - use returned objects
        documents = documents.map((doc) => {
          if (matchedIds.has(doc._id)) {
            return addAutoFields({ ...doc }, modelConfig, 'delete');
          }
          return doc;
        });
      } else {
        // Hard delete all matched
        documents = documents.filter((doc) => !matchedIds.has(doc._id));
      }

      await store.save(modelName, documents);
      return matched.length;
    },

    /**
     * Run aggregation pipeline
     * @param {Array} pipeline - Array of aggregation stages
     * @returns {Promise<Array>} Aggregation results
     */
    async aggregate(pipeline) {
      return await aggregationEngine.aggregate(modelName, pipeline);
    },

    /**
     * Get raw model (for compatibility)
     * Returns the repository itself to support raw Mongoose operations
     */
    raw() {
      // Return a proxy that forwards calls back to the repository
      return {
        modelName,
        aggregate: async (pipeline) => await aggregationEngine.aggregate(modelName, pipeline),
        countDocuments: async (arg = {}) => {
          // Accept both { query: {...} } wrapper and a plain filter object directly
          const query = Object.prototype.hasOwnProperty.call(arg, 'query') ? arg.query : arg;
          let documents = await store.load(modelName);

          // Apply paranoid filter
          if (modelConfig.paranoid) {
            documents = documents.filter((doc) => doc.deleted === 0);
          }

          // Match query
          const matched = queryEngine.match(documents, query);
          return matched.length;
        },
      };
    },
  };
}

/**
 * Create a new session for transactions
 * @returns {Session}
 */
function createSession() {
  return getSessionManager().createSession();
}

/**
 * Session object with transaction methods
 * @typedef {Object} Session
 * @property {string} id - Session ID
 * @property {boolean} inTransaction - Whether transaction is active
 * @property {function} startTransaction - Start transaction
 * @property {function} commitTransaction - Commit transaction
 * @property {function} abortTransaction - Abort transaction
 * @property {function} endSession - End session
 */

/**
 * Clear all caches (for testing)
 */
function clearAllCaches() {
  const store = getSharedStore();
  if (store) {
    store.invalidateAll();
  }
}

/**
 * Register a schema for validation
 * @param {string} modelName - Name of the model
 * @param {object} schema - Schema definition
 */
function registerSchema(modelName, schema) {
  const validator = getSchemaValidator();
  validator.registerSchema(modelName, schema);
}

/**
 * ModelSchema - Simple schema definition class for compatibility
 */
/**
 * ModelSchema - Simple schema definition class for compatibility
 */
class ModelSchema {
  constructor(definition) {
    this.definition = definition;
  }
}

/**
 * createModel - Create a model instance
 * This returns a repository with CRUD methods
 */
function createModel(modelName, schema) {
  if (schema && schema.definition) {
    registerSchema(modelName, schema.definition);
  }
  return mockRepositoryFactory(modelName, {});
}

module.exports = mockRepositoryFactory;
module.exports.createSession = createSession;
module.exports.clearAllCaches = clearAllCaches;
module.exports.registerSchema = registerSchema;
module.exports.ModelSchema = ModelSchema;
module.exports.createModel = createModel;
