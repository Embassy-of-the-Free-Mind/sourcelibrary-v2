import { describe, it, expect } from 'vitest';
import {
  giveDestination,
  supportsFrequency,
  defaultRouteForCountry,
  formatGiveAmount,
  GIVE_PRESETS,
  GIVE_DEFAULT_AMOUNT,
  GIVE_MIN_AMOUNT,
  GIVE_MAX_AMOUNT,
} from '@/lib/give-routes';

/**
 * Guards the handoff that carries the donor's chosen amount into the payment
 * page. Exercises the real builder — none of these pass if the encoding is
 * wrong, which is the whole point (CLAUDE.md: "a test that greps source is not
 * a guard").
 *
 * The failure this exists to catch is silent and expensive: the two destinations
 * take the amount in DIFFERENT UNITS. DonorPerfect wants whole dollars,
 * Stripe wants cents. Swap them and a donor who picks $25 is shown a bill for
 * $2,500 — or, in the other direction, €0.25. Both render as a perfectly normal
 * payment page, so nothing downstream can tell.
 *
 * The param names were verified by hand against the live destinations on
 * 2026-08-05 (see PARAM NOTES in src/lib/give-routes.ts). This file pins the
 * ENCODING, not their continued existence upstream — if Stripe drops
 * `__prefilled_amount` the donor lands on an empty field and types, which is
 * what happened before this feature.
 */

describe('giveDestination — unit encoding per destination', () => {
  it('sends WHOLE DOLLARS to DonorPerfect', () => {
    const { url } = giveDestination('us', 25, 'once');
    const amount = new URL(url).searchParams.get('amount');
    expect(amount).toBe('25');
  });

  it('sends CENTS to the Stripe payment link', () => {
    const { url } = giveDestination('international', 25, 'once');
    const amount = new URL(url).searchParams.get('__prefilled_amount');
    expect(amount).toBe('2500');
  });

  // The regression that would cost the most: the two encodings crossed. Stated
  // as its own case so a failure names the actual hazard.
  it('never sends a cents value to DonorPerfect', () => {
    const { url } = giveDestination('us', 100, 'once');
    expect(new URL(url).searchParams.get('amount')).not.toBe('10000');
  });

  it.each([1, 5, 10, 25, 50, 100, 250, 1000])('round-trips %i without drift', (amount) => {
    expect(new URL(giveDestination('us', amount, 'once').url).searchParams.get('amount'))
      .toBe(String(amount));
    expect(new URL(giveDestination('international', amount, 'once').url).searchParams.get('__prefilled_amount'))
      .toBe(String(amount * 100));
  });
});

describe('giveDestination — frequency', () => {
  it('flips the DonorPerfect toggle for a monthly gift', () => {
    const { url } = giveDestination('us', 10, 'monthly');
    expect(new URL(url).searchParams.get('frequency')).toBe('monthly');
  });

  it('omits the frequency param for a one-time gift rather than sending an untested value', () => {
    const { url } = giveDestination('us', 10, 'once');
    expect(new URL(url).searchParams.has('frequency')).toBe(false);
  });
});

describe('giveDestination — routing', () => {
  it('points the US route at the Source Library designation, not the general Embassy fund', () => {
    const { url, channel } = giveDestination('us', 25, 'once');
    // NAF runs two forms for the Embassy; `.../give/naf/embassyofthefreemind` is
    // the general one and would misdirect a gift made from sourcelibrary.org.
    expect(url).toContain('/give/embassyofthefreemindsourcelibrary');
    expect(url).not.toContain('/give/naf/embassyofthefreemind?');
    expect(channel).toBe('naf_donorperfect');
  });

  it('points the international route at the Embassy Stripe link', () => {
    const { url, channel } = giveDestination('international', 25, 'once');
    expect(url.startsWith('https://donate.stripe.com/')).toBe(true);
    expect(channel).toBe('efm_stripe');
  });

  it('emits channels that match the values /support already logs', () => {
    // These strings are the join key for every donate_click query written before
    // this feature existed; renaming one silently splits the series in two.
    expect(giveDestination('us', 25, 'once').channel).toBe('naf_donorperfect');
    expect(giveDestination('international', 25, 'once').channel).toBe('efm_stripe');
  });
});

describe('giveDestination — refuses an amount it cannot honour', () => {
  // Throwing rather than clamping is deliberate: a clamped amount sends the
  // donor to a payment page showing a number they did not choose, with no way to
  // tell that we changed it.
  it.each([0, -5, 0.5, 25.5, NaN, Infinity, GIVE_MAX_AMOUNT + 1])('rejects %p', (amount) => {
    expect(() => giveDestination('us', amount as number, 'once')).toThrow(RangeError);
    expect(() => giveDestination('international', amount as number, 'once')).toThrow(RangeError);
  });

  it('accepts the exact boundaries', () => {
    expect(() => giveDestination('us', GIVE_MIN_AMOUNT, 'once')).not.toThrow();
    expect(() => giveDestination('us', GIVE_MAX_AMOUNT, 'once')).not.toThrow();
  });
});

describe('supportsFrequency', () => {
  it('allows one-time on both routes', () => {
    expect(supportsFrequency('us', 'once')).toBe(true);
    expect(supportsFrequency('international', 'once')).toBe(true);
  });

  // The Embassy's Stripe link is a one-time payment link. Offering monthly there
  // would take the gift once and drop the recurring intent with no error — worse
  // than not offering it. Unlocking this needs a recurring payment link created
  // on the Embassy's Stripe account, at which point this expectation flips.
  it('refuses monthly on the international route', () => {
    expect(supportsFrequency('international', 'monthly')).toBe(false);
  });

  it('allows monthly on the US route, which DonorPerfect honours', () => {
    expect(supportsFrequency('us', 'monthly')).toBe(true);
  });
});

describe('defaultRouteForCountry', () => {
  it('routes US visitors to the tax-deductible form', () => {
    expect(defaultRouteForCountry('US')).toBe('us');
    expect(defaultRouteForCountry('us')).toBe('us');
  });

  it.each(['NL', 'GB', 'DE', 'AR', 'JP'])('routes %s internationally', (country) => {
    expect(defaultRouteForCountry(country)).toBe('international');
  });

  // Unknown country is the local/non-Vercel case and must not throw or guess US:
  // only the NAF route carries a deduction, so a wrong US default hands someone
  // a US tax form they cannot use, while a wrong international default forfeits
  // nothing they were owed.
  it.each([null, undefined, ''])('defaults %p to international', (country) => {
    expect(defaultRouteForCountry(country)).toBe('international');
  });
});

describe('preset ladders', () => {
  it('anchors on the second rung, not the cheapest', () => {
    for (const frequency of ['once', 'monthly'] as const) {
      const presets = GIVE_PRESETS[frequency];
      expect(presets).toContain(GIVE_DEFAULT_AMOUNT[frequency]);
      expect(GIVE_DEFAULT_AMOUNT[frequency]).toBe(presets[1]);
    }
  });

  it('keeps every rung inside the range the builder will accept', () => {
    for (const presets of Object.values(GIVE_PRESETS)) {
      for (const value of presets) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(GIVE_MIN_AMOUNT);
        expect(value).toBeLessThanOrEqual(GIVE_MAX_AMOUNT);
        expect(() => giveDestination('us', value, 'once')).not.toThrow();
      }
    }
  });

  it('rises monotonically, so the ladder reads as a ladder', () => {
    for (const presets of Object.values(GIVE_PRESETS)) {
      expect([...presets].sort((a, b) => a - b)).toEqual(presets);
    }
  });

  // The destinations' own ladders start at $100 one-time. Ours exists to anchor
  // lower than that for a general reading audience; if the entry rung ever
  // drifts back up, the reason for this module has quietly gone away.
  it('opens below the destination forms own $100 entry rung', () => {
    expect(GIVE_PRESETS.once[0]).toBeLessThan(100);
    expect(GIVE_PRESETS.monthly[0]).toBeLessThan(100);
  });
});

describe('formatGiveAmount', () => {
  it('uses the currency the route actually charges in', () => {
    expect(formatGiveAmount('us', 25)).toBe('$25');
    expect(formatGiveAmount('international', 25)).toBe('€25');
  });

  it('groups thousands', () => {
    expect(formatGiveAmount('us', 1000)).toBe('$1,000');
  });
});
