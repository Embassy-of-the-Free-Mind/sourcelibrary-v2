/**
 * Queue first 25 OCR'd pages of a newly imported book for immediate translation.
 *
 * Triggered automatically when a preview OCR job completes. Gives users
 * readable translated content within minutes of import, rather than waiting
 * for the full pipeline (full OCR → metadata → FT verify → translate).
 *
 * Creates a job record with `config.preview: true` for tracking.
 */

import { nanoid } from 'nanoid';
import { enqueuePagesForJob } from './queue-utils';
import { SKIP_TRANSLATION_PAGE_TYPES } from './types/prompts/defaults';
import type { JobStatus } from './types/job';

type Db = Awaited<ReturnType<typeof import('./mongodb').getDb>>;

/**
 * Queue the first 25 OCR'd pages of a book for translation via Lambda FIFO queue.
 * Non-blocking — errors are caught and logged, never thrown.
 */
export async function queuePreviewTranslation(
  db: Db,
  bookId: string,
  bookTitle: string,
): Promise<void> {
  try {
    // Skip English books — they get modernized during the full pipeline
    // but preview translation for early modern English is less urgent
    const book = await db.collection('books').findOne(
      { id: bookId },
      { projection: { language: 1 } },
    );
    const lang = (book?.language || '').toLowerCase();
    if (lang === 'english') {
      console.log(`[preview-translate] Skipping English book ${bookId}`);
      return;
    }

    // Find first 25 pages that have OCR and need translation
    const pages = await db
      .collection('pages')
      .find({
        book_id: bookId,
        'ocr.data': { $exists: true, $nin: [null, ''] },
        page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
        $or: [
          { 'translation.data': { $exists: false } },
          { 'translation.data': null },
          { 'translation.data': '' },
        ],
      })
      .sort({ page_number: 1 })
      .limit(25)
      .project({ id: 1 })
      .toArray();

    if (pages.length === 0) {
      console.log(`[preview-translate] No untranslated OCR'd pages for ${bookId}`);
      return;
    }

    const pageIds = pages.map((p) => p.id);
    const jobId = nanoid(12);

    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'translation',
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
        model: 'gemini-3-flash-preview',
        language: book?.language || 'auto-detect',
      },
      initiated_by: 'preview_translate',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await db.collection('books').updateOne(
      { id: bookId },
      { $set: { job: { type: 'realtime', job_id: jobId }, preview_translate_queued_at: new Date() } },
    );

    // Translation uses FIFO queue for sequential page processing
    await enqueuePagesForJob(bookId, pageIds, 'translation', jobId);

    console.log(
      `[preview-translate] Queued ${pageIds.length} pages for preview translation on book ${bookId}`,
    );
  } catch (err) {
    console.error(`[preview-translate] Failed to queue preview translation for ${bookId}:`, err);
  }
}
