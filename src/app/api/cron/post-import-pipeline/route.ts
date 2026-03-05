import { NextRequest, NextResponse } from 'next/server';
import { getDb, forceReconnect, isConnectionError } from '@/lib/mongodb';
import type { PipelineAutoStatus } from '@/lib/types/pipeline';
import { verifyCronAuth } from '@/lib/cron-auth';
import { extractChaptersForBook } from '@/lib/chapter-extraction';
import { enrichBookMetadata } from '@/lib/metadata-enrichment';
import { scoreBookQuality } from '@/lib/quality-scoring';
import { nanoid } from 'nanoid';
import { SKIP_TRANSLATION_PAGE_TYPES } from '@/lib/types/prompts/defaults';
import { enqueuePagesForJob } from '@/lib/queue-utils';
import { createCronLogger } from '@/lib/cron-logger';
import { logAuditEvent } from '@/lib/audit-logger';
import { syncBookToGitHub } from '@/lib/git-sync';

export const maxDuration = 300;

const TIME_BUDGET_MS = 270_000; // 4.5 min — leave 30s buffer before Vercel's 300s limit
const EARLY_FLUSH_MS = 240_000; // 4 min — flush partial cron_runs record before budget expires
const ENROLL_LIMIT = 50;
const ARCHIVE_LIMIT = 100; // Just DB checks now — Hetzner does actual archiving
const OCR_SUBMIT_LIMIT = 20; // Re-enabled — pushing to 2,000 fully OCR'd books
const MAX_ACTIVE_BATCH_OCR = 200; // Gemini Batch API handles many concurrent jobs
const METADATA_ENRICH_LIMIT = 20; // Single Gemini call per book, fast
const TRANSLATE_SUBMIT_LIMIT = 50; // Increased — large backlog at metadata_enriched
const ENRICH_LIMIT = 8; // Processed concurrently — 8 books × ~60s each in parallel
const CHAPTER_LIMIT = 15; // Fast (~5-10s each)
const IMAGE_SUBMIT_LIMIT = 5;
const FINALIZE_LIMIT = 50; // Just DB updates
const MAX_ACTIVE_IMAGE_JOBS = 10;
const MAX_RETRIES = 3;
const ENROLL_WINDOW_DAYS = 7;

function getBaseUrl(): string {
  // Always use the production URL for all HTTP calls.
  // Internal Vercel routing causes 405 errors; external calls work fine.
  return process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';
}

/** Auth headers for internal route calls (routes use withAuth which accepts CRON_SECRET) */
function getInternalHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.CRON_SECRET) {
    headers['Authorization'] = `Bearer ${process.env.CRON_SECRET}`;
  }
  return headers;
}

function hasTimeBudget(startTime: number): boolean {
  return Date.now() - startTime < TIME_BUDGET_MS;
}

async function setPipelineStatus(
  db: Awaited<ReturnType<typeof getDb>>,
  bookId: string,
  status: PipelineAutoStatus,
  extra: Record<string, unknown> = {},
) {
  // Read previous status for audit trail
  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { 'pipeline_auto.status': 1, title: 1 } }
  );
  const prevStatus = book?.pipeline_auto?.status;

  await db.collection('books').updateOne(
    { id: bookId },
    {
      $set: {
        'pipeline_auto.status': status,
        'pipeline_auto.last_updated': new Date(),
        ...Object.fromEntries(
          Object.entries(extra).map(([k, v]) => [`pipeline_auto.${k}`, v])
        ),
        updated_at: new Date(),
      },
    }
  );

  // Fix stale thumbnails on any transition (not just archive_complete)
  // Books that passed archive_complete before the fix was added need this catch-all
  if (prevStatus !== status) {
    fixStaleThumbnail(db, bookId).catch(() => {}); // fire-and-forget, non-blocking
  }

  // Log transition to audit trail (fire-and-forget)
  if (prevStatus !== status) {
    logAuditEvent({
      action: 'pipeline_status_changed',
      book_id: bookId,
      book_title: book?.title,
      metadata: { from: prevStatus || 'none', to: status, ...extra },
    });
  }
}

/**
 * If a book's thumbnail still points to an unsplit upload, update it to the best cropped page.
 * Prefers title-page > frontispiece > first non-blank cropped page.
 */
async function fixStaleThumbnail(
  db: Awaited<ReturnType<typeof getDb>>,
  bookId: string,
) {
  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { thumbnail: 1 } }
  );
  if (!book?.thumbnail?.includes('/uploads/')) return;

  const hasCroppedPages = await db.collection('pages').countDocuments({
    book_id: bookId,
    cropped_photo: { $exists: true, $ne: '' },
  });
  if (hasCroppedPages === 0) return;

  let bestPage = await db.collection('pages').findOne({
    book_id: bookId, page_type: 'title-page',
    cropped_photo: { $exists: true, $ne: '' },
  });
  if (!bestPage) {
    bestPage = await db.collection('pages').findOne({
      book_id: bookId, page_type: 'frontispiece',
      cropped_photo: { $exists: true, $ne: '' },
    });
  }
  if (!bestPage) {
    bestPage = await db.collection('pages').findOne({
      book_id: bookId,
      cropped_photo: { $exists: true, $ne: '' },
      page_type: { $nin: ['blank', null] },
    }, { sort: { page_number: 1 } });
  }
  if (!bestPage) {
    bestPage = await db.collection('pages').findOne({
      book_id: bookId,
      cropped_photo: { $exists: true, $ne: '' },
    }, { sort: { page_number: 1 } });
  }

  if (bestPage) {
    const update: Record<string, string> = { thumbnail: bestPage.cropped_photo };
    if (bestPage.thumbnail_blob) update.thumbnail_blob = bestPage.thumbnail_blob;
    await db.collection('books').updateOne({ id: bookId }, { $set: update });
  }
}

async function markFailed(
  db: Awaited<ReturnType<typeof getDb>>,
  bookId: string,
  error: string,
  retryCount: number,
) {
  await setPipelineStatus(db, bookId, 'failed', { error, retry_count: retryCount });
}

/**
 * Submit OCR for a book via Lambda workers (realtime Gemini API).
 * Used as fallback when Gemini Batch API quota is exhausted.
 * Creates a job record and enqueues pages to the OCR SQS queue.
 */
async function submitOcrViaLambda(
  db: Awaited<ReturnType<typeof getDb>>,
  bookId: string,
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  try {
    // Find pages that need OCR
    const pages = await db.collection('pages')
      .find({
        book_id: bookId,
        $or: [
          { 'ocr.data': { $exists: false } },
          { 'ocr.data': null },
          { 'ocr.data': '' },
        ],
      })
      .project({ id: 1 })
      .toArray();

    if (pages.length === 0) {
      return { success: true, jobId: undefined, error: 'No pages need OCR' };
    }

    const pageIds = pages.map(p => p.id);
    const jobId = nanoid(12);

    const book = await db.collection('books').findOne(
      { id: bookId },
      { projection: { title: 1, language: 1 } },
    );

    // Create job record (same shape as queue-books route)
    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'ocr',
      book_id: bookId,
      book_title: book?.title,
      status: 'pending',
      progress: { total: pageIds.length, completed: 0, failed: 0 },
      config: {
        page_ids: pageIds,
        model: 'gemini-3-flash-preview',
        language: book?.language || 'auto-detect',
      },
      initiated_by: 'pipeline_lambda_fallback',
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Set active job on book
    await db.collection('books').updateOne(
      { id: bookId },
      { $set: { job: { type: 'realtime', job_id: jobId } } },
    );

    // Enqueue to SQS
    await enqueuePagesForJob(bookId, pageIds, 'ocr', jobId);

    console.log(`[pipeline] Lambda OCR fallback: ${pageIds.length} pages for ${bookId} (job ${jobId})`);
    return { success: true, jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[pipeline] Lambda OCR fallback failed for ${bookId}:`, msg);
    return { success: false, error: msg };
  }
}

/**
 * Submit translation for a book via Lambda workers (realtime Gemini API).
 * Used as fallback when Gemini Batch API quota is exhausted.
 */
async function submitTranslationViaLambda(
  db: Awaited<ReturnType<typeof getDb>>,
  bookId: string,
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  try {
    // Find pages with OCR but no translation (skip non-content page types)
    const pages = await db.collection('pages')
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
      .project({ id: 1 })
      .toArray();

    if (pages.length === 0) {
      return { success: true, jobId: undefined, error: 'No pages need translation' };
    }

    const pageIds = pages.map(p => p.id);
    const jobId = nanoid(12);

    const book = await db.collection('books').findOne(
      { id: bookId },
      { projection: { title: 1, language: 1 } },
    );

    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'translation',
      book_id: bookId,
      book_title: book?.title,
      status: 'pending',
      progress: { total: pageIds.length, completed: 0, failed: 0 },
      config: {
        page_ids: pageIds,
        model: 'gemini-3-flash-preview',
        language: book?.language || 'auto-detect',
      },
      initiated_by: 'pipeline_lambda_fallback',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await db.collection('books').updateOne(
      { id: bookId },
      { $set: { job: { type: 'realtime', job_id: jobId } } },
    );

    // Translation uses FIFO queue — enqueuePagesForJob handles messageGroupId
    await enqueuePagesForJob(bookId, pageIds, 'translation', jobId);

    console.log(`[pipeline] Lambda translate fallback: ${pageIds.length} pages for ${bookId} (job ${jobId})`);
    return { success: true, jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[pipeline] Lambda translate fallback failed for ${bookId}:`, msg);
    return { success: false, error: msg };
  }
}

/**
 * GET /api/cron/post-import-pipeline
 *
 * Cron-driven post-import pipeline orchestrator.
 * Discovers books needing work and advances them through:
 *   archive -> OCR -> translate -> summary/index -> chapters -> images -> complete
 *
 * Scheduled: every 10 minutes via Vercel cron.
 */
export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const logger = createCronLogger('post-import-pipeline');
  const startTime = Date.now();
  const baseUrl = getBaseUrl();
  let db = await getDb();

  // Check emergency stop flag
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' as any });
  if (control?.paused) {
    logger.decision('early_return', 'Pipeline paused by emergency stop');
    await logger.flush();
    return NextResponse.json({
      success: true,
      paused: true,
      paused_at: control.paused_at,
      message: 'Pipeline paused by emergency stop. POST /api/admin/emergency-stop?resume=true to re-enable.',
    });
  }

  const log = {
    enrolled: 0,
    archived: 0,
    ocr_submitted: 0,
    ocr_advanced: 0,
    metadata_enriched: 0,
    metadata_skipped: 0,
    translate_submitted: 0,
    translate_advanced: 0,
    enriched: 0,
    chapters_extracted: 0,
    chapters_skipped: 0,
    images_submitted: 0,
    images_advanced: 0,
    finalized: 0,
    git_synced: 0,
    needs_attention: 0,
    stale_retried: 0,
    stale_failed: 0,
    stale_retranslate: 0,
    thumbnails_fixed: 0,
    errors: [] as string[],
  };

  // Early flush: write partial cron_runs record before time budget expires
  // so that if Vercel kills the function at 300s, we still have observability.
  let earlyFlushed = false;
  async function earlyFlushIfNeeded() {
    if (earlyFlushed || Date.now() - startTime < EARLY_FLUSH_MS) return;
    earlyFlushed = true;
    try {
      logger.setPartial();
      logger.setActions({
        enrolled: log.enrolled, archived: log.archived, ocr_submitted: log.ocr_submitted,
        ocr_advanced: log.ocr_advanced, metadata_enriched: log.metadata_enriched,
        translate_submitted: log.translate_submitted, translate_advanced: log.translate_advanced,
        enriched: log.enriched, chapters_extracted: log.chapters_extracted,
        images_submitted: log.images_submitted, finalized: log.finalized,
        needs_attention: log.needs_attention, stale_retried: log.stale_retried,
      });
      logger.addErrors(log.errors);
      logger.decision('time_budget', `Early flush at ${Date.now() - startTime}ms — continuing work`);
      await logger.flush();
    } catch { /* non-critical */ }
  }

  try {
    // Extract pause flags once — used by both submission AND completion phases
    const ocrPaused = control?.paused_phases?.includes('ocr');
    const translatePaused = control?.paused_phases?.includes('translation');
    const imagesPaused = control?.paused_phases?.includes('images');

    // ════════════════════════════════════════════════════════════════════
    // PRIORITY PASS: Run fast, late-stage phases FIRST so they don't get
    // starved by heavy enrichment/chapters work consuming the time budget.
    // These are all cheap (DB writes + SQS) and unblock book completion.
    // ════════════════════════════════════════════════════════════════════

    // ── Priority: Finalize (images_complete -> complete) — with quality validation ──
    if (hasTimeBudget(startTime) && !imagesPaused) {
      const readyToFinalize = await db.collection('books')
        .find({ 'pipeline_auto.status': 'images_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, language: 1 })
        .limit(FINALIZE_LIMIT)
        .toArray();

      for (const book of readyToFinalize) {
        const totalPages = book.pages_count || await db.collection('pages').countDocuments({ book_id: book.id });

        if (totalPages === 0) {
          await setPipelineStatus(db, book.id, 'needs_attention', {
            error: 'Empty book: 0 pages. Likely a failed import.',
          });
          log.errors.push(`Finalize blocked ${book.id} (${book.title}): 0 pages`);
          continue;
        }

        const ocrCount = await db.collection('pages').countDocuments({
          book_id: book.id,
          'ocr.data': { $exists: true, $ne: '', $not: { $eq: null } },
        });

        if (ocrCount === 0) {
          await setPipelineStatus(db, book.id, 'needs_attention', {
            error: `Finalize blocked: 0/${totalPages} OCR pages. Needs manual investigation.`,
          });
          log.needs_attention++;
          log.errors.push(`Finalize blocked ${book.id} (${book.title}): 0/${totalPages} OCR pages`);
          continue;
        }

        const ocrPercent = ocrCount / totalPages;
        if (ocrPercent < 0.1) {
          await setPipelineStatus(db, book.id, 'needs_attention', {
            error: `Very low OCR coverage: ${ocrCount}/${totalPages} (${(ocrPercent * 100).toFixed(1)}%)`,
          });
          log.errors.push(`Finalize blocked ${book.id} (${book.title}): ${ocrCount}/${totalPages} OCR (${(ocrPercent * 100).toFixed(1)}%)`);
          continue;
        }

        await setPipelineStatus(db, book.id, 'complete', { completed_at: new Date() });
        log.finalized++;

        // Sync text to GitHub (non-blocking — don't fail the pipeline on git errors)
        try {
          const gitResult = await syncBookToGitHub(book.id);
          if (gitResult.synced) log.git_synced++;
        } catch { /* git sync is best-effort */ }
      }
    }

    // ── Priority: Image extraction submission (chapters_complete -> images_submitted) ──
    if (imagesPaused) {
      logger.decision('skip', 'Image extraction paused via processing_control.paused_phases');
    }
    if (hasTimeBudget(startTime) && !imagesPaused) {
      const activeImageJobs = await db.collection('jobs').countDocuments({
        type: 'image_extraction',
        status: { $in: ['pending', 'processing'] },
      });

      if (activeImageJobs >= MAX_ACTIVE_IMAGE_JOBS) {
        logger.backpressure('image_jobs_limit', { active: activeImageJobs, max: MAX_ACTIVE_IMAGE_JOBS });
      }

      if (activeImageJobs < MAX_ACTIVE_IMAGE_JOBS) {
        const readyForImages = await db.collection('books')
          .find({ 'pipeline_auto.status': 'chapters_complete' })
          .sort({ hidden: 1 })
          .project({ id: 1, title: 1 })
          .limit(IMAGE_SUBMIT_LIMIT)
          .toArray();

        for (const book of readyForImages) {
          if (!hasTimeBudget(startTime)) break;
          try {
            const bookPages = await db.collection('pages')
              .find(
                { book_id: book.id },
                { projection: { id: 1 } }
              )
              .toArray();

            if (bookPages.length === 0) {
              await setPipelineStatus(db, book.id, 'images_complete');
              log.images_advanced++;
              continue;
            }

            const pageIds = bookPages.map(p => p.id);
            const jobId = nanoid(12);

            await db.collection('jobs').insertOne({
              id: jobId,
              type: 'image_extraction',
              status: 'pending',
              book_id: book.id,
              book_title: book.title,
              progress: { total: pageIds.length, completed: 0, failed: 0 },
              config: { page_ids: pageIds },
              created_at: new Date(),
              updated_at: new Date(),
            });

            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { job: { type: 'image_extraction', job_id: jobId } } }
            );

            await enqueuePagesForJob(book.id, pageIds, 'image_extraction', jobId);

            await setPipelineStatus(db, book.id, 'images_submitted', {
              image_extraction_job_id: jobId,
            });
            log.images_submitted++;
          } catch (err) {
            log.errors.push(`Images submit ${book.id}: ${err instanceof Error ? err.message : 'unknown'}`);
          }
        }
      }

      // Check for completed image extraction jobs
      const imagesPending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'images_submitted' })
        .project({ id: 1, 'pipeline_auto.image_extraction_job_id': 1 })
        .toArray();

      for (const book of imagesPending) {
        if (!hasTimeBudget(startTime)) break;
        const imgJobId = book.pipeline_auto?.image_extraction_job_id;
        if (!imgJobId) {
          await setPipelineStatus(db, book.id, 'images_complete');
          log.images_advanced++;
          continue;
        }

        const imgJob = await db.collection('jobs').findOne({
          id: imgJobId,
          status: { $in: ['completed', 'completed_with_errors'] },
        });

        if (imgJob) {
          await setPipelineStatus(db, book.id, 'images_complete');
          log.images_advanced++;
        }
      }
    }

    // ── Priority: Staleness detection — unstick books in *_submitted states ──
    if (hasTimeBudget(startTime)) {
      const staleThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const staleBooks = await db.collection('books')
        .find({
          'pipeline_auto.status': { $in: ['ocr_submitted', 'translate_submitted', 'images_submitted', 'enriching', 'chapters'] },
          'pipeline_auto.last_updated': { $lt: staleThreshold },
        })
        .project({ id: 1, title: 1, 'pipeline_auto': 1 })
        .limit(10)
        .toArray();

      for (const book of staleBooks) {
        if (!hasTimeBudget(startTime)) break;
        const retries = book.pipeline_auto?.retry_count || 0;
        const status = book.pipeline_auto?.status as string;

        // Before rolling back ocr_submitted/translate_submitted, check if batch_jobs are still active
        // Rolling back while Gemini is still processing creates duplicate submissions
        if (status === 'ocr_submitted' || status === 'translate_submitted') {
          const batchType = status === 'ocr_submitted' ? 'ocr' : 'translation';
          const BATCH_MAX_AGE_MS = 72 * 60 * 60 * 1000; // 72h — completed jobs older than this are abandoned
          const batchAgeThreshold = new Date(Date.now() - BATCH_MAX_AGE_MS);
          const activeBatch = await db.collection('batch_jobs').countDocuments({
            book_id: book.id,
            type: batchType,
            status: { $in: ['pending', 'processing', 'completed'] }, // completed = not yet collected
            created_at: { $gte: batchAgeThreshold }, // Ignore ancient zombie jobs
          });
          if (activeBatch > 0) {
            // Extend staleness window — batch jobs exist but haven't been collected
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { 'pipeline_auto.last_updated': new Date() } }
            );
            logger.decision('skip', `Stale skip ${book.id}: ${activeBatch} uncollected batch jobs`, { book_id: book.id, status });
            continue;
          }
        }

        if (retries >= MAX_RETRIES) {
          await markFailed(db, book.id, `Stale in ${status} for >48h after ${retries} retries`, retries);
          log.stale_failed++;
          logger.decision('circuit_breaker', `Stale ${book.id} in ${status} after ${retries} retries`, { book_id: book.id, status });
        } else {
          const rollbackMap: Record<string, PipelineAutoStatus> = {
            'ocr_submitted': 'archive_complete',
            'translate_submitted': 'metadata_enriched',
            'images_submitted': 'chapters_complete',
            'enriching': 'translate_complete',
            'chapters': 'enriched',
          };
          const rollbackTo = rollbackMap[status];
          if (rollbackTo) {
            await setPipelineStatus(db, book.id, rollbackTo, { retry_count: retries + 1 });
            log.stale_retried++;
            logger.decision('rollback', `Stale ${book.id}: ${status} → ${rollbackTo} (retry ${retries + 1})`, { book_id: book.id, from: status, to: rollbackTo });
          }
        }
        log.errors.push(`Stale ${book.id} (${book.title}): stuck in ${status} since ${book.pipeline_auto?.last_updated}`);
      }
    }

    // ── Priority: Zombie job detection — force-complete jobs stuck >24h ──
    if (hasTimeBudget(startTime)) {
      const zombieThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const zombieJobs = await db.collection('jobs').find({
        status: 'processing',
        updated_at: { $lt: zombieThreshold },
      }).project({ id: 1, book_id: 1, type: 1, progress: 1, 'config.page_ids': 1 }).limit(10).toArray();

      for (const job of zombieJobs) {
        if (!hasTimeBudget(startTime)) break;
        try {
          const total = job.progress?.total || 0;
          const completed = job.progress?.completed || 0;
          const failed = job.progress?.failed || 0;
          const remaining = total - completed - failed;

          if (remaining <= 0) {
            // All pages accounted for — force complete
            const finalStatus = failed > 0 ? 'completed_with_errors' : 'completed';
            await db.collection('jobs').updateOne(
              { id: job.id },
              { $set: { status: finalStatus, completed_at: new Date(), updated_at: new Date() } }
            );
            await db.collection('books').updateOne(
              { id: job.book_id },
              { $unset: { job: '' } }
            );
            logger.action('zombie_jobs_completed');
          } else {
            // Some pages still missing — mark failed with the missing ones
            await db.collection('jobs').updateOne(
              { id: job.id },
              { $set: { status: 'completed_with_errors', completed_at: new Date(), updated_at: new Date() } }
            );
            await db.collection('books').updateOne(
              { id: job.book_id },
              { $unset: { job: '' } }
            );
            logger.action('zombie_jobs_completed');
            logger.decision('rollback', `Zombie job ${job.id} (${job.type}): ${completed}/${total} done, ${remaining} lost`, { job_id: job.id, book_id: job.book_id });
          }
        } catch (e) {
          logger.error(`Zombie job cleanup failed: ${e instanceof Error ? e.message : 'unknown'}`, { book_id: job.book_id });
        }
      }
    }

    // ── Stale translation retranslation — DISABLED ──
    // This aggregation scans 1,338+ books' pages (full collection scan, ~186s)
    // and starves OCR submission for 1,523 books at archive_complete.
    // TODO: Move to a separate daily cron with a dedicated time budget.
    // See git history for the original implementation.

    // ════════════════════════════════════════════════════════════════════
    // MAIN PASS: Standard pipeline phases (enrollment through chapters)
    // ════════════════════════════════════════════════════════════════════

    await earlyFlushIfNeeded();

    // ── Phase 0: Auto-enroll recently imported books ──
    if (hasTimeBudget(startTime)) {
      const cutoff = new Date(Date.now() - ENROLL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const newBooks = await db.collection('books')
        .find({
          pipeline_auto: { $exists: false },
          created_at: { $gte: cutoff },
        })
        .project({ id: 1 })
        .limit(ENROLL_LIMIT)
        .toArray();

      for (const book of newBooks) {
        await db.collection('books').updateOne(
          { id: book.id },
          {
            $set: {
              pipeline_auto: {
                status: 'queued',
                source: 'cron',
                queued_at: new Date(),
                last_updated: new Date(),
                retry_count: 0,
              },
              updated_at: new Date(),
            },
          }
        );
        log.enrolled++;
      }
    }

    // ── Phase 1: Archive check (queued/archiving -> archive_complete) ──
    // Archiving is done externally by Hetzner's archive-images-fast.ts script.
    // The cron just checks MongoDB to see if all pages are archived and advances status.
    if (hasTimeBudget(startTime)) {
      const ARCHIVABLE_SOURCES = /archive\.org|gallica\.bnf\.fr|digitale-sammlungen\.de|digi\.vatlib\.it|diglib\.hab\.de|e-rara|wellcomecollection|cudl\.lib\.cam|digital\.bodleian/;

      // Move queued books to archiving
      const queuedBooks = await db.collection('books')
        .find({ 'pipeline_auto.status': 'queued' })
        .sort({ hidden: 1 }) // Visible books first
        .project({ id: 1 })
        .limit(ARCHIVE_LIMIT)
        .toArray();

      for (const book of queuedBooks) {
        if (!hasTimeBudget(startTime)) break;
        await setPipelineStatus(db, book.id, 'archiving', { started_at: new Date() });
        log.archived++;
      }

      // Check archiving books for completion (pages archived by Hetzner script)
      const ARCHIVE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h — OCR works on original IIIF URLs
      const archivingBooks = await db.collection('books')
        .find({ 'pipeline_auto.status': 'archiving' })
        .sort({ hidden: 1 }) // Visible books first
        .project({ id: 1, title: 1, 'pipeline_auto.last_updated': 1, 'pipeline_auto.started_at': 1 })
        .limit(100) // Just DB queries per book — can handle many
        .toArray();

      for (const book of archivingBooks) {
        if (!hasTimeBudget(startTime)) break;

        // Count pages still needing archiving from external sources
        // Also treat "failed:*" archived_photo values as unarchived
        const remaining = await db.collection('pages').countDocuments({
          book_id: book.id,
          $or: [
            { archived_photo: { $exists: false } },
            { archived_photo: { $regex: /^failed:/ } },
          ],
          $and: [{
            $or: [
              { photo: { $regex: ARCHIVABLE_SOURCES } },
              { photo_original: { $regex: ARCHIVABLE_SOURCES } },
            ],
          }],
        });

        if (remaining === 0) {
          await setPipelineStatus(db, book.id, 'archive_complete', { retry_count: 0 });
          log.archived++;
        } else {
          // Timeout: if stuck in archiving for >24h, advance anyway.
          // OCR works fine on original IIIF URLs — archiving is a nice-to-have, not a blocker.
          const archiveStart = book.pipeline_auto?.started_at || book.pipeline_auto?.last_updated;
          if (archiveStart && (Date.now() - new Date(archiveStart).getTime()) > ARCHIVE_TIMEOUT_MS) {
            await setPipelineStatus(db, book.id, 'archive_complete', { retry_count: 0 });
            log.archived++;
            logger.decision('skip', `Archive timeout: ${book.id} (${book.title}) — ${remaining} unarchived pages, advancing after 24h`, { book_id: book.id, remaining });
          }
          // Otherwise Hetzner is still working — check again next cycle
        }
      }
    }

    // ── Phase 2: Submit OCR (archive_complete -> ocr_submitted) ──
    // Primary: Gemini Batch API (50% cheaper). Fallback: Lambda workers (realtime).
    if (ocrPaused) {
      logger.decision('skip', 'OCR submission paused via processing_control.paused_phases');
    }
    if (hasTimeBudget(startTime) && !ocrPaused) {
      // Backpressure: don't overwhelm the Gemini Batch API queue
      const activeBatchOcr = await db.collection('batch_jobs').countDocuments({
        type: 'ocr',
        status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
      });

      // Lambda backpressure: check active realtime OCR jobs
      const activeLambdaOcr = await db.collection('jobs').countDocuments({
        type: 'ocr',
        status: { $in: ['pending', 'processing'] },
      });
      const MAX_ACTIVE_LAMBDA_OCR = 50; // Cap Lambda jobs — each = hundreds of SQS messages

      const ocrLimit = activeBatchOcr >= MAX_ACTIVE_BATCH_OCR ? 0 : OCR_SUBMIT_LIMIT;

      if (activeBatchOcr >= MAX_ACTIVE_BATCH_OCR) {
        logger.backpressure('ocr_batch_limit', { active: activeBatchOcr, max: MAX_ACTIVE_BATCH_OCR });
      }
      if (activeLambdaOcr >= MAX_ACTIVE_LAMBDA_OCR) {
        logger.backpressure('ocr_lambda_limit', { active: activeLambdaOcr, max: MAX_ACTIVE_LAMBDA_OCR });
      }

      const readyForOcr = (ocrLimit > 0 && activeLambdaOcr < MAX_ACTIVE_LAMBDA_OCR) ? await db.collection('books')
        .find({ 'pipeline_auto.status': 'archive_complete' })
        .sort({ hidden: 1 }) // Visible books first
        .project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.retry_count': 1 })
        .limit(ocrLimit)
        .toArray() : [];

      let ocrQuotaExhausted = true; // FORCE Lambda — batch quota exhausted, skip costly batch attempts
      let lambdaFallbackCount = 0;
      let consecutiveBatchFailures = 0;
      const LAMBDA_FALLBACK_LIMIT = 10; // Re-enabled for OCR push to 2,000 books
      const CONSECUTIVE_FAILURE_THRESHOLD = 3; // After N consecutive batch 500s, assume quota exhausted

      for (const book of readyForOcr) {
        if (!hasTimeBudget(startTime)) break;
        // When batch is exhausted, switch to Lambda fallback (limited per run)
        if (ocrQuotaExhausted && lambdaFallbackCount >= LAMBDA_FALLBACK_LIMIT) break;
        const retries = book.pipeline_auto?.retry_count || 0;
        try {
          // Guard: verify book has pages with good archived images (not failed)
          const archivedPageCount = await db.collection('pages').countDocuments({
            book_id: book.id,
            archived_photo: { $regex: /^https?:\/\// },
          });

          // Fallback: check for any HTTP image URL (original source)
          const httpPageCount = archivedPageCount > 0 ? archivedPageCount : await db.collection('pages').countDocuments({
            book_id: book.id,
            $or: [
              { photo: { $regex: /^https?:\/\// } },
              { photo_original: { $regex: /^https?:\/\// } },
            ],
          });

          if (httpPageCount === 0) {
            await setPipelineStatus(db, book.id, 'needs_attention', {
              error: 'No pages with HTTP image URLs — cannot OCR',
            });
            log.needs_attention++;
            log.errors.push(`OCR skip ${book.id} (${book.title}): no HTTP image URLs`);
            continue;
          }

          // If batch quota is exhausted, use Lambda workers (realtime, same model)
          if (ocrQuotaExhausted) {
            const lambdaResult = await submitOcrViaLambda(db, book.id);
            if (lambdaResult.success && lambdaResult.jobId) {
              await setPipelineStatus(db, book.id, 'ocr_submitted', {
                ocr_job_id: lambdaResult.jobId,
                retry_count: 0,
              });
              log.ocr_submitted++;
              lambdaFallbackCount++;
              logger.action('ocr_lambda_fallback', lambdaFallbackCount);
            } else if (lambdaResult.success) {
              // No pages needed OCR — advance directly
              await setPipelineStatus(db, book.id, 'ocr_complete');
              log.ocr_advanced++;
            } else {
              log.errors.push(`OCR Lambda ${book.id}: ${lambdaResult.error}`);
            }
            continue;
          }

          // Submit the full book — route handles parallel downloads and child-batch splitting
          const res = await fetch(`${baseUrl}/api/books/${book.id}/batch-ocr-async`, {
            method: 'POST',
            headers: getInternalHeaders(),
            body: JSON.stringify({ limit: 500, force: false }),
          });

          const text = await res.text();
          let data: Record<string, unknown>;
          try { data = JSON.parse(text); } catch {
            data = { error: `invalid JSON (${text.length} chars)` };
          }

          if (!res.ok) {
            // Permanent failure: no valid image URLs
            if (data.error === 'no_valid_image_urls') {
              await setPipelineStatus(db, book.id, 'needs_attention', {
                error: `${data.message}`,
              });
              log.needs_attention++;
              log.errors.push(`OCR submit ${book.id}: no valid image URLs — needs_attention`);
              continue;
            }
            // Circuit breaker: 429 = batch quota exhausted — switch to Lambda fallback
            // Also detect quota errors hidden in 500 responses (defense-in-depth)
            const errorStr = typeof data.error === 'string' ? data.error : '';
            const isQuotaIn500 = res.status === 500 && (
              errorStr.includes('429') || errorStr.includes('quota') ||
              errorStr.includes('RESOURCE_EXHAUSTED') || errorStr.includes('exhausted')
            );
            if (res.status === 429 || isQuotaIn500) {
              ocrQuotaExhausted = true;
              logger.backpressure('ocr_batch_quota_exhausted', { book_id: book.id, status: 429 });
              // Try this book via Lambda instead of skipping
              const lambdaResult = await submitOcrViaLambda(db, book.id);
              if (lambdaResult.success && lambdaResult.jobId) {
                await setPipelineStatus(db, book.id, 'ocr_submitted', {
                  ocr_job_id: lambdaResult.jobId,
                  retry_count: 0,
                });
                log.ocr_submitted++;
                lambdaFallbackCount++;
                logger.action('ocr_lambda_fallback', lambdaFallbackCount);
              } else if (lambdaResult.success) {
                await setPipelineStatus(db, book.id, 'ocr_complete');
                log.ocr_advanced++;
              } else {
                log.errors.push(`OCR Lambda fallback ${book.id}: ${lambdaResult.error}`);
              }
              continue;
            }
            // Track consecutive batch failures — likely quota exhaustion manifesting as 500
            if (res.status === 500) {
              consecutiveBatchFailures++;
              if (consecutiveBatchFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
                ocrQuotaExhausted = true;
                logger.backpressure('ocr_batch_consecutive_500s', {
                  book_id: book.id, count: consecutiveBatchFailures,
                });
                // Try this book via Lambda
                const lambdaResult = await submitOcrViaLambda(db, book.id);
                if (lambdaResult.success && lambdaResult.jobId) {
                  await setPipelineStatus(db, book.id, 'ocr_submitted', {
                    ocr_job_id: lambdaResult.jobId, retry_count: 0,
                  });
                  log.ocr_submitted++;
                  lambdaFallbackCount++;
                  logger.action('ocr_lambda_fallback', lambdaFallbackCount);
                } else if (lambdaResult.success) {
                  await setPipelineStatus(db, book.id, 'ocr_complete');
                  log.ocr_advanced++;
                }
                continue;
              }
            }
            // Transient failure — retry with tracking
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `OCR submit failed after ${retries} retries: HTTP ${res.status}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'archive_complete', { retry_count: retries + 1 });
            }
            log.errors.push(`OCR submit ${book.id}: HTTP ${res.status} (retry ${retries + 1}/${MAX_RETRIES})`);
            continue;
          }

          // Reset consecutive failure counter on success
          consecutiveBatchFailures = 0;

          if (data.jobName) {
            await setPipelineStatus(db, book.id, 'ocr_submitted', {
              ocr_job_name: data.jobName as string,
              retry_count: 0,
            });
            log.ocr_submitted++;
          } else if (data.processed === 0 || (data.message as string)?.includes('No pages need OCR')) {
            // Already OCR'd — skip to translate
            await setPipelineStatus(db, book.id, 'ocr_complete');
            log.ocr_advanced++;
          } else {
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `OCR submit unexpected: ${data.error || 'unknown'}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'archive_complete', { retry_count: retries + 1 });
            }
            log.errors.push(`OCR submit ${book.id}: ${data.error || 'unexpected response'}`);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'unknown';
          // Circuit breaker: catch quota errors that come through as exceptions
          if (errMsg.includes('429') || errMsg.includes('quota')) {
            ocrQuotaExhausted = true;
            logger.backpressure('ocr_batch_quota_exhausted', { book_id: book.id, error: errMsg });
            // Try this book via Lambda
            const lambdaResult = await submitOcrViaLambda(db, book.id);
            if (lambdaResult.success && lambdaResult.jobId) {
              await setPipelineStatus(db, book.id, 'ocr_submitted', {
                ocr_job_id: lambdaResult.jobId,
                retry_count: 0,
              });
              log.ocr_submitted++;
              lambdaFallbackCount++;
              logger.action('ocr_lambda_fallback', lambdaFallbackCount);
            } else if (lambdaResult.success) {
              await setPipelineStatus(db, book.id, 'ocr_complete');
              log.ocr_advanced++;
            }
            continue;
          }
          if (retries >= MAX_RETRIES) {
            await markFailed(db, book.id, `OCR submit exception: ${errMsg}`, retries);
          } else {
            await setPipelineStatus(db, book.id, 'archive_complete', { retry_count: retries + 1 });
          }
          log.errors.push(`OCR submit ${book.id}: ${errMsg}`);
        }
      }

      if (ocrQuotaExhausted) {
        log.errors.push(`OCR: Batch API quota exhausted — used Lambda fallback for ${lambdaFallbackCount} books`);
      }
    }

    // ── Phase 3: Check OCR completion (ocr_submitted -> ocr_complete) ──
    // Guard: don't advance past OCR when paused — books stay in ocr_submitted
    if (hasTimeBudget(startTime) && !ocrPaused) {
      const ocrPending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'ocr_submitted' })
        .project({ id: 1, 'pipeline_auto.ocr_job_name': 1, 'pipeline_auto.ocr_job_id': 1, 'pipeline_auto.ocr_loop_count': 1 })
        .toArray();

      for (const book of ocrPending) {
        if (!hasTimeBudget(startTime)) break;
        const jobName = book.pipeline_auto?.ocr_job_name;
        const jobId = book.pipeline_auto?.ocr_job_id;

        let isComplete = false;

        if (jobId) {
          // Realtime Lambda job — check jobs collection
          const job = await db.collection('jobs').findOne({
            id: jobId,
            status: { $in: ['completed', 'completed_with_errors'] },
          });
          if (job) isComplete = true;
        } else if (jobName) {
          // Batch API job — check batch_jobs collection
          const batchJob = await db.collection('batch_jobs').findOne({
            book_id: book.id,
            type: 'ocr',
            $or: [
              { job_name: jobName },
              { gemini_job_name: jobName },
            ],
            status: { $in: ['completed', 'saved', 'completed_with_errors'] },
          });

          const parentJob = !batchJob
            ? await db.collection('batch_jobs').findOne({
                book_id: book.id,
                type: 'ocr',
                child_job_ids: { $exists: true, $ne: [] },
                status: { $in: ['completed', 'saved', 'completed_with_errors'] },
              })
            : null;

          if (batchJob || parentJob) isComplete = true;
        }

        if (isComplete) {
          // Check if there are still un-OCR'd pages — if so, loop back for another batch
          const remainingOcr = await db.collection('pages').countDocuments({
            book_id: book.id,
            $or: [
              { photo: { $exists: true, $ne: null } },
              { photo_original: { $exists: true, $ne: null } },
            ],
            $and: [
              { $or: [
                { 'ocr.data': { $exists: false } },
                { 'ocr.data': null },
                { 'ocr.data': '' },
              ] },
            ],
          });

          if (remainingOcr > 0) {
            // Check if there are uncollected batch_jobs — collector may not have saved results yet
            const uncollectedBatch = await db.collection('batch_jobs').countDocuments({
              book_id: book.id,
              type: 'ocr',
              status: { $in: ['pending', 'processing', 'completed'] }, // NOT 'saved' — results not yet written to pages
            });

            if (uncollectedBatch > 0) {
              // Results exist in Gemini but haven't been saved — wait for collector
              // Don't change state, don't increment loop count
            } else {
              // All batch_jobs collected — remaining pages genuinely failed
              const loopCount = (book.pipeline_auto?.ocr_loop_count || 0) + 1;
              if (loopCount > MAX_RETRIES) {
                await setPipelineStatus(db, book.id, 'needs_attention', {
                  error: `OCR looped ${loopCount} times with ${remainingOcr} pages still un-OCR'd`,
                  ocr_loop_count: loopCount,
                });
                log.needs_attention++;
                log.errors.push(`OCR circuit breaker ${book.id}: looped ${loopCount}x, ${remainingOcr} pages remaining`);
              } else {
                await setPipelineStatus(db, book.id, 'archive_complete', { ocr_loop_count: loopCount });
              }
            }
            log.ocr_advanced++;
          } else {
            await setPipelineStatus(db, book.id, 'ocr_complete');
            log.ocr_advanced++;
          }
        }
        // Otherwise keep waiting — process-batches cron will collect results
      }
    }

    // ── Phase 3.5: Metadata enrichment (ocr_complete -> metadata_enriched) ──
    // AI reads OCR text to verify/fill language, year, categories, description.
    // Non-blocking: failure skips to metadata_enriched (don't block translation).
    if (hasTimeBudget(startTime)) {
      const readyForMetadata = await db.collection('books')
        .find({ 'pipeline_auto.status': 'ocr_complete' })
        .sort({ hidden: 1 }) // Visible books first
        .project({ id: 1, title: 1, 'pipeline_auto.retry_count': 1, 'ai_metadata.enriched_at': 1 })
        .limit(METADATA_ENRICH_LIMIT)
        .toArray();

      for (const book of readyForMetadata) {
        if (!hasTimeBudget(startTime)) break;
        try {
          // Skip if already enriched (e.g. by manual script)
          if (book.ai_metadata?.enriched_at) {
            await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
            log.metadata_skipped++;
            continue;
          }

          const result = await enrichBookMetadata(db, book.id);

          if (result.success) {
            await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
            log.metadata_enriched++;
          } else {
            // Non-blocking: skip to metadata_enriched on failure
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES || result.error?.includes('Only')) {
              // Too few pages or persistent failure — skip
              await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
              log.metadata_skipped++;
            } else {
              await setPipelineStatus(db, book.id, 'ocr_complete', { retry_count: retries + 1 });
            }
            log.errors.push(`Metadata ${book.id}: ${result.error}`);
          }
        } catch (err) {
          // Non-blocking: skip on unexpected errors
          await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
          log.metadata_skipped++;
          log.errors.push(`Metadata ${book.id}: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    }

    await earlyFlushIfNeeded();

    // ── Phase 4: Submit translation via Gemini Batch API (metadata_enriched -> translate_submitted) ──
    if (translatePaused) {
      logger.decision('skip', 'Translation submission paused via processing_control.paused_phases');
    }
    if (hasTimeBudget(startTime) && !translatePaused) {
      // Lambda backpressure: check active realtime translation jobs
      const activeLambdaTranslate = await db.collection('jobs').countDocuments({
        type: 'translation',
        status: { $in: ['pending', 'processing'] },
      });
      const MAX_ACTIVE_LAMBDA_TRANSLATE = 60; // Bumped from 30 — each FIFO job is 1 page in-flight, safe to parallelize

      if (activeLambdaTranslate >= MAX_ACTIVE_LAMBDA_TRANSLATE) {
        logger.backpressure('translate_lambda_limit', { active: activeLambdaTranslate, max: MAX_ACTIVE_LAMBDA_TRANSLATE });
      }

      const readyForTranslate = activeLambdaTranslate < MAX_ACTIVE_LAMBDA_TRANSLATE ? await db.collection('books')
        .find({ 'pipeline_auto.status': 'metadata_enriched' })
        .sort({ hidden: 1 }) // Visible books first
        .project({ id: 1, title: 1, pages_count: 1, language: 1, 'pipeline_auto.retry_count': 1 })
        .limit(TRANSLATE_SUBMIT_LIMIT)
        .toArray() : [];

      let translateQuotaExhausted = true; // FORCE Lambda — batch quota exhausted, skip costly batch attempts
      let translateLambdaCount = 0;
      let consecutiveTranslateFailures = 0;
      const TRANSLATE_LAMBDA_LIMIT = 60; // Match MAX_ACTIVE — each FIFO job is 1 page in-flight
      const CONSECUTIVE_TRANSLATE_THRESHOLD = 3;

      for (const book of readyForTranslate) {
        if (!hasTimeBudget(startTime)) break;
        if (translateQuotaExhausted && translateLambdaCount >= TRANSLATE_LAMBDA_LIMIT) break;
        const retries = book.pipeline_auto?.retry_count || 0;

        // English books get modernized (Early Modern → Modern English) via the same batch route
        try {
          // If batch quota is exhausted, use Lambda workers directly
          if (translateQuotaExhausted) {
            const lambdaResult = await submitTranslationViaLambda(db, book.id);
            if (lambdaResult.success && lambdaResult.jobId) {
              await setPipelineStatus(db, book.id, 'translate_submitted', {
                translate_job_id: lambdaResult.jobId,
                retry_count: 0,
              });
              log.translate_submitted++;
              translateLambdaCount++;
              logger.action('translate_lambda_fallback', translateLambdaCount);
            } else if (lambdaResult.success) {
              await setPipelineStatus(db, book.id, 'translate_complete');
              log.translate_advanced++;
            } else {
              log.errors.push(`Translate Lambda ${book.id}: ${lambdaResult.error}`);
            }
            continue;
          }

          const res = await fetch(`${baseUrl}/api/books/${book.id}/batch-translate-async`, {
            method: 'POST',
            headers: getInternalHeaders(),
            body: JSON.stringify({ limit: 500 }),
          });

          const text = await res.text();
          let data: Record<string, unknown>;
          try { data = JSON.parse(text); } catch {
            data = { error: `invalid JSON (${text.length} chars)` };
          }

          if (!res.ok) {
            // Circuit breaker: 429 = quota exhausted — switch to Lambda fallback
            // Also detect quota errors hidden in 500 responses (defense-in-depth)
            const translateErrorStr = typeof data.error === 'string' ? data.error : '';
            const isTranslateQuotaIn500 = res.status === 500 && (
              translateErrorStr.includes('429') || translateErrorStr.includes('quota') ||
              translateErrorStr.includes('RESOURCE_EXHAUSTED') || translateErrorStr.includes('exhausted')
            );
            if (res.status === 429 || isTranslateQuotaIn500) {
              translateQuotaExhausted = true;
              logger.backpressure('translate_batch_quota_exhausted', { book_id: book.id, status: res.status });
              // Try this book via Lambda
              const lambdaResult = await submitTranslationViaLambda(db, book.id);
              if (lambdaResult.success && lambdaResult.jobId) {
                await setPipelineStatus(db, book.id, 'translate_submitted', {
                  translate_job_id: lambdaResult.jobId,
                  retry_count: 0,
                });
                log.translate_submitted++;
                translateLambdaCount++;
                logger.action('translate_lambda_fallback', translateLambdaCount);
              } else if (lambdaResult.success) {
                await setPipelineStatus(db, book.id, 'translate_complete');
                log.translate_advanced++;
              } else {
                log.errors.push(`Translate Lambda fallback ${book.id}: ${lambdaResult.error}`);
              }
              continue;
            }
            // Track consecutive batch failures — likely quota exhaustion manifesting as 500
            if (res.status === 500) {
              consecutiveTranslateFailures++;
              if (consecutiveTranslateFailures >= CONSECUTIVE_TRANSLATE_THRESHOLD) {
                translateQuotaExhausted = true;
                logger.backpressure('translate_batch_consecutive_500s', {
                  book_id: book.id, count: consecutiveTranslateFailures,
                });
                const lambdaResult = await submitTranslationViaLambda(db, book.id);
                if (lambdaResult.success && lambdaResult.jobId) {
                  await setPipelineStatus(db, book.id, 'translate_submitted', {
                    translate_job_id: lambdaResult.jobId, retry_count: 0,
                  });
                  log.translate_submitted++;
                  translateLambdaCount++;
                  logger.action('translate_lambda_fallback', translateLambdaCount);
                } else if (lambdaResult.success) {
                  await setPipelineStatus(db, book.id, 'translate_complete');
                  log.translate_advanced++;
                }
                continue;
              }
            }
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Translate submit failed after ${retries} retries: HTTP ${res.status}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: retries + 1 });
            }
            log.errors.push(`Translate submit ${book.id}: HTTP ${res.status} (retry ${retries + 1}/${MAX_RETRIES})`);
            continue;
          }

          // Reset consecutive failure counter on success
          consecutiveTranslateFailures = 0;

          if (data.jobName) {
            await setPipelineStatus(db, book.id, 'translate_submitted', {
              translate_job_name: data.jobName as string,
              retry_count: 0,
            });
            log.translate_submitted++;
          } else if (data.processed === 0 || (data.message as string)?.includes('No pages need translation')) {
            await setPipelineStatus(db, book.id, 'translate_complete');
            log.translate_advanced++;
          } else {
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Translate submit unexpected: ${data.error || 'unknown'}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: retries + 1 });
            }
            log.errors.push(`Translate submit ${book.id}: ${data.error || 'unexpected response'}`);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'unknown';
          // Circuit breaker: catch rate limit errors that come through as exceptions
          if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate')) {
            translateQuotaExhausted = true;
            logger.backpressure('translate_batch_quota_exhausted', { book_id: book.id, error: errMsg });
            // Try this book via Lambda
            const lambdaResult = await submitTranslationViaLambda(db, book.id);
            if (lambdaResult.success && lambdaResult.jobId) {
              await setPipelineStatus(db, book.id, 'translate_submitted', {
                translate_job_id: lambdaResult.jobId,
                retry_count: 0,
              });
              log.translate_submitted++;
              translateLambdaCount++;
              logger.action('translate_lambda_fallback', translateLambdaCount);
            } else if (lambdaResult.success) {
              await setPipelineStatus(db, book.id, 'translate_complete');
              log.translate_advanced++;
            }
            continue;
          }
          if (retries >= MAX_RETRIES) {
            await markFailed(db, book.id, `Translate submit exception: ${errMsg}`, retries);
          } else {
            await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: retries + 1 });
          }
          log.errors.push(`Translate submit ${book.id}: ${errMsg}`);
        }
      }

      if (translateQuotaExhausted) {
        log.errors.push(`Translate: Batch API quota exhausted — used Lambda fallback for ${translateLambdaCount} books`);
      }
    }

    // ── Phase 5: Check translation completion (translate_submitted -> translate_complete) ──
    // Guard: don't advance past translation when paused — books stay in translate_submitted
    if (hasTimeBudget(startTime) && !translatePaused) {
      const translatePending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'translate_submitted' })
        .project({ id: 1, 'pipeline_auto.translate_job_name': 1, 'pipeline_auto.translate_job_id': 1, 'pipeline_auto.translate_loop_count': 1 })
        .toArray();

      for (const book of translatePending) {
        if (!hasTimeBudget(startTime)) break;
        const jobName = book.pipeline_auto?.translate_job_name;
        const jobId = book.pipeline_auto?.translate_job_id;

        let isComplete = false;

        if (jobId) {
          // Realtime Lambda job — check jobs collection
          const job = await db.collection('jobs').findOne({
            id: jobId,
            status: { $in: ['completed', 'completed_with_errors'] },
          });
          if (job) isComplete = true;
        } else if (jobName) {
          // Batch API job — check batch_jobs collection
          const batchJob = await db.collection('batch_jobs').findOne({
            book_id: book.id,
            type: 'translation',
            $or: [
              { job_name: jobName },
              { gemini_job_name: jobName },
            ],
            status: { $in: ['completed', 'saved', 'completed_with_errors'] },
          });

          const parentJob = !batchJob
            ? await db.collection('batch_jobs').findOne({
                book_id: book.id,
                type: 'translation',
                child_job_ids: { $exists: true, $ne: [] },
                status: { $in: ['completed', 'saved', 'completed_with_errors'] },
              })
            : null;

          if (batchJob || parentJob) isComplete = true;
        }

        if (isComplete) {
          // Check if there are still un-translated pages — if so, loop back
          const remainingTranslate = await db.collection('pages').countDocuments({
            book_id: book.id,
            'ocr.data': { $exists: true, $nin: [null, ''] },
            page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
            $or: [
              { 'translation.data': { $exists: false } },
              { 'translation.data': null },
              { 'translation.data': '' },
            ],
          });

          if (remainingTranslate > 0) {
            // Check if there are uncollected batch_jobs — collector may not have saved results yet
            const uncollectedTransBatch = await db.collection('batch_jobs').countDocuments({
              book_id: book.id,
              type: 'translation',
              status: { $in: ['pending', 'processing', 'completed'] }, // NOT 'saved'
            });

            if (uncollectedTransBatch > 0) {
              // Wait for collector to save results
            } else {
              const tLoopCount = (book.pipeline_auto?.translate_loop_count || 0) + 1;
              if (tLoopCount > MAX_RETRIES) {
                await setPipelineStatus(db, book.id, 'needs_attention', {
                  error: `Translation looped ${tLoopCount} times with ${remainingTranslate} pages still untranslated`,
                  translate_loop_count: tLoopCount,
                });
                log.needs_attention++;
                log.errors.push(`Translate circuit breaker ${book.id}: looped ${tLoopCount}x, ${remainingTranslate} pages remaining`);
              } else {
                await setPipelineStatus(db, book.id, 'metadata_enriched', { translate_loop_count: tLoopCount });
              }
            }
            log.translate_advanced++;
          } else {
            await setPipelineStatus(db, book.id, 'translate_complete');
            log.translate_advanced++;
          }
        }
      }
    }

    await earlyFlushIfNeeded();

    // ── Phase 6: Enrich — generate summary + index (translate_complete -> enriched) ──
    // Also re-enriches books where enrichment_stale was set by OCR/translation workers.
    // Picks up 'enriching' books too — they may have been orphaned if a previous cron run timed out.
    if (hasTimeBudget(startTime)) {
      const readyForEnrich = await db.collection('books')
        .find({
          $or: [
            { 'pipeline_auto.status': 'translate_complete' },
            { 'pipeline_auto.status': 'enriching' },
            { enrichment_stale: true, 'index.generatedAt': { $exists: true } },
          ]
        })
        .sort({ hidden: 1 }) // Visible books first
        .project({ id: 1, title: 1, 'pipeline_auto.status': 1, 'pipeline_auto.retry_count': 1, enrichment_stale: 1 })
        .limit(ENRICH_LIMIT)
        .toArray();

      // Mark all as enriching up front (skip books already in enriching state)
      for (const book of readyForEnrich) {
        if (book.pipeline_auto?.status === 'translate_complete') {
          await setPipelineStatus(db, book.id, 'enriching');
        }
      }

      // Process all books concurrently
      const enrichResults = await Promise.allSettled(
        readyForEnrich.map(async (book) => {
          // GET /api/books/{id}/index generates summary + index if stale
          const res = await fetch(`${baseUrl}/api/books/${book.id}/index`, {
            method: 'GET',
          });

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }

          // Quality scoring — non-blocking, fast (~2s)
          try { await scoreBookQuality(db, book.id); } catch { /* non-critical */ }

          return book;
        })
      );

      // Process results
      for (let i = 0; i < enrichResults.length; i++) {
        const result = enrichResults[i];
        const book = readyForEnrich[i];
        const isStaleReenrich = book.enrichment_stale && book.pipeline_auto?.status !== 'translate_complete';

        if (result.status === 'fulfilled') {
          if (isStaleReenrich) {
            // Stale re-enrich: just clear the flag, don't touch pipeline status
            await db.collection('books').updateOne(
              { id: book.id },
              { $unset: { enrichment_stale: '' } }
            );
          } else {
            await setPipelineStatus(db, book.id, 'enriched', { retry_count: 0 });
          }
          log.enriched++;
        } else {
          const retries = book.pipeline_auto?.retry_count || 0;
          if (isStaleReenrich) {
            // Stale re-enrich failure: clear the flag anyway — will retry next time OCR/translation runs
            await db.collection('books').updateOne(
              { id: book.id },
              { $unset: { enrichment_stale: '' } }
            );
          } else if (retries >= MAX_RETRIES) {
            // Enrichment is non-critical — skip on persistent failure
            await setPipelineStatus(db, book.id, 'enriched', { retry_count: 0 });
            log.enriched++;
          } else {
            await setPipelineStatus(db, book.id, 'translate_complete', { retry_count: retries + 1 });
          }
          log.errors.push(`Enrich ${book.id}: ${result.reason instanceof Error ? result.reason.message : 'unknown'}`);
        }
      }
    }

    // ── Phase 7: Chapter extraction (enriched -> chapters_complete) ──
    // AI extracts chapter structure from OCR headings. Fast & cheap (~$0.02/book).
    // Books with <10 pages skip directly — no meaningful structure to extract.
    if (hasTimeBudget(startTime)) {
      const readyForChapters = await db.collection('books')
        .find({ 'pipeline_auto.status': 'enriched' })
        .sort({ hidden: 1 }) // Visible books first
        .project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.retry_count': 1 })
        .limit(CHAPTER_LIMIT)
        .toArray();

      for (const book of readyForChapters) {
        if (!hasTimeBudget(startTime)) break;
        try {
          // Skip very short books — no meaningful chapter structure
          if ((book.pages_count || 0) < 10) {
            await setPipelineStatus(db, book.id, 'chapters_complete', { retry_count: 0 });
            log.chapters_skipped++;
            continue;
          }

          await setPipelineStatus(db, book.id, 'chapters');

          await extractChaptersForBook(db, book.id);

          await setPipelineStatus(db, book.id, 'chapters_complete', { retry_count: 0 });
          log.chapters_extracted++;
        } catch (err) {
          const retries = book.pipeline_auto?.retry_count || 0;
          if (retries >= MAX_RETRIES) {
            // Chapter extraction is non-critical — skip to next phase on persistent failure
            await setPipelineStatus(db, book.id, 'chapters_complete', { retry_count: 0 });
            log.chapters_skipped++;
          } else {
            await setPipelineStatus(db, book.id, 'enriched', { retry_count: retries + 1 });
          }
          log.errors.push(`Chapters ${book.id}: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    }

    // (Phases 8, 8.5, 9 now run in the priority pass above)

    const duration = Date.now() - startTime;

    // Summary counts + page totals in one $facet scan
    const [facetResult] = await db.collection('books').aggregate([{
      $facet: {
        funnel: [
          { $match: { 'pipeline_auto.status': { $exists: true } } },
          { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
        ],
        totals: [{ $group: {
          _id: null,
          books: { $sum: 1 },
          pages: { $sum: { $ifNull: ['$pages_count', 0] } },
          ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
          translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        }}],
      },
    }]).toArray();

    const counts = Object.fromEntries((facetResult?.funnel || []).map((s: any) => [s._id, s.count]));
    const totals = facetResult?.totals?.[0] || { books: 0, pages: 0, ocr: 0, translated: 0 };

    // Active batch jobs count
    const activeBatch = await db.collection('batch_jobs').aggregate([
      { $match: { status: { $in: ['pending', 'processing'] } } },
      { $group: { _id: '$type', count: { $sum: 1 }, pages: { $sum: { $ifNull: ['$page_count', 0] } } } },
    ]).toArray();
    const batchByType = Object.fromEntries(activeBatch.map((b: any) => [b._id, { count: b.count, pages: b.pages }]));

    // ── Persist snapshot + cron run (non-blocking) ──
    const now = new Date();
    const snapshotWrite = db.collection('pipeline_snapshots').insertOne({
      timestamp: now,
      funnel: counts,
      pages: { total: totals.pages, ocr: totals.ocr, translated: totals.translated },
      books: totals.books,
      active_batch: batchByType,
      cost_period: null, // filled by dashboard queries against gemini_usage
    }).catch(e => console.error('[pipeline-snapshot] write failed:', e));

    // ── Sweep: fix any books with stale /uploads/ thumbnails ──
    // This catches books that aren't transitioning states (e.g. sitting at chapters_complete)
    try {
      const staleThumbnailBooks = await db.collection('books').find(
        { thumbnail: { $regex: '/uploads/' } },
        { projection: { id: 1 } }
      ).limit(10).toArray();
      for (const b of staleThumbnailBooks) {
        await fixStaleThumbnail(db, b.id);
      }
      if (staleThumbnailBooks.length > 0) {
        log.thumbnails_fixed = staleThumbnailBooks.length;
      }
    } catch (e) {
      // Non-critical — don't fail the cron
    }

    // Log time budget decision if budget was exhausted
    if (!hasTimeBudget(startTime)) {
      logger.timeBudgetExhausted(`after ${duration}ms`);
    }

    logger.setActions({
      enrolled: log.enrolled,
      archived: log.archived,
      ocr_submitted: log.ocr_submitted,
      ocr_advanced: log.ocr_advanced,
      metadata_enriched: log.metadata_enriched,
      metadata_skipped: log.metadata_skipped,
      translate_submitted: log.translate_submitted,
      translate_advanced: log.translate_advanced,
      enriched: log.enriched,
      chapters_extracted: log.chapters_extracted,
      chapters_skipped: log.chapters_skipped,
      images_submitted: log.images_submitted,
      images_advanced: log.images_advanced,
      finalized: log.finalized,
      git_synced: log.git_synced,
      needs_attention: log.needs_attention,
      stale_retried: log.stale_retried,
      stale_failed: log.stale_failed,
      stale_retranslate: log.stale_retranslate,
    });
    logger.addErrors(log.errors);

    const cronWrite = logger.flush();

    // Don't block the response on writes
    await Promise.allSettled([snapshotWrite, cronWrite]);

    return NextResponse.json({
      success: true,
      duration_ms: duration,
      actions: log,
      pipeline_status: counts,
      pages: { total: totals.pages, ocr: totals.ocr, translated: totals.translated },
    });
  } catch (error) {
    console.error('[post-import-pipeline] Error:', error);

    // On connection timeout, try to reconnect for the logging/summary phase
    if (isConnectionError(error)) {
      logger.error(`MongoDB connection lost: ${error instanceof Error ? error.message : 'unknown'} — reconnecting`);
      try {
        db = await forceReconnect();
        // If reconnect works, try to at least write the partial summary
        logger.setActions({
          enrolled: log.enrolled,
          archived: log.archived,
          ocr_submitted: log.ocr_submitted,
          ocr_advanced: log.ocr_advanced,
          metadata_enriched: log.metadata_enriched,
          translate_submitted: log.translate_submitted,
          translate_advanced: log.translate_advanced,
          enriched: log.enriched,
          chapters_extracted: log.chapters_extracted,
          images_submitted: log.images_submitted,
          finalized: log.finalized,
          git_synced: log.git_synced,
          needs_attention: log.needs_attention,
          stale_retried: log.stale_retried,
          stale_failed: log.stale_failed,
          stale_retranslate: log.stale_retranslate,
        });
        logger.addErrors(log.errors);
        logger.error(`Recovered from connection timeout after partial work`);
        await logger.flush();
        // Return 200 — work was partially done, cron shouldn't count as failed
        return NextResponse.json({
          success: true,
          recovered: true,
          duration_ms: Date.now() - startTime,
          partial: log,
        });
      } catch {
        // Reconnect also failed — fall through to standard error handling
      }
    }

    logger.setActions({
      enrolled: log.enrolled,
      archived: log.archived,
      ocr_submitted: log.ocr_submitted,
      ocr_advanced: log.ocr_advanced,
      metadata_enriched: log.metadata_enriched,
      translate_submitted: log.translate_submitted,
      translate_advanced: log.translate_advanced,
      enriched: log.enriched,
      chapters_extracted: log.chapters_extracted,
      images_submitted: log.images_submitted,
      finalized: log.finalized,
      git_synced: log.git_synced,
      needs_attention: log.needs_attention,
      stale_retried: log.stale_retried,
      stale_failed: log.stale_failed,
      stale_retranslate: log.stale_retranslate,
    });
    logger.addErrors(log.errors);
    logger.error(error instanceof Error ? error.message : 'Unknown error');
    logger.setFailed();
    await logger.flush();
    return NextResponse.json({
      error: 'Pipeline cron failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      partial: log,
    }, { status: 500 });
  }
}

// Support POST for Vercel Cron
export async function POST(request: NextRequest) {
  return GET(request);
}
