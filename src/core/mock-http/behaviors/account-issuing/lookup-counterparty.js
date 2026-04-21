const { getAccountBehavior, getPatternBehavior } = require('../test-data/test-accounts');

module.exports = {
  name: 'lookup-counterparty',
  method: 'POST',
  urlPattern: '.*/account-lookups$',

  handler(request, context) {
    const { details, issuer } = request.data || {};

    if (!details || !details.account_number) {
      return {
        status: 400,
        body: {
          code: 'INVALID_REQUEST',
          message: 'Account number is required',
          errors: [{ field: 'details.account_number', message: 'Required field missing' }],
        },
      };
    }

    if (!issuer || !issuer.code) {
      return {
        status: 400,
        body: {
          code: 'INVALID_REQUEST',
          message: 'Issuer code is required',
          errors: [{ field: 'issuer.code', message: 'Required field missing' }],
        },
      };
    }

    const { account_number } = details;

    // Check for magic test values
    const magicAccount = getAccountBehavior(account_number);

    if (magicAccount) {
      if (magicAccount.error === 'timeout') {
        throw new Error('Request timeout');
      }

      if (magicAccount.error === 'service_unavailable') {
        return {
          status: 503,
          body: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Account lookup service temporarily unavailable',
          },
        };
      }

      if (magicAccount.error === 'account_not_found') {
        const lookupId = context.generateULID();
        const lookupData = {
          id: lookupId,
          status: 'failed',
          error_code: 'NOT_FOUND',
          details: {
            account_number,
            issuer: {
              code: issuer.code,
              name: issuer.name || 'Unknown Bank',
            },
          },
          created_at: context.timestamp(),
        };

        context.storeResource('lookups', lookupId, lookupData);

        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: { data: lookupData },
        };
      }

      if (magicAccount.error) {
        return {
          status: 400,
          body: {
            code: magicAccount.error.toUpperCase(),
            message: `Account lookup failed: ${magicAccount.error}`,
          },
        };
      }

      // Success case with magic account
      const lookupId = context.generateULID();
      const lookupData = {
        id: lookupId,
        status: 'completed',
        details: {
          account_number,
          name: magicAccount.name,
          type: magicAccount.type,
          issuer: {
            code: issuer.code,
            name: issuer.name || 'Test Bank',
          },
        },
        created_at: context.timestamp(),
        completed_at: context.timestamp(),
      };

      context.storeResource('lookups', lookupId, lookupData);

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { data: lookupData },
      };
    }

    // Pattern-based behaviors
    const patternBehavior = getPatternBehavior(account_number);

    if (patternBehavior) {
      if (patternBehavior.error === 'provider_error') {
        return {
          status: 500,
          body: {
            code: 'PROVIDER_ERROR',
            message: 'Upstream provider error',
          },
        };
      }

      return {
        status: 400,
        body: {
          code: patternBehavior.error.toUpperCase(),
          message: patternBehavior.description,
        },
      };
    }

    // Default success behavior
    const lookupId = context.generateULID();
    const lookupData = {
      id: lookupId,
      status: 'completed',
      details: {
        account_number,
        name: `Account Holder ${account_number.slice(-4)}`,
        type: 'individual',
        issuer: {
          code: issuer.code,
          name: issuer.name || 'Test Bank',
        },
      },
      created_at: context.timestamp(),
      completed_at: context.timestamp(),
    };

    context.storeResource('lookups', lookupId, lookupData);

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { data: lookupData },
    };
  },
};
