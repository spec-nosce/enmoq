/**
 * Persistence Manager
 *
 * Handles session and fixture management for ClickHouse mock state.
 */

const fs = require('fs').promises;
const path = require('path');
const { serializeValue } = require('./utils');

class PersistenceManager {
  constructor(dataDir) {
    this.dataDir = dataDir || path.join(__dirname, '..', 'clickhouse-data');
    this.sessionsDir = path.join(this.dataDir, 'sessions');
    this.fixturesDir = path.join(this.dataDir, 'fixtures');
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
   * Save session snapshot
   */
  async saveSession(sessionId, tables) {
    // Save directly to dataDir (not in sessions subdirectory)
    await this.ensureDir(this.dataDir);

    const tablesPath = path.join(this.dataDir, 'tables.json');
    const metadataPath = path.join(this.dataDir, 'metadata.json');

    // Serialize all tables
    const serializedTables = {};
    let totalRows = 0;

    for (const [tableName, tableData] of tables.entries()) {
      serializedTables[tableName] = {
        schema: tableData.schema,
        rows: tableData.rows.map(serializeValue),
      };
      totalRows += tableData.rows.length;
    }

    const metadata = {
      sessionId,
      timestamp: new Date().toISOString(),
      tableCount: tables.size,
      totalRows,
      version: '1.0.0',
    };

    // Atomic writes for each file
    await this._atomicWrite(tablesPath, serializedTables);
    await this._atomicWrite(metadataPath, metadata);
  }

  /**
   * Atomic write helper
   */
  async _atomicWrite(filePath, data) {
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tempPath, filePath);
  }

  /**
   * Load session snapshot
   */
  async loadSession(sessionId) {
    try {
      const tablesPath = path.join(this.dataDir, 'tables.json');
      const data = await fs.readFile(tablesPath, 'utf8');
      const serializedTables = JSON.parse(data);

      // Convert tables back to Map
      const tables = new Map();
      for (const [tableName, tableData] of Object.entries(serializedTables)) {
        tables.set(tableName, {
          schema: tableData.schema,
          rows: tableData.rows,
        });
      }

      return tables;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // Session not found
      }
      throw error;
    }
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId) {
    try {
      const tablesPath = path.join(this.dataDir, 'tables.json');
      const metadataPath = path.join(this.dataDir, 'metadata.json');

      await Promise.all([
        fs.unlink(tablesPath).catch(() => {}),
        fs.unlink(metadataPath).catch(() => {}),
      ]);
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * List all sessions
   */
  async listSessions() {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessions = [];

      for (const file of files) {
        if (file.endsWith('.meta.json')) {
          const metaPath = path.join(this.sessionsDir, file);
          const data = await fs.readFile(metaPath, 'utf8');
          sessions.push(JSON.parse(data));
        }
      }

      return sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Save fixture
   */
  async saveFixture(fixtureName, tables) {
    await this.ensureDir(this.fixturesDir);

    const fixturePath = path.join(this.fixturesDir, `${fixtureName}.json`);
    const tempPath = `${fixturePath}.tmp`;

    // Serialize all tables
    const serializedTables = {};
    let totalRows = 0;

    for (const [tableName, tableData] of tables.entries()) {
      serializedTables[tableName] = {
        schema: tableData.schema,
        rows: tableData.rows.map(serializeValue),
      };
      totalRows += tableData.rows.length;
    }

    const fixture = {
      tables: serializedTables,
      metadata: {
        name: fixtureName,
        created: new Date().toISOString(),
        tableCount: tables.size,
        totalRows,
        version: '1.0.0',
      },
    };

    // Atomic write
    await fs.writeFile(tempPath, JSON.stringify(fixture, null, 2), 'utf8');
    await fs.rename(tempPath, fixturePath);

    return fixturePath;
  }

  /**
   * Load fixture
   */
  async loadFixture(fixturePathOrName) {
    let fixturePath = fixturePathOrName;

    // If not absolute path, assume it's in fixtures directory
    if (!path.isAbsolute(fixturePathOrName)) {
      fixturePath = path.join(this.fixturesDir, fixturePathOrName);
      if (!fixturePathOrName.endsWith('.json')) {
        fixturePath += '.json';
      }
    }

    try {
      const data = await fs.readFile(fixturePath, 'utf8');
      const fixture = JSON.parse(data);

      // Convert tables back to Map
      const tables = new Map();
      for (const [tableName, tableData] of Object.entries(fixture.tables)) {
        tables.set(tableName, {
          schema: tableData.schema,
          rows: tableData.rows,
        });
      }

      return tables;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all fixtures
   */
  async listFixtures() {
    try {
      const files = await fs.readdir(this.fixturesDir);
      return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); // Remove .json extension
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}

module.exports = PersistenceManager;
