/**
 * TigerBeetle Mock
 *
 * In-memory ledger implementation that mimics TigerBeetle's behavior
 * for testing purposes. Includes persistence layer for session management.
 */

const path = require('path');
const { ErrorCode } = require('./error-codes');
const { PersistenceManager } = require('./persistence');
const { isInMockMode, getMockDataDir } = require('../mock-mode');
const {
  ACCOUNT_BIGINT_FIELDS,
  TRANSFER_BIGINT_FIELDS,
  serializeBigInt,
  deserializeBigInt,
  getAvailableBalance,
  hasFlag,
} = require('./utils');

// Account flags
const AccountFlags = {
  linked: 1 << 0,
  debits_must_not_exceed_credits: 1 << 1,
  credits_must_not_exceed_debits: 1 << 2,
};

// Transfer flags
const TransferFlags = {
  pending: 1 << 0,
  post_pending_transfer: 1 << 1,
  void_pending_transfer: 1 << 2,
  linked: 1 << 3,
};

/**
 * Main TigerBeetleMock class
 */
class TigerBeetleMock {
  constructor(options = {}) {
    // In-memory storage
    this.accounts = new Map();
    this.transfers = new Map();
    this.pendingTransfers = new Map();

    // Persistence configuration
    this.sessionId = options.sessionId || null;
    this.autoPersist = options.autoPersist || false;
    this.persistOnOperation = options.persistOnOperation || [];
    this.persistDebounceMs =
      options.persistDebounceMs !== undefined ? options.persistDebounceMs : 100;

    // Determine persistence directory
    if (options.persistenceDir) {
      this.persistenceDir = options.persistenceDir;
    } else if (isInMockMode()) {
      this.persistenceDir = path.join(getMockDataDir(), 'tigerbeetle');
    } else {
      this.persistenceDir = 'playground/.tigerbeetle-mock';
    }

    // Persistence manager
    this.persistence = new PersistenceManager(this.persistenceDir);

    // Metadata
    this.metadata = {
      operationCount: 0,
      createdAt: Date.now(),
      lastOperation: null,
      transferCount: 0,
      pendingCreatedCount: 0,
      pendingPostedCount: 0,
      pendingVoidedCount: 0,
    };

    // ID generation
    this._idCounter = 0n;

    // Baseline snapshot taken after restore() — used by reset() for scoped undo.
    // null until restore() has been called at least once.
    this._restoreBaseline = null;
  }

  /**
   * Generate unique 128-bit ID
   */
  static getId() {
    // Generate random 128-bit BigInt
    const high = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    const low = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    return (high << 64n) | low;
  }

  /**
   * Create accounts
   */
  async createAccounts(accounts) {
    const errors = [];

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];

      // Validate ledger (allow reasonable range 1-999)
      if (account.ledger < 1 || account.ledger > 999) {
        errors.push({ index: i, code: ErrorCode.invalid_ledger });
        continue;
      }

      // Check for duplicate ID
      if (this.accounts.has(account.id)) {
        errors.push({ index: i, code: ErrorCode.exists });
        continue;
      }

      // Store account
      this.accounts.set(account.id, {
        ...account,
        // Initialize BigInt fields with defaults if not provided
        debits_posted: account.debits_posted !== undefined ? account.debits_posted : 0n,
        credits_posted: account.credits_posted !== undefined ? account.credits_posted : 0n,
        debits_pending: account.debits_pending !== undefined ? account.debits_pending : 0n,
        credits_pending: account.credits_pending !== undefined ? account.credits_pending : 0n,
        user_data_128: account.user_data_128 !== undefined ? account.user_data_128 : 0n,
        user_data_64: account.user_data_64 !== undefined ? account.user_data_64 : 0n,
        user_data_32: account.user_data_32 !== undefined ? account.user_data_32 : 0,
        flags: account.flags !== undefined ? account.flags : 0,
        timestamp: account.timestamp !== undefined ? account.timestamp : 0n,
      });
    }

    // Update metadata
    this.metadata.operationCount++;
    this.metadata.lastOperation = 'createAccounts';

    // Auto-persist if configured
    if (this.autoPersist && this.persistOnOperation.includes('createAccounts')) {
      await this._debouncedPersist();
    }

    return errors;
  }

  /**
   * Lookup accounts by IDs
   */
  async lookupAccounts(ids) {
    const accounts = [];

    for (const id of ids) {
      const account = this.accounts.get(id);
      if (account) {
        accounts.push({ ...account });
      }
    }

    return accounts;
  }

  /**
   * Create transfers
   */
  async createTransfers(transfers) {
    const errors = [];

    // Group linked transfers
    const transferGroups = this._groupLinkedTransfers(transfers);

    for (const group of transferGroups) {
      if (group.isLinked) {
        // Process linked transfers atomically
        const groupErrors = await this._processLinkedTransfers(group.transfers, group.startIndex);
        errors.push(...groupErrors);
      } else {
        // Process individual transfers
        for (let i = 0; i < group.transfers.length; i++) {
          const transfer = group.transfers[i];
          const index = group.startIndex + i;
          const error = await this._processSingleTransfer(transfer, index);
          if (error) {
            errors.push(error);
          }
        }
      }
    }

    // Update metadata
    this.metadata.operationCount++;
    this.metadata.lastOperation = 'createTransfers';
    this.metadata.transferCount += transfers.length - errors.length;

    // Auto-persist if configured
    if (this.autoPersist && this.persistOnOperation.includes('createTransfers')) {
      await this._debouncedPersist();
    }

    return errors;
  }

  /**
   * Group consecutive linked transfers
   */
  _groupLinkedTransfers(transfers) {
    const groups = [];
    let currentGroup = null;

    for (let i = 0; i < transfers.length; i++) {
      const transfer = transfers[i];
      const isLinked = hasFlag(transfer.flags || 0, TransferFlags.linked);

      if (isLinked) {
        if (!currentGroup) {
          // Start new linked group
          currentGroup = {
            isLinked: true,
            transfers: [transfer],
            startIndex: i,
          };
        } else {
          // Add to existing linked group
          currentGroup.transfers.push(transfer);
        }
      } else {
        // End current linked group if exists
        if (currentGroup) {
          currentGroup.transfers.push(transfer); // Include final non-linked transfer
          groups.push(currentGroup);
          currentGroup = null;
        } else {
          // Single non-linked transfer
          groups.push({
            isLinked: false,
            transfers: [transfer],
            startIndex: i,
          });
        }
      }
    }

    // Add final group if still open
    if (currentGroup) {
      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * Process linked transfers atomically
   */
  async _processLinkedTransfers(transfers, startIndex) {
    const errors = [];
    const accountSnapshots = new Map();

    // Basic validation first (accounts exist, same accounts, ledger match, duplicate IDs)
    for (let i = 0; i < transfers.length; i++) {
      const transfer = transfers[i];
      const index = startIndex + i;

      // Check for duplicate ID
      if (this.transfers.has(transfer.id) || this.pendingTransfers.has(transfer.id)) {
        errors.push({ index, code: ErrorCode.exists });
        continue;
      }

      // Check accounts must be different
      if (transfer.debit_account_id === transfer.credit_account_id) {
        errors.push({ index, code: ErrorCode.accounts_must_be_different });
        continue;
      }

      // Check accounts exist
      const debitAccount = this.accounts.get(transfer.debit_account_id);
      const creditAccount = this.accounts.get(transfer.credit_account_id);

      if (!debitAccount || !creditAccount) {
        errors.push({ index, code: ErrorCode.accounts_not_found });
        continue;
      }

      // Check ledgers match
      if (debitAccount.ledger !== creditAccount.ledger) {
        errors.push({ index, code: ErrorCode.ledger_must_match });
        continue;
      }
    }

    // If any validation failed, return all errors and don't execute
    if (errors.length > 0) {
      return errors;
    }

    // Save account snapshots for rollback
    for (const transfer of transfers) {
      const debitAccount = this.accounts.get(transfer.debit_account_id);
      const creditAccount = this.accounts.get(transfer.credit_account_id);

      if (debitAccount && !accountSnapshots.has(transfer.debit_account_id)) {
        accountSnapshots.set(transfer.debit_account_id, { ...debitAccount });
      }
      if (creditAccount && !accountSnapshots.has(transfer.credit_account_id)) {
        accountSnapshots.set(transfer.credit_account_id, { ...creditAccount });
      }
    }

    // Execute all transfers (balance check happens during execution)
    // Don't store transfers in Map yet - only update balances
    const executedTransfers = [];
    try {
      for (let i = 0; i < transfers.length; i++) {
        const transfer = transfers[i];
        const index = startIndex + i;

        // Check balance before execution
        const debitAccount = this.accounts.get(transfer.debit_account_id);
        const availableBalance = getAvailableBalance(debitAccount);
        if (availableBalance < transfer.amount) {
          // Rollback all changes
          this._rollbackAccounts(accountSnapshots);
          errors.push({ code: ErrorCode.exceeds_credits, index });
          return errors;
        }

        // Update balances
        const creditAccount = this.accounts.get(transfer.credit_account_id);
        debitAccount.debits_posted = (debitAccount.debits_posted || 0n) + transfer.amount;
        creditAccount.credits_posted = (creditAccount.credits_posted || 0n) + transfer.amount;

        // Track for storage after all succeed
        executedTransfers.push(transfer);
      }

      // All transfers succeeded - now store them
      for (const transfer of executedTransfers) {
        this.transfers.set(transfer.id, { ...transfer });
      }
    } catch (err) {
      // Rollback on any error
      this._rollbackAccounts(accountSnapshots);
      throw err;
    }

    return errors;
  }

  /**
   * Process single transfer
   */
  async _processSingleTransfer(transfer, index) {
    // Check if this is a post/void pending operation
    const isPostPending = hasFlag(transfer.flags || 0, TransferFlags.post_pending_transfer);
    const isVoidPending = hasFlag(transfer.flags || 0, TransferFlags.void_pending_transfer);

    if (isPostPending) {
      return await this._postPendingTransfer(transfer, index);
    }

    if (isVoidPending) {
      return await this._voidPendingTransfer(transfer, index);
    }

    // Check if this is a pending transfer
    const isPending = hasFlag(transfer.flags || 0, TransferFlags.pending);

    // Validate transfer
    const validationError = this._validateTransfer(transfer, index);
    if (validationError) {
      return validationError;
    }

    // Execute transfer (pending or posted)
    const executionError = isPending
      ? this._executePendingTransfer(transfer)
      : this._executeTransfer(transfer);

    if (executionError) {
      return { ...executionError, index };
    }

    return null;
  }

  /**
   * Validate transfer
   */
  _validateTransfer(transfer, index) {
    // Check for duplicate ID
    if (this.transfers.has(transfer.id) || this.pendingTransfers.has(transfer.id)) {
      return { index, code: ErrorCode.exists };
    }

    // Check accounts must be different
    if (transfer.debit_account_id === transfer.credit_account_id) {
      return { index, code: ErrorCode.accounts_must_be_different };
    }

    // Check accounts exist
    const debitAccount = this.accounts.get(transfer.debit_account_id);
    const creditAccount = this.accounts.get(transfer.credit_account_id);

    if (!debitAccount || !creditAccount) {
      return { index, code: ErrorCode.accounts_not_found };
    }

    // Check ledgers match
    if (debitAccount.ledger !== creditAccount.ledger) {
      return { index, code: ErrorCode.ledger_must_match };
    }

    // Check sufficient balance
    const availableBalance = getAvailableBalance(debitAccount);
    if (availableBalance < transfer.amount) {
      return { index, code: ErrorCode.exceeds_credits };
    }

    return null;
  }

  /**
   * Execute transfer (update balances)
   */
  _executeTransfer(transfer) {
    const debitAccount = this.accounts.get(transfer.debit_account_id);
    const creditAccount = this.accounts.get(transfer.credit_account_id);

    if (!debitAccount || !creditAccount) {
      return { code: ErrorCode.accounts_not_found };
    }

    // Check balance again (for linked transfers, balance changes during chain)
    const availableBalance = getAvailableBalance(debitAccount);
    if (availableBalance < transfer.amount) {
      return { code: ErrorCode.exceeds_credits };
    }

    // Update balances
    debitAccount.debits_posted = (debitAccount.debits_posted || 0n) + transfer.amount;
    creditAccount.credits_posted = (creditAccount.credits_posted || 0n) + transfer.amount;

    // Store transfer
    this.transfers.set(transfer.id, { ...transfer });

    return null;
  }

  /**
   * Execute pending transfer (update pending balances)
   */
  _executePendingTransfer(transfer) {
    const debitAccount = this.accounts.get(transfer.debit_account_id);
    const creditAccount = this.accounts.get(transfer.credit_account_id);

    if (!debitAccount || !creditAccount) {
      return { code: ErrorCode.accounts_not_found };
    }

    // Check available balance (includes existing pending debits)
    const availableBalance = getAvailableBalance(debitAccount);
    if (availableBalance < transfer.amount) {
      return { code: ErrorCode.exceeds_credits };
    }

    // Update pending balances
    debitAccount.debits_pending = (debitAccount.debits_pending || 0n) + transfer.amount;
    creditAccount.credits_pending = (creditAccount.credits_pending || 0n) + transfer.amount;

    // Store in pending transfers
    this.pendingTransfers.set(transfer.id, { ...transfer });

    // Update metadata
    this.metadata.pendingCreatedCount++;

    return null;
  }

  /**
   * Post pending transfer (move from pending to posted)
   */
  async _postPendingTransfer(transfer, index) {
    // Check if transfer has pending_id
    if (!transfer.pending_id) {
      return { index, code: ErrorCode.pending_transfer_not_found };
    }

    // Check if already posted
    if (this.transfers.has(transfer.pending_id)) {
      return { index, code: ErrorCode.pending_transfer_already_posted };
    }

    // Lookup pending transfer
    const pendingTransfer = this.pendingTransfers.get(transfer.pending_id);
    if (!pendingTransfer) {
      return { index, code: ErrorCode.pending_transfer_not_found };
    }

    // Get accounts
    const debitAccount = this.accounts.get(pendingTransfer.debit_account_id);
    const creditAccount = this.accounts.get(pendingTransfer.credit_account_id);

    if (!debitAccount || !creditAccount) {
      return { index, code: ErrorCode.accounts_not_found };
    }

    // Move from pending to posted
    debitAccount.debits_pending = (debitAccount.debits_pending || 0n) - pendingTransfer.amount;
    debitAccount.debits_posted = (debitAccount.debits_posted || 0n) + pendingTransfer.amount;
    creditAccount.credits_pending = (creditAccount.credits_pending || 0n) - pendingTransfer.amount;
    creditAccount.credits_posted = (creditAccount.credits_posted || 0n) + pendingTransfer.amount;

    // Move transfer to posted
    this.transfers.set(pendingTransfer.id, { ...pendingTransfer });
    this.pendingTransfers.delete(transfer.pending_id);

    // Update metadata
    this.metadata.pendingPostedCount++;

    return null;
  }

  /**
   * Void pending transfer (cancel and return funds)
   */
  async _voidPendingTransfer(transfer, index) {
    // Check if transfer has pending_id
    if (!transfer.pending_id) {
      return { index, code: ErrorCode.pending_transfer_not_found };
    }

    // Lookup pending transfer
    const pendingTransfer = this.pendingTransfers.get(transfer.pending_id);
    if (!pendingTransfer) {
      return { index, code: ErrorCode.pending_transfer_not_found };
    }

    // Check if already voided (not in pending map)
    if (!this.pendingTransfers.has(transfer.pending_id)) {
      return { index, code: ErrorCode.pending_transfer_already_voided };
    }

    // Get accounts
    const debitAccount = this.accounts.get(pendingTransfer.debit_account_id);
    const creditAccount = this.accounts.get(pendingTransfer.credit_account_id);

    if (!debitAccount || !creditAccount) {
      return { index, code: ErrorCode.accounts_not_found };
    }

    // Return funds by clearing pending balances
    debitAccount.debits_pending = (debitAccount.debits_pending || 0n) - pendingTransfer.amount;
    creditAccount.credits_pending = (creditAccount.credits_pending || 0n) - pendingTransfer.amount;

    // Remove from pending transfers
    this.pendingTransfers.delete(transfer.pending_id);

    // Update metadata
    this.metadata.pendingVoidedCount++;

    return null;
  }

  /**
   * Rollback account changes
   */
  _rollbackAccounts(snapshots) {
    for (const [id, snapshot] of snapshots.entries()) {
      this.accounts.set(id, snapshot);
    }
  }

  /**
   * Lookup transfers by IDs
   */
  async lookupTransfers(ids) {
    const transfers = [];

    for (const id of ids) {
      // Check posted transfers
      let transfer = this.transfers.get(id);

      // Check pending transfers
      if (!transfer) {
        transfer = this.pendingTransfers.get(id);
      }

      if (transfer) {
        transfers.push({ ...transfer });
      }
    }

    return transfers;
  }

  /**
   * Query accounts with filters
   */
  async queryAccounts(filter) {
    if (!filter || typeof filter.ledger === 'undefined') {
      throw new Error('ledger filter is required');
    }

    let results = [];

    // Filter by ledger (required)
    for (const [id, account] of this.accounts.entries()) {
      if (account.ledger === filter.ledger) {
        results.push({ id, ...account });
      }
    }

    // Filter by user_data_128 (optional)
    if (typeof filter.user_data_128 !== 'undefined') {
      results = results.filter((acc) => acc.user_data_128 === filter.user_data_128);
    }

    // Filter by user_data_64 (optional)
    if (typeof filter.user_data_64 !== 'undefined') {
      results = results.filter((acc) => acc.user_data_64 === filter.user_data_64);
    }

    // Filter by code (optional)
    if (typeof filter.code !== 'undefined') {
      results = results.filter((acc) => acc.code === filter.code);
    }

    // Filter by flags (optional)
    if (typeof filter.flags !== 'undefined') {
      results = results.filter((acc) => acc.flags === filter.flags);
    }

    // Filter by timestamp range (optional)
    if (typeof filter.timestamp_min !== 'undefined') {
      results = results.filter((acc) => acc.timestamp >= filter.timestamp_min);
    }
    if (typeof filter.timestamp_max !== 'undefined') {
      results = results.filter((acc) => acc.timestamp <= filter.timestamp_max);
    }

    // Apply limit (optional)
    if (typeof filter.limit !== 'undefined' && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Get clearing wallet (user_data_128 = 1)
   */
  async getClearingWallet(ledger) {
    const accounts = await this.queryAccounts({ ledger, user_data_128: 1n });
    return accounts[0] || null;
  }

  /**
   * Get revenue wallet (user_data_128 = 2)
   */
  async getRevenueWallet(ledger) {
    const accounts = await this.queryAccounts({ ledger, user_data_128: 2n });
    return accounts[0] || null;
  }

  /**
   * Get provider wallet (user_data_128 = 100 + ASCII code)
   */
  async getProviderWallet(ledger, providerCode) {
    const userData128 = 100n + BigInt(providerCode.charCodeAt(0));
    const accounts = await this.queryAccounts({ ledger, user_data_128: userData128 });
    return accounts[0] || null;
  }

  /**
   * Load fixture from file or object
   */
  async loadFixture(pathOrObject) {
    let state;

    if (typeof pathOrObject === 'string') {
      // Load from file
      state = await this.persistence.loadFixture(pathOrObject);
      if (!state) {
        throw new Error(`Fixture not found: ${pathOrObject}`);
      }
    } else {
      // Use provided object
      state = pathOrObject;
    }

    // Validate fixture structure
    if (!state.accounts || !Array.isArray(state.accounts)) {
      throw new Error('Invalid fixture: missing accounts array');
    }

    // Clear current state
    await this.reset();

    // Restore accounts
    for (const account of state.accounts) {
      const { id, ...accountData } = account;
      const deserializedAccount = deserializeBigInt(accountData, ACCOUNT_BIGINT_FIELDS);
      this.accounts.set(id.toString(), {
        id: id.toString(),
        ...deserializedAccount,
      });
    }

    // Restore transfers
    if (state.transfers && Array.isArray(state.transfers)) {
      for (const transfer of state.transfers) {
        const { id, debit_account_id, credit_account_id, ...transferData } = transfer;
        const deserializedTransfer = deserializeBigInt(transferData, TRANSFER_BIGINT_FIELDS);
        this.transfers.set(id.toString(), {
          id: id.toString(),
          debit_account_id: debit_account_id.toString(),
          credit_account_id: credit_account_id.toString(),
          ...deserializedTransfer,
        });
      }
    }

    // Restore pending transfers
    if (state.pendingTransfers && Array.isArray(state.pendingTransfers)) {
      for (const transfer of state.pendingTransfers) {
        const { id, debit_account_id, credit_account_id, pending_id, ...transferData } = transfer;
        const deserializedTransfer = deserializeBigInt(transferData, TRANSFER_BIGINT_FIELDS);
        this.pendingTransfers.set(id.toString(), {
          id: id.toString(),
          debit_account_id: debit_account_id.toString(),
          credit_account_id: credit_account_id.toString(),
          pending_id: pending_id ? pending_id.toString() : undefined,
          ...deserializedTransfer,
        });
      }
    }

    // Restore metadata if present
    if (state.metadata) {
      this.metadata = { ...state.metadata };
    }

    return true;
  }

  /**
   * Export to JSON format
   */
  exportToJSON() {
    return this.getSnapshot();
  }

  /**
   * Save fixture to file
   */
  async saveFixture(name) {
    const state = this.exportToJSON();
    await this.persistence.saveFixture(name, state);
    return this.persistence.getFixturePath(name);
  }

  /**
   * Reset ledger state
   */
  async reset(options = {}) {
    if (options.persist) {
      await this.persist();
    }

    if (this._restoreBaseline) {
      // Scoped undo — revert only this file's work, keeping prior persisted state intact.
      this.accounts = new Map(this._restoreBaseline.accounts);
      this.transfers = new Map(this._restoreBaseline.transfers);
      this.pendingTransfers = new Map(this._restoreBaseline.pendingTransfers);
      this.metadata = { ...this._restoreBaseline.metadata };
    } else {
      // No baseline (restoreOnInit was false or first run) — full clear.
      this.accounts.clear();
      this.transfers.clear();
      this.pendingTransfers.clear();

      this.metadata = {
        operationCount: 0,
        createdAt: Date.now(),
        lastOperation: null,
        transferCount: 0,
        pendingCreatedCount: 0,
        pendingPostedCount: 0,
        pendingVoidedCount: 0,
      };
    }
  }

  /**
   * Get snapshot of current state
   */
  getSnapshot() {
    const snapshot = {
      accounts: Array.from(this.accounts.entries()).map(([id, account]) => ({
        id,
        ...account,
      })),
      transfers: Array.from(this.transfers.entries()).map(([id, transfer]) => ({
        id,
        ...transfer,
      })),
      pendingTransfers: Array.from(this.pendingTransfers.entries()).map(([id, transfer]) => ({
        id,
        ...transfer,
      })),
      metadata: { ...this.metadata },
    };

    // Serialize all BigInt values for JSON persistence
    return serializeBigInt(snapshot);
  }

  /**
   * Persist current state to disk
   */
  async persist() {
    if (!this.sessionId) {
      throw new Error('Cannot persist: sessionId not set');
    }

    const state = this.getSnapshot();
    await this.persistence.saveSession(this.sessionId, state);
  }

  /**
   * Restore state from disk
   */
  async restore() {
    if (!this.sessionId) {
      return false;
    }

    const state = await this.persistence.loadSession(this.sessionId);
    if (!state) {
      return false; // Don't clear state if session doesn't exist
    }

    // Restore accounts
    this.accounts.clear();
    for (const account of state.accounts) {
      const { id, ...accountData } = account;
      const deserializedAccount = deserializeBigInt(accountData, ACCOUNT_BIGINT_FIELDS);
      this.accounts.set(id.toString(), {
        id: id.toString(),
        ...deserializedAccount,
      });
    }

    // Restore transfers
    this.transfers.clear();
    for (const transfer of state.transfers) {
      const { id, debit_account_id, credit_account_id, ...transferData } = transfer;
      const deserializedTransfer = deserializeBigInt(transferData, TRANSFER_BIGINT_FIELDS);
      this.transfers.set(id.toString(), {
        id: id.toString(),
        debit_account_id: debit_account_id.toString(),
        credit_account_id: credit_account_id.toString(),
        ...deserializedTransfer,
      });
    }

    // Restore pending transfers
    this.pendingTransfers.clear();
    for (const transfer of state.pendingTransfers) {
      const { id, debit_account_id, credit_account_id, pending_id, ...transferData } = transfer;
      const deserializedTransfer = deserializeBigInt(transferData, TRANSFER_BIGINT_FIELDS);
      this.pendingTransfers.set(id.toString(), {
        id: id.toString(),
        debit_account_id: debit_account_id.toString(),
        credit_account_id: credit_account_id.toString(),
        pending_id: pending_id ? pending_id.toString() : undefined,
        ...deserializedTransfer,
      });
    }

    // Restore metadata
    if (state.metadata) {
      this.metadata = { ...state.metadata };
    }

    // Snap baseline — reset() will return to this point rather than empty.
    this._restoreBaseline = {
      accounts: new Map(this.accounts),
      transfers: new Map(this.transfers),
      pendingTransfers: new Map(this.pendingTransfers),
      metadata: { ...this.metadata },
    };

    return true;
  }

  /**
   * Set session ID (without auto-restore)
   * Use restore() explicitly if you want to load the session
   */
  async setSessionId(id) {
    this.sessionId = id;
  }

  /**
   * Clear current session
   */
  async clearSession() {
    if (!this.sessionId) {
      return;
    }

    await this.persistence.deleteSession(this.sessionId);
    await this.reset();
  }

  /**
   * Debounced persist (avoid excessive I/O)
   */
  async _debouncedPersist() {
    // If debounce delay is 0, persist immediately
    if (this.persistDebounceMs === 0) {
      return await this.persist();
    }

    if (this._persistTimeout) {
      clearTimeout(this._persistTimeout);
    }

    this._persistTimeout = setTimeout(async () => {
      await this.persist();
      this._persistTimeout = null;
    }, this.persistDebounceMs);
  }
}

// Singleton instance for tests
let sharedInstance = null;

/**
 * Create TigerBeetle client (mock version)
 * Mimics the real tigerbeetle-node createClient API
 */
function createClient(options = {}) {
  if (!sharedInstance) {
    // Get session name from environment (set by setup.js)
    const sessionId = process.env.TEST_SESSION_DIR || 'default';

    sharedInstance = new TigerBeetleMock({
      sessionId,
      persistenceDir: path.join(getMockDataDir(), 'tigerbeetle'),
      autoPersist: true,
      persistOnOperation: ['createAccounts', 'createTransfers'],
      persistDebounceMs: 0, // Immediate persistence for tests
    });
  }
  return sharedInstance;
}

// Mock ID generator
function id(value) {
  const crypto = require('crypto');

  if (value === undefined || value === null) {
    return BigInt(`0x${crypto.randomBytes(16).toString('hex')}`);
  }

  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'string') {
    const hash = crypto.createHash('sha256').update(value).digest();
    return BigInt(`0x${hash.slice(0, 16).toString('hex')}`);
  }

  throw new Error('Invalid ID value');
}

// Export
module.exports = {
  TigerBeetleMock,
  createClient,
  id,
  AccountFlags,
  TransferFlags,
  ErrorCode,
};
