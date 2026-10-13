/**
 * #3697: chapter `confidence` was the model's self-report, "high" on 96% of
 * entries and on every entry of the reported book, including the wrong ones.
 *
 * Fixtures are the real shape of 6956953e8c9559f6c2db0b6d (Taylor 1818,
 * Nicomachean Ethics) as stored on 2026-10-12: Book IX skips Chapter IV, and
 * Book X ch. IX runs to the page count (392–407) because nothing bounded it.
 */
import { describe, it, expect } from 'vitest';
import { checkChapters, endMatterStart, findNumberingGaps, parseNumbering } from '@/lib/chapter-checks';
import { computeEndPages } from '@/lib/chapter-text';
import type { Chapter } from '@/lib/types';

const ch = (title: string, pageNumber: number, level: number): Chapter =>
  ({ title, pageNumber, level, pageId: `p${pageNumber}`, confidence: 'high' }) as Chapter;

const taylorTail = (): Chapter[] => computeEndPages([
  ch('Book IX', 320, 1),
  ch('Chapter I', 320, 2), ch('Chapter II', 324, 2), ch('Chapter III', 327, 2),
  ch('Chapter V', 332, 2), ch('Chapter VI', 335, 2), ch('Chapter VII', 337, 2),
  ch('Chapter VIII', 340, 2), ch('Chapter IX', 345, 2), ch('Chapter X', 349, 2),
  ch('Chapter XI', 352, 2), ch('Chapter XII', 355, 2),
  ch('Book X', 358, 1),
  ch('Chapter I', 358, 2), ch('Chapter II', 360, 2), ch('Chapter III', 364, 2),
  ch('Chapter IV', 368, 2), ch('Chapter V', 372, 2), ch('Chapter VI', 377, 2),
  ch('Chapter VII', 380, 2), ch('Chapter VIII', 385, 2), ch('Chapter IX', 392, 2),
], 407);

describe('parseNumbering', () => {
  it('reads labelled roman and arabic numerals', () => {
    expect(parseNumbering('Chapter IX')).toEqual({ label: 'caput', n: 9 });
    expect(parseNumbering('CHAP. XIV. Of pleasure')).toEqual({ label: 'caput', n: 14 });
    expect(parseNumbering('Liber 3')).toEqual({ label: 'liber', n: 3 });
    expect(parseNumbering('XII.')).toEqual({ label: '', n: 12 });
    // Gradus ad Parnassum: one heading for two chapters must not read as a gap before III.
    expect(parseNumbering('CAPUT I & II: De Sono')).toEqual({ label: 'caput', n: 2 });
  });
  it('does not read a word as a numeral', () => {
    expect(parseNumbering('Civil Government')).toBeNull();
    expect(parseNumbering('Book of the Dead')).toBeNull();
    expect(parseNumbering('Mild remedies')).toBeNull();
  });
});

describe('findNumberingGaps', () => {
  it('finds Book IX skipping Chapter IV', () => {
    const gaps = findNumberingGaps(taylorTail());
    expect(gaps).toHaveLength(1);
    expect(gaps[0].missing).toEqual([4]);
  });
  it('does not compare Chapter V of Book X with Chapter VII of Book IX', () => {
    // Numbering restarts under each parent — no gap or reversal across books.
    const gaps = findNumberingGaps(taylorTail());
    expect(gaps.every(g => g.afterIndex < 12 && g.beforeIndex < 12)).toBe(true);
  });
  it('ignores a run that does not start at 1 and large jumps', () => {
    expect(findNumberingGaps([ch('Chapter V', 1, 1), ch('Chapter VI', 3, 1)])).toEqual([]);
    expect(findNumberingGaps([ch('Chapter 1', 1, 1), ch('Chapter 20', 3, 1)])).toEqual([]);
  });
});

describe('checkChapters', () => {
  const report = checkChapters(taylorTail());
  const byTitle = (t: string, page: number) =>
    report.chapters.find(c => c.title === t && c.pageNumber === page)!;

  it('lowers both neighbours of the gap and keeps the model value', () => {
    for (const [t, p] of [['Chapter III', 327], ['Chapter V', 332]] as const) {
      const c = byTitle(t, p);
      expect(c.confidence).toBe('low');
      expect(c.model_confidence).toBe('high');
      expect(c.flags).toContain('numbering-gap');
    }
  });
  it('flags the last chapter that swallowed the back matter', () => {
    const c = byTitle('Chapter IX', 392);
    expect(c.endPage).toBe(407);
    expect(c.flags).toContain('span-outlier');
    expect(c.confidence).toBe('medium');
  });
  it('leaves ordinary entries alone and does not mutate the input', () => {
    const input = taylorTail();
    const out = checkChapters(input);
    expect(out.chapters[1]).toEqual(input[1]);
    expect(input.every(c => c.confidence === 'high')).toBe(true);
    expect(out.flagged).toBe(3);
    expect(out.gaps[0]).toMatchObject({ after: 'Chapter III', before: 'Chapter V', missing: [4], pages: [327, 332] });
  });
});

describe('checkChapters — idempotent', () => {
  it('a saved, already-checked list comes back the same on a second pass', () => {
    const once = checkChapters(taylorTail()).chapters;
    const twice = checkChapters(once).chapters;
    expect(twice).toEqual(once);
    expect(twice.find(c => c.title === 'Chapter V' && c.pageNumber === 332)!.model_confidence).toBe('high');
  });
});

describe('endMatterStart', () => {
  // pp. 391–407 of the Taylor scan, OCR tags as stored (body text abridged).
  const page = (n: number, ocr: string) => ({ page_number: n, ocr });
  const tail = [
    ...Array.from({ length: 7 }, (_, i) =>
      page(391 + i, `<page-num>${400 + i}</page-num><page-type>text</page-type>…`)),
    page(398, '<page-num>407</page-num><page-type>text</page-type>sophists profess…'),
    page(399, '<page-num>408</page-num><page-type>text</page-type>ing the works…'),
    page(400, '<page-num>409</page-num><page-type>text</page-type>several polities…'),
    page(401, '<page-type>blank</page-type>'),
    page(402, '<page-type>text</page-type>## LATELY PUBLISHED, BY JAMES BLACK AND SON'),
    page(403, '<page-type>text</page-type># Books published by James Black and Son.'),
    page(404, '<page-type>blank</page-type>'),
    page(405, '<page-type>blank</page-type>'),
    page(406, '<page-type>text</page-type>Stanford University Libraries'),
    page(407, '<page-type>blank</page-type>'),
  ];

  it('puts end matter after the last printed body page', () => {
    expect(endMatterStart(tail)).toBe(401);
  });
  it('and bounding the last chapter there removes the outlier', () => {
    const chapters = taylorTail();
    computeEndPages(chapters, endMatterStart(tail)! - 1);
    const last = chapters[chapters.length - 1];
    expect(last.endPage).toBe(400);
    expect(checkChapters(chapters).chapters.at(-1)!.flags).toBeUndefined();
  });
  it('returns null when the book ends on a body page', () => {
    expect(endMatterStart(tail.slice(0, 3))).toBeNull();
  });
  it('returns null when nothing is printed-numbered and the tail is text', () => {
    expect(endMatterStart([page(1, 'text'), page(2, 'more text'), page(3, 'last text')])).toBeNull();
  });
  it('on an unpaginated book trims only the structural run, never unnumbered text', () => {
    // A manuscript with one stray numbered leaf: the unnumbered leaves after
    // it are body text, not end matter.
    const ms = [
      page(1, '<page-type>text</page-type>body'), page(2, '<page-type>text</page-type>body'),
      page(3, '<page-num>17</page-num><page-type>text</page-type>body'),
      ...Array.from({ length: 8 }, (_, i) => page(4 + i, '<page-type>text</page-type>body')),
      page(12, '<page-type>blank</page-type>'), page(13, '<page-type>blank</page-type>'),
    ];
    expect(endMatterStart(ms)).toBe(12);
  });
  it('does not count closing plates as end matter', () => {
    expect(endMatterStart([
      page(1, '<page-type>text</page-type>body'),
      page(2, '<page-type>illustration</page-type>Plate I'),
      page(3, '<page-type>illustration</page-type>Plate II'),
    ])).toBeNull();
  });
});
