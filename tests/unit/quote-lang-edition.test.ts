import { describe, it, expect } from 'vitest';
import { resolveQuoteText } from '@/lib/quote-text';
import { editionsForBook } from '@/lib/page-translations';
import { generateCitations } from '@/lib/citation';
import { getShortUrl } from '@/lib/shortlinks';
import type { Book, Page } from '@/lib/types';

/**
 * Quoting a NON-ENGLISH edition (#4095).
 *
 * A page can now hold more than one translation — English on
 * `pages.translation`, everything else on `pages.translations.<iso>` — and 103
 * books of 22,000 have a Spanish one. So the fallback to English is the COMMON
 * case, and the property that matters is not "Spanish comes back when it
 * exists" (easy) but "the response SAYS which edition it served" (silent when
 * wrong, and wrong in a way that makes a caller assert something it never
 * checked: a quote is a claim about words).
 *
 * The citation links are pinned alongside, because they are the other half of
 * the same claim — a `/es` URL for a book with no Spanish pages 307s back to
 * English, so the link has to follow the edition SERVED, never the one asked
 * for.
 */

const page = (over: Record<string, unknown> = {}): Page => ({
  id: 'p1',
  book_id: 'b1',
  page_number: 42,
  ocr: { data: 'Lapis philosophorum est.' },
  translation: { data: 'The philosophers stone is.' },
  ...over,
} as unknown as Page);

describe('resolveQuoteText — which edition, and saying so', () => {
  it('serves the requested edition and labels it', () => {
    const got = resolveQuoteText(page({ translations: { es: { data: 'La piedra filosofal es.' } } }), 'b1', 'es');
    expect(got?.lang).toBe('es');
    expect(got?.text).toContain('La piedra filosofal');
  });

  it('falls back to English and says lang: "en" — never silently', () => {
    const got = resolveQuoteText(page(), 'b1', 'es');
    expect(got?.text).toContain('The philosophers stone');
    // The whole point. A caller that reads `lang` sees the substitution; one
    // that assumes its request was honoured does not.
    expect(got?.lang).toBe('en');
  });

  it('labels English as English when English was asked for', () => {
    expect(resolveQuoteText(page(), 'b1')?.lang).toBe('en');
    expect(resolveQuoteText(page(), 'b1', 'en')?.lang).toBe('en');
  });

  it('folds the legacy translation_es field in', () => {
    const got = resolveQuoteText(page({ translation_es: { data: 'La piedra.' } }), 'b1', 'es');
    expect(got?.lang).toBe('es');
  });

  it('does not let a language request change what an English-original leaf is', () => {
    // A 1570 English leaf has no translation and needs none. Asking for Spanish
    // cannot make it Spanish — the leaf's language is a property of the page.
    const englishLeaf = page({
      translation: undefined,
      ocr: { data: '<language>English</language>The Mathematicall Praeface, wherein the excellencie of Arithmetike and Geometrie is declared unto all men of good will and studious minde.' },
    });
    const got = resolveQuoteText(englishLeaf, 'b1', 'es');
    expect(got?.source).toBe('ocr_original');
    expect(got?.lang).toBe('en');
  });
});

describe('editionsForBook', () => {
  it('reports every language the book can be read in, with page counts', () => {
    expect(editionsForBook({ pages_translated: 357, pages_translated_es: 357 })).toEqual({ en: 357, es: 357 });
  });

  it('omits a language with zero pages rather than reporting an empty edition', () => {
    // `{ es: 0 }` would read as "there is a Spanish edition, it is empty",
    // which is the opposite of true.
    expect(editionsForBook({ pages_translated: 12, pages_translated_es: 0 })).toEqual({ en: 12 });
    expect(editionsForBook({ pages_translated: 12 })).toEqual({ en: 12 });
  });

  it('is empty for an untranslated book', () => {
    expect(editionsForBook({ pages_count: 200 })).toEqual({});
  });
});

describe('citation links follow the edition served', () => {
  const book = { id: 'b1', slug: 'splendor-solis', title: 'Splendor Solis', author: 'Trismosin', published: '1582' } as unknown as Book;

  it('prefixes the reader URL with the locale', () => {
    const es = generateCitations(book, 42, '6953b56577f38f6761bd979d', 'p1', 'https://sourcelibrary.org', undefined, 'es');
    expect(es.url).toContain('/es/book/splendor-solis');
  });

  it('leaves English URLs unprefixed — every DOI and footnote already points there', () => {
    const en = generateCitations(book, 42, '6953b56577f38f6761bd979d', 'p1', 'https://sourcelibrary.org');
    expect(en.url).toContain('/book/splendor-solis');
    expect(en.url).not.toContain('/es/');
    expect(en.short_url).not.toContain('lang=');
  });

  it('keeps the shortlink CODE canonical and carries the language as a parameter', () => {
    // One shortlink per leaf, printable in a footnote. A second, divergent code
    // per language would be a second identifier for the same page.
    const en = getShortUrl('6953b56577f38f6761bd979d', 42);
    const es = getShortUrl('6953b56577f38f6761bd979d', 42, undefined, undefined, 'es');
    expect(es).toBe(`${en}?lang=es`);
  });
});
