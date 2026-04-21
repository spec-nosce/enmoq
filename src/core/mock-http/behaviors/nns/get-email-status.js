const { appLogger } = require('../../../../utils/logger');

/**
 * Mock behavior for retrieving email status
 * GET /messages/:message_id
 */
module.exports = {
  urlPattern: /\/messages\/([a-zA-Z0-9]+)$/,
  method: 'GET',

  handler(request, context) {
    const match = request.url.match(this.urlPattern);
    const messageId = match[1];

    appLogger.info({ message_id: messageId }, 'mock-nns-get-email-status');

    // Try to get from registry
    const email = context.getResource('emails', messageId);

    if (!email) {
      return {
        status: 404,
        body: {
          status: 'error',
          code: 'MESSAGE_NOT_FOUND',
          message: 'Email message not found',
          details: { message_id: messageId },
        },
      };
    }

    // Progress status on subsequent calls
    const stateKey = `email:${messageId}`;
    const currentState = context.getState(stateKey) || { status: 'pending', calls: 0 };

    // Status progression: pending → sent → delivered
    const statusFlow = ['pending', 'sent', 'delivered'];
    const nextStatusIndex = Math.min(currentState.calls, statusFlow.length - 1);
    const newStatus = statusFlow[nextStatusIndex];

    context.setState(stateKey, {
      status: newStatus,
      calls: currentState.calls + 1,
    });

    return {
      status: 200,
      body: {
        id: email.id,
        status: newStatus,
        from: email.from,
        to: email.to,
        template_id: email.template_id,
        created_at: email.created_at,
        updated_at: Date.now(),
      },
    };
  },
};
