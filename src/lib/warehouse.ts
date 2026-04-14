/**
 * Warehouse collections — move archived books out of the live `books`/`pages`
 * collections to reduce Atlas query load.
 *
 * Books with pipeline_auto.status in ['archiving', 'archive_complete'] live in
 * `books_warehouse` / `pages_warehouse`. When the pipeline is ready to process
 * them (OCR submission), they get promoted back to the live collections.
 *
 * This cuts the live collections by ~75%, making all queries dramatically faster.
 */

import { Db, Document } from 'mongodb';

/** Statuses that belong in the warehouse */
export const WAREHOUSE_STATUSES = ['archiving', 'archive_complete'] as const;

/**
 * Move a single book and its pages from live to warehouse collections.
 * Idempotent — skips if the book is already in warehouse.
 */
export async function moveToWarehouse(db: Db, bookId: string): Promise<boolean> {
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) return false;

  // Never warehouse artworks — they live in books with resource_type set
  if (book.resource_type) return false;

  // Insert into warehouse (use upsert to be idempotent)
  await db.collection('books_warehouse').replaceOne(
    { id: bookId },
    book,
    { upsert: true }
  );

  // Move pages in bulk
  const pages = await db.collection('pages').find({ book_id: bookId }).toArray();
  if (pages.length > 0) {
    const bulkOps = pages.map(page => ({
      replaceOne: {
        filter: { _id: page._id },
        replacement: page,
        upsert: true,
      }
    }));
    await db.collection('pages_warehouse').bulkWrite(bulkOps, { ordered: false });
  }

  // Delete from live collections only after warehouse write succeeds
  await db.collection('pages').deleteMany({ book_id: bookId });
  await db.collection('books').deleteOne({ id: bookId });

  return true;
}

/**
 * Move a single book and its pages from warehouse back to live collections.
 * Called when the pipeline is ready to process the book (e.g., OCR submission).
 * Idempotent — skips if the book is already in the live collection.
 */
export async function promoteFromWarehouse(db: Db, bookId: string): Promise<boolean> {
  const book = await db.collection('books_warehouse').findOne({ id: bookId });
  if (!book) return false;

  // Insert into live (upsert for idempotency)
  await db.collection('books').replaceOne(
    { id: bookId },
    book,
    { upsert: true }
  );

  // Move pages in bulk
  const pages = await db.collection('pages_warehouse').find({ book_id: bookId }).toArray();
  if (pages.length > 0) {
    const bulkOps = pages.map(page => ({
      replaceOne: {
        filter: { _id: page._id },
        replacement: page,
        upsert: true,
      }
    }));
    await db.collection('pages').bulkWrite(bulkOps, { ordered: false });
  }

  // Mark warehouse copy as promoted but keep it (permanent backup)
  await db.collection('books_warehouse').updateOne(
    { id: bookId },
    { $set: { promoted_at: new Date(), promoted_to: 'live' } }
  );

  return true;
}

/**
 * Find a book across both live and warehouse collections.
 * Returns { book, isWarehouse } or null.
 */
export async function findBookAnywhere(
  db: Db,
  bookId: string,
  projection?: Document
): Promise<{ book: Document; isWarehouse: boolean } | null> {
  const opts = projection ? { projection } : undefined;
  const live = await db.collection('books').findOne({ id: bookId }, opts);
  if (live) return { book: live, isWarehouse: false };
  const warehouse = await db.collection('books_warehouse').findOne({ id: bookId }, opts);
  if (warehouse) return { book: warehouse, isWarehouse: true };
  return null;
}

/**
 * Soft-delete a book: archives to deleted_books, then removes from live.
 * ALWAYS use this instead of raw deleteOne/deleteMany on books.
 * Returns the deleted book document for verification.
 */
export async function softDeleteBook(
  db: Db,
  bookId: string,
  reason: string
): Promise<Document | null> {
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) return null;

  // Archive to deleted_books with metadata
  await db.collection('deleted_books').replaceOne(
    { id: bookId },
    {
      ...book,
      deleted_at: new Date(),
      deletion_reason: reason,
    },
    { upsert: true }
  );

  // Remove pages and book from live AFTER archive succeeds
  await db.collection('pages').deleteMany({ book_id: bookId });
  await db.collection('books').deleteOne({ id: bookId });

  // Audit log
  await db.collection('audit_log').insertOne({
    action: 'soft_delete_book',
    book_id: bookId,
    title: book.title,
    reason,
    timestamp: new Date(),
  });

  return book;
}

/**
 * Soft-delete multiple books. Archives each to deleted_books before removing.
 * NEVER use raw deleteMany({ status: ... }) on the books collection.
 * Always pass an explicit list of IDs.
 */
export async function softDeleteBooks(
  db: Db,
  bookIds: string[],
  reason: string
): Promise<{ deleted: number; failed: string[] }> {
  let deleted = 0;
  const failed: string[] = [];

  for (const id of bookIds) {
    try {
      const result = await softDeleteBook(db, id, reason);
      if (result) deleted++;
      else failed.push(id);
    } catch (err) {
      failed.push(id);
    }
  }

  return { deleted, failed };
}

/**
 * Count books in warehouse by pipeline status.
 * Used by enrichment-snapshot to include warehouse books in funnel counts.
 */
export async function getWarehouseFunnelCounts(
  db: Db
): Promise<Record<string, number>> {
  const result = await db.collection('books_warehouse').aggregate([
    { $match: { 'pipeline_auto.status': { $exists: true } } },
    { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
  ]).toArray();
  return Object.fromEntries(result.map(r => [r._id, r.count]));
}
