import { describe, it, expect, beforeEach } from 'vitest';
import { matchBookMetadata, resetBookMetadataSnapshot } from '@/lib/search/book-metadata-snapshot';
import { stemmedQueryRegex } from '@/lib/search/word-forms';

// The book lane's metadata fallback moved from a Mongo regex over every live
// book to the same RegExp objects over an in-memory snapshot (#2049). These pin
// what the Mongo query did: every word must match at least one of the five
// fields, an array field matches if any element does, non-strings never match,
// rows come back in the order they were read, and a failed load hands the
// caller null so it can run the Mongo query instead.

const DOCS = [
  { id: 'a', title: 'De materia medica', categories: ['Medicine'], language: 'Latin' },
  { id: 'b', title: 'Herbal', subject_keywords: ['botany', 'Botany', 'gardens'], language: 'English' },
  { id: 'c', display_title: 'Botanical gardens of Padua', language: 'Italian' },
  { id: 'd', title: 42, subject_keywords: [7, 'egyptian funerary'], language: ['Coptic'] },
  { id: 7, title: 'no string id' },
];

function fakeDb(opts: { fail?: boolean; calls?: { n: number } } = {}) {
  return {
    collection: () => ({
      find: () => {
        const cursor: any = {
          sort: () => cursor, batchSize: () => cursor, maxTimeMS: () => cursor,
          toArray: async () => {
            if (opts.calls) opts.calls.n++;
            if (opts.fail) throw new Error('boom');
            return DOCS;
          },
        };
        return cursor;
      },
    }),
  } as any;
}

const rx = (q: string) => q.split(/\s+/).map(w => stemmedQueryRegex(w));

describe('matchBookMetadata', () => {
  beforeEach(() => resetBookMetadataSnapshot());

  it('needs every word to match one of the five fields', async () => {
    const r = await matchBookMetadata(fakeDb(), rx('botanical gardens'), 20);
    // "botanical" folds to the botan- stem (#5517), so b's keyword "botany" counts.
    expect(r).toEqual({ ids: ['b', 'c'], complete: true });
    expect((await matchBookMetadata(fakeDb(), rx('materia latin'), 20))?.ids).toEqual(['a']);
    expect((await matchBookMetadata(fakeDb(), rx('materia english'), 20))?.ids).toEqual([]);
  });

  it('matches inside arrays and ignores non-strings', async () => {
    expect((await matchBookMetadata(fakeDb(), rx('coptic'), 20))?.ids).toEqual(['d']);
    expect((await matchBookMetadata(fakeDb(), rx('42'), 20))?.ids).toEqual([]);
    expect((await matchBookMetadata(fakeDb(), rx('funerary'), 20))?.ids).toEqual(['d']);
  });

  it('stops at the cap and says the list is incomplete', async () => {
    expect(await matchBookMetadata(fakeDb(), [/./], 2)).toEqual({ ids: ['a', 'b'], complete: false });
  });

  it('loads once and reuses the snapshot', async () => {
    const calls = { n: 0 };
    const db = fakeDb({ calls });
    await matchBookMetadata(db, rx('herbal'), 20);
    await matchBookMetadata(db, rx('padua'), 20);
    expect(calls.n).toBe(1);
  });

  it('returns null when the snapshot cannot load', async () => {
    expect(await matchBookMetadata(fakeDb({ fail: true }), rx('herbal'), 20)).toBeNull();
  });
});
