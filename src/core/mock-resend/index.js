/**
 * MockResend — drop-in replacement for the `resend` npm package.
 *
 * Mirrors the real Resend SDK API surface used by the codebase:
 *   const { Resend } = require('resend');
 *   const resend = new Resend(apiKey);
 *   const { data, error } = await resend.emails.send(payload);
 *
 * Test utilities are exposed via MockResend static methods and via the
 * top-level `mockResend` export, following the same pattern as mock-http.
 */

// ---------------------------------------------------------------------------
// Singleton store — shared across all Resend instances within a test run
// ---------------------------------------------------------------------------

function getStore() {
  if (!global.__mockResendStore) {
    global.__mockResendStore = {
      sentEmails: [],    // Array of sent payloads, in order
      nextError: null,   // If set, the next send() returns this as `error`
      nextData: null,    // If set, the next send() returns this as `data` (overrides default)
    };
  }
  return global.__mockResendStore;
}

// ---------------------------------------------------------------------------
// MockResend class
// ---------------------------------------------------------------------------

class MockResend {
  /**
   * @param {string} [apiKey] - Ignored in tests; accepted for API compatibility.
   */
  constructor(apiKey) {
    this._apiKey = apiKey;

    const self = this;
    this.emails = {
      /**
       * Record an outgoing email and return a mock send result.
       * @param {object} payload
       * @returns {Promise<{ data: object|null, error: object|null }>}
       */
      async send(payload) {
        const store = getStore();

        // Record the call
        store.sentEmails.push({
          ...payload,
          _sentAt: new Date().toISOString(),
        });

        // Return configured error if one was queued
        if (store.nextError) {
          const error = store.nextError;
          store.nextError = null;
          return { data: null, error };
        }

        // Return configured data or a sensible default
        const data = store.nextData || { id: `mock_email_${store.sentEmails.length}` };
        store.nextData = null;
        return { data, error: null };
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Static test-utility API
  // ---------------------------------------------------------------------------

  /**
   * All emails recorded since the last clearEmails() / resetResend() call.
   * @returns {object[]}
   */
  static getSentEmails() {
    return getStore().sentEmails;
  }

  /**
   * The most recently sent email payload, or null.
   * @returns {object|null}
   */
  static getLastEmail() {
    const emails = getStore().sentEmails;
    return emails.length ? emails[emails.length - 1] : null;
  }

  /**
   * Clear recorded emails.
   */
  static clearEmails() {
    getStore().sentEmails = [];
  }

  /**
   * Make the next send() call return an error instead of data.
   * @param {object|string} error
   */
  static simulateError(error) {
    getStore().nextError = typeof error === 'string' ? { message: error } : error;
  }

  /**
   * Override the data returned by the next send() call.
   * @param {object} data
   */
  static mockNextResponse(data) {
    getStore().nextData = data;
  }

  /**
   * Full reset — clear sent emails, pending error/data, and the global store.
   */
  static reset() {
    global.__mockResendStore = null;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// Named export mirrors the real package: const { Resend } = require('resend')
module.exports.Resend = MockResend;

// Default export for consumers who do: const Resend = require('resend')
module.exports.default = MockResend;

// Testing utilities namespace — matches the mock-http `mockHttp` pattern
module.exports.mockResend = {
  getSentEmails: () => MockResend.getSentEmails(),
  getLastEmail: () => MockResend.getLastEmail(),
  clearEmails: () => MockResend.clearEmails(),
  simulateError: (err) => MockResend.simulateError(err),
  mockNextResponse: (data) => MockResend.mockNextResponse(data),
  reset: () => MockResend.reset(),
};
