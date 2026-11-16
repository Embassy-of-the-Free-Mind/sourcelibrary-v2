/**
 * What the Librarian page shows around an answer (v3#250).
 *
 * The card shape is the live turn of 2026-11-13 (thread 6af70498c205a9be6ed8c6bb):
 * a Ficino answer citing three pages, with a card row that listed every passage
 * any search returned, uncited books among them.
 */
import { describe, it, expect } from 'vitest';
import { splitSourceCards, collapseRepeatedQuestions } from '@/lib/embassy/source-cards';
import { previewText } from '@/lib/embassy/thread-preview';

const card = (bookSlug: string, pageNumber?: number) => ({ bookId: `id-${bookSlug}`, bookSlug, pageNumber });

const SOURCES = [
  card('three-books-on-life-ficino-3', 9),
  card('three-books-on-life-ficino', 85),
  card('the-age-of-reason-thomas-paine', 386),
  card('three-books-on-life-1489-first-edition-ficino', 20),
  card('de-vita-libri-tres-ficinus-3', 15),
  card('three-books-on-life-ficino', 43),
  card('three-books-on-life-1489-first-edition-ficino', 18),
  card('plotinus-enneads-1492', 228),
  card('three-books-on-life-ficino', 43), // the same page, returned by a second search
];

const ANSWER = [
  'Ficino explains it in [Three Books on Life](https://sourcelibrary.org/book/three-books-on-life-1489-first-edition-ficino), [Page 18](https://sourcelibrary.org/book/three-books-on-life-1489-first-edition-ficino/page-number/18).',
  '> "For as much as they are idle..." — [De Vita](https://sourcelibrary.org/book/de-vita-libri-tres-ficinus-3?page=15)',
  '> "When the thinner parts..." — [Three Books](https://sourcelibrary.org/book/three-books-on-life-ficino?page=43)',
].join('\n\n');

describe('splitSourceCards', () => {
  it('leads with the pages the answer cites, in the order it cites them', () => {
    const { cited } = splitSourceCards(SOURCES, ANSWER);
    expect(cited.map(c => `${c.bookSlug}#${c.pageNumber}`)).toEqual([
      'three-books-on-life-1489-first-edition-ficino#18',
      'de-vita-libri-tres-ficinus-3#15',
      'three-books-on-life-ficino#43',
    ]);
  });

  it('keeps an uncited book out of the cited row', () => {
    const { cited, other } = splitSourceCards(SOURCES, ANSWER);
    expect(cited.some(c => c.bookSlug === 'the-age-of-reason-thomas-paine')).toBe(false);
    expect(other.some(c => c.bookSlug === 'the-age-of-reason-thomas-paine')).toBe(true);
  });

  it('loses no page and repeats none', () => {
    const { cited, other } = splitSourceCards(SOURCES, ANSWER);
    const keys = [...cited, ...other].map(c => `${c.bookSlug}#${c.pageNumber}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(8); // nine cards, one page returned twice
  });

  it('reads both link forms and a link written with the book id', () => {
    const sources = [card('a-book', 3), card('b-book', 7), { bookId: 'abc123', pageNumber: 2 }];
    const answer = '[x](/book/a-book/page-number/3) [y](/es/book/b-book?page=7) [z](/book/abc123/page-number/2)';
    expect(splitSourceCards(sources, answer).cited).toHaveLength(3);
  });

  it('gives a book cited without a matching page one card, not all of them', () => {
    const sources = [card('a-book', 3), card('a-book', 4), card('b-book', 1)];
    const { cited, other } = splitSourceCards(sources, 'See [the book](/book/a-book).');
    expect(cited).toEqual([card('a-book', 3)]);
    expect(other).toHaveLength(2);
  });

  it('cites nothing when the answer links to nothing', () => {
    const { cited, other } = splitSourceCards(SOURCES, 'An answer with no links.');
    expect(cited).toEqual([]);
    expect(other).toHaveLength(8);
  });
});

describe('collapseRepeatedQuestions', () => {
  const row = (question: string, id: string) => ({ id, preview: { question } });

  it('keeps the newest asking of a question and drops the repeats', () => {
    const rows = [
      row('What is the Emerald Tablet?', 'newest'),
      row('Armeni', 'a'),
      row('what is the emerald tablet', 'older'),
      row('What is the Emerald Tablet? ', 'oldest'),
    ];
    expect(collapseRepeatedQuestions(rows).map(r => r.id)).toEqual(['newest', 'a']);
  });

  it('compares non-Latin questions too, and keeps rows with no question', () => {
    const rows = [row('Русские заговоры', '1'), row('русские заговоры!', '2'), row('', '3'), row('', '4')];
    expect(collapseRepeatedQuestions(rows).map(r => r.id)).toEqual(['1', '3', '4']);
  });
});

describe('previewText', () => {
  it('shows no markdown', () => {
    const md = '## Abundance\n\nAbundance is personified as the goddess **Abundantia**, see [Ripa](https://sourcelibrary.org/book/x/page-number/3).\n\n> "a quote"\n\n- *Fortuna*';
    const out = previewText(md, 300);
    expect(out).toBe('Abundance Abundance is personified as the goddess Abundantia, see Ripa. "a quote" Fortuna');
    expect(out).not.toMatch(/[*#>\]]|\(http/);
  });

  it('cuts at a word, with an ellipsis, and never past the limit', () => {
    const out = previewText('The Armenian Golden Age represents the flowering of Armenian literature.', 40);
    expect(out).toBe('The Armenian Golden Age represents the…');
    expect(out.length).toBeLessThanOrEqual(41);
  });

  it('returns an empty string for a missing answer', () => {
    expect(previewText(undefined, 300)).toBe('');
  });
});
