/**
 * The one way a SCRIPT removes a book from `books` (#4450).
 *
 * Mirror of `src/lib/delete-book.ts` — same rules, same shape, kept in step by
 * hand (the two runtimes don't share a module graph; `scripts/lib/r2-key.mjs`
 * and `src/lib/r2-key.ts` are the same arrangement).
 *
 * THE RULE
 *   `deleted_books` IS the recovery path (`POST /api/books/restore/[id]`).
 *   A delete that skips it is unrecoverable by design and silent. So archive
 *   and delete are one call, and the delete does not happen until the archive
 *   row has been read back.
 *
 *   Call `deleteBookArchived()`. `db.collection('books').deleteOne(...)` is the
 *   thing you don't call.
 *
 * THE OTHER HALF — look a book up by EITHER key
 *   A book has two identifiers: `_id`, and the `id` field holding its hex.
 *   Importers mint them together, but a re-created record (restore, re-import,
 *   recovery sweep) keeps `id` and gets a NEW `_id`; 16k+ books here are in
 *   that state. A lookup keyed only on `_id` returns nothing for a book that is
 *   alive and serving readers — which is exactly how #4450 came to be filed
 *   against five books that had never left. Use `findBookByEitherKey()`.
 */

import { ObjectId } from 'mongodb';

/**
 * Find a book by `id` OR `_id`, in that order — `id` is the key that survives
 * a re-create, so it is the one worth trusting first.
 *
 * @param {import('mongodb').Db} db
 * @param {string|ObjectId} ref
 * @param {object} [scope] extra filter, e.g. `{ tenantId }`
 * @returns {Promise<object|null>}
 */
export async function findBookByEitherKey(db, ref, scope = {}) {
  const s = String(ref);
  const byId = await db.collection('books').findOne({ ...scope, id: s });
  if (byId) return byId;
  if (ObjectId.isValid(s)) {
    return db.collection('books').findOne({ ...scope, _id: new ObjectId(s) });
  }
  return null;
}

/**
 * Archive a book and its pages to `deleted_books`, verify the archive row reads
 * back, then remove the book and its pages from the live collections.
 *
 * Throws instead of deleting when the archive cannot be re-read — a failed
 * archive must leave the book in place.
 *
 * @param {import('mongodb').Db} db
 * @param {string|ObjectId|object} ref  a book doc, or an `id`/`_id` naming one
 * @param {string} reason  recorded on the archive row; say who and why
 * @param {{scope?: object, stamp?: object}} [opts]
 * @returns {Promise<{bookId: string, title?: string, pagesArchived: number, archiveId: ObjectId}|null>}
 */
export async function deleteBookArchived(db, ref, reason, opts = {}) {
  if (!reason || typeof reason !== 'string') {
    throw new Error(
      'deleteBookArchived: a reason is required — it is the only record of why a book left the shelf.'
    );
  }
  const scope = opts.scope ?? {};

  const book =
    ref && typeof ref === 'object' && '_id' in ref
      ? ref
      : await findBookByEitherKey(db, ref, scope);
  if (!book) return null;

  const bookId = book.id || String(book._id);

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

  const archived = await db
    .collection('deleted_books')
    .findOne({ _id: archiveId }, { projection: { _id: 1 } });
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
 * Named so the deliberate permanent-delete path is recognisable as such rather
 * than looking like an ordinary `deleteOne`. Everything else wants
 * `deleteBookArchived()`.
 *
 * @param {import('mongodb').Db} db
 * @param {string|ObjectId|object} ref
 * @param {string} reason
 * @param {{scope?: object}} [opts]
 */
export async function purgeBookUnarchived(db, ref, reason, opts = {}) {
  if (!reason || typeof reason !== 'string') {
    throw new Error('purgeBookUnarchived: a reason is required.');
  }
  const scope = opts.scope ?? {};
  const book =
    ref && typeof ref === 'object' && '_id' in ref
      ? ref
      : await findBookByEitherKey(db, ref, scope);
  if (!book) return null;

  const bookId = book.id || String(book._id);
  const pagesResult = await db.collection('pages').deleteMany({ ...scope, book_id: bookId });
  await db.collection('books').deleteOne({ ...scope, _id: book._id });

  return { bookId, title: book.title, pagesDeleted: pagesResult.deletedCount ?? 0 };
}
