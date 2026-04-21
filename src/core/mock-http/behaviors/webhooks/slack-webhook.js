const { appLogger } = require('../../../../utils/logger');

/**
 * Mock behavior for Slack webhook notifications
 * POST to any hooks.slack.com URL
 *
 * Magic values:
 * - URL contains 'test-error' → 500 error
 * - URL contains 'test-timeout' → Timeout
 * - URL contains 'test-invalid' → Invalid webhook
 * - All others → Success
 */
module.exports = {
  urlPattern: /hooks\.slack\.com\/services\//,
  method: 'POST',

  handler(request, context) {
    const { blocks, text, attachments } = request.data;

    appLogger.info({ url: request.url }, 'mock-slack-webhook');

    // Check for error URL patterns
    if (request.url.includes('test-error')) {
      return {
        status: 500,
        data: 'server_error',
      };
    }

    if (request.url.includes('test-timeout')) {
      return {
        status: 504,
        data: 'timeout',
      };
    }

    if (request.url.includes('test-invalid')) {
      return {
        status: 404,
        data: 'channel_not_found',
      };
    }

    // Validate payload
    if (!blocks && !text && !attachments) {
      return {
        status: 400,
        data: 'invalid_payload',
      };
    }

    // Store webhook call in registry for testing assertions
    const webhookLog = {
      url: request.url,
      payload: request.data,
      timestamp: Date.now(),
    };

    // Store with a generated ID
    const logId = `slack_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    context.storeResource('slack_webhooks', logId, webhookLog);

    // Success response (Slack returns "ok")
    return {
      status: 200,
      data: 'ok',
    };
  },
};
