/**
 * Detect and remove duplicate pages caused by overlapping BPH spread photography.
 *
 * BPH digitization photographs overlapping page openings — the RIGHT half of
 * spread N is the same physical page as the LEFT half of spread N+1. After split
 * detection, these produce duplicate page records with identical content.
 *
 * Detection: fingerprint OCR text (first 400 chars of raw ocr.data), group by
 * fingerprint server-side via MongoDB aggregation, flag groups with 2+ pages.
 *
 * For each duplicate group, keep the lowest page_number, archive the rest to
 * `duplicate_pages` collection, renumber remaining pages, update book caches.
 *
 * Integrated into pipeline cron Phase 3 after OCR completion.
 */

import type { Db } from 'mongodb';

export interface DedupResult {
  bookId: string;
  duplicatesFound: number;
  pagesRemoved: number;
  pagesRenumbered: number;
  newPageCount: number;
}

/**
 * Scan a book for duplicate pages and remove them.
 * Only processes books that have split pages (crop data exists).
 *
 * @returns null if no duplicates found, DedupResult otherwise
 */
export async function deduplicateOverlappingPages(
  db: Db,
  bookId: string,
): Promise<DedupResult | null> {
  const pagesCol = db.collection('pages');

  // Only run on books with split pages — no splits means no overlapping duplicates
  const hasSplitPages = await pagesCol.countDocuments({
    book_id: bookId,
    'crop.xStart': { $exists: true },
  });
  if (hasSplitPages === 0) return null;

  // Fingerprint OCR text server-side: take first 400 chars of ocr.data,
  // group by that substring, return groups with 2+ pages.
  // XML tags are consistent across duplicate scans so raw comparison works.
  const pipeline = [
    {
      $match: {
        book_id: bookId,
        'ocr.data': { $exists: true, $ne: '' },
      },
    },
    {
      $project: {
        id: 1,
        page_number: 1,
        fp_raw: { $substrCP: ['$ocr.data', 0, 400] },
      },
    },
    {
      $group: {
        _id: '$fp_raw',
        count: { $sum: 1 },
        pages: { $push: { id: '$id', page_number: '$page_number' } },
      },
    },
    { $match: { count: { $gte: 2 } } },
  ];

  const groups = await pagesCol
    .aggregate(pipeline, { allowDiskUse: true })
    .toArray();

  if (groups.length === 0) return null;

  // Collect page IDs to archive (keep lowest page_number in each group)
  const pageIdsToArchive: string[] = [];
  for (const group of groups) {
    const sorted = group.pages.sort(
      (a: { page_number: number }, b: { page_number: number }) =>
        a.page_number - b.page_number,
    );
    for (let i = 1; i < sorted.length; i++) {
      pageIdsToArchive.push(sorted[i].id);
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
  const newCount = remainingPages.length;
  const ocrCount = await pagesCol.countDocuments({
    book_id: bookId,
    'ocr.data': { $exists: true, $ne: '' },
  });
  const transCount = await pagesCol.countDocuments({
    book_id: bookId,
    'translation.data': { $exists: true, $ne: '' },
  });

  await db.collection('books').updateOne(
    { id: bookId },
    {
      $set: {
        pages_count: newCount,
        pages_ocr: ocrCount,
        pages_translated: transCount,
        updated_at: new Date(),
      },
    },
  );

  return {
    bookId,
    duplicatesFound: groups.length,
    pagesRemoved: pageIdsToArchive.length,
    pagesRenumbered: bulkOps.length,
    newPageCount: newCount,
  };
}
