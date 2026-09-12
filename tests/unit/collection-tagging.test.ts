/**
 * Tagging a book into a collection must reach the Supabase mirror.
 *
 * INCIDENT (#4399, and at least twice before it). A collection's books grid is
 * served from Supabase `books_catalog` — `browseBooks()` does
 * `.contains('collections', [slug])`. `scripts/workers/sync-books-catalog.mjs`
 * runs incrementally, selecting `{ updated_at: { $gt: lastSync } }`.
 * `$addToSet: { collections: slug }` does not touch `updated_at`, so every
 * collection created through the API tagged its books in Mongo, computed a
 * correct `book_count`, rendered its page — and served an EMPTY GRID until an
 * unrelated edit re-bumped those books or someone ran the sync with `--full`.
 *
 * It reads as "we hold nothing", not as "the mirror never ran", which is why it
 * was rediscovered three times: the theosophy collection in May, then
 * `create-aldine-press-collection.mjs` (which fixed it locally, in a comment),
 * then again while building #4398.
 *
 * THE RULE. `books.collections` is written in exactly one module —
 * `src/lib/collection-tagging.ts` — which owns the array operator and the
 * `updated_at` bump together, so the two cannot drift apart again.
 *
 * This file pins both halves:
 *   1. BEHAVIOUR — a tagged (and an untagged) book satisfies the incremental
 *      sync selector afterwards. Guarded by a negative control: a bare
 *      `$addToSet` must NOT satisfy it, or the assertion proves nothing.
 *   2. STRUCTURE — no other file under `src/` writes `collections` with
 *      `$addToSet`/`$pull` inline. A behavioural test on the helper cannot see
 *      a new call site that bypasses the helper; this can.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import type { Db } from 'mongodb';
import { tagBooksIntoCollection, untagBooksFromCollection } from '@/lib/collection-tagging';

// ── A fake `books` collection that honours the operators we care about ──────

type Book = { id: string; collections?: string[]; updated_at: Date };

/** Minimal filter evaluation — enough for `{ id: { $in: [...] } }`, `$and`,
 *  `$or`, `$ne`, and a bare equality against an array field. */
function matches(doc: Book, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$and') return (cond as Record<string, unknown>[]).every((f) => matches(doc, f));
    if (key === '$or') return (cond as Record<string, unknown>[]).some((f) => matches(doc, f));
    const value = (doc as Record<string, unknown>)[key];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ('$in' in c) {
        const list = c.$in as unknown[];
        return Array.isArray(value) ? value.some((v) => list.includes(v)) : list.includes(value);
      }
      if ('$ne' in c) {
        return Array.isArray(value) ? !value.includes(c.$ne) : value !== c.$ne;
      }
    }
    // Mongo matches a scalar against an array field by membership.
    return Array.isArray(value) ? value.includes(cond) : value === cond;
  });
}

function makeDb(books: Book[], now: Date) {
  /** Every update document the helper handed to Mongo, for shape assertions. */
  const updates: Record<string, unknown>[] = [];

  const booksCollection = {
    countDocuments: async (filter: Record<string, unknown>) =>
      books.filter((b) => matches(b, filter)).length,
    updateMany: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      updates.push(update);
      const hits = books.filter((b) => matches(b, filter));
      let modified = 0;
      for (const book of hits) {
        let touched = false;
        const addToSet = update.$addToSet as Record<string, string> | undefined;
        if (addToSet) {
          for (const [field, value] of Object.entries(addToSet)) {
            const arr = ((book as Record<string, unknown>)[field] as string[]) ?? [];
            if (!arr.includes(value)) {
              (book as Record<string, unknown>)[field] = [...arr, value];
              touched = true;
            }
          }
        }
        const pull = update.$pull as Record<string, string> | undefined;
        if (pull) {
          for (const [field, value] of Object.entries(pull)) {
            const arr = ((book as Record<string, unknown>)[field] as string[]) ?? [];
            if (arr.includes(value)) {
              (book as Record<string, unknown>)[field] = arr.filter((v) => v !== value);
              touched = true;
            }
          }
        }
        const currentDate = update.$currentDate as Record<string, boolean> | undefined;
        if (currentDate) {
          for (const field of Object.keys(currentDate)) {
            (book as Record<string, unknown>)[field] = now;
            touched = true;
          }
        }
        if (touched) modified += 1;
      }
      return { matchedCount: hits.length, modifiedCount: modified };
    },
  };

  const db = {
    collection: (name: string) => {
      if (name !== 'books') throw new Error(`unexpected collection: ${name}`);
      return booksCollection;
    },
  } as unknown as Db;

  return { db, updates, booksCollection };
}

const LAST_SYNC = new Date('2026-08-31T10:00:00Z');
const AFTER_SYNC = new Date('2026-08-31T10:05:00Z');

/** The selector `scripts/workers/sync-books-catalog.mjs` builds for an
 *  incremental run (`query = { updated_at: { $gt: lastSync } }`, :~180). */
function incrementalSyncPicksUp(book: Book, lastSync = LAST_SYNC): boolean {
  return book.updated_at > lastSync;
}

describe('collection tagging reaches the books_catalog mirror', () => {
  it('a tagged book is picked up by the incremental sync selector', async () => {
    const book: Book = { id: 'b1', collections: ['alchemy'], updated_at: LAST_SYNC };
    const { db } = makeDb([book], AFTER_SYNC);

    await tagBooksIntoCollection(db, 'hermetica', { id: { $in: ['b1'] } });

    expect(book.collections).toContain('hermetica');
    expect(incrementalSyncPicksUp(book)).toBe(true);
  });

  it('NEGATIVE CONTROL: a bare $addToSet is NOT picked up', async () => {
    // Without this the assertion above could pass for the wrong reason. This is
    // the exact write the three incidents shipped.
    const book: Book = { id: 'b1', collections: ['alchemy'], updated_at: LAST_SYNC };
    const { booksCollection } = makeDb([book], AFTER_SYNC);

    await booksCollection.updateMany(
      { id: { $in: ['b1'] } },
      { $addToSet: { collections: 'hermetica' } },
    );

    expect(book.collections).toContain('hermetica'); // Mongo is right …
    expect(incrementalSyncPicksUp(book)).toBe(false); // … and the grid stays empty.
  });

  it('an untagged book is picked up too, so it leaves the grid', async () => {
    const book: Book = { id: 'b1', collections: ['alchemy', 'hermetica'], updated_at: LAST_SYNC };
    const { db } = makeDb([book], AFTER_SYNC);

    await untagBooksFromCollection(db, 'hermetica', { id: { $in: ['b1'] } });

    expect(book.collections).toEqual(['alchemy']);
    expect(incrementalSyncPicksUp(book)).toBe(true);
  });

  it('both writes carry $currentDate: { updated_at: true }', async () => {
    const { db, updates } = makeDb(
      [{ id: 'b1', collections: [], updated_at: LAST_SYNC }],
      AFTER_SYNC,
    );

    await tagBooksIntoCollection(db, 'hermetica', { id: { $in: ['b1'] } });
    await untagBooksFromCollection(db, 'hermetica', { id: { $in: ['b1'] } });

    expect(updates).toHaveLength(2);
    for (const update of updates) {
      expect(update.$currentDate).toEqual({ updated_at: true });
    }
    expect(updates[0].$addToSet).toEqual({ collections: 'hermetica' });
    expect(updates[1].$pull).toEqual({ collections: 'hermetica' });
  });

  it('reports newly tagged books, not the books the bump merely touched', async () => {
    // `modifiedCount` now counts the `updated_at` bump, so it would report an
    // already-tagged book as new work. Routes report `changedCount` instead.
    const books: Book[] = [
      { id: 'b1', collections: ['hermetica'], updated_at: LAST_SYNC },
      { id: 'b2', collections: [], updated_at: LAST_SYNC },
    ];
    const { db } = makeDb(books, AFTER_SYNC);

    const result = await tagBooksIntoCollection(db, 'hermetica', { id: { $in: ['b1', 'b2'] } });

    expect(result.matchedCount).toBe(2);
    expect(result.modifiedCount).toBe(2); // both bumped
    expect(result.changedCount).toBe(1); // only b2 actually gained the slug
    // The already-tagged book is re-synced on purpose: that repairs a row
    // stranded by an earlier unbumped write or a half-failed sync tick.
    expect(incrementalSyncPicksUp(books[0])).toBe(true);
  });
});

// ── Structural half: nothing under src/ writes the array inline ─────────────

const root = path.join(__dirname, '..', '..');
const HELPER = path.join(root, 'src/lib/collection-tagging.ts');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** `$addToSet: { collections: ... }` / `$pull: { collections: ... }`, allowing
 *  whitespace and a line break between the operator and the field. */
const INLINE_WRITE = /\$(?:addToSet|pull)\s*:\s*\{\s*collections\s*:/;

describe('books.collections is written in one place', () => {
  const files = sourceFiles(path.join(root, 'src')).filter((f) => f !== HELPER);

  it('finds the source tree it means to guard', () => {
    // Guard the guard: a path change that empties this list must fail loudly.
    expect(files.length).toBeGreaterThan(500);
  });

  it('no file outside src/lib/collection-tagging.ts writes the array inline', () => {
    const offenders = files.filter((f) => INLINE_WRITE.test(readFileSync(f, 'utf8')));
    expect(
      offenders.map((f) => path.relative(root, f)),
      'route these through tagBooksIntoCollection / untagBooksFromCollection — ' +
        'an inline $addToSet leaves updated_at alone and the Supabase grid empty (#4399)',
    ).toEqual([]);
  });

  it('the helper itself still pairs each operator with the bump', () => {
    // Every line that writes the array must carry `$currentDate` on that same
    // line — the pairing is the whole point of the module.
    const writeLines = readFileSync(HELPER, 'utf8')
      .split('\n')
      .filter((line) => INLINE_WRITE.test(line) && !line.trimStart().startsWith('*'));
    expect(writeLines).toHaveLength(2);
    for (const line of writeLines) {
      expect(line).toContain('$currentDate: { updated_at: true }');
    }
  });
});
