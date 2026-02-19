import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { PipelineAutoStatus } from '@/lib/types/pipeline';
import { verifyCronAuth } from '@/lib/cron-auth';
import { extractChaptersForBook } from '@/lib/chapter-extraction';
import { enrichBookMetadata } from '@/lib/metadata-enrichment';
import { nanoid } from 'nanoid';
import { SKIP_TRANSLATION_PAGE_TYPES } from '@/lib/types/prompts/defaults';
import { enqueuePagesForJob } from '@/lib/queue-utils';

export const maxDuration = 300;

const TIME_BUDGET_MS = 270_000; // 4.5 min — leave 30s buffer before Vercel's 300s limit
const ENROLL_LIMIT = 10;
const ARCHIVE_LIMIT = 20; // Just DB checks now — Hetzner does actual archiving
const OCR_SUBMIT_LIMIT = 20;
const METADATA_ENRICH_LIMIT = 10;
const TRANSLATE_SUBMIT_LIMIT = 10;
const ENRICH_LIMIT = 5;
const CHAPTER_LIMIT = 5;
const IMAGE_SUBMIT_LIMIT = 3;
const FINALIZE_LIMIT = 10;
const MAX_ACTIVE_IMAGE_JOBS = 5;
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

  const startTime = Date.now();
  const baseUrl = getBaseUrl();
  const db = await getDb();

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
    stale_retried: 0,
    stale_failed: 0,
    errors: [] as string[],
  };

  try {
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
        .project({ id: 1 })
        .limit(20) // Check many — this is just a DB query, not I/O
        .toArray();

      for (const book of archivingBooks) {
        if (!hasTimeBudget(startTime)) break;

        // Count pages still needing archiving from external sources
        const remaining = await db.collection('pages').countDocuments({
          book_id: book.id,
          archived_photo: { $exists: false },
          $or: [
            { photo: { $regex: ARCHIVABLE_SOURCES } },
            { photo_original: { $regex: ARCHIVABLE_SOURCES } },
          ],
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
    if (hasTimeBudget(startTime)) {
      const readyForOcr = await db.collection('books')
        .find({ 'pipeline_auto.status': 'archive_complete' })
        .project({ id: 1, title: 1, pages_count: 1 })
        .limit(OCR_SUBMIT_LIMIT)
        .toArray();

      for (const book of readyForOcr) {
        if (!hasTimeBudget(startTime)) break;
        try {
          const res = await fetch(`${baseUrl}/api/books/${book.id}/batch-ocr-async`, {
            method: 'POST',
            headers: getInternalHeaders(),
            body: JSON.stringify({ limit: 10, force: false, pagesPerRequest: 5 }),
          });
          if (!res.ok) {
            log.errors.push(`OCR submit ${book.id}: HTTP ${res.status}`);
            continue;
          }
          const text = await res.text();
          let data: Record<string, unknown>;
          try { data = JSON.parse(text); } catch {
            log.errors.push(`OCR submit ${book.id}: invalid JSON (${text.length} chars)`);
            continue;
          }

          if (data.jobName) {
            await setPipelineStatus(db, book.id, 'ocr_submitted', {
              ocr_job_name: data.jobName as string,
            });
            log.ocr_submitted++;
          } else if (data.processed === 0 || (data.message as string)?.includes('No pages need OCR')) {
            // Already OCR'd — skip to translate
            await setPipelineStatus(db, book.id, 'ocr_complete');
            log.ocr_advanced++;
          } else {
            log.errors.push(`OCR submit ${book.id}: ${data.error || 'unexpected response'}`);
          }
        } catch (err) {
          log.errors.push(`OCR submit ${book.id}: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    }

    // ── Phase 3: Check OCR completion (ocr_submitted -> ocr_complete) ──
    if (hasTimeBudget(startTime)) {
      const ocrPending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'ocr_submitted' })
        .project({ id: 1, 'pipeline_auto.ocr_job_name': 1, 'pipeline_auto.ocr_job_id': 1 })
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
            // More pages to OCR — loop back to archive_complete for re-submission
            await setPipelineStatus(db, book.id, 'archive_complete');
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
        .project({ id: 1, title: 1, pages_count: 1, language: 1 })
        .limit(TRANSLATE_SUBMIT_LIMIT)
        .toArray();

      for (const book of readyForTranslate) {
        if (!hasTimeBudget(startTime)) break;

        // English books get modernized (Early Modern → Modern English) via the same batch route
        try {
          const res = await fetch(`${baseUrl}/api/books/${book.id}/batch-translate-async`, {
            method: 'POST',
            headers: getInternalHeaders(),
            body: JSON.stringify({ limit: 100 }),
          });
          if (!res.ok) {
            log.errors.push(`Translate submit ${book.id}: HTTP ${res.status}`);
            continue;
          }
          const text = await res.text();
          let data: Record<string, unknown>;
          try { data = JSON.parse(text); } catch {
            log.errors.push(`Translate submit ${book.id}: invalid JSON (${text.length} chars)`);
            continue;
          }

          if (data.jobName) {
            await setPipelineStatus(db, book.id, 'translate_submitted', {
              translate_job_name: data.jobName as string,
            });
            log.translate_submitted++;
          } else if (data.processed === 0 || (data.message as string)?.includes('No pages need translation')) {
            await setPipelineStatus(db, book.id, 'translate_complete');
            log.translate_advanced++;
          } else {
            log.errors.push(`Translate submit ${book.id}: ${data.error || 'unexpected response'}`);
          }
        } catch (err) {
          log.errors.push(`Translate submit ${book.id}: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    }

    // ── Phase 5: Check translation completion (translate_submitted -> translate_complete) ──
    if (hasTimeBudget(startTime)) {
      const translatePending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'translate_submitted' })
        .project({ id: 1, 'pipeline_auto.translate_job_name': 1, 'pipeline_auto.translate_job_id': 1 })
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
            await setPipelineStatus(db, book.id, 'metadata_enriched');
            log.translate_advanced++;
          } else {
            await setPipelineStatus(db, book.id, 'translate_complete');
            log.translate_advanced++;
          }
        }
      }
    }

    // ── Phase 6: Enrich — generate summary + index (translate_complete -> enriched) ──
    if (hasTimeBudget(startTime)) {
      const readyForEnrich = await db.collection('books')
        .find({ 'pipeline_auto.status': 'translate_complete' })
        .project({ id: 1, title: 1, 'pipeline_auto.retry_count': 1 })
        .limit(ENRICH_LIMIT)
        .toArray();

      for (const book of readyForEnrich) {
        if (!hasTimeBudget(startTime)) break;
        try {
          await setPipelineStatus(db, book.id, 'enriching');

          // GET /api/books/{id}/index generates summary + index if stale
          const res = await fetch(`${baseUrl}/api/books/${book.id}/index`, {
            method: 'GET',
          });

          if (!res.ok) {
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Enrich failed: HTTP ${res.status}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'translate_complete', { retry_count: retries + 1 });
            }
            log.errors.push(`Enrich ${book.id}: HTTP ${res.status}`);
            continue;
          }

          await setPipelineStatus(db, book.id, 'enriched', { retry_count: 0 });
          log.enriched++;
        } catch (err) {
          log.errors.push(`Enrich ${book.id}: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    }

    // ── Phase 7: Chapter extraction (enriched -> chapters_complete) ──
    // AI extracts chapter structure from OCR headings. Fast & cheap (~$0.02/book).
    // Books with <10 pages skip directly — no meaningful structure to extract.
    if (hasTimeBudget(startTime)) {
      const readyForChapters = await db.collection('books')
        .find({ 'pipeline_auto.status': 'enriched' })
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

    // ── Phase 8: Image extraction (chapters_complete -> images_submitted / images_complete) ──
    // Queue pages to Lambda for illustration detection. ~$0.15/book, takes minutes-hours.
    if (hasTimeBudget(startTime)) {
      // Check backpressure — don't queue more if many jobs are active
      const activeImageJobs = await db.collection('jobs').countDocuments({
        type: 'image_extraction',
        status: { $in: ['pending', 'processing'] },
      });

      if (activeImageJobs < MAX_ACTIVE_IMAGE_JOBS) {
        const readyForImages = await db.collection('books')
          .find({ 'pipeline_auto.status': 'chapters_complete' })
          .project({ id: 1, title: 1 })
          .limit(IMAGE_SUBMIT_LIMIT)
          .toArray();

        for (const book of readyForImages) {
          if (!hasTimeBudget(startTime)) break;
          try {
            // Get all page IDs for this book
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

            // Create job record
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

            // Set book.job for UI display
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { job: { type: 'image_extraction', job_id: jobId } } }
            );

            // Enqueue pages to SQS
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
          // No job ID — skip to complete
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

    // ── Phase 8.5: Staleness detection — unstick books in *_submitted states ──
    // If a book has been in a submitted state for >48h, the batch job likely failed silently.
    // Retry up to MAX_RETRIES, then mark failed.
    if (hasTimeBudget(startTime)) {
      const staleThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const staleBooks = await db.collection('books')
        .find({
          'pipeline_auto.status': { $in: ['ocr_submitted', 'translate_submitted', 'images_submitted'] },
          'pipeline_auto.last_updated': { $lt: staleThreshold },
        })
        .project({ id: 1, title: 1, 'pipeline_auto': 1 })
        .limit(10)
        .toArray();

      for (const book of staleBooks) {
        if (!hasTimeBudget(startTime)) break;
        const retries = book.pipeline_auto?.retry_count || 0;
        const status = book.pipeline_auto?.status as string;

        if (retries >= MAX_RETRIES) {
          await markFailed(db, book.id, `Stale in ${status} for >48h after ${retries} retries`, retries);
          log.stale_failed++;
        } else {
          // Roll back to the previous state so it gets re-submitted next cycle
          const rollbackMap: Record<string, PipelineAutoStatus> = {
            'ocr_submitted': 'archive_complete',
            'translate_submitted': 'metadata_enriched',
            'images_submitted': 'chapters_complete',
          };
          const rollbackTo = rollbackMap[status];
          if (rollbackTo) {
            await setPipelineStatus(db, book.id, rollbackTo, { retry_count: retries + 1 });
            log.stale_retried++;
          }
        }
        log.errors.push(`Stale ${book.id} (${book.title}): stuck in ${status} since ${book.pipeline_auto?.last_updated}`);
      }
    }

    // ── Phase 9: Finalize (images_complete -> complete) ──
    if (hasTimeBudget(startTime)) {
      const readyToFinalize = await db.collection('books')
        .find({ 'pipeline_auto.status': 'images_complete' })
        .project({ id: 1 })
        .limit(FINALIZE_LIMIT)
        .toArray();

      for (const book of readyToFinalize) {
        await setPipelineStatus(db, book.id, 'complete', { completed_at: new Date() });
        log.finalized++;
      }
    }

    const duration = Date.now() - startTime;

    // Summary counts
    const statusCounts = await db.collection('books').aggregate([
      { $match: { pipeline_auto: { $exists: true } } },
      { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
    ]).toArray();

    const counts = Object.fromEntries(statusCounts.map(s => [s._id, s.count]));

    return NextResponse.json({
      success: true,
      duration_ms: duration,
      actions: log,
      pipeline_status: counts,
    });
  } catch (error) {
    console.error('[post-import-pipeline] Error:', error);
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
