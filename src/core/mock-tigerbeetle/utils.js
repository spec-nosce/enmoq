/**
 * TigerBeetle Mock Utilities
 *
 * Helper functions for the TigerBeetle mock implementation.
 */

/**
 * Ledger mapping for currencies
 */
const LEDGER_MAP = {
  NGN: 1,
  USD: 2,
  GBP: 3,
  EUR: 4,
  KES: 5,
  GHS: 6,
  ZAR: 7,
};

const LEDGER_REVERSE_MAP = {
  1: 'NGN',
  2: 'USD',
  3: 'GBP',
  4: 'EUR',
  5: 'KES',
  6: 'GHS',
  7: 'ZAR',
};

/**
 * Get ledger ID from currency code
 */
function getLedgerFromCurrency(currency) {
  const ledger = LEDGER_MAP[currency.toUpperCase()];
  if (!ledger) {
    throw new Error(`Unknown currency: ${currency}`);
  }
  return ledger;
}

/**
 * Get currency code from ledger ID
 */
function getCurrencyFromLedger(ledger) {
  const currency = LEDGER_REVERSE_MAP[ledger];
  if (!currency) {
    throw new Error(`Unknown ledger: ${ledger}`);
  }
  return currency;
}

/**
 * Convert BigInt to string for JSON serialization
 */
function bigIntToString(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * Convert string to BigInt for JSON deserialization
 */
function stringToBigInt(value) {
  if (typeof value === 'string' && value.match(/^\d+$/)) {
    return BigInt(value);
  }
  return value;
}

/**
 * Serialize object with BigInt values to JSON-safe format
 */
function serializeBigInt(obj) {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'bigint') {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt);
  }

  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInt(value);
    }
    return result;
  }

  return obj;
}

/**
 * Deserialize JSON with string BigInt values
 */
function deserializeBigInt(obj, bigIntFields = []) {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => deserializeBigInt(item, bigIntFields));
  }

  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (bigIntFields.includes(key) && typeof value === 'string') {
        result[key] = BigInt(value);
      } else if (typeof value === 'object') {
        result[key] = deserializeBigInt(value, bigIntFields);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return obj;
}

/**
 * BigInt fields in account objects
 * NOTE: 'id' is excluded because IDs are ULIDs (strings, not BigInt)
 */
const ACCOUNT_BIGINT_FIELDS = [
  'user_data_64',
  'user_data_128',
  'debits_posted',
  'debits_pending',
  'credits_posted',
  'credits_pending',
  'timestamp',
  'reserved',
];

/**
 * BigInt fields in transfer objects
 * NOTE: ID fields ('id', 'debit_account_id', 'credit_account_id', 'pending_id')
 * are excluded because they are ULIDs (strings, not BigInt)
 */
const TRANSFER_BIGINT_FIELDS = [
  'amount',
  'user_data_64',
  'user_data_128',
  'timeout',
  'timestamp',
  'reserved',
];

/**
 * Get available balance (posted balance minus pending debits)
 */
function getAvailableBalance(account) {
  const creditsPosted = account.credits_posted || 0n;
  const debitsPosted = account.debits_posted || 0n;
  const debitsPending = account.debits_pending || 0n;

  return creditsPosted - debitsPosted - debitsPending;
}

/**
 * Get pending balance (including pending credits and debits)
 */
function getPendingBalance(account) {
  const creditsPosted = account.credits_posted || 0n;
  const creditsending = account.credits_pending || 0n;
  const debitsPosted = account.debits_posted || 0n;
  const debitsPending = account.debits_pending || 0n;

  return creditsPosted + creditsending - debitsPosted - debitsPending;
}

/**
 * Get posted balance (credits minus debits, excluding pending)
 */
function getPostedBalance(account) {
  const creditsPosted = account.credits_posted || 0n;
  const debitsPosted = account.debits_posted || 0n;

  return creditsPosted - debitsPosted;
}

/**
 * Compute flags bitfield from flag object
 */
function computeFlags(flagsEnum, flagsObject) {
  let flags = 0;

  if (!flagsObject) return flags;

  for (const [key, value] of Object.entries(flagsObject)) {
    if (value && flagsEnum[key] !== undefined) {
      flags |= flagsEnum[key];
    }
  }

  return flags;
}

/**
 * Check if flag is set in bitfield
 */
function hasFlag(flags, flagValue) {
  return (flags & flagValue) !== 0;
}

module.exports = {
  LEDGER_MAP,
  LEDGER_REVERSE_MAP,
  getLedgerFromCurrency,
  getCurrencyFromLedger,
  bigIntToString,
  stringToBigInt,
  serializeBigInt,
  deserializeBigInt,
  ACCOUNT_BIGINT_FIELDS,
  TRANSFER_BIGINT_FIELDS,
  getAvailableBalance,
  getPendingBalance,
  getPostedBalance,
  computeFlags,
  hasFlag,
};
