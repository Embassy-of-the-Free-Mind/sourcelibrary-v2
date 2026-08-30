import type { Db, Document, Filter, UpdateFilter } from 'mongodb';

/**
 * The single place that writes `books.collections`.
 *
 * WHY THIS EXISTS (#4399). A collection's books grid is served from Supabase
 * (`books_catalog`), not Mongo — `browseBooks()` does
 * `.contains('collections', [slug])`. `scripts/workers/sync-books-catalog.mjs`
 * runs incrementally, selecting `{ updated_at: { $gt: lastSync } }`.
 *
 * `$addToSet` does **not** touch `updated_at`. So a collection created through
 * the API tagged its books in Mongo, computed a correct `book_count`, rendered
 * its page — and showed an empty grid, until some unrelated edit re-bumped
 * those books or someone ran the sync with `--full`. The emptiness reads as
 * "we hold nothing" rather than "the mirror never ran", which is why it was
 * rediscovered at least three times (the theosophy collection in May, the
 * aldine-press script, and again while building #4398).
 *
 * `$pull` needs the bump for the same reason in the other direction: an
 * untagged book that is never re-synced stays in the Supabase grid forever.
 *
 * The rule is therefore: **never write `books.collections` inline.** Route
 * through these two functions, which own the operator *and* the
 * `$currentDate: { updated_at: true }` bump together, so the two can never
 * drift apart again. `tests/unit/collection-tagging.test.ts` pins both halves —
 * the operator shape here, and the absence of inline writes elsewhere in
 * `src/`.
 */

export interface CollectionTagResult {
  /** Books the selector matched. */
  matchedCount: number;
  /** Books Mongo actually rewrote (always ≥ `changedCount`: the `updated_at` bump modifies every match). */
  modifiedCount: number;
  /**
   * Books whose `collections` array actually gained (or lost) the slug.
   * This is the number worth reporting to a caller — `modifiedCount` counts
   * the `updated_at` bump too, so it would over-report a re-run as new work.
   */
  changedCount: number;
}

/**
 * Add `slug` to `books.collections` for every book matching `selector`, and
 * bump `updated_at` so the incremental `books_catalog` sync picks the books up.
 *
 * Books already carrying the slug are still bumped — that is deliberate, so
 * re-running a tag operation repairs a book stranded by an earlier unbumped
 * write or a sync tick that failed mid-batch.
 */
export async function tagBooksIntoCollection(
  db: Db,
  slug: string,
  selector: Filter<Document>,
): Promise<CollectionTagResult> {
  return applyCollectionTag(db, slug, selector, 'add');
}

/**
 * Remove `slug` from `books.collections` for every book matching `selector`,
 * and bump `updated_at` so the untagging reaches the Supabase grid.
 */
export async function untagBooksFromCollection(
  db: Db,
  slug: string,
  selector: Filter<Document>,
): Promise<CollectionTagResult> {
  return applyCollectionTag(db, slug, selector, 'remove');
}

async function applyCollectionTag(
  db: Db,
  slug: string,
  selector: Filter<Document>,
  mode: 'add' | 'remove',
): Promise<CollectionTagResult> {
  if (!slug) throw new Error('collection slug is required');

  const books = db.collection('books');

  // Count the books that will genuinely change membership BEFORE the write —
  // afterwards `modifiedCount` includes every book whose `updated_at` moved.
  const membership = mode === 'add' ? { $ne: slug } : slug;
  const changedCount = await books.countDocuments({
    $and: [selector, { collections: membership }],
  } as Filter<Document>);

  const update = (
    mode === 'add'
      ? { $addToSet: { collections: slug }, $currentDate: { updated_at: true } }
      : { $pull: { collections: slug }, $currentDate: { updated_at: true } }
  ) as UpdateFilter<Document>;

  const result = await books.updateMany(selector, update);

  return {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    changedCount,
  };
}
