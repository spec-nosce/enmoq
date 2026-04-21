/**
 * ClickHouse Mock for Testing
 *
 * Provides a drop-in replacement for @app-core/clickhouse with file-based persistence.
 */

const Storage = require('./storage');
const PersistenceManager = require('./persistence');
const QueryParser = require('./query-parser');
const QueryEngine = require('./query-engine');
const { parseColumnType, validateValueType, convertToClickHouseType } = require('./utils');

class ClickHouseMock {
  constructor(options = {}) {
    this.dataDir = options.dataDir || null;
    this.storage = new Storage(this.dataDir);
    this.persistence = new PersistenceManager(this.dataDir);
    this.queryParser = new QueryParser();
    this.queryEngine = new QueryEngine();

    // In-memory table storage
    this.tables = new Map();

    // Configuration
    this.autoPersist = options.autoPersist !== false; // Default: true
    this.persistDebounce = options.persistDebounce || 100; // 100ms
    this.sessionId = options.sessionId || null;

    // Debounce timer
    this._persistTimer = null;
  }

  /**
   * Ping - Test connection
   */
  async ping() {
    return { success: true };
  }

  /**
   * Create table from SQL statement
   */
  async createTable(sql) {
    // Parse CREATE TABLE statement
    const tableMatch = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/i);
    if (!tableMatch) {
      throw new Error('Invalid CREATE TABLE statement');
    }

    const tableName = tableMatch[1];

    // Check if table already exists
    if (this.tables.has(tableName)) {
      return; // IF NOT EXISTS behavior
    }

    // Extract column definitions
    // Find content between ( after table name and ) before ENGINE
    const firstParen = sql.indexOf('(', tableMatch.index);
    let closingParen = firstParen;
    let depth = 0;

    // Find matching closing paren
    for (let i = firstParen; i < sql.length; i++) {
      if (sql[i] === '(') depth++;
      if (sql[i] === ')') {
        depth--;
        if (depth === 0) {
          closingParen = i;
          break;
        }
      }
    }

    if (closingParen === firstParen) {
      throw new Error('Could not parse column definitions');
    }

    const columnsStr = sql.substring(firstParen + 1, closingParen);
    const columnDefs = columnsStr
      .split(',')
      .map((col) => col.trim())
      .filter(
        (col) =>
          col && !col.toUpperCase().startsWith('PRIMARY') && !col.toUpperCase().startsWith('INDEX')
      );

    const schema = [];
    for (const colDef of columnDefs) {
      const parts = colDef.trim().split(/\s+/);
      if (parts.length >= 2) {
        schema.push({
          name: parts[0],
          type: parts.slice(1).join(' '),
        });
      }
    }

    // Create table
    this.tables.set(tableName, {
      schema,
      rows: [],
    });

    return { success: true };
  }

  /**
   * Insert data into table
   */
  async insert({ table, values, format = 'JSONEachRow' }) {
    if (format !== 'JSONEachRow') {
      throw new Error(`Format ${format} not supported. Use JSONEachRow.`);
    }

    // Load table from storage if not in memory
    let tableData = this.tables.get(table);
    if (!tableData) {
      tableData = await this.storage.loadTable(table);
      if (tableData) {
        this.tables.set(table, tableData);
      }
    }

    if (!tableData) {
      throw new Error(`Table ${table} not found. Create it first with createTable().`);
    }

    const { schema } = tableData;

    // Validate and convert each row
    const rows = Array.isArray(values) ? values : [values];
    for (const row of rows) {
      const validatedRow = {};

      // Validate each column
      for (const column of schema) {
        const value = row[column.name];

        // Validate type
        if (!validateValueType(value, column)) {
          throw new Error(
            `Invalid type for column ${column.name}. Expected ${column.type}, got ${typeof value}`
          );
        }

        // Convert to proper ClickHouse type
        validatedRow[column.name] = convertToClickHouseType(value, column);
      }

      // Add row
      tableData.rows.push(validatedRow);
    }

    // Auto-persist if enabled
    if (this.autoPersist) {
      this._debouncedPersist(table, tableData);
    }

    return { success: true };
  }

  /**
   * Debounced persist for batch operations
   */
  _debouncedPersist(table, tableData) {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
    }

    this._persistTimer = setTimeout(async () => {
      await this.storage.saveTable(table, tableData);
      this._persistTimer = null;
    }, this.persistDebounce);
  }

  /**
   * findMany - Execute SELECT query
   */
  async findMany({ query, queryParams = {} }) {
    // Substitute query parameters
    let processedQuery = query;
    if (Object.keys(queryParams).length > 0) {
      processedQuery = this.queryParser.substituteParameters(query, queryParams);
    }

    // Parse query
    const parsed = this.queryParser.parseSelect(processedQuery);

    // Execute query
    const results = this.queryEngine.execute(parsed, this.tables);

    return results;
  }

  /**
   * Execute query (alias for findMany)
   */
  async query({ query, query_params = {}, format = 'JSONEachRow' }) {
    if (format !== 'JSONEachRow') {
      throw new Error(`Format ${format} not supported. Use JSONEachRow.`);
    }

    return await this.findMany({ query, queryParams: query_params });
  }

  /**
   * Reset - Clear all tables
   */
  async reset() {
    // Clear in-memory tables
    this.tables.clear();

    // Clear storage cache
    this.storage.clearCache();

    // Delete all table files
    const tableNames = await this.storage.listTables();
    for (const tableName of tableNames) {
      await this.storage.deleteTable(tableName);
    }
  }

  /**
   * Get snapshot of current state (for debugging)
   */
  getSnapshot() {
    const snapshot = {};
    for (const [tableName, tableData] of this.tables.entries()) {
      snapshot[tableName] = {
        schema: tableData.schema,
        rowCount: tableData.rows.length,
        sampleRows: tableData.rows.slice(0, 5), // First 5 rows
      };
    }
    return snapshot;
  }

  /**
   * Persist - Save current session
   */
  async persist(sessionId) {
    const sid = sessionId || this.sessionId;
    if (!sid) {
      throw new Error('Session ID required. Provide sessionId parameter or set in constructor.');
    }

    await this.persistence.saveSession(sid, this.tables);
  }

  /**
   * Restore - Load session
   */
  async restore(sessionId) {
    const sid = sessionId || this.sessionId;
    if (!sid) {
      throw new Error('Session ID required. Provide sessionId parameter or set in constructor.');
    }

    const tables = await this.persistence.loadSession(sid);
    if (!tables) {
      return false; // Session not found
    }

    this.tables = tables;
    return true;
  }

  /**
   * Set session ID
   */
  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  /**
   * Clear session
   */
  async clearSession(sessionId) {
    const sid = sessionId || this.sessionId;
    if (!sid) {
      throw new Error('Session ID required. Provide sessionId parameter or set in constructor.');
    }

    await this.persistence.deleteSession(sid);
    await this.reset();
  }

  /**
   * Save fixture
   */
  async saveFixture(fixtureName) {
    return await this.persistence.saveFixture(fixtureName, this.tables);
  }

  /**
   * Load fixture
   */
  async loadFixture(fixturePathOrName) {
    // Handle object input
    if (typeof fixturePathOrName === 'object') {
      // Direct object load
      this.tables.clear();
      for (const [tableName, tableData] of Object.entries(
        fixturePathOrName.tables || fixturePathOrName
      )) {
        this.tables.set(tableName, {
          schema: tableData.schema,
          rows: tableData.rows,
        });
      }
      return true;
    }

    // Load from file
    const tables = await this.persistence.loadFixture(fixturePathOrName);
    if (!tables) {
      return false;
    }

    this.tables = tables;
    return true;
  }

  /**
   * Export to JSON
   */
  exportToJSON() {
    const exported = {
      tables: {},
      metadata: {
        exported: new Date().toISOString(),
        tableCount: this.tables.size,
      },
    };

    for (const [tableName, tableData] of this.tables.entries()) {
      exported.tables[tableName] = {
        schema: tableData.schema,
        rows: tableData.rows,
      };
    }

    return exported;
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
}

// Singleton instance for tests
let sharedInstance = null;

/**
 * Create ClickHouse client (mock version)
 * Mimics the real @app-core/clickhouse API
 */
function createClient(options = {}) {
  if (!sharedInstance) {
    const path = require('path');
    const { getMockDataDir } = require('../mock-mode');

    // Get session name from environment (set by setup.js)
    const sessionId = process.env.TEST_SESSION_DIR || 'default';

    sharedInstance = new ClickHouseMock({
      sessionId,
      dataDir: path.join(getMockDataDir(), 'clickhouse'),
      autoPersist: true,
      persistDebounce: 0, // Immediate persistence for tests
    });
  }
  return sharedInstance;
}

module.exports = ClickHouseMock;
module.exports.createClient = createClient;
module.exports.ClickHouseMock = ClickHouseMock;
