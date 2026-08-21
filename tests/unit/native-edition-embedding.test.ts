import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs script lib, no types
import { pageTextForLang } from '../../scripts/lib/page-embedding-text.mjs';
// @ts-expect-error — .mjs script lib, no types
import { pageFilterForLang } from '../../scripts/lib/embed-book-page-texts.mjs';
// @ts-expect-error — .mjs script lib, no types
import { isNativeEditionLanguage, NATIVE_EDITION_LANGUAGE } from '../../scripts/lib/native-edition-language.mjs';

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
