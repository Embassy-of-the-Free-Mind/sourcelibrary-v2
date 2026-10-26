import { describe, it, expect } from 'vitest';
import { resolveQuoteText, pageIsInLanguage } from '@/lib/quote-text';
import { generateCitations } from '@/lib/citation';
import type { Book, Page } from '@/lib/types';

/**
 * A transcribed, untranslated page is quotable in its OWN language (#7458).
 *
 * Search serves such pages as `ocr` snippets and tells the caller to check a
 * passage with get_quote before quoting it; get_quote then answered 404
 * "No translation available" on every one of them, with no way to ask for the
 * German. Measured 2026-10-26 on production: du Bois-Reymond, *Über die Grenzen
 * des Naturerkennens* (6aa35e0de213def30d6cab63) scans 39 and 52, and Simmel's
 * *Goethe* and *Hauptprobleme* — all transcribed, none translated.
 *
 * What must NOT change: asking for English still gets no German back under an
 * English framing (#3939), and a page that declares another language is not
 * served as the book's.
 */

// Production fixture, du Bois-Reymond scan 39 (envelope + opening sentence).
const DU_BOIS_39 = '<scan-quality>good</scan-quality>\n<language>German</language>\n<script>printed</script>\n'
  + '<page-type>text</page-type>\n<page-num>30</page-num>\n<header>Über die Grenzen des Naturerkennens</header>\n\n'
  + 'Gleichgewichtslagen, und um Einleitung eines Stoffwechsels, teils durch von außen überkommene Bewegung. '
  + 'Was das Lebende vom Toten, die Pflanze und das nur in seinen körperlichen Funktionen betrachtete Tier vom '
  + 'Kristall unterscheidet, ist zuletzt dieses.';

const book = { id: '6aa35e0de213def30d6cab63', language: 'German', title: 'Über die Grenzen des Naturerkennens' };

const page = (ocr: string, over: Record<string, unknown> = {}): Page => ({
  id: 'p39', book_id: book.id, page_number: 39, ocr: { data: ocr }, ...over,
} as unknown as Page);

describe('quoting an untranslated page in its own language (#7458)', () => {
  it('serves the transcription when the page\'s own language is asked for', () => {
    const got = resolveQuoteText(page(DU_BOIS_39), book.id, 'de', { book });
    expect(got?.source).toBe('ocr_original');
    expect(got?.lang).toBe('de');
    expect(got?.text).toContain('Was das Lebende vom Toten');
    // The envelope is editorial, never quotable.
    expect(got?.text).not.toContain('scan-quality');
  });

  it('still refuses German under an English request — the 404 the caller recovers from', () => {
    expect(resolveQuoteText(page(DU_BOIS_39), book.id, 'en', { book })).toBeNull();
  });

  it('does not serve a page that declares a different language as the book\'s', () => {
    const latinLeaf = page('<language>Latin</language>\nLapis philosophorum est res una.');
    expect(resolveQuoteText(latinLeaf, book.id, 'de', { book })).toBeNull();
    expect(resolveQuoteText(latinLeaf, book.id, 'la', { book })?.lang).toBe('la');
  });

  it('falls back to the book language only when the page declared none, and never without a book', () => {
    expect(pageIsInLanguage('Gleichgewichtslagen und Stoffwechsel.', 'de', book)).toBe(true);
    expect(pageIsInLanguage('Gleichgewichtslagen und Stoffwechsel.', 'de', null)).toBe(false);
    expect(pageIsInLanguage('<language>German, Latin</language>x', 'la', book)).toBe(true);
  });

  it('prefers the leaf\'s own words to our English when the own language is asked for', () => {
    const translated = page(DU_BOIS_39, { translation: { data: 'What distinguishes the living from the dead…' } });
    expect(resolveQuoteText(translated, book.id, 'de', { book })?.source).toBe('ocr_original');
    expect(resolveQuoteText(translated, book.id, 'en', { book })?.source).toBe('translation');
  });

  it('cites a transcription without a translation credit or a locale prefix', () => {
    const c = generateCitations(book as unknown as Book, 39, book.id, 'p39', 'https://sourcelibrary.org', undefined, undefined, null, { transcription: true });
    expect(c.inline).not.toContain('trans. Source Library');
    expect(c.url).not.toContain('/de/');
    const ours = generateCitations(book as unknown as Book, 39, book.id, 'p39', 'https://sourcelibrary.org');
    expect(ours.inline).toContain('trans. Source Library');
  });
});
