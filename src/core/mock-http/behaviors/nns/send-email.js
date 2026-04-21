const { ulid } = require('../../../../utils/randomness');
const { appLogger } = require('../../../../utils/logger');
const { getTestTemplate } = require('../test-data/magic-values');

/**
 * Mock behavior for NNS email sending
 * POST /messages
 *
 * Magic values:
 * - template_id: test-success → Email queued successfully
 * - template_id: test-invalid → Template not found error
 * - template_id: test-timeout → Service timeout
 * - to: bounce@test.com → Bounce error
 * - to: spam@test.com → Spam rejection
 */
module.exports = {
  urlPattern: /\/messages$/,
  method: 'POST',

  handler(request, context) {
    const { from, to, template_id, template_data } = request.data;

    appLogger.info({ to, template_id }, 'mock-nns-send-email');

    // Check for bounce email
    const recipients = Array.isArray(to) ? to : [to];
    if (recipients.some((email) => email === 'bounce@test.com')) {
      return {
        status: 400,
        body: {
          status: 'error',
          code: 'EMAIL_BOUNCE',
          message: 'Email address bounced',
          details: {
            bounced_emails: recipients.filter((email) => email === 'bounce@test.com'),
          },
        },
      };
    }

    // Check for spam email
    if (recipients.some((email) => email === 'spam@test.com')) {
      return {
        status: 400,
        body: {
          status: 'error',
          code: 'SPAM_DETECTED',
          message: 'Email rejected as potential spam',
        },
      };
    }

    // Check for template errors
    const templateBehavior = getTestTemplate(template_id);

    if (templateBehavior === 'invalid') {
      return {
        status: 404,
        body: {
          status: 'error',
          code: 'TEMPLATE_NOT_FOUND',
          message: 'Email template not found',
          details: {
            template_id,
          },
        },
      };
    }

    if (templateBehavior === 'timeout') {
      return {
        status: 504,
        body: {
          status: 'error',
          code: 'GATEWAY_TIMEOUT',
          message: 'Email service timeout',
        },
      };
    }

    // Success case - create email job
    const messageId = ulid();
    const emailJob = {
      id: messageId,
      status: 'pending',
      from,
      to: recipients,
      template_id,
      template_data,
      created_at: Date.now(),
    };

    // Store in registry for later retrieval
    context.storeResource('emails', messageId, emailJob);

    return {
      status: 200,
      body: {
        status: 'pending',
        message_id: messageId,
        recipients: recipients.length,
      },
    };
  },
};
