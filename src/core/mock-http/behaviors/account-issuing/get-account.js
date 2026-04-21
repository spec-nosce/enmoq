module.exports = {
  name: 'get-account',
  method: 'GET',
  urlPattern: '.*/accounts/([a-zA-Z0-9]+)$',

  handler(request, context) {
    const accountId = request.urlParams[0];

    if (!accountId) {
      return {
        status: 400,
        body: {
          code: 'INVALID_REQUEST',
          message: 'Account ID is required',
        },
      };
    }

    // Retrieve from registry
    const account = context.getResource('accounts', accountId);

    if (!account) {
      return {
        status: 404,
        body: {
          code: 'NOT_FOUND',
          message: 'Account not found',
          account_id: accountId,
        },
      };
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { data: account },
    };
  },
};
