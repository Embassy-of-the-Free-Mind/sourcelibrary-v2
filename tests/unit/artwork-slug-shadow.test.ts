import { describe, it, expect } from 'vitest';
import { pickArtworkRecord } from '@/lib/artwork-slug';

/**
 * The real records that were dead in production: a dedup sweep hid the `art-`
 * prefixed twin, and `/artwork/<slug>` picked the hidden one and 404'd while
 * the visible canonical sat beside it. Mongo returns $in matches in no
 * guaranteed order, so this is about deliberate precedence, not luck — each
 * case is asserted against BOTH input orderings.
 */

const both = <T,>(a: T, b: T): T[][] => [[a, b], [b, a]];

describe('pickArtworkRecord', () => {
  it('prefers the visible canonical over a hidden art- twin, in either order', () => {
    const canonical = { slug: 'bembine-table-of-isis', visible: true };
    const hiddenTwin = { slug: 'art-bembine-table-of-isis', visible: false };

    for (const candidates of both(canonical, hiddenTwin)) {
      expect(pickArtworkRecord(candidates, 'bembine-table-of-isis')).toBe(candidates.find(c => c.visible));
    }
  });

  it('falls back to the art- variant when only it exists', () => {
    const twin = { slug: 'art-gold', visible: true };
    expect(pickArtworkRecord([twin], 'gold')).toBe(twin);
  });

  it('prefers the exact slug when both are visible', () => {
    const exact = { slug: 'gold', visible: true };
    const twin = { slug: 'art-gold', visible: true };

    for (const candidates of both(exact, twin)) {
      expect(pickArtworkRecord(candidates, 'gold')?.slug).toBe('gold');
    }
  });

  it('still returns a hidden canonical so the caller 404s it', () => {
    // A hidden canonical must NOT fall through to some other record — the
    // hidden-book read-path gate depends on this record reaching isHiddenBook.
    const hidden = { slug: 'form38', visible: false };
    expect(pickArtworkRecord([hidden], 'form38')).toBe(hidden);
  });

  it('treats a missing visible field as visible (legacy records)', () => {
    const legacy = { slug: 'the-death-of-orpheus-1' };
    expect(pickArtworkRecord([legacy], 'the-death-of-orpheus-1')).toBe(legacy);
  });

  it('returns null when nothing matched', () => {
    expect(pickArtworkRecord([], 'nothing-here')).toBeNull();
  });

  it('resolves a visible record addressed by id (favorites link by id)', () => {
    const byId = { id: '69e535a6ad2c589edb9e0779', slug: 'print-garden-of-love-ca-1500', visible: true };
    expect(pickArtworkRecord([byId], '69e535a6ad2c589edb9e0779')).toBe(byId);
  });

  it('prefers a visible slug match over an id match', () => {
    const slugMatch = { id: 'other-id', slug: 'gold', visible: true };
    const idMatch = { id: 'gold', slug: 'something-else', visible: true };
    for (const candidates of both(slugMatch, idMatch)) {
      expect(pickArtworkRecord(candidates, 'gold')).toBe(slugMatch);
    }
  });

  it('a hidden record addressed by id still reaches the caller gate (404, not fall-through)', () => {
    const hidden = { id: 'abc123', slug: 'hidden-work', visible: false };
    expect(pickArtworkRecord([hidden], 'abc123')).toBe(hidden);
  });
});
