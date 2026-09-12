import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs script lib, no types
import { pageTextForLang } from '../../scripts/lib/page-embedding-text.mjs';
// @ts-expect-error — .mjs script lib, no types
import { pageFilterForLang } from '../../scripts/lib/embed-book-page-texts.mjs';
// @ts-expect-error — .mjs script lib, no types
import { isNativeEditionLanguage, NATIVE_EDITION_LANGUAGE, embeddableEditionFilter, localizedEditionFilter } from '../../scripts/lib/native-edition-language.mjs';

/**
 * #4146 — a language-keyed row is a PROMISE that the text is that language, so
 * `pageTextForLang` has no blanket OCR fallback. The one exception is a book
 * WRITTEN in the language: its OCR already IS the language, and it has no
 * translation and never will.
 *
 * These are behaviour tests — they call the composer with real page shapes.
 */
describe('native-edition OCR fallback', () => {
  const ocrPage = { ocr: { data: 'Historia de Yucatán, escrita por Diego López de Cogolludo.' } };

  it('does NOT fall back to OCR by default — that would put Latin in the Spanish lane', () => {
    expect(pageTextForLang(ocrPage, 'es')).toBe(null);
  });

  it('DOES read OCR for a native edition', () => {
    const out = pageTextForLang(ocrPage, 'es', { nativeEdition: true });
    expect(out?.text).toContain('Cogolludo');
  });

  it('prefers a real translation over OCR even when native', () => {
    const both = { ocr: { data: 'OCR TEXT' }, translations: { es: { data: 'TRADUCCION' } } };
    expect(pageTextForLang(both, 'es', { nativeEdition: true })?.text).toBe('TRADUCCION');
  });

  it('strips the OCR tag apparatus rather than embedding it', () => {
    // Real OCR shape: the model emits these wrappers on every page.
    const tagged = { ocr: { data: '<scan-quality>good</scan-quality><language>Spanish</language><page-num>101</page-num> y del estilo de sus bocas' } };
    const out = pageTextForLang(tagged, 'es', { nativeEdition: true });
    expect(out?.text).not.toContain('scan-quality');
    expect(out?.text).not.toContain('<');
    expect(out?.text).toContain('y del estilo de sus bocas');
  });

  it('the page filter only admits OCR pages when native', () => {
    expect(JSON.stringify(pageFilterForLang('es'))).not.toContain('ocr.data');
    expect(JSON.stringify(pageFilterForLang('es', { nativeEdition: true }))).toContain('ocr.data');
  });
});

describe('which languages count as native', () => {
  it('accepts Spanish', () => {
    expect(isNativeEditionLanguage('Spanish', 'es')).toBe(true);
    expect(isNativeEditionLanguage('español', 'es')).toBe(true);
  });

  // Real stored `books.language` values, read off production — not invented.
  it('refuses partly-Spanish editions, so half a page cannot make a whole promise', () => {
    for (const l of ['Spanish / Latin', 'Spanish / French', 'Nahuatl-Spanish', 'Old Spanish', 'Spanish in Hebrew characters']) {
      expect(isNativeEditionLanguage(l, 'es')).toBe(false);
    }
  });

  it('has no pattern for a language it has not been taught', () => {
    expect(NATIVE_EDITION_LANGUAGE.fr).toBeUndefined();
    expect(isNativeEditionLanguage('French', 'fr')).toBe(false);
  });
});

/**
 * The WRITER (`embed-page-texts.mjs`) and its AUDIT (`page-texts-coverage.mjs`)
 * must select the same books, or the audit's gap number describes a different
 * corpus than the one the worker would fill. When the worker built this filter
 * inline and the audit selected on `pages_translated_es > 0`, the audit left
 * every native book out of its own denominator and reported CLEAN over the
 * exact state #4146 describes: 68 books and ~19.5K pages of Spanish, visible on
 * /es and unfindable. Measured against production while fixing it — the audit
 * saw 107 books before and 175 after, which is the worker's own count.
 */
describe('embeddableEditionFilter — one selector, two callers', () => {
  it('admits a book translated into the language', () => {
    const f = embeddableEditionFilter('es') as { $or: Record<string, unknown>[] };
    expect(f.$or[0]).toEqual({ pages_translated_es: { $gt: 0 } });
  });

  // These three guards are the difference between "readable in Spanish" and
  // "the store should hold it", and dropping any one of them silently changes
  // what a gap means: without `visible` the audit counts hidden books the
  // worker will never embed (measured: 203 books, 21 phantom gaps, exit 1 — a
  // check that can never go green is one people learn to ignore).
  it('admits a NATIVE book only when it is visible and has OCR', () => {
    const f = embeddableEditionFilter('es') as { $or: Record<string, unknown>[] };
    expect(f.$or[1]).toEqual({
      language: NATIVE_EDITION_LANGUAGE.es,
      visible: true,
      pages_ocr: { $gt: 0 },
    });
  });

  // For a language with no native pattern the counter stays the whole rule —
  // otherwise the clause would read `{ language: undefined }` and match nothing
  // in a way that looks deliberate.
  it('falls back to the counter alone for an untaught language', () => {
    const f = embeddableEditionFilter('fr') as { $or: Record<string, unknown>[] };
    expect(f.$or).toHaveLength(1);
    expect(f.$or[0]).toEqual({ pages_translated_fr: { $gt: 0 } });
  });

  it('is NOT the same rule as the read-side "readable in this language"', () => {
    // localizedEditionFilter answers a different question and leaves visibility
    // to its callers; conflating them is how a hidden book would reach /es.
    const read = localizedEditionFilter('es') as { $or: Record<string, unknown>[] };
    expect(read.$or[1]).toEqual({ language: NATIVE_EDITION_LANGUAGE.es });
    expect(read).not.toEqual(embeddableEditionFilter('es'));
  });
});
