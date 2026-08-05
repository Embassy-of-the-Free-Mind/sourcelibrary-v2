/**
 * The giving handoff: amount + frequency chosen on our page, carried into the
 * payment destination so the donor never types a number twice.
 *
 * Why a handoff at all, rather than an on-site card form: the two routes are two
 * different legal entities with different receipting, and neither is us. US
 * donors give through the Netherland-America Foundation (NAF), which issues the
 * 501(c)(3) receipt; everyone else gives to Stichting het Wereldhart (Cultural
 * ANBI) through the Embassy's Stripe, where Stripe issues the receipt. Source
 * Library holds no Stripe account of its own — `STRIPE_SECRET_KEY` is absent
 * from Vercel production, so every in-repo Checkout route (membership, adopt-a-
 * book) answers 503 today. Processing gifts here would change who receives the
 * money and who issues the receipt, which is a decision for the Embassy, not a
 * frontend one.
 *
 * What we CAN do is make the handoff carry state, which is most of the win. Both
 * destinations were tested by hand on 2026-08-05 and both accept a pre-filled
 * amount, so "click Support → tap €25 → pay with Apple Pay" is two taps and no
 * typing. See PARAM NOTES on each route below.
 */

export type GiveFrequency = 'once' | 'monthly';
export type GiveRoute = 'us' | 'international';

/**
 * NAF's DonorPerfect form, Source Library designation.
 *
 * NAF runs TWO forms for the Embassy (see thenaf.org/friends-funds/
 * embassy-of-the-free-mind/). `.../give/naf/embassyofthefreemind` is GENERAL
 * Embassy support; this one is earmarked for Source Library. A donor arriving
 * from sourcelibrary.org means to fund Source Library — don't "simplify" the two
 * into the general form.
 *
 * PARAM NOTES (verified by hand, 2026-08-05):
 *   ?amount=25          selects the $25 preset, or pre-fills the custom field
 *                       when the value isn't one of the form's presets. WHOLE
 *                       DOLLARS, not cents — `amount=2500` would ask for $2,500.
 *   ?frequency=monthly  flips the form's One-time/Monthly toggle. Verified alone,
 *                       without the `recurring=true` that was tried alongside it.
 * The form carries two different preset ladders (one-time starts at $100,
 * monthly at $25), which is why our own ladder below is the one that matters —
 * an amount we send always wins over whichever ladder the form would show.
 */
const NAF_DONORPERFECT_URL =
  'https://form-renderer-app.donorperfect.io/give/embassyofthefreemindsourcelibrary';

/**
 * The Embassy's Stripe payment link (Stichting het Wereldhart).
 *
 * PARAM NOTES (verified by hand, 2026-08-05):
 *   ?__prefilled_amount=2500   pre-fills €25.00 and shows a "Change amount"
 *                              control. CENTS, unlike DonorPerfect above — the
 *                              two encodings are the reason this module exists
 *                              rather than a template string at each call site.
 *
 * The double underscore marks this as Stripe-internal: it is not in the Payment
 * Links docs, which list only `prefilled_email`, `prefilled_promo_code` and
 * `client_reference_id`. It works today and degrades safely — if Stripe drops
 * it, the donor lands on the €0.00 field and types an amount, which is exactly
 * today's behaviour. Never build anything that assumes the amount ARRIVED.
 *
 * This link is ONE-TIME ONLY. `giveDestination` therefore refuses to pretend
 * otherwise (see `supportsFrequency`); unlocking monthly here needs a recurring
 * payment link created on the Embassy's Stripe account, not a code change.
 */
const EFM_STRIPE_URL = 'https://donate.stripe.com/9B67sLbO1bOg2GxfxP9fW08';

/**
 * Suggested amounts, in the route's own currency units (whole dollars/euros).
 *
 * Deliberately lower than the destinations' own ladders, which start at $100
 * one-time. An anchor is the single strongest determinant of gift size, and a
 * $100 floor on a general reading audience reads as "not for you" — the Internet
 * Archive anchors at $10 against a comparable audience. The ladder still runs up
 * to 250 so a donor who wants to give more doesn't have to reach for "custom".
 *
 * The default is the SECOND rung, not the first: the top of the list is the
 * cheapest thing to click, and anchoring one step above it lifts the median
 * without making the small gift feel unwelcome.
 */
export const GIVE_PRESETS: Record<GiveFrequency, number[]> = {
  once: [10, 25, 50, 100, 250],
  monthly: [5, 10, 25, 50, 100],
};

export const GIVE_DEFAULT_AMOUNT: Record<GiveFrequency, number> = {
  once: 25,
  monthly: 10,
};

/** Below this a card fee eats most of the gift; above it, route to a human. */
export const GIVE_MIN_AMOUNT = 1;
export const GIVE_MAX_AMOUNT = 50_000;

export const GIVE_CURRENCY: Record<GiveRoute, { code: string; symbol: string }> = {
  us: { code: 'USD', symbol: '$' },
  international: { code: 'EUR', symbol: '€' },
};

/**
 * Which frequencies a route can actually honour.
 *
 * Not cosmetic: sending a monthly donor to a one-time payment link takes their
 * money once and silently drops the recurring intent, which is worse than not
 * offering monthly at all.
 */
export function supportsFrequency(route: GiveRoute, frequency: GiveFrequency): boolean {
  if (frequency === 'once') return true;
  return route === 'us';
}

export interface GiveDestination {
  /** Where to send the donor. */
  url: string;
  /** `channel` for the donate_click event — matches the existing /support values. */
  channel: 'naf_donorperfect' | 'efm_stripe';
}

/**
 * Build the payment URL for a chosen amount and frequency.
 *
 * Throws on an amount outside [GIVE_MIN_AMOUNT, GIVE_MAX_AMOUNT] or a
 * non-integer, rather than silently clamping: a clamped amount would send the
 * donor to a payment page showing a number they did not choose, and they would
 * have no way to tell that we changed it. The caller validates the input field
 * and never reaches this with a bad value.
 */
export function giveDestination(
  route: GiveRoute,
  amount: number,
  frequency: GiveFrequency,
): GiveDestination {
  if (!Number.isInteger(amount) || amount < GIVE_MIN_AMOUNT || amount > GIVE_MAX_AMOUNT) {
    throw new RangeError(
      `give amount must be a whole number between ${GIVE_MIN_AMOUNT} and ${GIVE_MAX_AMOUNT}, got ${amount}`,
    );
  }

  if (route === 'us') {
    const params = new URLSearchParams({ amount: String(amount) });
    // Only send the frequency param when it changes something. The form defaults
    // to one-time, and an explicit `frequency=once` is an untested value.
    if (frequency === 'monthly') params.set('frequency', 'monthly');
    return { url: `${NAF_DONORPERFECT_URL}?${params}`, channel: 'naf_donorperfect' };
  }

  // Stripe wants the minor unit. No frequency param exists — a monthly choice
  // cannot reach this link, which is what `supportsFrequency` exists to prevent
  // the UI from offering.
  const params = new URLSearchParams({ __prefilled_amount: String(amount * 100) });
  return { url: `${EFM_STRIPE_URL}?${params}`, channel: 'efm_stripe' };
}

/**
 * Default route from the visitor's country.
 *
 * US donors are the ones with something to lose by guessing wrong — the 501(c)(3)
 * deduction only exists on the NAF route — so an unknown country defaults to
 * international, where the gift is still receipted and nothing is forfeited. The
 * donor can switch either way; this only decides which button is primary.
 */
export function defaultRouteForCountry(country: string | null | undefined): GiveRoute {
  return country?.toUpperCase() === 'US' ? 'us' : 'international';
}

/** "$25" / "€25" — no decimals, thousands separator. */
export function formatGiveAmount(route: GiveRoute, amount: number): string {
  return `${GIVE_CURRENCY[route].symbol}${amount.toLocaleString('en-US')}`;
}
