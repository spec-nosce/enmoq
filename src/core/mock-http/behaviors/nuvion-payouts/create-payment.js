const { getCardBehavior } = require('../test-data/test-cards');
const { checkAmountBehavior, checkReferencePattern } = require('../test-data/magic-values');

module.exports = {
  name: 'create-payment',
  method: 'POST',
  urlPattern: '.*/payments$',

  handler(request, context) {
    const { amount, currency, counterparty, unique_reference } = request.data || {};

    // Validation
    if (!amount || amount <= 0) {
      return {
        status: 400,
        body: {
          code: 'INVALID_AMOUNT',
          message: 'Amount must be greater than 0',
          errors: [{ field: 'amount', message: 'Invalid amount' }],
        },
      };
    }

    if (!currency) {
      return {
        status: 400,
        body: {
          code: 'INVALID_CURRENCY',
          message: 'Currency is required',
          errors: [{ field: 'currency', message: 'Required field missing' }],
        },
      };
    }

    if (!counterparty) {
      return {
        status: 400,
        body: {
          code: 'INVALID_COUNTERPARTY',
          message: 'Counterparty details are required',
          errors: [{ field: 'counterparty', message: 'Required field missing' }],
        },
      };
    }

    // Amount-based behaviors
    const amountBehavior = checkAmountBehavior(amount);
    if (amountBehavior) {
      return {
        status: 400,
        body: {
          code: amountBehavior.error.toUpperCase(),
          message: amountBehavior.message,
          errors: [{ field: 'amount', message: amountBehavior.message }],
        },
      };
    }

    // Reference pattern checking
    if (unique_reference) {
      const refBehavior = checkReferencePattern(unique_reference);
      if (refBehavior) {
        if (refBehavior.error === 'timeout') {
          throw new Error('Request timeout');
        }

        if (refBehavior.error === 'duplicate_reference') {
          return {
            status: 400,
            body: {
              code: 'DUPLICATE_REFERENCE',
              message: 'Payment reference already exists',
              errors: [{ field: 'unique_reference', message: 'Reference already used' }],
            },
          };
        }

        return {
          status: 400,
          body: {
            code: refBehavior.error.toUpperCase(),
            message: refBehavior.message,
          },
        };
      }
    }

    // Test card behavior
    const cardNumber = counterparty.card_number || counterparty.account_number;
    const testCard = getCardBehavior(cardNumber);

    if (testCard) {
      if (testCard.outcome === 'timeout') {
        throw new Error('Request timeout');
      }

      if (testCard.outcome === 'declined') {
        return {
          status: 400,
          body: {
            code: 'PAYMENT_DECLINED',
            message: 'Payment declined',
            status: 'declined',
            status_reason: testCard.reason,
          },
        };
      }

      if (testCard.outcome === 'error') {
        return {
          status: 500,
          body: {
            code: 'PAYMENT_ERROR',
            message: 'Payment processing error',
            status: 'failed',
            status_reason: testCard.reason,
          },
        };
      }

      // Success or pending case
      const paymentId = unique_reference || context.generateULID();
      const paymentData = {
        id: paymentId,
        status: testCard.outcome === 'pending' ? 'requires_action' : 'pending',
        amount,
        currency,
        counterparty: {
          ...counterparty,
          card_network: testCard.network,
        },
        status_reason: testCard.reason || 'Payment initiated',
        created_at: context.timestamp(),
      };

      context.storeResource('payments', paymentId, paymentData);

      // Initialize state for status progression
      if (testCard.outcome !== 'pending') {
        context.setState(paymentId, {
          status: 'pending',
          statusIndex: 0,
        });
      }

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { data: paymentData },
      };
    }

    // Default success behavior for non-test cards
    const paymentId = unique_reference || context.generateULID();
    const paymentData = {
      id: paymentId,
      status: 'pending',
      amount,
      currency,
      counterparty,
      status_reason: 'Payment initiated',
      created_at: context.timestamp(),
    };

    context.storeResource('payments', paymentId, paymentData);

    // Initialize state for status progression
    context.setState(paymentId, {
      status: 'pending',
      statusIndex: 0,
    });

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { data: paymentData },
    };
  },
};
