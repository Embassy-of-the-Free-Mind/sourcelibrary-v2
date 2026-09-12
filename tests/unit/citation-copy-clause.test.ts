/**
 * The copy clause of the citation apparatus (#4360).
 *
 * A scan is a photograph of ONE physical object. The imprint describes the
 * edition — any copy of the 1609 printing reads the same — but marginalia,
 * provenance marks and bindings exist in exactly one copy, so a citation of
 * our images must name the institution whose object they show, and must never
 * name an aggregator as if it held the book.
 */
import { describe, it, expect } from 'vitest';
import { copyClause } from '@/lib/holding-library';
import { generateCitations } from '@/lib/citation';
import type { Book } from '@/lib/types';

const base = {
  id: 'bk1',
  slug: 'a-book',
  title: 'Amphitheatrum sapientiae aeternae',
  author: 'Khunrath, Heinrich',
  published: '1609',
  place_published: 'Hanau',
  publisher: 'Antonius',
  language: 'Latin',
} as unknown as Book;

const cite = (book: Book) =>
  generateCitations(book, 28, 'bk1', 'pg1', 'https://sourcelibrary.org');

describe('copyClause — who actually holds the book', () => {
  it('names the holder, with shelfmark when known', () => {
    const c = copyClause('Bibliotheca Philosophica Hermetica', 'PH441');
    expect(c?.statement).toBe('Copy: Bibliotheca Philosophica Hermetica, Amsterdam, PH441');
    expect(c?.holding_library).toBe('Bibliotheca Philosophica Hermetica, Amsterdam');
    expect(c?.shelfmark).toBe('PH441');
  });

  it('collapses variant spellings to one canonical institution', () => {
    const a = copyClause('Bayerische Staatsbibliothek');
    const b = copyClause('Bayerische Staatsbibliothek (Munich)');
    expect(a?.holding_library).toBe(b?.holding_library);
  });

  it('refuses to present an aggregator as a holding library', () => {
    // 6,185 live books carry "Internet Archive" as contributing_library. IA
    // hosted the scan; some other institution owns the object.
    for (const agg of ['Internet Archive', 'internet archive', 'Google Books', 'HathiTrust', 'e-rara']) {
      expect(copyClause(agg, 'shelf-1')).toBeNull();
    }
  });

  it('emits nothing for a bare shelfmark — "Copy: PH441" locates nothing', () => {
    expect(copyClause(undefined, 'PH441')).toBeNull();
    expect(copyClause('', 'PH441')).toBeNull();
  });

  it('refuses null-holder tokens — "Copy: unknown library" asserts nothing', () => {
    // IA metadata itself says "unknown library" on many Google scans, and old
    // backfills wrote it verbatim (641 books measured 2026-08-29).
    for (const tok of ['unknown library', 'Unknown', 'IIIF Source']) {
      expect(copyClause(tok, 'shelf-1')).toBeNull();
    }
  });

  it('passes an unmapped institution through as-is', () => {
    expect(copyClause('John Rylands Library, University of Manchester')?.statement)
      .toBe('Copy: John Rylands Library, University of Manchester');
  });
});

describe('generateCitations — the clause reaches every long form', () => {
  const held = {
    ...base,
    image_source: { contributing_library: 'Bibliotheca Philosophica Hermetica', shelfmark: 'PH441' },
  } as unknown as Book;
  const c = cite(held);

  it('carries a structured copy object', () => {
    expect(c.copy?.holding_library).toBe('Bibliotheca Philosophica Hermetica, Amsterdam');
    expect(c.copy?.shelfmark).toBe('PH441');
  });

  it('names the copy in footnote, bibliography, chicago, mla and the bibtex note', () => {
    for (const form of [c.footnote, c.bibliography, c.chicago, c.mla, c.bibtex]) {
      expect(form).toContain('Copy: Bibliotheca Philosophica Hermetica, Amsterdam, PH441');
    }
  });

  it('keeps the inline form terse — no copy clause there', () => {
    expect(c.inline).not.toContain('Copy:');
  });
});

describe('generateCitations — silence when no genuine holder is known', () => {
  it('a book with no image_source cites exactly as before', () => {
    const c = cite(base);
    expect(c.copy).toBeUndefined();
    for (const form of [c.inline, c.footnote, c.bibliography, c.chicago, c.mla, c.bibtex]) {
      expect(form).not.toContain('Copy:');
    }
  });

  it('an aggregator-attributed book cites as before too', () => {
    const c = cite({
      ...base,
      image_source: { contributing_library: 'Internet Archive' },
    } as unknown as Book);
    expect(c.copy).toBeUndefined();
    expect(c.footnote).not.toContain('Copy:');
  });
});

describe('the copy clause is orthogonal to the rendering credit (#3724)', () => {
  it('an English original with a known holder gets the copy but no translation claim', () => {
    const c = cite({
      ...base,
      language: 'English',
      image_source: { contributing_library: 'British Library' },
    } as unknown as Book);
    expect(c.footnote).toContain('Copy: British Library, London');
    expect(c.footnote).not.toContain('trans. Source Library');
    expect(c.bibtex).not.toContain('translator = {Source Library}');
  });
});
