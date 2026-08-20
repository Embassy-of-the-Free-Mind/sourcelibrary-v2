import { describe, it, expect } from 'vitest';
import { hasLocalizedEdition } from '@/lib/localized';

/**
 * The rule: a localized URL is a PROMISE that the page is in that language.
 * `/es/book/<slug>` exists only for a book with Spanish PAGES; everything else
 * 307s to the English page. This helper is the gate, and its three-valued
 * return is the whole point — see the null cases.
 */
describe('hasLocalizedEdition', () => {
  it('is always true for English — the root is the English site', () => {
    expect(hasLocalizedEdition({}, 'en')).toBe(true);
    expect(hasLocalizedEdition({ pages_translated_es: 0 }, 'en')).toBe(true);
  });

  it('is true only when the book has PAGES in that language', () => {
    expect(hasLocalizedEdition({ pages_translated_es: 445 }, 'es')).toBe(true);
    expect(hasLocalizedEdition({ pages_translated_es: 1 }, 'es')).toBe(true);
    expect(hasLocalizedEdition({ pages_translated_es: 0 }, 'es')).toBe(false);
  });

  it('a title gloss alone is NOT an edition', () => {
    // 103 books have Spanish text; the gloss is chrome and must not open a URL.
    const glossOnly = { localized: { es: { title: 'Aurora naciente' } } };
    expect(hasLocalizedEdition(glossOnly, 'es')).toBe(null);
  });

  it('returns null — never false — when the payload cannot answer', () => {
    // The counter is a Mongo field; the Supabase catalog fast-path lacks it.
    // Reading that absence as "no Spanish edition" would 307 a genuinely
    // Spanish book to English, and a caller that does `=== false` silently
    // never fires. Both mistakes were made and caught by measurement.
    expect(hasLocalizedEdition({ id: 'x', slug: 'y' }, 'es')).toBe(null);
    expect(hasLocalizedEdition({ id: 'x', slug: 'y' }, 'es')).not.toBe(false);
  });

  it('a projected-but-absent field is an ANSWER at the call site', () => {
    // Call sites that projected the counter explicitly resolve null with
    // `?? false`; this pins the shape they rely on.
    const projectedDoc: Record<string, unknown> = {}; // { _id: 0, pages_translated_es: 1 } over a book with none
    expect(hasLocalizedEdition(projectedDoc, 'es') ?? false).toBe(false);
  });

  it('treats a non-numeric counter as no edition', () => {
    expect(hasLocalizedEdition({ pages_translated_es: null }, 'es')).toBe(false);
    expect(hasLocalizedEdition({ pages_translated_es: '445' }, 'es')).toBe(false);
  });
});
