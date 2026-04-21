const { appLogger } = require('../../../../utils/logger');

/**
 * Mock behavior for generic webhook testing
 * POST to URLs containing 'webhook-' in the path
 *
 * This is for testing entity webhooks and other outbound webhook calls
 *
 * Magic URL patterns:
 * - URL contains 'webhook-success' → 200 OK
 * - URL contains 'webhook-timeout' → Timeout
 * - URL contains 'webhook-unauthorized' → 401 Unauthorized
 * - URL contains 'webhook-servererror' → 500 Server Error
 * - URL contains 'webhook-badrequest' → 400 Bad Request
 * - Default → 200 OK with echo
 */
module.exports = {
  urlPattern: /webhook-/, // Match URLs with 'webhook-' in the path
  method: 'POST',

  handler(request, context) {
    appLogger.info({ url: request.url, method: request.method }, 'mock-generic-webhook');

    // Check for URL-based behaviors
    if (request.url.includes('webhook-timeout')) {
      return {
        status: 504,
        body: {
          error: 'Gateway Timeout',
          message: 'Webhook endpoint timed out',
        },
      };
    }

    if (request.url.includes('webhook-unauthorized')) {
      return {
        status: 401,
        body: {
          error: 'Unauthorized',
          message: 'Invalid or missing authentication',
        },
      };
    }

    if (request.url.includes('webhook-servererror')) {
      return {
        status: 500,
        body: {
          error: 'Internal Server Error',
          message: 'Webhook processing failed',
        },
      };
    }

    if (request.url.includes('webhook-badrequest')) {
      return {
        status: 400,
        body: {
          error: 'Bad Request',
          message: 'Invalid webhook payload',
        },
      };
    }

    // Store webhook call in registry for testing assertions
    const webhookLog = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      payload: request.data,
      timestamp: Date.now(),
    };

    // Store with a generated ID
    const logId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    context.storeResource('webhook_calls', logId, webhookLog);

    // Success response - echo back the request
    return {
      status: 200,
      body: {
        status: 'received',
        webhook_url: request.url,
        received_at: Date.now(),
        payload_received: !!request.data,
      },
    };
  },
};
