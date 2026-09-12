/**
 * The one way to remove a book from `books` (#4450).
 *
 * THE RULE
 *   `deleted_books` IS the recovery path — `POST /api/books/restore/[id]` reads
 *   nothing else. A delete that skips it is unrecoverable *by design* and
 *   silent: nothing errors, no alarm fires, and the only way anyone finds out
 *   is a reader hitting a dead URL. So the archive write and the delete are one
 *   operation, not two steps a caller is trusted to remember.
 *
 *   Call `deleteBookArchived()`. Treat `db.collection('books').deleteOne(...)`
 *   as the thing you don't call — the same shape as `assertBookScopedKey` for
 *   R2 keys (#3362/#3365). A convention five scripts follow and one doesn't is
 *   not a guard; a helper that refuses to delete until it has re-read the
 *   archive row is.
 *
 * THE OTHER HALF — look a book up by EITHER key
 *   A book carries two identifiers: the Mongo `_id`, and the `id` field that
 *   holds its hex string. Importers mint them together
 *   (`{ _id: oid, id: oid.toHexString() }`), so they normally agree — but a
 *   record that is re-created (restore, re-import, a recovery sweep) keeps its
 *   `id` and gets a NEW `_id`. 16k+ books in this corpus are in that state.
 *
 *   A lookup keyed only on `_id` therefore returns nothing for a book that is
 *   alive, visible, and serving readers at its URL. That is exactly how #4450
 *   was filed: five books reported "vanished, no ledger row" were all present
 *   the whole time, findable by `id`. `findBookByEitherKey()` is the fix, and
 *   every delete path here goes through it.
 *
 * The mirror for `scripts/` is `scripts/lib/delete-book.mjs`. Keep them in step.
 */

import { Db, Document, ObjectId } from 'mongodb';

export interface DeleteBookOptions {
  /** Extra filter applied to every read and write, e.g. `{ tenantId }`. */
  scope?: Document;
  /** Extra fields stamped onto the `deleted_books` row, e.g. `{ tenantId }`. */
  stamp?: Document;
}

export interface DeleteBookResult {
  bookId: string;
  title?: string;
  /** Pages copied into the archive row and then removed from `pages`. */
  pagesArchived: number;
  /** `_id` of the `deleted_books` row — the handle the restore route needs. */
  archiveId: ObjectId;
}

/**
 * Find a book by `id` OR `_id`, in that order.
 *
 * Order matters: `id` is the stable, reader-facing key that survives a
 * re-create; `_id` does not. Checking `id` first means a churned record is
 * found by the key that still means something.
 */
export async function findBookByEitherKey(
  db: Db,
  ref: string | ObjectId,
  scope: Document = {}
): Promise<Document | null> {
  const s = String(ref);
  const byId = await db.collection('books').findOne({ ...scope, id: s });
  if (byId) return byId;
  if (ObjectId.isValid(s)) {
    return db.collection('books').findOne({ ...scope, _id: new ObjectId(s) });
  }
  return null;
}

/**
 * Archive a book (with its pages) to `deleted_books`, verify the archive row is
 * readable, and only then remove the book and its pages from the live
 * collections.
 *
 * Throws rather than deleting if the archive write cannot be read back — a
 * failed archive must leave the book in place, never half-removed. The caller
 * is expected to surface that error, not swallow it.
 *
 * @param ref   a book document, or an `id` / `_id` naming one
 * @param reason free text recorded on the archive row; say who and why
 */
export async function deleteBookArchived(
  db: Db,
  ref: string | ObjectId | Document,
  reason: string,
  opts: DeleteBookOptions = {}
): Promise<DeleteBookResult | null> {
  if (!reason || typeof reason !== 'string') {
    throw new Error(
      'deleteBookArchived: a reason is required — it is the only record of why a book left the shelf.'
    );
  }
  const scope = opts.scope ?? {};

  const book =
    typeof ref === 'object' && ref !== null && '_id' in ref
      ? (ref as Document)
      : await findBookByEitherKey(db, ref as string | ObjectId, scope);
  if (!book) return null;

  const bookId: string = book.id || String(book._id);

  const pages = await db
    .collection('pages')
    .find({ ...scope, book_id: bookId })
    .maxTimeMS(30000)
    .toArray();

  const archiveId = new ObjectId();
  await db.collection('deleted_books').insertOne({
    ...book,
    ...(opts.stamp ?? {}),
    _id: archiveId,
    pages,
    deleted_at: new Date(),
    deletion_reason: reason,
    original_id: book._id,
  });

  // Read the archive back before destroying the original. An insert that
  // reported success but cannot be read is the one case where deleting would
  // be unrecoverable, so it is the one case worth a second round trip.
  const archived = await db.collection('deleted_books').findOne(
    { _id: archiveId },
    { projection: { _id: 1, id: 1 } }
  );
  if (!archived) {
    throw new Error(
      `deleteBookArchived: archive row for ${bookId} is not readable after insert — refusing to delete. The book is untouched.`
    );
  }

  await db.collection('pages').deleteMany({ ...scope, book_id: bookId });
  await db.collection('books').deleteOne({ ...scope, _id: book._id });

  return { bookId, title: book.title, pagesArchived: pages.length, archiveId };
}

/**
 * Remove a book WITHOUT archiving it. Unrecoverable.
 *
 * This exists so the deliberate permanent-delete path has a name a reader can
 * recognise, instead of looking like an ordinary `deleteOne`. Reach for it only
 * where an operator has explicitly asked for destruction; everything else wants
 * `deleteBookArchived()`.
 */
export async function purgeBookUnarchived(
  db: Db,
  ref: string | ObjectId | Document,
  reason: string,
  opts: DeleteBookOptions = {}
): Promise<{ bookId: string; title?: string; pagesDeleted: number } | null> {
  if (!reason || typeof reason !== 'string') {
    throw new Error('purgeBookUnarchived: a reason is required.');
  }
  const scope = opts.scope ?? {};
  const book =
    typeof ref === 'object' && ref !== null && '_id' in ref
      ? (ref as Document)
      : await findBookByEitherKey(db, ref as string | ObjectId, scope);
  if (!book) return null;

  const bookId: string = book.id || String(book._id);
  const pagesResult = await db.collection('pages').deleteMany({ ...scope, book_id: bookId });
  await db.collection('books').deleteOne({ ...scope, _id: book._id });

  return { bookId, title: book.title, pagesDeleted: pagesResult.deletedCount ?? 0 };
}
