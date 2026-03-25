/**
 * Detect and remove ghost pages at the end of IA-imported books.
 *
 * IA IIIF manifests sometimes claim N canvases but the last K all resolve
 * to the same fallback image (title card, Google disclaimer, etc.). Gemini
 * OCRs them faithfully, producing near-identical text K times.
 *
 * Detection: compare OCR text of the last 10 pages using word-level Jaccard
 * similarity. If 3+ consecutive pages from the end share >70% word overlap
 * with the final page, trim them.
 *
 * Only runs on IA-sourced books. Cost: negligible (string comparison on
 * already-loaded OCR text, no API calls).
 *
 * Integrated into pipeline cron Phase 3 after OCR completion + dedup.
 */

import type { Db } from 'mongodb';

export interface GhostDetectionResult {
  bookId: string;
  ghostPagesFound: number;
  pagesRemoved: number;
  newPageCount: number;
}

/**
 * Extract a bag of words from OCR text, ignoring XML tags and short tokens.
 */
function extractWords(text: string): Set<string> {
  const cleaned = text
    .replace(/<[^>]+>/g, ' ')  // Strip XML/HTML tags
    .toLowerCase();
  const words = cleaned.match(/[a-z\u00c0-\u024f]{4,}/g) || [];
  return new Set(words);
}

/**
 * Jaccard similarity between two word sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Scan a book's trailing pages for ghost content and remove them.
 *
 * @returns null if no ghosts found or book isn't IA-sourced
 */
export async function detectAndRemoveGhostPages(
  db: Db,
  bookId: string,
): Promise<GhostDetectionResult | null> {
  const pagesCol = db.collection('pages');

  // Only check IA-sourced books
  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { 'image_source.provider': 1, pages_count: 1 } },
  );
  if (!book) return null;
  const provider = (book.image_source as { provider?: string } | undefined)?.provider;
  if (provider !== 'internet_archive') return null;

  // Need at least 10 pages to meaningfully check
  const pageCount = book.pages_count as number || 0;
  if (pageCount < 10) return null;

  // Fetch the last 10 pages' OCR text, ordered by page_number descending
  const tailPages = await pagesCol
    .find(
      { book_id: bookId, 'ocr.data': { $exists: true } },
      { projection: { id: 1, page_number: 1, 'ocr.data': 1 } },
    )
    .sort({ page_number: -1 })
    .limit(10)
    .toArray();

  if (tailPages.length < 4) return null;

  // The last page is our reference — compare others against it
  const lastPage = tailPages[0];
  const lastWords = extractWords((lastPage.ocr as { data?: string })?.data || '');

  // If the last page has very little text, it might just be blank — skip
  if (lastWords.size < 5) return null;

  // Walk backwards from the end, counting consecutive ghost pages
  const ghostPageIds: string[] = [];
  for (let i = 1; i < tailPages.length; i++) {
    const page = tailPages[i];
    const pageWords = extractWords((page.ocr as { data?: string })?.data || '');

    const similarity = jaccardSimilarity(lastWords, pageWords);
    if (similarity >= 0.70) {
      ghostPageIds.push(page.id as string);
    } else {
      // First non-matching page — stop looking
      break;
    }
  }

  // Need at least 3 ghost pages to act (avoid false positives on legitimately
  // repeated content like colophons or indices)
  if (ghostPageIds.length < 3) return null;

  // The last page itself is also a ghost — it's the "reference" duplicate
  // Actually, keep the last page and remove the duplicates before it,
  // OR remove all including the last. The issue says all trailing pages are
  // ghosts of the same fallback. Let's remove all but one.
  // We keep the first occurrence (lowest page number) and remove the rest.
  // Since ghostPageIds are pages BEFORE the last one that match it,
  // we remove those + the last page, keeping just the first match.
  // Actually simpler: we know the last N pages are all identical ghosts.
  // Remove all of them (including the last one).
  ghostPageIds.push(lastPage.id as string);

  // Archive to ghost_pages collection before deletion
  const ghostDocs = await pagesCol
    .find({ id: { $in: ghostPageIds } })
    .toArray();

  if (ghostDocs.length > 0) {
    const archiveDocs = ghostDocs.map(doc => ({
      ...doc,
      _original_id: doc._id,
      archived_at: new Date(),
      archived_reason: 'ghost_page',
      original_book_id: bookId,
    }));
    // Remove _id to avoid conflicts
    for (const doc of archiveDocs) {
      delete (doc as Record<string, unknown>)._id;
    }
    await db.collection('ghost_pages').insertMany(archiveDocs);

    // Delete from pages
    await pagesCol.deleteMany({ id: { $in: ghostPageIds } });
  }

  // Renumber remaining pages sequentially
  const remainingPages = await pagesCol
    .find({ book_id: bookId }, { projection: { id: 1, page_number: 1 } })
    .sort({ page_number: 1 })
    .toArray();

  const bulkOps = remainingPages
    .map((page, idx) => {
      const newNum = idx + 1;
      if (page.page_number !== newNum) {
        return {
          updateOne: {
            filter: { id: page.id },
            update: { $set: { page_number: newNum } },
          },
        };
      }
      return null;
    })
    .filter(Boolean);

  if (bulkOps.length > 0) {
    await pagesCol.bulkWrite(bulkOps as NonNullable<typeof bulkOps[0]>[]);
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
    ghostPagesFound: ghostPageIds.length,
    pagesRemoved: ghostDocs.length,
    newPageCount: newCount,
  };
}
