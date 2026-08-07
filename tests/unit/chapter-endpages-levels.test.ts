/**
 * `endPage` is derived, and it was derived flatly.
 *
 * The regression these pin is the one an MCP client hit on Taylor's Nicomachean
 * Ethics: "Book I" at p.12 came back with endPage 11, because the very next
 * entry in the flat list was its own "Chapter I" — also on p.12. Every level-1
 * span in every nested book was inverted the same way (29,037 entries across
 * 6,901 books, measured 2026-08-07).
 *
 * A flat implementation passes any single-level fixture, which is why this was
 * invisible for so long. So the fixtures here are deliberately NESTED, and the
 * first assertion is the same-page parent/child case that produced the bug.
 */
import { describe, it, expect } from 'vitest';
import { computeEndPages, chunkEndPage } from '@/lib/chapter-text';
import type { Chapter } from '@/lib/types';

/** The rule that shipped before the level fix, kept here as the oracle below. */
function flatEndPages(chapters: Chapter[], totalPages: number): number[] {
  return chapters.map((c, i) =>
    i < chapters.length - 1 ? chapters[i + 1].pageNumber - 1 : totalPages,
  );
}

const ch = (title: string, pageNumber: number, level: number): Chapter =>
  ({ title, pageNumber, level }) as Chapter;

describe('computeEndPages — levels', () => {
  it('a book heading spans its chapters, not the page before itself', () => {
    // The real shape from 6956953e8c9559f6c2db0b6d: Book I and its Chapter I
    // both open on p.12, and Book II opens on p.58.
    const chapters = [
      ch('Book I', 12, 1),
      ch('Chapter I', 12, 2),
      ch('Chapter II', 13, 2),
      ch('Book II', 58, 1),
      ch('Chapter I', 58, 2),
    ];
    computeEndPages(chapters, 407);

    expect(chapters[0].endPage).toBe(57); // Book I: 12–57, NOT 12–11
    expect(chapters[1].endPage).toBe(12); // Chapter I bounded by its sibling
    expect(chapters[2].endPage).toBe(57); // last child bounded by its parent's end
    expect(chapters[3].endPage).toBe(407); // Book II runs to the end of the volume
    expect(chapters[4].endPage).toBe(407);
  });

  it('never returns an inverted span', () => {
    const chapters = [
      ch('Part One', 5, 1),
      ch('Section A', 5, 2),
      ch('Subsection i', 5, 3),
      ch('Part Two', 6, 1),
    ];
    computeEndPages(chapters, 10);
    for (const c of chapters) {
      expect(c.endPage).toBeGreaterThanOrEqual(c.pageNumber);
    }
    expect(chapters[3].endPage).toBe(10);
  });

  it('a deeper entry is bounded by its parent, not by the next entry of any level', () => {
    // Chapter III's next SIBLING is in the following book, so a "next sibling
    // only" rule would run it past the parent boundary. It must stop at 83.
    const chapters = [
      ch('Book II', 58, 1),
      ch('Chapter III', 63, 2),
      ch('Book III', 84, 1),
      ch('Chapter I', 84, 2),
    ];
    computeEndPages(chapters, 200);
    expect(chapters[1].endPage).toBe(83);
  });

  it('still behaves flatly for a single-level list', () => {
    const chapters = [ch('I', 1, 1), ch('II', 10, 1), ch('III', 20, 1)];
    computeEndPages(chapters, 30);
    expect(chapters.map((c) => c.endPage)).toEqual([9, 19, 30]);
  });

  it('treats a missing level as level 1', () => {
    const chapters = [
      { title: 'A', pageNumber: 1 } as Chapter,
      { title: 'B', pageNumber: 5 } as Chapter,
    ];
    computeEndPages(chapters, 9);
    expect(chapters.map((c) => c.endPage)).toEqual([4, 9]);
  });
});

/**
 * The repair rewrites `books.chapters[].endPage`. It must NOT silently change
 * what `chapter_texts` holds — 15,796 books' worth of materialized retrieval
 * chunks that nothing in this change re-runs.
 *
 * `chunkEndPage` is what guarantees that: for every entry it must return
 * exactly what the old flat rule returned, so the materializers see an
 * identical page range before and after. If this test ever fails, the repair
 * needs a re-materialization pass shipped alongside it.
 */
describe('chunkEndPage — chapter_texts ranges are unchanged by the fix', () => {
  const cases: Array<[string, Chapter[], number]> = [
    [
      'nested, parent and first child share a page',
      [
        ch('Book I', 12, 1),
        ch('Chapter I', 12, 2),
        ch('Chapter II', 13, 2),
        ch('Book II', 58, 1),
        ch('Chapter I', 58, 2),
      ],
      407,
    ],
    [
      'nested, parent has a preamble before its first child',
      [ch('Book II', 58, 1), ch('Chapter I', 61, 2), ch('Book III', 84, 1)],
      200,
    ],
    ['flat', [ch('I', 1, 1), ch('II', 10, 1), ch('III', 20, 1)], 30],
    [
      'three levels deep',
      [ch('Part', 5, 1), ch('Section', 5, 2), ch('Sub', 7, 3), ch('Part Two', 9, 1)],
      12,
    ],
  ];

  for (const [name, chapters, totalPages] of cases) {
    it(name, () => {
      const expected = flatEndPages(chapters, totalPages);
      computeEndPages(chapters, totalPages); // sets the NEW, level-aware endPage
      const actual = chapters.map((_, i) => chunkEndPage(chapters, i, totalPages));
      expect(actual).toEqual(expected);
    });
  }
});

/**
 * The request path (`src/lib/chapter-text.ts`) and the worker path
 * (`scripts/lib/chapter-endpages.mjs`) must agree. Four independent copies of
 * this function is how one flat implementation stayed wrong in four places at
 * once; two twins are the repo convention (cf. r2-key, ngram-normalize), and
 * this is what keeps them honest.
 */
describe('computeEndPages — .ts/.mjs twin parity', () => {
  it('both implementations return identical spans', async () => {
    const { computeEndPages: mjs } = await import(
      '../../scripts/lib/chapter-endpages.mjs'
    );

    const fixture = () => [
      ch('Book I', 12, 1),
      ch('Chapter I', 12, 2),
      ch('Chapter II', 13, 2),
      ch('Book II', 58, 1),
      ch('Chapter I', 58, 2),
      ch('Chapter II', 61, 2),
    ];

    const a = computeEndPages(fixture(), 407).map((c) => c.endPage);
    const b = (mjs(fixture(), 407) as Chapter[]).map((c) => c.endPage);
    expect(b).toEqual(a);
  });

  it('both implementations return identical chunk ranges', async () => {
    const { computeEndPages: mjsEnd, chunkEndPage: mjsChunk } = await import(
      '../../scripts/lib/chapter-endpages.mjs'
    );
    const fixture = () => [
      ch('Book I', 12, 1),
      ch('Chapter I', 12, 2),
      ch('Book II', 58, 1),
      ch('Chapter I', 61, 2),
    ];

    const ts = computeEndPages(fixture(), 407);
    const mj = mjsEnd(fixture(), 407) as Chapter[];
    expect(
      mj.map((_, i) => mjsChunk(mj, i, 407)),
    ).toEqual(ts.map((_, i) => chunkEndPage(ts, i, 407)));
  });
});
