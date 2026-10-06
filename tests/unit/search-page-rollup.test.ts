import { describe, it, expect } from 'vitest';
import type { Db } from 'mongodb';
import {
  rollupTerms,
  buildRollupCountStage,
  buildBestPageStage,
  countMatchingPagesByBook,
  bestPagePerBook,
  evidenceTier,
  compareEvidence,
} from '@/lib/search/page-rollup';

// The page-lane roll-up for /api/search (#5905): "Drebbel" returned 9 results
// while 157 live works print the name, because the lane read its 25 best
// pages and they sat in 3 books.

describe('rollupTerms — the words a page must all print', () => {
  it('keeps a single name', () => {
    expect(rollupTerms('Drebbel')).toEqual(['Drebbel']);
  });

  it('requires every content word and drops function words', () => {
    expect(rollupTerms('motion of the heart and blood')).toEqual(['motion', 'heart', 'blood']);
  });

  it('keeps a hyphenated word whole, so its parts must sit side by side', () => {
    expect(rollupTerms('self-regulating oven')).toEqual(['self-regulating', 'oven']);
  });

  it('treats a quoted query as one phrase', () => {
    expect(rollupTerms('"venus humanitas"')).toEqual(['venus humanitas']);
  });

  it('keeps non-Latin words, including short ones', () => {
    // A length floor or an ASCII class would erase these (non-latin-text-operations.md).
    expect(rollupTerms('薛己')).toEqual(['薛己']);
    expect(rollupTerms('Πλάτων')).toEqual(['Πλάτων']);
    expect(rollupTerms('Zhu Xi')).toEqual(['Zhu', 'Xi']);
  });

  it('abstains (null), rather than matching nothing, when it cannot judge', () => {
    expect(rollupTerms('of the')).toBeNull();          // only function words
    expect(rollupTerms('— … !')).toBeNull();           // only punctuation
    expect(rollupTerms('""')).toBeNull();              // empty phrase
    expect(rollupTerms('what did the alchemists say about the nature of mercury and sulphur and salt together'))
      .toBeNull();                                     // a sentence
  });
});

describe('roll-up search stages', () => {
  const must = (stage: any) => (stage.$searchMeta?.facet.operator ?? stage.$search).compound.must;
  const filter = (stage: any) => (stage.$searchMeta?.facet.operator ?? stage.$search).compound.filter;

  it('requires each term, as a phrase, in the translation or the OCR', () => {
    const clauses = must(buildRollupCountStage(['Basil', 'Valentine']));
    expect(clauses).toHaveLength(2);
    for (const [i, term] of ['Basil', 'Valentine'].entries()) {
      expect(clauses[i].compound.minimumShouldMatch).toBe(1);
      expect(clauses[i].compound.should.map((s: any) => [s.phrase.query, s.phrase.path])).toEqual([
        [term, 'translation.data'],
        [term, 'ocr.data'],
      ]);
    }
  });

  it('never counts hidden pages (page_number ≤ 0)', () => {
    expect(filter(buildRollupCountStage(['mercury']))).toContainEqual({ range: { path: 'page_number', gt: 0 } });
    expect(filter(buildBestPageStage(['mercury'], 'b1'))).toContainEqual({ range: { path: 'page_number', gt: 0 } });
  });

  it('has no book filter without an allow-list, and passes one through', () => {
    const none = filter(buildRollupCountStage(['mercury']));
    expect(none.some((f: any) => f.in || f.equals)).toBe(false);
    expect(filter(buildRollupCountStage(['mercury'], ['a', 'b']))).toContainEqual({ in: { path: 'book_id', value: ['a', 'b'] } });
  });

  it('matches NOTHING for an empty allow-list — must not fall open to the corpus (#2760)', () => {
    const f = filter(buildRollupCountStage(['mercury'], [])).find((x: any) => x.in || x.equals);
    expect(f).toBeDefined();
    expect(f.in).toBeUndefined();
    expect(f.equals.path).toBe('book_id');
    expect(f.equals.value).not.toBe('');
  });

  it('scopes the best-page search to exactly one book', () => {
    expect(filter(buildBestPageStage(['mercury'], 'book-1'))).toContainEqual({ equals: { path: 'book_id', value: 'book-1' } });
  });
});

/** A `db` whose pages collection answers `aggregate` from a function of the pipeline. */
function fakeDb(answer: (pipeline: any[]) => any[] | Promise<any[]>): { db: Db; pipelines: any[][] } {
  const pipelines: any[][] = [];
  const db = {
    collection: () => ({
      aggregate: (pipeline: any[]) => {
        pipelines.push(pipeline);
        return { toArray: async () => answer(pipeline) };
      },
    }),
  } as unknown as Db;
  return { db, pipelines };
}

describe('countMatchingPagesByBook', () => {
  it('returns the facet buckets as book counts, most pages first', async () => {
    const { db, pipelines } = fakeDb(() => [{
      count: { lowerBound: 76 },
      facet: { book: { buckets: [{ _id: 'naber', count: 51 }, { _id: 'monconys', count: 25 }] } },
    }]);
    expect(await countMatchingPagesByBook(db, ['Drebbel'])).toEqual([
      { book_id: 'naber', pages: 51 },
      { book_id: 'monconys', pages: 25 },
    ]);
    // One index-only query: no page documents are read to count.
    expect(pipelines).toHaveLength(1);
    expect(Object.keys(pipelines[0][0])).toEqual(['$searchMeta']);
  });

  it('returns no books when nothing matches', async () => {
    const { db } = fakeDb(() => []);
    expect(await countMatchingPagesByBook(db, ['zzzz'])).toEqual([]);
  });
});

describe('bestPagePerBook', () => {
  const bookOf = (pipeline: any[]) =>
    pipeline[0].$search.compound.filter.find((f: any) => f.equals).equals.value as string;

  it('returns one page per book, in the order asked, skipping books with none', async () => {
    const { db } = fakeDb(pipeline => {
      const id = bookOf(pipeline);
      return id === 'empty' ? [] : [{ id: `${id}-page`, book_id: id, page_number: 7 }];
    });
    const pages = await bestPagePerBook(db, ['Drebbel'], ['c', 'empty', 'a', 'b']);
    expect(pages.map(p => p.book_id)).toEqual(['c', 'a', 'b']);
  });

  it('reads one content page per book: limit 1, after non-content pages are dropped', async () => {
    const { db, pipelines } = fakeDb(() => []);
    await bestPagePerBook(db, ['Drebbel'], ['a']);
    const [, match, limit] = pipelines[0];
    expect(match.$match.page_type.$nin).toContain('title-page');
    expect(limit).toEqual({ $limit: 1 });
  });

  it('never runs more searches at once than the concurrency bound', async () => {
    let running = 0;
    let peak = 0;
    const { db } = fakeDb(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 2));
      running--;
      return [];
    });
    await bestPagePerBook(db, ['Drebbel'], Array.from({ length: 25 }, (_, i) => `b${i}`), 10);
    expect(peak).toBe(10);
  });
});

describe('evidence rung', () => {
  it('tiers page counts coarsely', () => {
    expect([1, 2, 3, 4, 7, 8, 51].map(evidenceTier)).toEqual([0, 1, 1, 2, 2, 3, 5]);
  });

  it('gives no count its own tier below a single mention', () => {
    expect(evidenceTier(undefined)).toBe(-1);
    expect(evidenceTier(null)).toBe(-1);
    expect(evidenceTier(0)).toBe(-1);
  });

  it('puts the 51-page study above the passing mention', () => {
    expect(compareEvidence(51, 1)).toBeLessThan(0);
    expect(compareEvidence(1, 51)).toBeGreaterThan(0);
    expect(compareEvidence(1, undefined)).toBeLessThan(0);
  });

  it('defers to the next rung when the evidence is about the same', () => {
    // 12 pages against 9 must not override closeness to the source (#2395).
    expect(compareEvidence(12, 9)).toBe(0);
    expect(compareEvidence(undefined, undefined)).toBe(0);
  });

  it('sorts consistently', () => {
    const rows = [1, undefined, 51, 3, 9, 2, 12];
    const sorted = [...rows].sort(compareEvidence).map(evidenceTier);
    expect(sorted).toEqual([5, 3, 3, 1, 1, 0, -1]);
  });
});
