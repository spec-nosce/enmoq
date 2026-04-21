module.exports = {
  name: 'get-payment',
  method: 'GET',
  urlPattern: '.*/payments/([a-zA-Z0-9_-]+)$',

  handler(request, context) {
    const paymentId = request.urlParams[0];

    if (!paymentId) {
      return {
        status: 400,
        body: {
          code: 'INVALID_REQUEST',
          message: 'Payment ID is required',
        },
      };
    }

    // Check for state progression (pending → completed)
    const state = context.getState(paymentId);

    if (state) {
      // Progress through statuses: pending → processing → completed
      const statusSequence = ['pending', 'processing', 'completed'];
      const nextStatus = context.getNextStatus(paymentId, statusSequence);

      // Retrieve from registry and update status
      const payment = context.getResource('payments', paymentId);

      if (payment) {
        payment.status = nextStatus;
        payment.updated_at = context.timestamp();

        if (nextStatus === 'completed') {
          payment.completed_at = context.timestamp();
        }

        context.storeResource('payments', paymentId, payment);

        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: { data: payment },
        };
      }
    }

    // Retrieve from registry
    const payment = context.getResource('payments', paymentId);

    if (!payment) {
      return {
        status: 404,
        body: {
          code: 'NOT_FOUND',
          message: 'Payment not found',
          payment_id: paymentId,
        },
      };
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { data: payment },
    };
  },
};
