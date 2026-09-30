/**
 * scripts/lib/ocr-targeting.mjs (#5244) — the page/book list shapes the batch and realtime OCR
 * scripts share, and the byte-bounded chunking that replaced the page-count bound (#3974).
 */
import { describe, it, expect } from 'vitest';
import { parsePageIds, parseBookIds, chunkByBytes } from '../../scripts/lib/ocr-targeting.mjs';

describe('parsePageIds', () => {
  it('takes a bare array of ids', () => {
    expect(parsePageIds(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });
  it('takes page_id objects under confirmed / suspected / pages, dropping duplicates in order', () => {
    const raw = { confirmed: [{ page_id: 'p1' }, 'p2'], suspected: [{ page_id: 'p2' }, { page_id: 'p3' }], pages: [{ nope: 1 }, 'p4'] };
    expect(parsePageIds(raw)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
  it('returns nothing for an object with none of the known keys', () => {
    expect(parsePageIds({ other: ['x'] })).toEqual([]);
  });
});

describe('parseBookIds', () => {
  it('reads one id per line, ignoring blanks and # comments', () => {
    expect(parseBookIds('b1\n\n  b2  # keely\n# whole-line comment\nb1\n')).toEqual(['b1', 'b2']);
  });
});

describe('chunkByBytes', () => {
  const size = (n: number) => n;
  it('bounds a chunk by bytes before item count', () => {
    const chunks = chunkByBytes([40, 40, 40, 40], size, { maxBytes: 100, maxItems: 10 });
    expect(chunks.map((c) => c.items)).toEqual([[40, 40], [40, 40]]);
    expect(chunks.map((c) => c.bytes)).toEqual([80, 80]);
  });
  it('bounds by item count when bytes allow more', () => {
    const chunks = chunkByBytes([1, 1, 1, 1, 1], size, { maxBytes: 1000, maxItems: 2 });
    expect(chunks.map((c) => c.items.length)).toEqual([2, 2, 1]);
  });
  it('never drops an item larger than the cap: it gets a chunk of its own', () => {
    const chunks = chunkByBytes([10, 500, 10], size, { maxBytes: 100, maxItems: 10 });
    expect(chunks.map((c) => c.items)).toEqual([[10], [500], [10]]);
    expect(chunks.flatMap((c) => c.items)).toHaveLength(3);
  });
  it('rejects a non-positive cap', () => {
    expect(() => chunkByBytes([1], size, { maxBytes: 0, maxItems: 1 })).toThrow();
  });
});
