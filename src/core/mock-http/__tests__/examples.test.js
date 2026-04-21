// Example test demonstrating the mock HTTP system
// This file shows common testing patterns and usage

const HttpRequest = require('@app-core/http-request');

// Enable mock mode for this test file
process.env.USE_MOCK_HTTP_REQUEST = 'true';

describe('Mock HTTP Request System - Examples', () => {
  const { mockHttp } = HttpRequest;

  beforeEach(() => {
    // Clear all state between tests
    mockHttp.clearAll();
  });

  describe('Account Creation Flow', () => {
    it('should create account with test issuer', async () => {
      const response = await HttpRequest.post('https://accounts.example.com/accounts', {
        entity_type: 'individual',
        issuer_code: 'TESTBANK',
        issuer_name: 'Test Bank',
        kyc: {
          first_name: 'John',
          last_name: 'Doe',
        },
      });

      expect(response.data.data.status).toBe('active');
      expect(response.data.data.entity_type).toBe('individual');
      expect(response.data.data.kyc.first_name).toBe('John');

      // Verify stored in registry
      const accountId = response.data.data.id;
      const stored = mockHttp.resourceRegistry.get('accounts', accountId);
      expect(stored).toBeDefined();
      expect(stored.status).toBe('active');
    });

    it('should return pending status for PENDING_BANK', async () => {
      const response = await HttpRequest.post('https://accounts.example.com/accounts', {
        entity_type: 'individual',
        issuer_code: 'PENDING_BANK',
        kyc: { first_name: 'Jane', last_name: 'Smith' },
      });

      expect(response.data.data.status).toBe('pending');
    });

    it('should error for ERROR_BANK', async () => {
      await expect(
        HttpRequest.post('https://accounts.example.com/accounts', {
          entity_type: 'individual',
          issuer_code: 'ERROR_BANK',
          kyc: { first_name: 'Bob', last_name: 'Wilson' },
        })
      ).rejects.toMatchObject({
        response: {
          status: 500,
          data: {
            code: 'PROVIDER_ERROR',
          },
        },
      });
    });

    it('should validate required fields', async () => {
      await expect(
        HttpRequest.post('https://accounts.example.com/accounts', {
          entity_type: 'individual',
          issuer_code: 'TESTBANK',
          // Missing kyc
        })
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            code: 'INVALID_KYC',
          },
        },
      });
    });
  });

  describe('Create → Lookup Flow', () => {
    it('should retrieve created account', async () => {
      // Create account
      const created = await HttpRequest.post('https://accounts.example.com/accounts', {
        entity_type: 'business',
        issuer_code: 'TESTBANK',
        kyc: {
          first_name: 'Alice',
          last_name: 'Johnson',
          business_name: 'Acme Corp',
        },
      });

      const accountId = created.data.data.id;

      // Retrieve account
      const retrieved = await HttpRequest.get(`https://accounts.example.com/accounts/${accountId}`);

      // Should return same data
      expect(retrieved.data.data.id).toBe(accountId);
      expect(retrieved.data.data.status).toBe('active');
      expect(retrieved.data.data.kyc.business_name).toBe('Acme Corp');
    });

    it('should return 404 for non-existent account', async () => {
      await expect(
        HttpRequest.get('https://accounts.example.com/accounts/01NONEXISTENT')
      ).rejects.toMatchObject({
        response: {
          status: 404,
          data: {
            code: 'NOT_FOUND',
          },
        },
      });
    });
  });

  describe('Account Lookup with Magic Values', () => {
    it('should lookup magic account successfully', async () => {
      const response = await HttpRequest.post('https://accounts.example.com/account-lookups', {
        details: {
          account_number: '1234567890', // Magic test account
        },
        issuer: {
          code: 'TESTBANK',
          name: 'Test Bank',
        },
      });

      expect(response.data.data.status).toBe('completed');
      expect(response.data.data.details.name).toBe('John Doe');
      expect(response.data.data.details.account_number).toBe('1234567890');
    });

    it('should handle account not found', async () => {
      const response = await HttpRequest.post('https://accounts.example.com/account-lookups', {
        details: {
          account_number: '0000000000', // Magic "not found" account
        },
        issuer: {
          code: 'TESTBANK',
          name: 'Test Bank',
        },
      });

      expect(response.data.data.status).toBe('failed');
      expect(response.data.data.error_code).toBe('NOT_FOUND');
    });

    it('should handle service unavailable', async () => {
      await expect(
        HttpRequest.post('https://accounts.example.com/account-lookups', {
          details: {
            account_number: '8888888888', // Magic "service unavailable" account
          },
          issuer: {
            code: 'TESTBANK',
            name: 'Test Bank',
          },
        })
      ).rejects.toMatchObject({
        response: {
          status: 503,
          data: {
            code: 'SERVICE_UNAVAILABLE',
          },
        },
      });
    });
  });

  describe('Payment Processing with Test Cards', () => {
    it('should process successful payment with Visa', async () => {
      const response = await HttpRequest.post('https://payouts.example.com/payments', {
        amount: 1000,
        currency: 'USD',
        counterparty: {
          card_number: '4111111111111111', // Visa success card
        },
        unique_reference: 'payment_test_001',
      });

      expect(response.data.data.status).toBe('pending');
      expect(response.data.data.amount).toBe(1000);
      expect(response.data.data.id).toBe('payment_test_001');

      // Verify in registry
      const payment = mockHttp.resourceRegistry.get('payments', 'payment_test_001');
      expect(payment.counterparty.card_network).toBe('visa');
    });

    it('should decline payment for insufficient funds card', async () => {
      await expect(
        HttpRequest.post('https://payouts.example.com/payments', {
          amount: 500,
          currency: 'USD',
          counterparty: {
            card_number: '4000000000000002', // Insufficient funds card
          },
        })
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            status: 'declined',
            status_reason: 'insufficient_funds',
          },
        },
      });
    });

    it('should handle processing error card', async () => {
      await expect(
        HttpRequest.post('https://payouts.example.com/payments', {
          amount: 750,
          currency: 'USD',
          counterparty: {
            card_number: '4000000000000119', // Processing error card
          },
        })
      ).rejects.toMatchObject({
        response: {
          status: 500,
          data: {
            status: 'failed',
            status_reason: 'processing_error',
          },
        },
      });
    });

    it('should validate amount limits', async () => {
      // Amount too high
      await expect(
        HttpRequest.post('https://payouts.example.com/payments', {
          amount: 2000000,
          currency: 'USD',
          counterparty: {
            card_number: '4111111111111111',
          },
        })
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            code: 'AMOUNT_TOO_HIGH',
          },
        },
      });

      // Amount too low
      await expect(
        HttpRequest.post('https://payouts.example.com/payments', {
          amount: 50,
          currency: 'USD',
          counterparty: {
            card_number: '4111111111111111',
          },
        })
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            code: 'AMOUNT_TOO_LOW',
          },
        },
      });
    });

    it('should handle duplicate reference', async () => {
      await expect(
        HttpRequest.post('https://payouts.example.com/payments', {
          amount: 1000,
          currency: 'USD',
          counterparty: {
            card_number: '4111111111111111',
          },
          unique_reference: 'DUP_payment_001', // Magic duplicate reference pattern
        })
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: {
            code: 'DUPLICATE_REFERENCE',
          },
        },
      });
    });
  });

  describe('State Progression', () => {
    it('should progress payment status on repeated checks', async () => {
      // Create payment
      const created = await HttpRequest.post('https://payouts.example.com/payments', {
        amount: 1000,
        currency: 'USD',
        counterparty: {
          card_number: '5555555555554444', // Mastercard success
        },
        unique_reference: 'payment_progression',
      });

      expect(created.data.data.status).toBe('pending');

      // First check → pending
      const check1 = await HttpRequest.get(
        'https://payouts.example.com/payments/payment_progression'
      );
      expect(check1.data.data.status).toBe('pending');

      // Second check → processing
      const check2 = await HttpRequest.get(
        'https://payouts.example.com/payments/payment_progression'
      );
      expect(check2.data.data.status).toBe('processing');

      // Third check → completed
      const check3 = await HttpRequest.get(
        'https://payouts.example.com/payments/payment_progression'
      );
      expect(check3.data.data.status).toBe('completed');
      expect(check3.data.data.completed_at).toBeDefined();

      // Fourth check → still completed
      const check4 = await HttpRequest.get(
        'https://payouts.example.com/payments/payment_progression'
      );
      expect(check4.data.data.status).toBe('completed');
    });
  });

  describe('Request History', () => {
    it('should track all requests', async () => {
      // Make multiple requests
      await HttpRequest.post('https://accounts.example.com/accounts', {
        entity_type: 'individual',
        issuer_code: 'TESTBANK',
        kyc: { first_name: 'Test' },
      });

      await HttpRequest.post('https://payouts.example.com/payments', {
        amount: 1000,
        currency: 'USD',
        counterparty: { card_number: '4111111111111111' },
      });

      const history = mockHttp.getRequestHistory();
      expect(history).toHaveLength(2);

      const lastRequest = mockHttp.getLastRequest();
      expect(lastRequest.url).toContain('/payments');
      expect(lastRequest.method).toBe('POST');
      expect(lastRequest.data.amount).toBe(1000);
    });
  });

  describe('Initialized Client', () => {
    it('should work with initialized client', async () => {
      const client = HttpRequest.initialize({
        baseUrl: 'https://api.example.com',
      });

      const response = await client.post('/accounts', {
        entity_type: 'individual',
        issuer_code: 'TESTBANK',
        kyc: { first_name: 'Client', last_name: 'Test' },
      });

      expect(response.data.data.status).toBe('active');

      const history = mockHttp.getRequestHistory();
      expect(history[0].url).toBe('https://api.example.com/accounts');
    });
  });
});
