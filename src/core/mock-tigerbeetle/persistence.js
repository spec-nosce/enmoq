/**
 * Persistence Manager
 *
 * Handles saving and loading TigerBeetle mock state to/from disk.
 */

const fs = require('fs').promises;
const path = require('path');
const { serializeBigInt } = require('./utils');

class PersistenceManager {
  constructor(persistenceDir) {
    this.persistenceDir = persistenceDir;
    this.sessionsDir = path.join(persistenceDir, 'sessions');
    this.fixturesDir = path.join(persistenceDir, 'fixtures');
    this.sharedDir = path.join(persistenceDir, 'shared');
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
   * Save session state
   */
  async saveSession(sessionId, state) {
    // Save directly to persistenceDir (not in sessions subdirectory)
    await this.ensureDir(this.persistenceDir);

    const accountsPath = path.join(this.persistenceDir, 'accounts.json');
    const transfersPath = path.join(this.persistenceDir, 'transfers.json');
    const pendingPath = path.join(this.persistenceDir, 'pending-transfers.json');
    const metadataPath = path.join(this.persistenceDir, 'metadata.json');

    // Serialize and write each file separately
    const accountsData = state.accounts.map(serializeBigInt);
    const transfersData = state.transfers.map(serializeBigInt);
    const pendingData = state.pendingTransfers.map(serializeBigInt);

    // Atomic writes for each file
    await this._atomicWrite(accountsPath, accountsData);
    await this._atomicWrite(transfersPath, transfersData);
    await this._atomicWrite(pendingPath, pendingData);
    await this._atomicWrite(metadataPath, state.metadata);
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
   * Load session state
   */
  async loadSession(sessionId) {
    try {
      const accountsPath = path.join(this.persistenceDir, 'accounts.json');
      const transfersPath = path.join(this.persistenceDir, 'transfers.json');
      const pendingPath = path.join(this.persistenceDir, 'pending-transfers.json');
      const metadataPath = path.join(this.persistenceDir, 'metadata.json');

      const accounts = JSON.parse(await fs.readFile(accountsPath, 'utf8'));
      const transfers = JSON.parse(await fs.readFile(transfersPath, 'utf8'));
      const pendingTransfers = JSON.parse(await fs.readFile(pendingPath, 'utf8'));
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));

      return {
        accounts,
        transfers,
        pendingTransfers,
        metadata,
      };
    } catch (error) {
      return null; // Session doesn't exist
    }
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId) {
    try {
      const accountsPath = path.join(this.persistenceDir, 'accounts.json');
      const transfersPath = path.join(this.persistenceDir, 'transfers.json');
      const pendingPath = path.join(this.persistenceDir, 'pending-transfers.json');
      const metadataPath = path.join(this.persistenceDir, 'metadata.json');

      await Promise.all([
        fs.unlink(accountsPath).catch(() => {}),
        fs.unlink(transfersPath).catch(() => {}),
        fs.unlink(pendingPath).catch(() => {}),
        fs.unlink(metadataPath).catch(() => {}),
      ]);
    } catch (error) {
      // Ignore errors
    }
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
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Save fixture
   */
  async saveFixture(fixtureName, state) {
    await this.ensureDir(this.fixturesDir);

    const fixturePath = path.join(this.fixturesDir, `${fixtureName}.json`);
    const tempPath = `${fixturePath}.tmp`;

    // Serialize state
    const serializedState = {
      accounts: state.accounts.map(serializeBigInt),
      transfers: state.transfers.map(serializeBigInt),
      pendingTransfers: state.pendingTransfers.map(serializeBigInt),
      metadata: state.metadata,
    };

    // Atomic write
    await fs.writeFile(tempPath, JSON.stringify(serializedState, null, 2), 'utf8');
    await fs.rename(tempPath, fixturePath);

    return fixturePath;
  }

  /**
   * Get fixture path
   */
  getFixturePath(fixtureName) {
    return path.join(this.fixturesDir, `${fixtureName}.json`);
  }

  /**
   * List all sessions
   */
  async listSessions() {
    try {
      await this.ensureDir(this.sessionsDir);
      const files = await fs.readdir(this.sessionsDir);
      const metaFiles = files.filter((f) => f.endsWith('.meta.json'));

      const sessions = [];
      for (const metaFile of metaFiles) {
        try {
          const metaPath = path.join(this.sessionsDir, metaFile);
          const data = await fs.readFile(metaPath, 'utf8');
          const meta = JSON.parse(data);
          sessions.push(meta);
        } catch (error) {
          // Skip invalid meta files
        }
      }

      return sessions;
    } catch (error) {
      return [];
    }
  }

  /**
   * Share session (copy to shared directory)
   */
  async shareSession(sessionId, sharedName) {
    await this.ensureDir(this.sharedDir);

    const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
    const sharedPath = path.join(this.sharedDir, `${sharedName}.json`);

    try {
      const data = await fs.readFile(sessionPath, 'utf8');
      await fs.writeFile(sharedPath, data, 'utf8');

      // Add shared metadata
      const metaPath = path.join(this.sharedDir, `${sharedName}.meta.json`);
      const metadata = {
        sharedName,
        originalSessionId: sessionId,
        sharedAt: Date.now(),
      };
      await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf8');

      return sharedPath;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Session not found: ${sessionId}`);
      }
      throw error;
    }
  }

  /**
   * Cleanup old sessions
   */
  async cleanupSessions(options = {}) {
    const keepRecent = options.keepRecent || 10;
    const sessions = await this.listSessions();

    if (sessions.length <= keepRecent) {
      return 0; // Nothing to clean up
    }

    // Sort by timestamp (oldest first)
    sessions.sort((a, b) => a.timestamp - b.timestamp);

    // Delete oldest sessions
    const toDelete = sessions.slice(0, sessions.length - keepRecent);
    let deleted = 0;

    for (const session of toDelete) {
      try {
        await this.deleteSession(session.sessionId);
        deleted++;
      } catch (error) {
        // Ignore errors
      }
    }

    return deleted;
  }
}

module.exports = { PersistenceManager };
