/**
 * Detect and remove duplicate pages caused by overlapping BPH spread photography.
 *
 * BPH scans photograph overlapping page openings: the RIGHT half of spread N is
 * the same physical page as the LEFT half of spread N+1. After splitting, this
 * creates duplicate page records throughout the book.
 *
 * Detection is structural (not OCR-based): a LEFT-crop page following a RIGHT-crop
 * page from a different spread is a duplicate. This is reliable because OCR text
 * varies between scans of the same page, making fingerprint-based dedup unreliable.
 *
 * For each duplicate, the LEFT page (from the later spread) is archived to
 * `duplicate_pages` collection, remaining pages are renumbered, and book caches
 * are updated.
 *
 * Integrated into pipeline orchestrator Phase 3.1 after spread splitting.
 */

import type { Db } from 'mongodb';
import { buildVisiblePageCountPipeline } from '@/lib/page-counts';

export interface DedupResult {
  bookId: string;
  duplicatesFound: number;
  pagesRemoved: number;
  pagesRenumbered: number;
  newPageCount: number;
}

/**
 * Scan a book for duplicate pages from overlapping spread scans and remove them.
 *
 * @returns null if no duplicates found, DedupResult otherwise
 */
export async function deduplicateOverlappingPages(
  db: Db,
  bookId: string,
): Promise<DedupResult | null> {
  const pagesCol = db.collection('pages');

  // Get all pages with crop and spread info, sorted by page_number
  const pages = await pagesCol
    .find(
      { book_id: bookId },
      {
        projection: {
          _id: 1,
          id: 1,
          page_number: 1,
          crop: 1,
          photo_original: 1,
        },
      },
    )
    .sort({ page_number: 1 })
    .toArray();

  if (pages.length === 0) return null;

  // Detect structural duplicates: LEFT page following RIGHT page from different spread
  const pageIdsToArchive: string[] = [];
  for (let i = 1; i < pages.length; i++) {
    const prev = pages[i - 1];
    const curr = pages[i];
    const prevIsRight = prev.crop && prev.crop.xStart > 0;
    const currIsLeft = curr.crop && curr.crop.xStart === 0;
    const differentSpread =
      prev.photo_original &&
      curr.photo_original &&
      prev.photo_original !== curr.photo_original;

    if (prevIsRight && currIsLeft && differentSpread) {
      pageIdsToArchive.push(curr.id as string);
    }
  }

  if (pageIdsToArchive.length === 0) return null;

  // Archive duplicate pages (preserve data for recovery)
  const dupePages = await pagesCol
    .find({ id: { $in: pageIdsToArchive } })
    .toArray();

  if (dupePages.length > 0) {
    const archiveDocs = dupePages.map((p) => {
      const { _id, ...rest } = p;
      return {
        ...rest,
        original_page_id: p.id,
        original_mongo_id: _id,
        archived_at: new Date(),
        archive_reason: 'duplicate_overlapping_spread',
        book_id: bookId,
      };
    });
    await db.collection('duplicate_pages').insertMany(archiveDocs);
  }

  // Delete duplicates from pages collection
  await pagesCol.deleteMany({ id: { $in: pageIdsToArchive } });

  // Renumber remaining pages sequentially
  const remainingPages = await pagesCol
    .find({ book_id: bookId }, { projection: { _id: 1, page_number: 1 } })
    .sort({ page_number: 1 })
    .toArray();

  const bulkOps = [];
  for (let i = 0; i < remainingPages.length; i++) {
    const expectedNumber = i + 1;
    if (remainingPages[i].page_number !== expectedNumber) {
      bulkOps.push({
        updateOne: {
          filter: { _id: remainingPages[i]._id },
          update: { $set: { page_number: expectedNumber } },
        },
      });
    }
  }

  if (bulkOps.length > 0) {
    await pagesCol.bulkWrite(bulkOps);
  }

  // Update book-level caches

  // Counters come from the canonical pipeline (#4442/#4499). The private counts that
  // used to live here matched ALL pages — so the soft-hidden pages this very function
  // had just created were counted back in — and their translated count included
  // blank-page placeholders. Both inflate; together they are how a book ends up
  // reporting more translated pages than it has.
  const [counts] = await pagesCol.aggregate(buildVisiblePageCountPipeline(bookId)).toArray();

  await db.collection('books').updateOne(
    { id: bookId },
    {
      $set: {
        pages_count: counts?.total ?? 0,
        pages_ocr: counts?.with_ocr ?? 0,
        pages_translated: counts?.with_translation ?? 0,
        pages_translatable: counts?.translatable ?? 0,
        pages_blank: counts?.blank ?? 0,
        updated_at: new Date(),
      },
    },
  );

  return {
    bookId,
    duplicatesFound: pageIdsToArchive.length,
    pagesRemoved: pageIdsToArchive.length,
    pagesRenumbered: bulkOps.length,
    newPageCount: counts?.total ?? 0,
  };
}
