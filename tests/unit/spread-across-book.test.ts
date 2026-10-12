import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { spreadAcrossBook } from '../../scripts/lib/spread-across-book.mjs';

/**
 * Phase 6 kept `quotes.slice(0, 15)`: with 3-5 quotes per batch that is the first few batches, so
 * 45% of long books had every pull-quote in their first quarter (#4387). These pin the replacement
 * on the shape the worker actually produces: a flat, book-ordered list of per-batch quotes.
 */

/** 4 quotes per batch, each batch covering `pagesPerBatch` pages, as processAllBatches returns them. */
function batchQuotes(batches: number, pagesPerBatch = 12) {
  return Array.from({ length: batches }, (_, b) =>
    Array.from({ length: 4 }, (_, q) => ({ text: `b${b}q${q}`, page: b * pagesPerBatch + q * 3 + 1 }))
  ).flat();
}

describe('spreadAcrossBook', () => {
  it('reaches the end of a long book where slice(0, 15) stopped in the first quarter', () => {
    const quotes = batchQuotes(40);
    const lastPage = quotes[quotes.length - 1].page;

    const before = quotes.slice(0, 15);
    expect(Math.max(...before.map((q) => q.page)) / lastPage).toBeLessThan(0.25);

    const after = spreadAcrossBook(quotes, 15);
    expect(after).toHaveLength(15);
    expect(after[0]).toBe(quotes[0]);
    expect(after[14]).toBe(quotes[quotes.length - 1]);
    // every quarter of the book is represented
    for (let quarter = 0; quarter < 4; quarter++) {
      expect(after.some((q: { page: number }) => q.page > (lastPage * quarter) / 4 && q.page <= (lastPage * (quarter + 1)) / 4)).toBe(true);
    }
  });

  it('keeps book order and never repeats an item', () => {
    for (const len of [16, 17, 29, 30, 31, 160, 1000]) {
      const quotes = batchQuotes(Math.ceil(len / 4)).slice(0, len);
      const picked = spreadAcrossBook(quotes, 15);
      expect(picked).toHaveLength(15);
      expect(new Set(picked).size).toBe(15);
      const pages = picked.map((q: { page: number }) => q.page);
      expect(pages).toEqual([...pages].sort((a, b) => a - b));
    }
  });

  it('returns a short list unchanged, as a copy', () => {
    const quotes = batchQuotes(3);
    const picked = spreadAcrossBook(quotes, 15);
    expect(picked).toEqual(quotes);
    expect(picked).not.toBe(quotes);
  });

  it('tolerates a missing list and a non-positive n', () => {
    expect(spreadAcrossBook(undefined, 15)).toEqual([]);
    expect(spreadAcrossBook(null, 15)).toEqual([]);
    expect(spreadAcrossBook(batchQuotes(5), 0)).toEqual([]);
    expect(spreadAcrossBook(batchQuotes(5), 1)).toEqual([batchQuotes(5)[0]]);
  });
});
