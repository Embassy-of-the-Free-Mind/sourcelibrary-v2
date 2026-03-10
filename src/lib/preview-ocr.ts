/**
 * Queue first 25 pages of a newly imported book for immediate OCR.
 *
 * This gives metadata enrichment (Phase 3.5) enough OCR text to work with
 * within minutes of import, rather than waiting for the full pipeline
 * (archiving → full OCR) which can take hours.
 *
 * Called non-blocking from import routes after page creation.
 * Creates a job record with `config.preview: true` for tracking.
 */

import { nanoid } from 'nanoid';
import { getDb } from './mongodb';
import { enqueuePagesForJob } from './queue-utils';
import type { JobStatus } from './types/job';

const PREVIEW_PAGE_COUNT = 25;

/**
 * Queue the first 25 pages of a book for OCR via Lambda workers.
 * Non-blocking — errors are caught and logged, never thrown.
 *
 * @param bookId - The book ID
 * @param bookTitle - Book title for job record
 */
export async function queuePreviewOcr(
  bookId: string,
  bookTitle: string,
): Promise<void> {
  try {
    const db = await getDb();

    // Get first 25 pages sorted by page number
    const pages = await db
      .collection('pages')
      .find(
        { book_id: bookId, photo: { $exists: true, $ne: null } },
        { projection: { id: 1, page_number: 1 } },
      )
      .sort({ page_number: 1 })
      .limit(PREVIEW_PAGE_COUNT)
      .toArray();

    if (pages.length === 0) return;

    const pageIds = pages.map((p) => p.id);
    const jobId = nanoid(12);

    // Create job record
    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'ocr',
      book_id: bookId,
      book_title: bookTitle,
      status: 'pending' as JobStatus,
      progress: {
        total: pageIds.length,
        completed: 0,
        failed: 0,
      },
      config: {
        page_ids: pageIds,
        preview: true,
      },
      initiated_by: 'import_preview',
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Set active job on book + flag for early metadata enrichment
    await db.collection('books').updateOne(
      { id: bookId },
      { $set: { job: { type: 'realtime', job_id: jobId }, preview_ocr_queued_at: new Date() } },
    );

    // Enqueue to OCR Lambda queue
    await enqueuePagesForJob(bookId, pageIds, 'ocr', jobId);

    console.log(
      `[preview-ocr] Queued ${pageIds.length} pages for preview OCR on book ${bookId}`,
    );
  } catch (err) {
    // Non-blocking — log and continue
    console.error(`[preview-ocr] Failed to queue preview OCR for ${bookId}:`, err);
  }
}
