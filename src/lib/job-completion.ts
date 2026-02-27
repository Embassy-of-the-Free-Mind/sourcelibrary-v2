/**
 * Shared job completion checker for Lambda workers and the write-processor.
 *
 * After each page is processed (success or failure), this function counts
 * completed pages and checks if the job is done. When a job finishes,
 * it updates book-level aggregates and clears the active job reference.
 *
 * Extracted from the per-worker implementations to avoid 4x duplication.
 */

import { getDb } from '@/lib/mongodb';
import type { PageJobType } from '@/lib/types/job';

/** Type alias for the Db returned by getDb() */
type Db = Awaited<ReturnType<typeof getDb>>;
type Collection = ReturnType<Db['collection']>;

interface CompletionCheckOptions {
  db: Db;
  jobId: string;
  bookId: string;
  targetPageIds: string[];
  jobType: PageJobType;
  logPrefix?: string;
}

/**
 * Check if a job is complete and, if so, update its status and book-level fields.
 *
 * This function is idempotent — calling it multiple times for the same job
 * is safe (it re-counts from the pages collection each time).
 */
export async function checkJobCompletion(options: CompletionCheckOptions): Promise<void> {
  const { db, jobId, bookId, targetPageIds, jobType, logPrefix = '[JOB]' } = options;
  const jobs = db.collection('jobs');
  const pages = db.collection('pages');

  // Count completed pages based on job type
  const completionQuery = getCompletionQuery(bookId, targetPageIds, jobType);
  const completedCount = await pages.countDocuments(completionQuery);

  await jobs.updateOne(
    { id: jobId },
    {
      $set: {
        'progress.completed': completedCount,
        updated_at: new Date()
      }
    }
  );

  console.log(`${logPrefix} Progress: ${completedCount}/${targetPageIds.length}`);

  const updatedJob = await jobs.findOne({ id: jobId });
  const failedCount = updatedJob?.progress?.failed || 0;
  const totalAttempted = completedCount + failedCount;

  if (totalAttempted >= targetPageIds.length) {
    const finalStatus = failedCount > 0 ? 'completed_with_errors' : 'completed';
    console.log(`${logPrefix} Job ${jobId} ${finalStatus} (${completedCount} succeeded, ${failedCount} failed)`);

    await jobs.updateOne(
      { id: jobId },
      {
        $set: {
          status: finalStatus,
          completed_at: new Date(),
          updated_at: new Date()
        }
      }
    );

    // Job-type-specific completion logic
    await handleJobCompletion(db, jobs, pages, jobId, bookId, targetPageIds, jobType, failedCount, completedCount, logPrefix);
  }
}

/**
 * Build the MongoDB query to count completed pages for a given job type.
 */
function getCompletionQuery(bookId: string, targetPageIds: string[], jobType: PageJobType) {
  const baseFilter = { book_id: bookId, id: { $in: targetPageIds } };

  switch (jobType) {
    case 'ocr':
      return { ...baseFilter, 'ocr.data': { $exists: true, $nin: [null, ''] } };
    case 'translation':
      return { ...baseFilter, 'translation.data': { $exists: true, $ne: null } };
    case 'image_extraction':
      return { ...baseFilter, detected_images: { $exists: true } };
  }
}

/**
 * Job-type-specific finalization when all pages are done.
 */
async function handleJobCompletion(
  db: Db,
  jobs: Collection,
  pages: Collection,
  jobId: string,
  bookId: string,
  targetPageIds: string[],
  jobType: PageJobType,
  failedCount: number,
  completedCount: number,
  logPrefix: string
): Promise<void> {
  const books = db.collection('books');

  switch (jobType) {
    case 'ocr': {
      // Circuit breaker: if >90% of pages failed, block the book with exponential backoff
      if (targetPageIds.length > 0 && failedCount / targetPageIds.length >= 0.9) {
        const book = await books.findOne({ id: bookId }, { projection: { ocr_failure_count: 1 } });
        const failureCount = (book?.ocr_failure_count || 0) + 1;
        const backoffHours = [1, 4, 24, 168, 720][Math.min(failureCount - 1, 4)];
        const blockedUntil = new Date(Date.now() + backoffHours * 60 * 60 * 1000);
        await books.updateOne(
          { id: bookId },
          { $set: { ocr_failure_count: failureCount, ocr_blocked_until: blockedUntil } }
        );
        console.log(`${logPrefix} Circuit breaker: book ${bookId} blocked for ${backoffHours}h (failure #${failureCount})`);
      }

      // Update book's pages_ocr count
      const totalPagesWithOcr = await pages.countDocuments({
        book_id: bookId,
        'ocr.data': { $exists: true, $ne: '' }
      });

      // Mark enrichment stale if this book already has an index
      const bookDoc = await books.findOne(
        { id: bookId },
        { projection: { 'index.generatedAt': 1 } }
      );
      const enrichmentStale = bookDoc?.index?.generatedAt ? { enrichment_stale: true } : {};

      await books.updateOne(
        { id: bookId },
        {
          $set: {
            pages_ocr: totalPagesWithOcr,
            ...enrichmentStale,
            updated_at: new Date()
          },
          $unset: { job: '' }
        }
      );

      console.log(`${logPrefix} Updated book ${bookId}: pages_ocr = ${totalPagesWithOcr}${enrichmentStale.enrichment_stale ? ', marked enrichment_stale' : ''}`);
      break;
    }

    case 'translation': {
      // Update book's pages_translated count
      const totalPagesWithTranslation = await pages.countDocuments({
        book_id: bookId,
        'translation.data': { $exists: true, $ne: '' }
      });

      // Mark enrichment stale if this book already has an index
      const bookDoc = await books.findOne(
        { id: bookId },
        { projection: { 'index.generatedAt': 1 } }
      );
      const enrichmentStale = bookDoc?.index?.generatedAt ? { enrichment_stale: true } : {};

      await books.updateOne(
        { id: bookId },
        {
          $set: {
            pages_translated: totalPagesWithTranslation,
            last_translation_at: new Date(),
            ...enrichmentStale,
            updated_at: new Date()
          },
          $unset: { job: '' }
        }
      );

      console.log(`${logPrefix} Updated book ${bookId}: pages_translated = ${totalPagesWithTranslation}${enrichmentStale.enrichment_stale ? ', marked enrichment_stale' : ''}`);
      break;
    }

    case 'image_extraction': {
      // Clear job from book
      await books.updateOne(
        { id: bookId },
        { $unset: { job: '' } }
      );
      break;
    }
  }
}
