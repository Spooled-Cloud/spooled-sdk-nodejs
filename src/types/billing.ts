/**
 * Billing Types
 */

/** Billing status returned by `GET /api/v1/billing/status` */
export interface BillingStatus {
  /** Current plan tier (free/starter/pro/enterprise, etc.) */
  planTier: string;

  /** Stripe subscription ID (if subscribed) */
  stripeSubscriptionId?: string | null;

  /** Stripe subscription status (active, past_due, canceled, etc.) */
  stripeSubscriptionStatus?: string | null;

  /** Current billing period end (ISO8601) */
  stripeCurrentPeriodEnd?: string | null;

  /** Whether the subscription will cancel at period end */
  stripeCancelAtPeriodEnd?: boolean | null;

  /** Whether the org has a Stripe customer object */
  hasStripeCustomer: boolean;
}

export interface CreateBillingPortalParams {
  /** Return URL after exiting the portal */
  returnUrl: string;
}

export interface CreateBillingPortalResponse {
  /** URL to redirect the user to */
  url: string;
}
