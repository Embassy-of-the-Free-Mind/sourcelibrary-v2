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
import { SKIP_TRANSLATION_PAGE_TYPES } from '@/lib/types/prompts/defaults';
import { queuePreviewTranslation } from '@/lib/preview-translate';
import { revalidateBook } from '@/lib/revalidate';

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
      return { ...baseFilter, 'translation.data': { $exists: true, $nin: [null, ''] } };
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

      // If this was a preview OCR job, automatically queue preview translation
      const completedJob = await jobs.findOne({ id: jobId }, { projection: { config: 1, book_title: 1 } });
      if (completedJob?.config?.preview) {
        console.log(`${logPrefix} Preview OCR complete for ${bookId} — triggering preview translation`);
        // Non-blocking — fire and forget
        queuePreviewTranslation(db, bookId, completedJob.book_title || '').catch(err => {
          console.error(`${logPrefix} Preview translation trigger failed for ${bookId}:`, err);
        });
      }

      break;
    }

    case 'translation': {
      // Update book's pages_translated + pages_blank counts
      const [translationAgg] = await pages.aggregate([
        { $match: { book_id: bookId } },
        { $group: {
          _id: null,
          translated: { $sum: {
            $cond: [
              { $and: [
                { $eq: [{ $type: '$translation.data' }, 'string'] },
                { $gt: [{ $strLenCP: '$translation.data' }, 0] },
              ] },
              1, 0
            ]
          }},
          blank: { $sum: {
            $cond: [
              { $and: [
                { $in: [{ $ifNull: ['$page_type', ''] }, SKIP_TRANSLATION_PAGE_TYPES] },
                { $eq: [{ $type: '$ocr.data' }, 'string'] },
                { $gt: [{ $strLenCP: '$ocr.data' }, 0] },
              ] },
              1, 0
            ]
          }}
        }}
      ]).toArray();
      const totalPagesWithTranslation = translationAgg?.translated || 0;
      const totalPagesBlank = translationAgg?.blank || 0;

      // Mark enrichment stale if this book already has an index
      const bookDoc = await books.findOne(
        { id: bookId },
        { projection: { 'index.generatedAt': 1, pages_translated: 1, pages_ocr: 1, pages_blank: 1 } }
      );
      const enrichmentStale = bookDoc?.index?.generatedAt ? { enrichment_stale: true } : {};

      await books.updateOne(
        { id: bookId },
        {
          $set: {
            pages_translated: totalPagesWithTranslation,
            pages_blank: totalPagesBlank,
            last_translation_at: new Date(),
            ...enrichmentStale,
            updated_at: new Date()
          },
          $unset: { job: '' }
        }
      );

      console.log(`${logPrefix} Updated book ${bookId}: pages_translated = ${totalPagesWithTranslation}, pages_blank = ${totalPagesBlank}${enrichmentStale.enrichment_stale ? ', marked enrichment_stale' : ''}`);

      // Inline milestone counter updates on the enrichment snapshot
      // Compare old vs new to detect threshold crossings
      await updateMilestoneCounters(db, {
        oldTranslated: bookDoc?.pages_translated || 0,
        newTranslated: totalPagesWithTranslation,
        pagesOcr: bookDoc?.pages_ocr || 0,
        pagesBlank: totalPagesBlank,
        logPrefix,
        bookId,
      });
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

  // Trigger on-demand revalidation so the book page reflects new content
  revalidateBook(bookId).catch(() => {
    // Best-effort — logged inside revalidateBook
  });
}

/**
 * Inline-update the enrichment snapshot's milestone counters when a book
 * crosses the 90% or 100% translation threshold.
 *
 * The 2-hourly snapshot recompute resets these to ground truth, so small
 * drift from race conditions is acceptable.
 */
async function updateMilestoneCounters(
  db: Db,
  opts: {
    oldTranslated: number;
    newTranslated: number;
    pagesOcr: number;
    pagesBlank: number;
    logPrefix: string;
    bookId: string;
  }
): Promise<void> {
  const { oldTranslated, newTranslated, pagesOcr, pagesBlank, logPrefix, bookId } = opts;
  const denominator = pagesOcr - pagesBlank;
  if (denominator <= 0) return;

  const threshold90 = Math.floor(denominator * 0.9);
  const threshold100 = denominator;

  const inc: Record<string, number> = {};

  // Check 90% threshold crossing
  if (oldTranslated < threshold90 && newTranslated >= threshold90) {
    inc['milestones.over_90_pct'] = 1;
  }

  // Check 100% threshold crossing
  if (oldTranslated < threshold100 && newTranslated >= threshold100) {
    inc['milestones.fully_translated'] = 1;
  }

  if (Object.keys(inc).length === 0) return;

  try {
    await db.collection('system_config').updateOne(
      { _id: 'enrichment_snapshot' as any },
      { $inc: inc }
    );
    const crossed = Object.keys(inc).map(k => k.split('.')[1]).join(', ');
    console.log(`${logPrefix} Milestone crossed for ${bookId}: ${crossed}`);
  } catch (err) {
    // Non-fatal — snapshot recompute will correct
    console.error(`${logPrefix} Failed to update milestone counters:`, err);
  }
}
