import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { nanoid } from 'nanoid';
import { DEFAULT_MODEL } from '@/lib/types/ai-models';
import { enqueuePagesForJob } from '@/lib/queue-utils';
import type { JobStatus } from '@/lib/types/job';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createCronLogger } from '@/lib/cron-logger';

export const maxDuration = 300;

// Tunables
const MAX_ACTIVE_JOBS = 100;    // Don't submit if this many realtime jobs are active
const BOOKS_PER_RUN = 20;       // Books to submit per cron invocation
const PAGES_PER_BOOK = 500;     // Max pages to submit per book (Lambda handles concurrency)
const MAX_FAILURES_BEFORE_BLOCK = 3; // After this many high-failure jobs, block the book

/**
 * GET /api/cron/submit-ocr
 *
 * Auto-submits OCR jobs via Lambda workers (realtime Gemini API).
 * Unlike submit-batch-ocr (which uses Gemini Batch API with daily quotas),
 * this uses SQS → Lambda → realtime API with per-minute rate limits only.
 *
 * Backpressure: pauses when MAX_ACTIVE_JOBS are in flight.
 * Complements process-batches (batch path) with a realtime path.
 */
export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const logger = createCronLogger('submit-ocr');

  try {
    const db = await getDb();

    // Backpressure: check active realtime job count
    const activeJobs = await db.collection('jobs').countDocuments({
      type: 'ocr',
      status: { $in: ['pending', 'processing'] as JobStatus[] },
    });

    logger.action('active_jobs_before', activeJobs);

    if (activeJobs >= MAX_ACTIVE_JOBS) {
      logger.backpressure('realtime_job_limit', { active: activeJobs, max: MAX_ACTIVE_JOBS });
      await logger.flush();
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: `${activeJobs} active realtime OCR jobs (max ${MAX_ACTIVE_JOBS})`,
        duration_ms: logger.durationMs,
      });
    }

    // Get book IDs that already have active jobs (realtime or batch)
    const booksWithRealtimeJobs = await db.collection('jobs').distinct('book_id', {
      type: 'ocr',
      status: { $in: ['pending', 'processing'] as JobStatus[] },
    });
    const booksWithBatchJobs = await db.collection('batch_jobs').distinct('book_id', {
      status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
    });

    // Circuit breaker: exclude books that are blocked due to repeated failures.
    // Uses book-level ocr_blocked_until field (set by this cron after high-failure jobs).
    const now = new Date();
    const blockedBooks = await db.collection('books')
      .find(
        { ocr_blocked_until: { $gt: now } },
        { projection: { id: 1 } }
      )
      .toArray();
    const blockedBookIds = blockedBooks.map(b => b.id);

    if (blockedBookIds.length > 0) {
      logger.decision('circuit_breaker', `${blockedBookIds.length} books blocked`, { count: blockedBookIds.length });
    }

    // Also exclude books managed by the pipeline cron (avoid double-submitting)
    const pipelineBooks = await db.collection('books')
      .find(
        { 'pipeline_auto.status': { $exists: true, $nin: ['complete', 'failed', 'needs_attention'] } },
        { projection: { id: 1 } }
      )
      .toArray();
    const pipelineBookIds = pipelineBooks.map(b => b.id);

    if (pipelineBookIds.length > 0) {
      logger.skip(`${pipelineBookIds.length} books excluded (pipeline-managed)`);
    }

    const excludeBookIds = [...new Set([
      ...booksWithRealtimeJobs,
      ...booksWithBatchJobs,
      ...blockedBookIds,
      ...pipelineBookIds,
    ])];

    // Fast query using cached pages_count/pages_ocr fields
    const eligibleBooks = await db.collection('books').find({
      pages_count: { $gt: 0 },
      $expr: { $gt: ['$pages_count', { $ifNull: ['$pages_ocr', 0] }] },
      id: { $nin: excludeBookIds },
    })
      .sort({ pages_count: 1 }) // Smallest books first (complete faster)
      .limit(BOOKS_PER_RUN)
      .project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1, language: 1 })
      .toArray();

    if (eligibleBooks.length === 0) {
      logger.skip('all books have OCR or are already being processed');
      await logger.flush();
      return NextResponse.json({
        success: true,
        message: 'All books have OCR or are already being processed',
        activeJobs,
        blockedBooks: blockedBookIds.length,
        pipelineExcluded: pipelineBookIds.length,
        duration_ms: logger.durationMs,
      });
    }

    // Submit jobs
    const submitted: Array<{ bookId: string; title: string; jobId: string; pagesQueued: number }> = [];
    const skippedNoImages: string[] = [];
    const errors: string[] = [];

    for (const book of eligibleBooks) {
      try {
        // Find pages without OCR that have valid image URLs
        const pagesWithoutOcr = await db.collection('pages')
          .find({
            book_id: book.id,
            $or: [
              { 'ocr.data': { $exists: false } },
              { 'ocr.data': null },
              { 'ocr.data': '' },
            ],
          })
          .limit(PAGES_PER_BOOK)
          .project({ id: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1 })
          .toArray();

        if (pagesWithoutOcr.length === 0) {
          continue; // Book already fully OCR'd (cached count was stale)
        }

        // Guard: verify at least some pages have fetchable image URLs
        // Skip books where all images are dead (failed archiving, no valid URLs)
        const pagesWithValidImages = pagesWithoutOcr.filter(p => {
          // Check fallback chain: cropped_photo → archived_photo → photo → photo_original
          if (p.cropped_photo && /^https?:\/\//.test(p.cropped_photo)) return true;
          if (p.archived_photo && /^https?:\/\//.test(p.archived_photo) && !p.archived_photo.startsWith('failed:')) return true;
          // If archiving was attempted and failed ("failed:HTTP 404" etc), the source URL is dead.
          // Don't fall through to photo/photo_original — archiving already tried those URLs.
          const archiveFailed = typeof p.archived_photo === 'string' && p.archived_photo.startsWith('failed:');
          if (!archiveFailed) {
            if (p.photo && /^https?:\/\//.test(p.photo)) return true;
            if (p.photo_original && /^https?:\/\//.test(p.photo_original)) return true;
          }
          return false;
        });

        if (pagesWithValidImages.length === 0) {
          skippedNoImages.push(book.title);
          logger.skip(`no valid images: ${book.title}`, { book_id: book.id });
          // Block this book — no point retrying until images are fixed
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: { ocr_blocked_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } }
          );
          continue;
        }

        const pageIds = pagesWithValidImages.map(p => p.id);
        const jobId = nanoid(12);

        // Create job record
        await db.collection('jobs').insertOne({
          id: jobId,
          type: 'ocr',
          book_id: book.id,
          book_title: book.title,
          status: 'pending' as JobStatus,
          progress: {
            total: pageIds.length,
            completed: 0,
            failed: 0,
          },
          config: {
            page_ids: pageIds,
            model: DEFAULT_MODEL,
            language: book.language || 'auto-detect',
          },
          initiated_by: 'cron',
          created_at: new Date(),
          updated_at: new Date(),
        });

        // Set active job on book
        await db.collection('books').updateOne(
          { id: book.id },
          { $set: { job: { type: 'realtime', job_id: jobId } } }
        );

        // Enqueue pages to SQS
        await enqueuePagesForJob(book.id, pageIds, 'ocr', jobId);

        submitted.push({
          bookId: book.id,
          title: book.title,
          jobId,
          pagesQueued: pageIds.length,
        });

        console.log(`[cron/submit-ocr] Queued ${pageIds.length} pages for ${book.title} (job ${jobId})`);

      } catch (e) {
        const msg = `${book.title}: ${e instanceof Error ? e.message : 'Unknown error'}`;
        errors.push(msg);
        console.error(`[cron/submit-ocr] ${msg}`);
      }
    }

    const totalPages = submitted.reduce((sum, s) => sum + s.pagesQueued, 0);

    logger.setActions({
      active_jobs_before: activeJobs,
      books_submitted: submitted.length,
      total_pages: totalPages,
      blocked_books: blockedBookIds.length,
      pipeline_excluded: pipelineBookIds.length,
      skipped_no_images: skippedNoImages.length,
    });
    logger.addErrors(errors);

    await logger.flush();

    return NextResponse.json({
      success: true,
      activeJobsBefore: activeJobs,
      booksSubmitted: submitted.length,
      totalPages,
      submitted,
      blockedBooks: blockedBookIds.length,
      pipelineExcluded: pipelineBookIds.length,
      skippedNoImages: skippedNoImages.length > 0 ? skippedNoImages : undefined,
      errors: errors.length > 0 ? errors : undefined,
      duration_ms: logger.durationMs,
    });
  } catch (error) {
    console.error('[cron/submit-ocr] Error:', error);
    logger.error(error instanceof Error ? error.message : 'Submit cron failed');
    logger.setFailed();
    await logger.flush();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Submit cron failed' },
      { status: 500 }
    );
  }
}
