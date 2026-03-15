import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[stripe] STRIPE_SECRET_KEY not set — payment features disabled');
}

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export const MEMBERSHIP_PRICE = 10000; // $100.00 in cents
export const MEMBERSHIP_CURRENCY = 'usd';
export const MEMBERSHIP_NAME = 'Ficino Society Membership';
export const MEMBERSHIP_DESCRIPTION = 'Annual membership — high-res downloads, prints, API access';
