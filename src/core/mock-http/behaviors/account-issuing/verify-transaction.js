const { ulid } = require('../../../../utils/randomness');
const { appLogger } = require('../../../../utils/logger');

/**
 * Mock behavior for Account Issuing transaction verification
 * POST /transaction-verifications
 *
 * Magic values:
 * - provider_reference: VERIFY_SUCCESS_XXX → Verified transaction
 * - provider_reference: VERIFY_NOTFOUND_XXX → Transaction not found
 * - provider_reference: VERIFY_MISMATCH_XXX → Account mismatch
 * - provider_reference: VERIFY_TIMEOUT_XXX → Service timeout
 * - provider_code: TESTBANK → Success
 * - provider_code: ERROR_BANK → Provider error
 */
module.exports = {
  urlPattern: /\/transaction-verifications$/,
  method: 'POST',

  handler(request, context) {
    const { provider_code, provider_reference } = request.data;

    appLogger.info({ provider_code, provider_reference }, 'mock-verify-transaction');

    // Check for reference-based behaviors
    if (provider_reference?.startsWith('VERIFY_NOTFOUND')) {
      return {
        status: 404,
        body: {
          status: 'error',
          code: 'TRANSACTION_NOT_FOUND',
          message: 'Transaction not found',
          body: {
            provider_reference,
            provider_code,
          },
        },
      };
    }

    if (provider_reference?.startsWith('VERIFY_MISMATCH')) {
      return {
        status: 400,
        body: {
          status: 'error',
          code: 'ACCOUNT_MISMATCH',
          message: 'Transaction account does not match expected account',
          body: {
            provider_reference,
          },
        },
      };
    }

    if (provider_reference?.startsWith('VERIFY_TIMEOUT')) {
      return {
        status: 504,
        body: {
          status: 'error',
          code: 'GATEWAY_TIMEOUT',
          message: 'Transaction verification timeout',
        },
      };
    }

    // Check for provider-based behaviors
    if (provider_code === 'ERROR_BANK') {
      return {
        status: 500,
        body: {
          status: 'error',
          code: 'PROVIDER_ERROR',
          message: 'Provider returned an error',
          body: {
            provider_code,
          },
        },
      };
    }

    // Success case
    const verificationId = ulid();
    const verification = {
      id: verificationId,
      provider_code,
      provider_reference,
      status: 'verified',
      transaction: {
        amount: 10000, // Default test amount
        currency: 'USD',
        sender_account: '1234567890',
        recipient_account: '0987654321',
        transaction_date: Date.now(),
      },
      verified_at: Date.now(),
    };

    // Store in registry
    context.storeResource('verifications', verificationId, verification);

    return {
      status: 200,
      body: {
        status: 'success',
        data: verification,
      },
    };
  },
};
