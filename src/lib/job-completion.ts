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
import { revalidateBook } from '@/lib/revalidate';
import { buildVisiblePageCountPipeline } from '@/lib/page-counts';

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

      // NOTE: a completed OCR job used to auto-trigger preview TRANSLATION here.
      // Both halves of that import-time shortcut are gone (see the removal of
      // src/lib/preview-ocr.ts): they enqueued Gemini work straight onto the
      // SQS/Lambda realtime path, which consults neither the processing pause
      // nor the daily dial. Translation now comes from the orchestrator's
      // dial-gated phases like every other book's.

      break;
    }

    case 'translation': {
      // Counters come from the canonical pipeline, NOT a private aggregation.
      // The one that used to live here diverged from every other writer twice over:
      // it matched ALL pages (no `page_number > 0`, so soft-hidden duplicate spreads
      // counted) and it counted blank-page PLACEHOLDERS as translations. Measured
      // 2026-08-31 on 60 random live books, it disagreed with the canonical count on
      // 30% of them and over-counted by 1,973 pages; on "Phantasms of the Living,
      // Vol. I" (663 visible pages, 1,514 soft-hidden) it would have written
      // pages_translated: 2175 against pages_count: 663 — 328% translated — the next
      // time a translation job completed. See #4442 and page-counts.ts.
      const [translationAgg] = await pages
        .aggregate(buildVisiblePageCountPipeline(bookId))
        .toArray();
      const totalPagesWithTranslation = translationAgg?.with_translation || 0;
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
            pages_translatable: translationAgg?.translatable ?? 0,
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
