/**
 * JSON File Storage
 *
 * Handles atomic writes and reads of table data to/from disk.
 */

const fs = require('fs').promises;
const path = require('path');
const { serializeValue } = require('./utils');
const { isInMockMode, getMockDataDir } = require('../mock-mode');

class Storage {
  constructor(dataDir) {
    if (dataDir) {
      this.dataDir = dataDir;
    } else if (isInMockMode()) {
      this.dataDir = path.join(getMockDataDir(), 'clickhouse');
    } else {
      this.dataDir = path.join(__dirname, '..', 'clickhouse-data');
    }
    this.runtimeDir = path.join(this.dataDir, 'runtime');
    this.cache = new Map(); // In-memory cache for performance
  }

  /**
   * Ensure directory exists
   */
  async ensureDir(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      // Directory already exists, ignore
    }
  }

  /**
   * Get file path for a table
   */
  getTablePath(tableName) {
    return path.join(this.runtimeDir, `${tableName}.json`);
  }

  /**
   * Save table to disk (atomic write)
   */
  async saveTable(tableName, tableData) {
    await this.ensureDir(this.runtimeDir);

    const filePath = this.getTablePath(tableName);
    const tempPath = `${filePath}.tmp`;

    // Serialize data
    const serialized = {
      schema: tableData.schema,
      rows: tableData.rows.map(serializeValue),
      metadata: {
        rowCount: tableData.rows.length,
        lastModified: new Date().toISOString(),
        version: '1.0.0',
      },
    };

    // Atomic write: temp file → rename
    await fs.writeFile(tempPath, JSON.stringify(serialized, null, 2), 'utf8');
    await fs.rename(tempPath, filePath);

    // Update cache
    this.cache.set(tableName, tableData);
  }

  /**
   * Load table from disk
   */
  async loadTable(tableName) {
    // Check cache first
    if (this.cache.has(tableName)) {
      return this.cache.get(tableName);
    }

    const filePath = this.getTablePath(tableName);

    try {
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);

      const tableData = {
        schema: parsed.schema,
        rows: parsed.rows,
      };

      // Update cache
      this.cache.set(tableName, tableData);

      return tableData;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // Table file not found
      }
      throw error;
    }
  }

  /**
   * Delete table file
   */
  async deleteTable(tableName) {
    const filePath = this.getTablePath(tableName);

    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // Remove from cache
    this.cache.delete(tableName);
  }

  /**
   * List all table files
   */
  async listTables() {
    try {
      const files = await fs.readdir(this.runtimeDir);
      return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); // Remove .json extension
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

  /**
   * Get table from cache (if exists)
   */
  getCached(tableName) {
    return this.cache.get(tableName);
  }
}

module.exports = Storage;
