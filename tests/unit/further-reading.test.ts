import { describe, it, expect } from 'vitest';
import {
  furtherReadingStatus,
  resolveFurtherReading,
  resolveReadingListGaps,
  type FurtherReadingBook,
} from '@/lib/further-reading';

/**
 * Fixtures are copied from the production `books` rows the first further-reading
 * list points at (forum-of-conscience, #4653), measured 2026-09-04 — not
 * invented to reach a wanted verdict. Polanco's *Breve directorium* really is
 * 223 pages with 25 OCR'd, 0 blank, 0 translated; every one of the eighteen has
 * `pages_translated: 0`.
 */
const POLANCO: FurtherReadingBook = {
  id: '6a4f7563eeef22aafac6164b',
  slug: 'breve-directorium-ad-confessarii-et-confitentis-munus-recte-polanco',
  title: 'Breve directorium ad confessarii et confitentis munus recte obeundum',
  author: 'Polanco, Juan de',
  published: '1586',
  language: 'Latin',
  pages_count: 223,
  pages_ocr: 25,
  pages_blank: 0,
  pages_translated: 0,
};

describe('furtherReadingStatus', () => {
  it('says so plainly when a held book has no translated pages', () => {
    const s = furtherReadingStatus(POLANCO);
    expect(s.kind).toBe('untranslated');
    expect(s.readable).toBe(false);
    expect(s.label).toBe('Not yet translated');
  });

  /**
   * The guard this file exists for. `isTranslationReadable()` divides by
   * `pages_ocr − pages_blank`, so a sampled transcription that happens to be
   * fully translated scores 100% and reads as "Translated" while 198 of 223
   * pages have never been transcribed. That is the exact shape of the books in
   * this band, so the status must NOT claim readable here.
   *
   * Negative control: drop the `fullyTranscribed` conjunct from
   * furtherReadingStatus and this assertion goes red while every other test in
   * the file stays green.
   */
  it('does not call a sampled-but-fully-translated book readable', () => {
    const s = furtherReadingStatus({ ...POLANCO, pages_translated: 25 });
    expect(s.readable).toBe(false);
    expect(s.kind).toBe('partial');
    expect(s.label).toBe('25 of 223 pages translated');
  });

  it('reports a genuinely partial translation in raw counts, not a verdict', () => {
    const s = furtherReadingStatus({
      ...POLANCO, pages_count: 100, pages_ocr: 100, pages_blank: 0, pages_translated: 40,
    });
    expect(s.kind).toBe('partial');
    expect(s.readable).toBe(false);
    expect(s.label).toBe('40 of 100 pages translated');
  });

  it('only says "Translated" when the whole book is transcribed and clears the existing readable bar', () => {
    const s = furtherReadingStatus({
      ...POLANCO, pages_count: 100, pages_ocr: 100, pages_blank: 0, pages_translated: 100,
    });
    expect(s.kind).toBe('translated');
    expect(s.readable).toBe(true);
    expect(s.label).toBe('Translated');
  });

  it('withholds "Translated" from a fully transcribed book below the 90% bar', () => {
    const s = furtherReadingStatus({
      ...POLANCO, pages_count: 100, pages_ocr: 100, pages_blank: 0, pages_translated: 89,
    });
    expect(s.readable).toBe(false);
  });

  it('judges a book with no page counts on the readable bar alone, not as zero', () => {
    const s = furtherReadingStatus({
      id: 'x', pages_translated: 5,
    } as FurtherReadingBook);
    // Unknown coverage is "not shown to be thin" — the same rule
    // translationCoverage() follows. It must not be demoted on absent data.
    expect(s.kind).toBe('translated');
  });
});

describe('resolveFurtherReading', () => {
  const A: FurtherReadingBook = { ...POLANCO, id: 'a', title: 'A' };
  const B: FurtherReadingBook = { ...POLANCO, id: 'b', title: 'B' };
  const C: FurtherReadingBook = { ...POLANCO, id: 'c', title: 'C' };

  it("preserves the curator's order, not the order the books came back in", () => {
    const out = resolveFurtherReading(
      [{ book_id: 'c' }, { book_id: 'a' }, { book_id: 'b' }],
      [A, B, C],
    );
    expect(out.map(b => b.id)).toEqual(['c', 'a', 'b']);
  });

  /**
   * The loader fetches with `visible: true`, so a hidden or removed book never
   * reaches this function. Dropping the ref is what stops an authored id list
   * from publishing a dead link after a takedown — the failure that left 13
   * removed books linked on /collections/freemasonry for six weeks.
   */
  it('drops a ref whose book was not returned, rather than rendering a bare id', () => {
    const out = resolveFurtherReading(
      [{ book_id: 'a' }, { book_id: 'hidden-or-removed' }, { book_id: 'b' }],
      [A, B],
    );
    expect(out.map(b => b.id)).toEqual(['a', 'b']);
  });

  it('carries the authored note through onto the book', () => {
    const out = resolveFurtherReading([{ book_id: 'a', note: 'Confessor’s manual.' }], [A]);
    expect(out[0].note).toBe('Confessor’s manual.');
  });

  it('returns nothing for an absent or empty field', () => {
    expect(resolveFurtherReading(undefined, [A])).toEqual([]);
    expect(resolveFurtherReading([], [A])).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveFurtherReading({ book_id: 'a' } as any, [A])).toEqual([]);
  });
});

describe('resolveReadingListGaps', () => {
  // Copied verbatim from forum-of-conscience's stored `reading_list_gaps`.
  const REAL = [
    { n: 'N01', want: 'Burchard of Worms, Decretum lib. XIX (Corrector)', witnesses: 'Bamberg Msc.Can.6 (c. 1020); BSB Clm 4570 (1108)' },
    { n: 'N07', want: 'Berthold von Freiburg, Rechtssumme', witnesses: 'Bämler, Augsburg 1472' },
  ];

  it('keeps well-formed rows intact', () => {
    expect(resolveReadingListGaps(REAL)).toEqual(REAL);
  });

  it('drops rows with no work named', () => {
    const out = resolveReadingListGaps([
      ...REAL,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { n: 'N09', witnesses: 'orphaned witness with no work' } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { n: 'N10', want: '   ' } as any,
    ]);
    expect(out).toHaveLength(2);
  });

  it('returns nothing for an absent field', () => {
    expect(resolveReadingListGaps(undefined)).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveReadingListGaps('not an array' as any)).toEqual([]);
  });
});
