module.exports = {
  name: 'get-account-lookup',
  method: 'GET',
  urlPattern: '.*/account-lookups/([a-zA-Z0-9]+)$',

  handler(request, context) {
    const lookupId = request.urlParams[0];

    if (!lookupId) {
      return {
        status: 400,
        body: {
          code: 'INVALID_REQUEST',
          message: 'Lookup ID is required',
        },
      };
    }

    // Check for state progression (new → pending → completed)
    const state = context.getState(lookupId);

    if (state) {
      // Progress through statuses on each check
      const statusSequence = ['pending', 'completed'];
      const nextStatus = context.getNextStatus(lookupId, statusSequence);

      // Retrieve from registry and update status
      const lookup = context.getResource('lookups', lookupId);

      if (lookup) {
        lookup.status = nextStatus;
        if (nextStatus === 'completed') {
          lookup.completed_at = context.timestamp();
        }
        context.storeResource('lookups', lookupId, lookup);

        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: { data: lookup },
        };
      }
    }

    // Retrieve from registry
    const lookup = context.getResource('lookups', lookupId);

    if (!lookup) {
      return {
        status: 404,
        body: {
          code: 'NOT_FOUND',
          message: 'Lookup not found',
          lookup_id: lookupId,
        },
      };
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { data: lookup },
    };
  },
};
