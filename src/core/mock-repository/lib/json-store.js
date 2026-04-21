/**
 * JSON Store - File-based data storage with atomic operations
 *
 * Features:
 * - Atomic writes (temp file + rename)
 * - In-memory cache for performance
 * - Model configuration registry
 * - Thread-safe operations
 */

const fs = require('fs').promises;
const path = require('path');

class JsonStore {
  constructor(basePath) {
    this.basePath = basePath;
    this.cache = new Map();
    this.modelConfigs = new Map();
    this.locks = new Map(); // Locks for concurrent write protection
  }

  /**
   * Register model configuration
   * @param {string} modelName - Collection name (e.g., 'identities')
   * @param {object} config - Model configuration
   * @param {boolean} config.paranoid - Enable soft delete
   * @param {boolean} config.supportULIDID - Auto-generate ULID
   * @param {string[]} config.uniqueFields - Fields in unique index
   * @param {object} config.timestamps - Timestamp plugin config
   */
  registerModel(modelName, config) {
    this.modelConfigs.set(modelName, {
      paranoid: config.paranoid || false,
      supportULIDID: config.supportULIDID || false,
      uniqueFields: config.uniqueFields || [],
      timestamps: config.timestamps || { createdIndexOrder: 'asc' },
    });
  }

  /**
   * Get model configuration
   */
  getConfig(modelName) {
    return this.modelConfigs.get(modelName);
  }

  /**
   * Load collection from file
   * @param {string} collection - Collection name
   * @returns {Promise<Array>} Documents array
   */
  async load(collection) {
    // Check cache first
    if (this.cache.has(collection)) {
      return this.cache.get(collection);
    }

    const filePath = path.join(this.basePath, `${collection}.json`);

    try {
      const data = await fs.readFile(filePath, 'utf8');
      const documents = JSON.parse(data);

      // Cache it
      this.cache.set(collection, documents);

      return documents;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, return empty array
        const empty = [];
        this.cache.set(collection, empty);
        return empty;
      }
      throw error;
    }
  }

  /**
   * Acquire lock for a collection
   */
  async _acquireLock(collection) {
    while (this.locks.get(collection)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    this.locks.set(collection, true);
  }

  /**
   * Release lock for a collection
   */
  _releaseLock(collection) {
    this.locks.delete(collection);
  }

  /**
   * Save collection to file atomically
   * @param {string} collection - Collection name
   * @param {Array} documents - Documents to save
   */
  async save(collection, documents) {
    // Acquire lock to prevent concurrent writes
    await this._acquireLock(collection);

    try {
      const filePath = path.join(this.basePath, `${collection}.json`);
      const tempPath = `${filePath}.tmp`;

      // Ensure directory exists first
      await fs.mkdir(this.basePath, { recursive: true });

      // Write to temp file
      await fs.writeFile(tempPath, JSON.stringify(documents, null, 2), 'utf8');

      // Atomic rename
      await fs.rename(tempPath, filePath);

      // Update cache
      this.cache.set(collection, documents);
    } catch (error) {
      // Clean up temp file on error
      const tempPath = path.join(this.basePath, `${collection}.json.tmp`);
      try {
        await fs.unlink(tempPath);
      } catch (unlinkError) {
        // Ignore if temp file doesn't exist
      }
      throw error;
    } finally {
      // Always release lock
      this._releaseLock(collection);
    }
  }

  /**
   * Clear cache for a collection
   */
  invalidate(collection) {
    this.cache.delete(collection);
  }

  /**
   * Clear all caches
   */
  invalidateAll() {
    this.cache.clear();
  }

  /**
   * Validate unique constraints
   * @param {string} modelName - Model name
   * @param {Array} existingDocs - Existing documents
   * @param {object} newDoc - New document to validate
   * @param {boolean} isUpdate - Whether this is an update operation
   * @throws {Error} E11000 duplicate key error
   */
  validateUniqueConstraints(modelName, existingDocs, newDoc, isUpdate = false) {
    const config = this.modelConfigs.get(modelName);

    if (!config?.uniqueFields?.length) {
      return true; // No unique constraints
    }

    for (const doc of existingDocs) {
      // Skip self in updates
      if (isUpdate && doc._id === newDoc._id) {
        continue;
      }

      // Skip soft-deleted records
      if (config.paranoid && doc.deleted !== 0) {
        continue;
      }

      // Check if all unique fields match
      const isDuplicate = config.uniqueFields.every((field) => doc[field] === newDoc[field]);

      if (isDuplicate) {
        const fields = config.uniqueFields.join(',');
        const error = new Error(
          `E11000 duplicate key error collection: ${modelName} index: ${fields}`
        );
        error.code = 11000;
        error.keyPattern = config.uniqueFields.reduce((acc, f) => {
          acc[f] = 1;
          return acc;
        }, {});
        throw error;
      }
    }

    return true;
  }
}

module.exports = JsonStore;
