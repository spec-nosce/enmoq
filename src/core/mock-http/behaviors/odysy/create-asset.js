const { ulid } = require('../../../../utils/randomness');
const { appLogger } = require('../../../../utils/logger');
const { getTestReference } = require('../test-data/magic-values');

/**
 * Mock behavior for Odysy PDF generation
 * POST /assets
 *
 * Magic values:
 * - reference: test-error → Generation error
 * - reference: test-timeout → Service timeout
 * - reference: test-invalid-html → Invalid HTML error
 * - data_token: test-expired → Expired token error
 * - Other references → Success (pending → processing → completed)
 */
module.exports = {
  urlPattern: /\/assets$/,
  method: 'POST',

  handler(request, context) {
    const { reference, filename, file_type, data_token, asset_data, file_attribute } = request.data;

    appLogger.info({ reference, filename }, 'mock-odysy-create-asset');

    // Check for expired token
    if (data_token === 'test-expired') {
      return {
        status: 401,
        body: {
          status: 'error',
          code: 'TOKEN_EXPIRED',
          message: 'Data token has expired',
          details: { data_token },
        },
      };
    }

    // Check for reference-based behaviors
    const referenceBehavior = getTestReference(reference);

    if (referenceBehavior === 'error') {
      return {
        status: 500,
        body: {
          status: 'error',
          code: 'GENERATION_ERROR',
          message: 'Failed to generate PDF',
          reference,
        },
      };
    }

    if (referenceBehavior === 'timeout') {
      return {
        status: 504,
        body: {
          status: 'error',
          code: 'GATEWAY_TIMEOUT',
          message: 'PDF generation timeout',
          reference,
        },
      };
    }

    if (referenceBehavior === 'invalid-html') {
      return {
        status: 400,
        body: {
          status: 'error',
          code: 'INVALID_HTML',
          message: 'HTML content is invalid or malformed',
          reference,
        },
      };
    }

    // Check for malformed HTML (basic validation)
    if (asset_data && asset_data.length < 10) {
      return {
        status: 400,
        body: {
          status: 'error',
          code: 'INVALID_ASSET_DATA',
          message: 'Asset data is too short or empty',
        },
      };
    }

    // Success case - create asset
    const assetId = ulid();
    const asset = {
      id: assetId,
      reference,
      filename: filename || 'document.pdf',
      file_type: file_type || 'pdf',
      status: 'pending',
      file_url: null,
      expiration_timestamp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      file_attribute,
      created_at: Date.now(),
    };

    // Store in registry
    context.storeResource('assets', reference, asset);

    return {
      status: 200,
      body: {
        id: assetId,
        reference,
        filename: asset.filename,
        status: 'pending',
        file_url: null,
        expiration_timestamp: asset.expiration_timestamp,
      },
    };
  },
};
