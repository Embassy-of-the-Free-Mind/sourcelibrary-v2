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
import { getModelForBook } from './types/ai-models';
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

    // Pin the model on the job. The OCR worker falls back to DEFAULT_MODEL
    // (full flash) when `config.model` is absent, so leaving it unset routed
    // EVERY preview job to the expensive model regardless of language — during
    // the 2026-08-27 acquisition push that was 4,450 Latin-script books at
    // ~6x the flash-lite rate. `getModelForBook` still returns full flash for
    // BPH, non-Latin scripts, and unknown language, so the safe default is
    // preserved; only the languages the routing rule already trusts get lite.
    const book = await db
      .collection('books')
      .findOne(
        { id: bookId },
        { projection: { language: 1, 'image_source.provider': 1 } },
      );
    const model = getModelForBook(book as Parameters<typeof getModelForBook>[0]);

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
        model,
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
      `[preview-ocr] Queued ${pageIds.length} pages for preview OCR on book ${bookId} (model: ${model})`,
    );
  } catch (err) {
    // Non-blocking — log and continue
    console.error(`[preview-ocr] Failed to queue preview OCR for ${bookId}:`, err);
  }
}
