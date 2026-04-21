const { getIssuerBehavior } = require('../test-data/magic-values');

module.exports = {
  name: 'create-account',
  method: 'POST',
  urlPattern: '.*/accounts$',

  handler(request, context) {
    const { entity_type, kyc, issuer_code, issuer_name } = request.data || {};

    // Validation behaviors
    if (!kyc || !kyc.first_name) {
      return {
        status: 400,
        body: {
          code: 'INVALID_KYC',
          message: 'KYC verification failed',
          errors: [{ field: 'kyc.first_name', message: 'Required field missing' }],
        },
      };
    }

    if (!issuer_code) {
      return {
        status: 400,
        body: {
          code: 'INVALID_ISSUER',
          message: 'Issuer code is required',
          errors: [{ field: 'issuer_code', message: 'Required field missing' }],
        },
      };
    }

    // Business rule behaviors
    if (entity_type === 'business' && !kyc.business_name) {
      return {
        status: 400,
        body: {
          code: 'INVALID_BUSINESS_KYC',
          message: 'Business name is required for business entities',
          errors: [{ field: 'kyc.business_name', message: 'Required field missing' }],
        },
      };
    }

    // Test issuer behaviors
    const issuerBehavior = getIssuerBehavior(issuer_code);

    if (issuerBehavior) {
      if (issuerBehavior.error === 'provider_error') {
        return {
          status: 500,
          body: {
            code: 'PROVIDER_ERROR',
            message: 'Account issuing service temporarily unavailable',
          },
        };
      }

      if (issuerBehavior.error === 'timeout') {
        throw new Error('Request timeout');
      }

      if (issuerBehavior.error === 'invalid_issuer') {
        return {
          status: 400,
          body: {
            code: 'INVALID_ISSUER',
            message: 'Invalid issuer code provided',
          },
        };
      }
    }

    // Success behavior - generate realistic response
    const accountId = context.generateULID();
    const accountNumber = context.generateAccountNumber();
    const iban = context.generateIBAN();

    const accountData = {
      id: accountId,
      status: issuerBehavior?.status === 'pending' ? 'pending' : 'active',
      entity_type: entity_type || 'individual',
      created_at: context.timestamp(),
      provider: {
        _id: `provider_${issuer_code}`,
        name: issuer_name || 'Test Bank',
        code: issuer_code,
      },
      details: {
        issuer: {
          code: issuer_code,
          name: issuer_name || 'Test Bank',
        },
        account_number: accountNumber,
        routing_number: '123456789',
        iban,
        bic: context.generateBIC(),
        sort_code: context.generateSortCode(),
      },
      kyc: {
        first_name: kyc.first_name,
        last_name: kyc.last_name || 'Doe',
        business_name: kyc.business_name || null,
      },
    };

    // Store in registry for later retrieval
    context.storeResource('accounts', accountId, accountData);

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { data: accountData },
    };
  },
};
