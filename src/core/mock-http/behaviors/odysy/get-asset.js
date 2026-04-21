const { appLogger } = require('../../../../utils/logger');

/**
 * Mock behavior for retrieving Odysy PDF asset
 * GET /assets?reference=XXX
 */
module.exports = {
  urlPattern: /\/assets/,
  method: 'GET',

  handler(request, context) {
    // Extract reference from query params
    const urlParams = new URLSearchParams(request.url.split('?')[1] || '');
    const reference = urlParams.get('reference');

    appLogger.info({ reference }, 'mock-odysy-get-asset');

    if (!reference) {
      return {
        status: 400,
        body: {
          status: 'error',
          code: 'MISSING_REFERENCE',
          message: 'Reference parameter is required',
        },
      };
    }

    // Try to get from registry
    const asset = context.getResource('assets', reference);

    if (!asset) {
      return {
        status: 404,
        body: {
          status: 'error',
          code: 'ASSET_NOT_FOUND',
          message: 'Asset not found',
          details: { reference },
        },
      };
    }

    // Progress status on subsequent calls
    const stateKey = `asset:${reference}`;
    const currentState = context.getState(stateKey) || { status: 'pending', calls: 0 };

    // Status progression: pending → processing → completed
    const statusFlow = ['pending', 'processing', 'completed'];
    const nextStatusIndex = Math.min(currentState.calls, statusFlow.length - 1);
    const newStatus = statusFlow[nextStatusIndex];

    // Generate file URL when completed
    const fileUrl =
      newStatus === 'completed'
        ? `https://cdn.odysy.test/files/${asset.reference}-${asset.id}.pdf`
        : null;

    context.setState(stateKey, {
      status: newStatus,
      calls: currentState.calls + 1,
    });

    return {
      status: 200,
      body: {
        id: asset.id,
        reference: asset.reference,
        filename: asset.filename,
        file_type: asset.file_type,
        status: newStatus,
        file_url: fileUrl,
        expiration_timestamp: asset.expiration_timestamp,
        created_at: asset.created_at,
        updated_at: Date.now(),
      },
    };
  },
};
