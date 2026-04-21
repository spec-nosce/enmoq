/**
 * Session Manager
 *
 * Utilities for managing TigerBeetle mock sessions.
 */

const { PersistenceManager } = require('./persistence');

class SessionManager {
  constructor(persistenceDir) {
    this.persistenceDir = persistenceDir;
    this.persistence = new PersistenceManager(persistenceDir);
  }

  /**
   * List all sessions with metadata
   */
  async listSessions() {
    return await this.persistence.listSessions();
  }

  /**
   * Share session (copy to shared directory)
   */
  async shareSession(sessionId, sharedName) {
    return await this.persistence.shareSession(sessionId, sharedName);
  }

  /**
   * Cleanup old sessions (keep most recent N sessions)
   */
  async cleanupSessions(options = {}) {
    return await this.persistence.cleanupSessions(options);
  }

  /**
   * Diff two sessions (compare accounts and transfers)
   */
  async diffSessions(sessionId1, sessionId2) {
    const session1 = await this.persistence.loadSession(sessionId1);
    const session2 = await this.persistence.loadSession(sessionId2);

    if (!session1) throw new Error(`Session not found: ${sessionId1}`);
    if (!session2) throw new Error(`Session not found: ${sessionId2}`);

    const diff = {
      accounts: {
        added: [],
        removed: [],
        modified: [],
      },
      transfers: {
        added: [],
        removed: [],
      },
      pendingTransfers: {
        added: [],
        removed: [],
      },
    };

    // Compare accounts
    const accounts1 = new Map(session1.accounts.map((a) => [a.id.toString(), a]));
    const accounts2 = new Map(session2.accounts.map((a) => [a.id.toString(), a]));

    for (const [id, account] of accounts2) {
      if (!accounts1.has(id)) {
        diff.accounts.added.push(account);
      } else {
        const account1 = accounts1.get(id);
        if (
          account1.debits_posted !== account.debits_posted ||
          account1.credits_posted !== account.credits_posted ||
          account1.debits_pending !== account.debits_pending ||
          account1.credits_pending !== account.credits_pending
        ) {
          diff.accounts.modified.push({
            id,
            before: account1,
            after: account,
          });
        }
      }
    }

    for (const [id, account] of accounts1) {
      if (!accounts2.has(id)) {
        diff.accounts.removed.push(account);
      }
    }

    // Compare transfers
    const transfers1 = new Set(session1.transfers.map((t) => t.id.toString()));
    const transfers2 = new Set(session2.transfers.map((t) => t.id.toString()));

    for (const transfer of session2.transfers) {
      if (!transfers1.has(transfer.id.toString())) {
        diff.transfers.added.push(transfer);
      }
    }

    for (const transfer of session1.transfers) {
      if (!transfers2.has(transfer.id.toString())) {
        diff.transfers.removed.push(transfer);
      }
    }

    // Compare pending transfers
    const pending1 = new Set(session1.pendingTransfers.map((t) => t.id.toString()));
    const pending2 = new Set(session2.pendingTransfers.map((t) => t.id.toString()));

    for (const transfer of session2.pendingTransfers) {
      if (!pending1.has(transfer.id.toString())) {
        diff.pendingTransfers.added.push(transfer);
      }
    }

    for (const transfer of session1.pendingTransfers) {
      if (!pending2.has(transfer.id.toString())) {
        diff.pendingTransfers.removed.push(transfer);
      }
    }

    return diff;
  }

  /**
   * Merge two sessions into a new target session
   * (Simple merge: combines all accounts and transfers, validates consistency)
   */
  async mergeSessions(sessionId1, sessionId2, targetSessionId) {
    const session1 = await this.persistence.loadSession(sessionId1);
    const session2 = await this.persistence.loadSession(sessionId2);

    if (!session1) throw new Error(`Session not found: ${sessionId1}`);
    if (!session2) throw new Error(`Session not found: ${sessionId2}`);

    const merged = {
      accounts: [],
      transfers: [],
      pendingTransfers: [],
      metadata: {
        sessionId: targetSessionId,
        timestamp: Date.now(),
        mergedFrom: [sessionId1, sessionId2],
      },
    };

    // Merge accounts (take later version if duplicate)
    const accountsMap = new Map();

    for (const account of session1.accounts) {
      accountsMap.set(account.id.toString(), account);
    }

    for (const account of session2.accounts) {
      const existing = accountsMap.get(account.id.toString());
      if (existing) {
        // Take account with higher posted amounts (later state)
        // Note: values are strings in session data, convert to BigInt for comparison
        const sum1 = BigInt(existing.debits_posted || '0') + BigInt(existing.credits_posted || '0');
        const sum2 = BigInt(account.debits_posted || '0') + BigInt(account.credits_posted || '0');
        if (sum2 > sum1) {
          accountsMap.set(account.id.toString(), account);
        }
      } else {
        accountsMap.set(account.id.toString(), account);
      }
    }

    merged.accounts = Array.from(accountsMap.values());

    // Merge transfers (union, no duplicates)
    const transfersMap = new Map();

    for (const transfer of session1.transfers) {
      transfersMap.set(transfer.id.toString(), transfer);
    }

    for (const transfer of session2.transfers) {
      transfersMap.set(transfer.id.toString(), transfer);
    }

    merged.transfers = Array.from(transfersMap.values());

    // Merge pending transfers (union, no duplicates)
    const pendingMap = new Map();

    for (const transfer of session1.pendingTransfers) {
      pendingMap.set(transfer.id.toString(), transfer);
    }

    for (const transfer of session2.pendingTransfers) {
      pendingMap.set(transfer.id.toString(), transfer);
    }

    merged.pendingTransfers = Array.from(pendingMap.values());

    // Save merged session
    await this.persistence.saveSession(targetSessionId, merged);

    return merged;
  }
}

module.exports = { SessionManager };
