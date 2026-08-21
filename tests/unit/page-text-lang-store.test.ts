import { describe, it, expect } from 'vitest';
import {
  pageTextForLang,
  buildPageTextRow,
  pageTextUpsertValues,
  PAGE_TEXT_COLUMNS,
  PAGE_TEXT_UPSERT_SQL,
  pageEmbeddingInput,
} from '../../scripts/lib/page-embedding-text.mjs';
import { usesLangStore, DEFAULT_TEXT_LANG } from '../../src/lib/semantic-search';

// `page_texts` rows carry the SNIPPET that gets quoted, not only the vector, so
// the two properties pinned here are content-integrity properties, not tidiness:
//
//   1. a row in `lang: 'es'` contains Spanish, or the row does not exist;
//   2. the row's values line up with the columns of the upsert that writes it.
//
// Both fail silently in production. A fallback to the original text would be
// retrieved for Spanish queries and quoted as the Spanish edition; a
// column/value misalignment would write well-formed rows with the wrong data in
// each field — the same shape as the `People: , , , ,` bug that motivated
// having one composer at all.

const book = { id: 'b1', title: 'Splendor Solis', author: 'Trismosin', language: 'German', year: 1582 };

describe('pageTextForLang — a language-keyed row promises that language', () => {
  it('returns null when the language is absent, even though OCR and English exist', () => {
    const page = {
      id: 'p1', book_id: 'b1', page_number: 4,
      ocr: { data: 'Der Sonnenglanz' },
      translation: { data: 'The Splendour of the Sun' },
    };
    // The English store deliberately falls back to OCR so an untranslated page
    // still gets a vector...
    expect(pageEmbeddingInput(page)).not.toBeNull();
    // ...the language-keyed one must not, or German lands in the Spanish lane.
    expect(pageTextForLang(page, 'es')).toBeNull();
  });

  it('reads translations.<lang> and strips editorial wrappers', () => {
    const page = {
      id: 'p1', book_id: 'b1', page_number: 4,
      translations: { es: { data: '<meta>Una página sobre mercurio</meta>El esplendor del sol.' } },
    };
    const got = pageTextForLang(page, 'es');
    expect(got?.text).toBe('El esplendor del sol.');
  });

  it('folds the legacy translation_es field in for es, and only for es', () => {
    const page = { id: 'p1', book_id: 'b1', page_number: 4, translation_es: { data: 'El esplendor.' } };
    expect(pageTextForLang(page, 'es')?.text).toBe('El esplendor.');
    expect(pageTextForLang(page, 'fr')).toBeNull();
  });

  it('stores the FULL page text but embeds only the model\'s window', () => {
    // The row does two jobs. Truncating the stored text to the embedding cap
    // would make the tail of a long page unsearchable in the lexical lane and
    // unreachable by a snippet — measured at 3.2% of Spanish pages.
    const long = 'á'.repeat(12000);
    const got = pageTextForLang({ id: 'p1', book_id: 'b1', page_number: 1, translations: { es: { data: long } } }, 'es');
    expect(got?.text.length).toBe(12000);
    expect(got?.embedText.length).toBe(8000);
  });

  it('prefers the map over the legacy field when both are present', () => {
    const page = {
      id: 'p1', book_id: 'b1', page_number: 4,
      translation_es: { data: 'vieja' },
      translations: { es: { data: 'nueva' } },
    };
    expect(pageTextForLang(page, 'es')?.text).toBe('nueva');
  });
});

describe('buildPageTextRow / the upsert', () => {
  const page = {
    id: 'p1', book_id: 'b1', page_number: 4,
    translations: { es: { data: 'El esplendor del sol.', updated_at: new Date('2026-08-20T10:00:00Z') } },
  };

  it('keys the row by (page_id, lang)', () => {
    const row = buildPageTextRow({ page, book, lang: 'es', text: 'El esplendor del sol.', embedding: [0.1, 0.2] });
    expect(row.page_id).toBe('p1');
    expect(row.lang).toBe('es');
    expect(row.book_title).toBe('Splendor Solis');
    // book_language is the EDITION's language and stays German — it is the
    // filter every other search surface means by "language".
    expect(row.book_language).toBe('German');
  });

  it('takes the watermark from the translation, not from the page', () => {
    const row = buildPageTextRow({ page, book, lang: 'es', text: 'x', embedding: [] });
    expect(row.mongo_updated_at).toEqual(new Date('2026-08-20T10:00:00Z'));
  });

  it('emits exactly as many values as the upsert has placeholders, in order', () => {
    const row = buildPageTextRow({ page, book, lang: 'es', text: 'x', embedding: [0.1] });
    const values = pageTextUpsertValues(row);
    expect(values.length).toBe(PAGE_TEXT_COLUMNS.length);
    const placeholders = new Set(PAGE_TEXT_UPSERT_SQL.match(/\$\d+/g));
    expect(placeholders.size).toBe(PAGE_TEXT_COLUMNS.length);
    // Positional order is what actually maps a value to a column.
    expect(values[0]).toBe(row.page_id);
    expect(values[1]).toBe('es');
    expect(values[PAGE_TEXT_COLUMNS.indexOf('text')]).toBe('x');
  });
});

describe('usesLangStore', () => {
  it('treats English as the unkeyed store and everything else as page_texts', () => {
    expect(DEFAULT_TEXT_LANG).toBe('en');
    expect(usesLangStore('en')).toBe(false);
    expect(usesLangStore(undefined)).toBe(false);
    expect(usesLangStore('')).toBe(false);
    expect(usesLangStore('es')).toBe(true);
    expect(usesLangStore('fr')).toBe(true);
  });
});
