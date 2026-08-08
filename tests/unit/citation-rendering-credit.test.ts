/**
 * The citation apparatus must describe what we actually did to the text (#3724).
 *
 * These tests could not exist before this change: `generateCitations` lived
 * inside a route file, where nothing could import it, and that is how it came to
 * assert "Translated by Source Library" over an English book rendered by a named
 * historical translator.
 *
 * Measured on production before the fix, `/api/books/6956953e…/quote?page=46`
 * (Taylor's 1818 Aristotle, an ENGLISH book) returned:
 *
 *     footnote: "Aristotle, The Rhetoric… trans. Source Library (2026), 46."
 *
 * We did not translate that. Taylor did.
 */
import { describe, it, expect } from 'vitest';
import { generateCitations } from '@/lib/citation';
import type { Book } from '@/lib/types';

const base = {
  id: 'bk1',
  slug: 'a-book',
  title: 'A Title',
  author: 'Aristotle',
  published: '1818',
  place_published: 'London',
  publisher: 'Valpy',
} as unknown as Book;

const greekBook = { ...base, language: 'Greek' } as Book;
const englishBook = { ...base, language: 'English' } as Book;

const cite = (book: Book) =>
  generateCitations(book, 46, 'bk1', 'pg1', 'https://sourcelibrary.org');

describe('rendering credit — text we produced', () => {
  const c = cite(greekBook);

  it('names Source Library in every long form', () => {
    expect(c.footnote).toContain('Source Library');
    expect(c.bibliography).toContain('Translated by Source Library');
    expect(c.chicago).toContain('Translated by Source Library');
    expect(c.mla).toContain('Translated by Source Library');
    expect(c.bibtex).toContain('translator = {Source Library}');
  });

  it('names it INLINE too — the form people paste into prose', () => {
    // This is what #3724 was opened about: 91.6% of live books serve English we
    // produced, and the inline form said only "(Aristotle 1818, p. 46)".
    expect(c.inline).toContain('Source Library');
    expect(c.inline).toContain('p. 46');
  });
});

describe('rendering credit — text we did NOT produce', () => {
  const c = cite(englishBook);

  it('claims no translation on a book printed in English', () => {
    for (const form of [c.inline, c.footnote, c.bibliography, c.chicago, c.mla]) {
      expect(form).not.toContain('Translated by Source Library');
      expect(form).not.toContain('trans. Source Library');
    }
    expect(c.bibtex).not.toContain('translator = {Source Library}');
  });

  it('says instead what we did do', () => {
    expect(c.bibtex).toContain('transcribed from the printed page');
  });

  it('still produces a usable citation', () => {
    // Removing a false claim must not leave a broken or empty apparatus.
    expect(c.inline).toBe('(Aristotle 1818, p. 46)');
    expect(c.footnote).toContain('Aristotle');
    expect(c.footnote).toContain('46');
    expect(c.chicago).toMatch(/Accessed |doi\.org/);
    expect(c.bibtex).toContain('author = {Aristotle}');
  });
});

describe('the author is never displaced', () => {
  it('keeps the historical author in the author position in both cases', () => {
    // Naming our rendering must not turn Source Library into the author. The
    // page is still Aristotle's work, whoever put it into English.
    for (const book of [greekBook, englishBook]) {
      const c = cite(book);
      expect(c.bibtex).toContain('author = {Aristotle}');
      expect(c.inline.startsWith('(Aristotle')).toBe(true);
    }
  });
});
