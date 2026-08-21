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
    // Counter zero AND the book is known not to be a Spanish original.
    expect(hasLocalizedEdition({ pages_translated_es: 0, language: 'Latin' }, 'es')).toBe(false);
  });

  // A book WRITTEN in Spanish has no pages_translated_es and never will — you do
  // not pivot Spanish into Spanish. Testing the counter alone hid 67 live books
  // (Cogolludo, Landa, Aguilar) from every /es surface while they sat there
  // fully readable. "Has pages in Spanish" is the promise; being written in it
  // keeps that promise as completely as being translated into it.
  it('counts a book WRITTEN in the language as an edition', () => {
    expect(hasLocalizedEdition({ language: 'Spanish' }, 'es')).toBe(true);
    expect(hasLocalizedEdition({ language: 'spanish', pages_translated_es: 0 }, 'es')).toBe(true);
  });

  // These are real stored `books.language` values, read off production, not
  // invented for the assertion. A substring match would claim every one of them.
  it('refuses partly-Spanish editions — the /es promise is the whole page', () => {
    for (const language of ['Spanish / Latin', 'Spanish / French', 'Nahuatl-Spanish', 'Old Spanish']) {
      expect(hasLocalizedEdition({ language, pages_translated_es: 0 }, 'es')).toBe(false);
    }
    // Judeo-Spanish in Hebrew script: Spanish words a Spanish reader cannot read.
    expect(hasLocalizedEdition({ language: 'Spanish in Hebrew characters', pages_translated_es: 0 }, 'es')).toBe(false);
  });

  it('a title gloss alone is NOT an edition', () => {
    // 103 books have Spanish text; the gloss is chrome and must not open a URL.
    const glossOnly = { localized: { es: { title: 'Aurora naciente' } } };
    expect(hasLocalizedEdition(glossOnly, 'es')).toBe(null);
  });

  it('returns null — never false — when the payload cannot answer', () => {
    // A payload can still arrive with neither signal — a hand-built card object,
    // a narrowed API select. (The Supabase catalog USED to be that payload; it
    // carries the counter since #4166, which is why the /es rails now resolve.)
    // Reading that absence as "no Spanish edition" would 307 a genuinely
    // Spanish book to English, and a caller that does `=== false` silently
    // never fires. Both mistakes were made and caught by measurement.
    expect(hasLocalizedEdition({ id: 'x', slug: 'y' }, 'es')).toBe(null);
    expect(hasLocalizedEdition({ id: 'x', slug: 'y' }, 'es')).not.toBe(false);
  });

  it('a projected-but-absent field is an ANSWER at the call site', () => {
    // Call sites that projected BOTH inputs explicitly resolve null with
    // `?? false`; this pins the shape they rely on.
    const projectedDoc: Record<string, unknown> = {}; // both fields asked for, book has neither
    expect(hasLocalizedEdition(projectedDoc, 'es') ?? false).toBe(false);
  });

  // CONTRACT CHANGE, deliberate: a zero counter alone no longer settles it.
  // Once "written in Spanish" counts as an edition, a doc with the counter
  // projected but `language` absent cannot distinguish "not translated" from
  // "Spanish original we cannot see" — and answering false there would 307 a
  // genuinely Spanish book to English, the failure this whole helper exists to
  // prevent. So it says "cannot answer" and the caller re-asks with both fields.
  // Both current call sites project both, so neither is affected.
  it('a zero counter with language unknown is null, not false', () => {
    expect(hasLocalizedEdition({ pages_translated_es: 0 }, 'es')).toBe(null);
    expect(hasLocalizedEdition({ pages_translated_es: null }, 'es')).toBe(null);
  });

  it('treats a non-numeric counter as no edition when the language is known', () => {
    expect(hasLocalizedEdition({ pages_translated_es: null, language: 'Latin' }, 'es')).toBe(false);
    expect(hasLocalizedEdition({ pages_translated_es: '445', language: 'Latin' }, 'es')).toBe(false);
  });
});
