/**
 * TigerBeetle Error Codes
 *
 * These error codes match TigerBeetle's native error responses
 * for consistent error handling in tests.
 */

const ErrorCode = {
  // Account errors
  exists: 'exists',
  invalid_ledger: 'invalid_ledger',
  invalid_code: 'invalid_code',

  // Transfer errors
  exceeds_credits: 'exceeds_credits',
  accounts_must_be_different: 'accounts_must_be_different',
  ledger_must_match: 'ledger_must_match',
  accounts_not_found: 'accounts_not_found',

  // Pending transfer errors
  pending_transfer_not_found: 'pending_transfer_not_found',
  pending_transfer_already_posted: 'pending_transfer_already_posted',
  pending_transfer_already_voided: 'pending_transfer_already_voided',
  pending_transfer_expired: 'pending_transfer_expired',
};

module.exports = { ErrorCode };
