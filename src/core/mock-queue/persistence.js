/**
 * Persistence Manager
 *
 * Handles session and fixture management for Bull mock.
 */

const fs = require('fs').promises;
const path = require('path');

class PersistenceManager {
  constructor(dataDir) {
    this.dataDir = dataDir || path.join(process.cwd(), 'playground', 'bull-data');
    this.sessionsDir = path.join(this.dataDir, 'sessions');
    this.fixturesDir = path.join(this.dataDir, 'fixtures');
  }

  /**
   * Save session
   */
  async saveSession(sessionId, queuesData) {
    // Save directly to dataDir (not in sessions subdirectory)
    await fs.mkdir(this.dataDir, { recursive: true });

    const queuesPath = path.join(this.dataDir, 'queues.json');
    const metadataPath = path.join(this.dataDir, 'metadata.json');

    const metadata = {
      sessionId,
      timestamp: new Date().toISOString(),
      queueCount: Object.keys(queuesData).length,
      totalJobs: Object.values(queuesData).reduce((sum, q) => sum + (q.jobs?.length || 0), 0),
      version: '1.0.0',
    };

    // Atomic writes for each file
    await this._atomicWrite(queuesPath, queuesData);
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
   * Load session
   */
  async loadSession(sessionId) {
    try {
      const queuesPath = path.join(this.dataDir, 'queues.json');
      const content = await fs.readFile(queuesPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId) {
    try {
      const queuesPath = path.join(this.dataDir, 'queues.json');
      const metadataPath = path.join(this.dataDir, 'metadata.json');

      await Promise.all([
        fs.unlink(queuesPath).catch(() => {}),
        fs.unlink(metadataPath).catch(() => {}),
      ]);
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * List sessions
   */
  async listSessions() {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessions = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const sessionPath = path.join(this.sessionsDir, file);
          try {
            const content = await fs.readFile(sessionPath, 'utf8');
            const data = JSON.parse(content);
            sessions.push(data.metadata);
          } catch (error) {
            // Skip invalid files
          }
        }
      }

      return sessions;
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
  async saveFixture(fixtureName, queuesData) {
    await fs.mkdir(this.fixturesDir, { recursive: true });

    const fixturePath = path.join(this.fixturesDir, `${fixtureName}.json`);
    const data = {
      queues: queuesData,
      metadata: {
        fixtureName,
        created: new Date().toISOString(),
        queueCount: Object.keys(queuesData).length,
        totalJobs: Object.values(queuesData).reduce((sum, q) => sum + (q.jobs?.length || 0), 0),
        version: '1.0.0',
      },
    };

    // Atomic write
    const tempPath = `${fixturePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tempPath, fixturePath);
  }

  /**
   * Load fixture
   */
  async loadFixture(fixturePathOrName) {
    let fixturePath;

    // Check if it's a full path
    if (path.isAbsolute(fixturePathOrName) || fixturePathOrName.includes('/')) {
      fixturePath = fixturePathOrName;
    } else {
      // Treat as fixture name
      fixturePath = path.join(this.fixturesDir, `${fixturePathOrName}.json`);
    }

    try {
      const content = await fs.readFile(fixturePath, 'utf8');
      const data = JSON.parse(content);
      return data.queues || null;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * List fixtures
   */
  async listFixtures() {
    try {
      const files = await fs.readdir(this.fixturesDir);
      return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}

module.exports = PersistenceManager;
