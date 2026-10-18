import { describe, it, expect, beforeEach } from 'vitest';
import { matchBookMetadata, loadBookMetadataSnapshot, resetBookMetadataSnapshot } from '@/lib/search/book-metadata-snapshot';
import { stemmedQueryRegex } from '@/lib/search/word-forms';

// The book lane's metadata fallback moved from a Mongo regex over every live
// book to the same RegExp objects over an in-memory snapshot (#2049). These pin
// what the Mongo query did: every word must match at least one of the five
// fields, an array field matches if any element does, non-strings never match,
// rows come back in the order they were read, and until the snapshot is loaded
// (or when it cannot be) the caller gets null and runs the Mongo query.

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
/** A loaded snapshot over DOCS, then the match. */
async function match(regexes: RegExp[], cap: number) {
  const db = fakeDb();
  await loadBookMetadataSnapshot(db);
  return matchBookMetadata(db, regexes, cap);
}

describe('matchBookMetadata', () => {
  beforeEach(() => resetBookMetadataSnapshot());

  it('needs every word to match one of the five fields', async () => {
    const r = await match(rx('botanical gardens'), 20);
    // "botanical" folds to the botan- stem (#5517), so b's keyword "botany" counts.
    expect(r).toEqual({ ids: ['b', 'c'], complete: true });
    expect((await match(rx('materia latin'), 20))?.ids).toEqual(['a']);
    expect((await match(rx('materia english'), 20))?.ids).toEqual([]);
  });

  it('matches inside arrays and ignores non-strings', async () => {
    expect((await match(rx('coptic'), 20))?.ids).toEqual(['d']);
    expect((await match(rx('42'), 20))?.ids).toEqual([]);
    expect((await match(rx('funerary'), 20))?.ids).toEqual(['d']);
  });

  it('stops at the cap and says the list is incomplete', async () => {
    expect(await match([/./], 2)).toEqual({ ids: ['a', 'b'], complete: false });
  });

  it('a cold instance gets null at once and loads in the background, once', async () => {
    const calls = { n: 0 };
    const db = fakeDb({ calls });
    expect(matchBookMetadata(db, rx('herbal'), 20)).toBeNull();
    expect(matchBookMetadata(db, rx('herbal'), 20)).toBeNull();
    await loadBookMetadataSnapshot(db);
    expect(matchBookMetadata(db, rx('padua'), 20)?.ids).toEqual(['c']);
    expect(calls.n).toBe(1);
  });

  it('stays null when the snapshot cannot load', async () => {
    const db = fakeDb({ fail: true });
    expect(matchBookMetadata(db, rx('herbal'), 20)).toBeNull();
    await loadBookMetadataSnapshot(db).catch(() => {});
    expect(matchBookMetadata(db, rx('herbal'), 20)).toBeNull();
  });
});
