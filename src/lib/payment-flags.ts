// PRIOR ART: src/lib/stripe.ts (exports the client, says nothing about what may charge); NEXT_PUBLIC_ADOPT_ENABLED in src/app/api/adopt/checkout/route.ts (one feature's flag, kept as it is).

/**
 * What the Stripe key is allowed to switch on.
 *
 * A key only means we CAN take money. Before this file it also meant we DO
 * charge for premium downloads, so adding a key for membership would have put
 * a price on downloads that signed-in readers get free, the minute it landed.
 * Each thing that takes money now has its own flag, and all of them need the key.
 *
 * Do not read STRIPE_SECRET_KEY to decide what a reader may do: ask here.
 * tests/unit/payment-flags.test.ts refuses new reads anywhere under src/.
 */

function hasStripeKey(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/** The $5 book and $2 image prices. Off by decision (#8227): "free for all". */
export function downloadChargesEnabled(): boolean {
  return hasStripeKey() && process.env.DOWNLOAD_CHARGES_ENABLED === 'true';
}

/**
 * Paid membership checkout. NEXT_PUBLIC_ so /ficino-society can choose its
 * button in the browser; changing it needs a new build.
 */
export function membershipCheckoutEnabled(): boolean {
  return hasStripeKey() && process.env.NEXT_PUBLIC_MEMBERSHIP_CHECKOUT_ENABLED === 'true';
}
