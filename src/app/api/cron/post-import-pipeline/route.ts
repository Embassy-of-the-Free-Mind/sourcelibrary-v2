import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
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

export const maxDuration = 300;

const TIME_BUDGET_MS = 270_000; // 4.5 min — leave 30s buffer before Vercel's 300s limit
const ENROLL_LIMIT = 50;
const ARCHIVE_LIMIT = 100; // Just DB checks now — Hetzner does actual archiving
const OCR_SUBMIT_LIMIT = 40; // Batch API jobs are async — submit more per cycle
const MAX_ACTIVE_BATCH_OCR = 200; // Gemini Batch API handles many concurrent jobs
const METADATA_ENRICH_LIMIT = 20; // Single Gemini call per book, fast
const TRANSLATE_SUBMIT_LIMIT = 30; // Batch API jobs are async
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

async function markFailed(
  db: Awaited<ReturnType<typeof getDb>>,
  bookId: string,
  error: string,
  retryCount: number,
) {
  await setPipelineStatus(db, bookId, 'failed', { error, retry_count: retryCount });
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
  const db = await getDb();

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
    needs_attention: 0,
    stale_retried: 0,
    stale_failed: 0,
    stale_retranslate: 0,
    errors: [] as string[],
  };

  try {
    // ════════════════════════════════════════════════════════════════════
    // PRIORITY PASS: Run fast, late-stage phases FIRST so they don't get
    // starved by heavy enrichment/chapters work consuming the time budget.
    // These are all cheap (DB writes + SQS) and unblock book completion.
    // ════════════════════════════════════════════════════════════════════

    // ── Priority: Finalize (images_complete -> complete) — with quality validation ──
    if (hasTimeBudget(startTime)) {
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
      }
    }

    // ── Priority: Image extraction submission (chapters_complete -> images_submitted) ──
    if (hasTimeBudget(startTime)) {
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
          const activeBatch = await db.collection('batch_jobs').countDocuments({
            book_id: book.id,
            type: batchType,
            status: { $in: ['pending', 'processing', 'completed'] }, // completed = not yet collected
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

    // ── Priority: Stale translation retranslation — books past translation phase with outdated translations ──
    if (hasTimeBudget(startTime)) {
      const STALE_RETRANSLATE_LIMIT = 5; // Conservative — each book is a batch job
      // Find books in late pipeline stages (or complete) that have pages with stale translations
      const lateStages: PipelineAutoStatus[] = [
        'translate_complete', 'enriching', 'enriched', 'chapters', 'chapters_complete',
        'images_submitted', 'images_complete', 'complete',
      ];
      const booksInLateStages = await db.collection('books')
        .find({ 'pipeline_auto.status': { $in: lateStages } })
        .project({ id: 1, title: 1, language: 1, 'pipeline_auto.status': 1 })
        .toArray();

      // For each, check if it has stale translation pages (batch-efficient: single aggregation)
      if (booksInLateStages.length > 0) {
        const lateBookIds = booksInLateStages.map(b => b.id);
        const staleTranslationBooks = await db.collection('pages').aggregate([
          {
            $match: {
              book_id: { $in: lateBookIds },
              'ocr.data': { $exists: true, $nin: [null, ''] },
              'ocr.model': 'gemini-3-flash-preview',
              'translation.data': { $exists: true, $nin: [null, ''] },
              'translation.model': { $ne: 'gemini-3-flash-preview' },
              page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
            },
          },
          { $group: { _id: '$book_id', stale_count: { $sum: 1 } } },
          { $sort: { stale_count: -1 } },
          { $limit: STALE_RETRANSLATE_LIMIT },
        ]).toArray();

        let staleTranslateQuotaExhausted = false;
        for (const staleBook of staleTranslationBooks) {
          if (!hasTimeBudget(startTime) || staleTranslateQuotaExhausted) break;

          // Check there isn't already a pending/processing stale retranslation batch job
          const existingJob = await db.collection('batch_jobs').countDocuments({
            book_id: staleBook._id,
            type: 'translation',
            stale_only: true,
            status: { $in: ['JOB_STATE_PENDING', 'JOB_STATE_RUNNING', 'pending', 'processing'] },
          });
          if (existingJob > 0) continue;

          try {
            const res = await fetch(`${baseUrl}/api/books/${staleBook._id}/batch-translate-async`, {
              method: 'POST',
              headers: getInternalHeaders(),
              body: JSON.stringify({ staleOnly: true, limit: 500 }),
            });

            if (res.status === 429) {
              staleTranslateQuotaExhausted = true;
              logger.backpressure('stale_retranslate_quota', { book_id: staleBook._id });
              break;
            }

            if (res.ok) {
              const data = await res.json();
              if (data.jobName) {
                log.stale_retranslate++;
                logger.action('stale_retranslate', 1);
              }
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'unknown';
            if (errMsg.includes('429') || errMsg.includes('quota')) {
              staleTranslateQuotaExhausted = true;
              break;
            }
            log.errors.push(`Stale retranslate ${staleBook._id}: ${errMsg}`);
          }
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // MAIN PASS: Standard pipeline phases (enrollment through chapters)
    // ════════════════════════════════════════════════════════════════════

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
      const archivingBooks = await db.collection('books')
        .find({ 'pipeline_auto.status': 'archiving' })
        .sort({ hidden: 1 }) // Visible books first
        .project({ id: 1 })
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
        }
        // Otherwise Hetzner is still working — check again next cycle
      }
    }

    // ── Phase 2: Submit OCR via Gemini Batch API (archive_complete -> ocr_submitted) ──
    // Batch API is 50% cheaper than realtime. Jobs complete within hours.
    // The route handles child-batch splitting for large books.
    if (hasTimeBudget(startTime)) {
      // Backpressure: don't overwhelm the Gemini Batch API queue
      const activeBatchOcr = await db.collection('batch_jobs').countDocuments({
        type: 'ocr',
        status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
      });

      const ocrLimit = activeBatchOcr >= MAX_ACTIVE_BATCH_OCR ? 0 : OCR_SUBMIT_LIMIT;

      if (activeBatchOcr >= MAX_ACTIVE_BATCH_OCR) {
        logger.backpressure('ocr_batch_limit', { active: activeBatchOcr, max: MAX_ACTIVE_BATCH_OCR });
      }

      const readyForOcr = ocrLimit > 0 ? await db.collection('books')
        .find({ 'pipeline_auto.status': 'archive_complete' })
        .sort({ hidden: 1 }) // Visible books first
        .project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.retry_count': 1 })
        .limit(ocrLimit)
        .toArray() : [];

      let ocrQuotaExhausted = false;
      for (const book of readyForOcr) {
        if (!hasTimeBudget(startTime) || ocrQuotaExhausted) break;
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
            // Circuit breaker: 429 = quota/rate limit — stop trying more books this run
            // Don't count systemic quota exhaustion against per-book retry count
            if (res.status === 429) {
              ocrQuotaExhausted = true;
              logger.backpressure('ocr_quota_exhausted', { book_id: book.id, status: 429 });
              log.errors.push(`OCR: quota/rate limit hit (HTTP 429) — skipping remaining OCR submits`);
              break;
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
            logger.backpressure('ocr_quota_exhausted', { book_id: book.id, error: errMsg });
            log.errors.push(`OCR: quota/rate limit hit — skipping remaining OCR submits`);
            break;
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
        log.errors.push('OCR: All API keys quota exhausted');
      }
    }

    // ── Phase 3: Check OCR completion (ocr_submitted -> ocr_complete) ──
    if (hasTimeBudget(startTime)) {
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

    // ── Phase 4: Submit translation via Gemini Batch API (metadata_enriched -> translate_submitted) ──
    if (hasTimeBudget(startTime)) {
      const readyForTranslate = await db.collection('books')
        .find({ 'pipeline_auto.status': 'metadata_enriched' })
        .sort({ hidden: 1 }) // Visible books first
        .project({ id: 1, title: 1, pages_count: 1, language: 1, 'pipeline_auto.retry_count': 1 })
        .limit(TRANSLATE_SUBMIT_LIMIT)
        .toArray();

      let translateQuotaExhausted = false;
      for (const book of readyForTranslate) {
        if (!hasTimeBudget(startTime) || translateQuotaExhausted) break;
        const retries = book.pipeline_auto?.retry_count || 0;

        // English books get modernized (Early Modern → Modern English) via the same batch route
        try {
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
            // Circuit breaker: 429 = quota/rate limit — stop trying more books this run
            // Don't count systemic rate limits against per-book retry count
            if (res.status === 429) {
              translateQuotaExhausted = true;
              logger.backpressure('translate_quota_exhausted', { book_id: book.id, status: 429 });
              log.errors.push(`Translate: rate limit hit (HTTP 429) — skipping remaining translate submits`);
              break;
            }
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Translate submit failed after ${retries} retries: HTTP ${res.status}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: retries + 1 });
            }
            log.errors.push(`Translate submit ${book.id}: HTTP ${res.status} (retry ${retries + 1}/${MAX_RETRIES})`);
            continue;
          }

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
            logger.backpressure('translate_quota_exhausted', { book_id: book.id, error: errMsg });
            log.errors.push(`Translate: rate limit hit — skipping remaining translate submits`);
            break;
          }
          if (retries >= MAX_RETRIES) {
            await markFailed(db, book.id, `Translate submit exception: ${errMsg}`, retries);
          } else {
            await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: retries + 1 });
          }
          log.errors.push(`Translate submit ${book.id}: ${errMsg}`);
        }
      }
    }

    // ── Phase 5: Check translation completion (translate_submitted -> translate_complete) ──
    if (hasTimeBudget(startTime)) {
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

    // ── Phase 6: Enrich — generate summary + index (translate_complete -> enriched) ──
    // Also re-enriches books where enrichment_stale was set by OCR/translation workers.
    if (hasTimeBudget(startTime)) {
      const readyForEnrich = await db.collection('books')
        .find({
          $or: [
            { 'pipeline_auto.status': 'translate_complete' },
            { enrichment_stale: true, 'index.generatedAt': { $exists: true } },
          ]
        })
        .sort({ hidden: 1 }) // Visible books first
        .project({ id: 1, title: 1, 'pipeline_auto.status': 1, 'pipeline_auto.retry_count': 1, enrichment_stale: 1 })
        .limit(ENRICH_LIMIT)
        .toArray();

      // Mark all as enriching up front
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
