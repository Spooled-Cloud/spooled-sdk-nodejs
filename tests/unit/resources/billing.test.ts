/**
 * Billing Resource tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { SpooledClient } from '../../../src/client.js';

const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe('BillingResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123' });

  describe('getStatus', () => {
    it('should get billing status', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/billing/status', () => {
          return HttpResponse.json({
            plan_tier: 'pro',
            stripe_subscription_id: 'sub_123',
            stripe_subscription_status: 'active',
            stripe_current_period_end: '2025-01-01T00:00:00Z',
            stripe_cancel_at_period_end: false,
            has_stripe_customer: true,
          });
        })
      );

      const client = createClient();
      const status = await client.billing.getStatus();

      expect(status.planTier).toBe('pro');
      expect(status.stripeSubscriptionId).toBe('sub_123');
      expect(status.stripeSubscriptionStatus).toBe('active');
      expect(status.stripeCurrentPeriodEnd).toBe('2025-01-01T00:00:00Z');
      expect(status.stripeCancelAtPeriodEnd).toBe(false);
      expect(status.hasStripeCustomer).toBe(true);
    });

    it('should handle org without Stripe customer', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/billing/status', () => {
          return HttpResponse.json({
            plan_tier: 'free',
            stripe_subscription_id: null,
            stripe_subscription_status: null,
            stripe_current_period_end: null,
            stripe_cancel_at_period_end: null,
            has_stripe_customer: false,
          });
        })
      );

      const client = createClient();
      const status = await client.billing.getStatus();

      expect(status.planTier).toBe('free');
      expect(status.hasStripeCustomer).toBe(false);
    });
  });

  describe('createPortal', () => {
    it('should create a billing portal session', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/billing/portal', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({ url: 'https://billing.stripe.com/session/abc' });
        })
      );

      const client = createClient();
      const result = await client.billing.createPortal({
        returnUrl: 'https://spooled.cloud/dashboard/billing',
      });

      expect(receivedBody.return_url).toBe('https://spooled.cloud/dashboard/billing');
      expect(result.url).toBe('https://billing.stripe.com/session/abc');
    });
  });
});
