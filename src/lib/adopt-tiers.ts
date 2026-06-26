import type { Book } from '@/lib/types';

/**
 * Adopt-a-book pricing tiers. Shared by the client amount-selector
 * (AdoptBookPanel) and the server checkout route so the suggested amounts and
 * minimums can never drift apart. All amounts are in euro cents.
 */

export type AdoptTier = 'standard' | 'rare';

export interface AdoptTierConfig {
  minCents: number;          // hard minimum gift
  suggestedCents: number[];  // buttons shown to the donor
  defaultCents: number;      // pre-selected suggestion (the anchor)
}

/** Sanity ceiling so a typo can't create a €1,000,000 charge. */
export const ADOPT_MAX_CENTS = 100_000_00; // €100,000

export const ADOPT_TIERS: Record<AdoptTier, AdoptTierConfig> = {
  // €250 floor, anchored at €500
  standard: { minCents: 250_00, suggestedCents: [250_00, 500_00, 1000_00], defaultCents: 500_00 },
  // rare/notable books and manuscripts — €500 floor, anchored at €1,000
  rare: { minCents: 500_00, suggestedCents: [500_00, 1000_00, 2500_00], defaultCents: 1000_00 },
};

/** A book is "rare" if explicitly flagged, otherwise manuscripts default to rare. */
export function resolveAdoptTier(book: Pick<Book, 'adopt_tier' | 'resource_type'>): AdoptTier {
  if (book.adopt_tier === 'rare') return 'rare';
  if (book.adopt_tier === 'standard') return 'standard';
  return book.resource_type === 'manuscript' ? 'rare' : 'standard';
}

/** "€1,250" — no decimals, thousands separator. */
export function formatEuros(cents: number): string {
  return `€${Math.round(cents / 100).toLocaleString('en-IE')}`;
}
