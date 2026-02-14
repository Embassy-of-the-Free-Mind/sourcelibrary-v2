import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { PipelineAutoStatus } from '@/lib/types/pipeline';

export const maxDuration = 300;

const TIME_BUDGET_MS = 270_000; // 4.5 min — leave 30s buffer before Vercel's 300s limit
const ENROLL_LIMIT = 10;
const ARCHIVE_LIMIT = 3;
const OCR_SUBMIT_LIMIT = 2;
const TRANSLATE_SUBMIT_LIMIT = 2;
const ENRICH_LIMIT = 1;
const MAX_RETRIES = 3;
const ENROLL_WINDOW_DAYS = 7;

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
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
 *   archive -> OCR -> translate -> summary/index
 *
 * Scheduled: every 10 minutes via Vercel cron.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const baseUrl = getBaseUrl();
  const db = await getDb();

  const log = {
    enrolled: 0,
    archived: 0,
    ocr_submitted: 0,
    ocr_advanced: 0,
    translate_submitted: 0,
    translate_advanced: 0,
    enriched: 0,
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

    // ── Phase 1: Archive images (queued -> archiving -> archive_complete) ──
    if (hasTimeBudget(startTime)) {
      // Start archiving for queued books
      const queuedBooks = await db.collection('books')
        .find({ 'pipeline_auto.status': 'queued' })
        .project({ id: 1, title: 1 })
        .limit(ARCHIVE_LIMIT)
        .toArray();

      for (const book of queuedBooks) {
        if (!hasTimeBudget(startTime)) break;
        await setPipelineStatus(db, book.id, 'archiving', { started_at: new Date() });
      }

      // Continue archiving for books in archiving state
      const archivingBooks = await db.collection('books')
        .find({ 'pipeline_auto.status': 'archiving' })
        .project({ id: 1, title: 1, 'pipeline_auto.retry_count': 1 })
        .limit(ARCHIVE_LIMIT)
        .toArray();

      for (const book of archivingBooks) {
        if (!hasTimeBudget(startTime)) break;
        try {
          const res = await fetch(`${baseUrl}/api/books/${book.id}/archive-images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 50 }),
          });

          if (!res.ok) {
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Archive failed: HTTP ${res.status}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'archiving', { retry_count: retries + 1 });
            }
            log.errors.push(`Archive ${book.id}: HTTP ${res.status}`);
            continue;
          }

          const data = await res.json();
          log.archived++;

          // Check if archiving is complete (no remaining pages)
          if ((data.remaining || 0) === 0) {
            await setPipelineStatus(db, book.id, 'archive_complete', { retry_count: 0 });
          }
          // Otherwise stays in 'archiving' — next invocation continues
        } catch (err) {
          log.errors.push(`Archive ${book.id}: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    }

    // ── Phase 2: Submit OCR (archive_complete -> ocr_submitted) ──
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: book.pages_count || 500 }),
          });

          if (!res.ok) {
            log.errors.push(`OCR submit ${book.id}: HTTP ${res.status}`);
            continue;
          }

          const data = await res.json();

          if (data.jobName) {
            await setPipelineStatus(db, book.id, 'ocr_submitted', {
              ocr_job_name: data.jobName,
            });
            log.ocr_submitted++;
          } else if (data.processed === 0 || data.message?.includes('No pages need OCR')) {
            // Already OCR'd — skip to translate
            await setPipelineStatus(db, book.id, 'ocr_complete');
            log.ocr_advanced++;
          } else {
            log.errors.push(`OCR submit ${book.id}: unexpected response`);
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
        .project({ id: 1, 'pipeline_auto.ocr_job_name': 1, 'pipeline_auto.ocr_batch_id': 1 })
        .toArray();

      for (const book of ocrPending) {
        if (!hasTimeBudget(startTime)) break;
        const jobName = book.pipeline_auto?.ocr_job_name;

        // Check batch_jobs collection for completion
        const batchJob = jobName
          ? await db.collection('batch_jobs').findOne({
              book_id: book.id,
              type: 'ocr',
              $or: [
                { job_name: jobName },
                { gemini_job_name: jobName },
              ],
            })
          : null;

        // Also check for parent jobs (large books split into children)
        const parentJob = await db.collection('batch_jobs').findOne({
          book_id: book.id,
          type: 'ocr',
          child_job_ids: { $exists: true, $ne: [] },
          status: { $in: ['completed', 'saved', 'completed_with_errors'] },
        });

        if (
          batchJob && ['saved', 'completed', 'completed_with_errors'].includes(batchJob.status) ||
          parentJob
        ) {
          await setPipelineStatus(db, book.id, 'ocr_complete');
          log.ocr_advanced++;
        }
        // Otherwise keep waiting — process-batches cron will collect results
      }
    }

    // ── Phase 4: Submit translation (ocr_complete -> translate_submitted) ──
    if (hasTimeBudget(startTime)) {
      const readyForTranslate = await db.collection('books')
        .find({ 'pipeline_auto.status': 'ocr_complete' })
        .project({ id: 1, title: 1, pages_count: 1 })
        .limit(TRANSLATE_SUBMIT_LIMIT)
        .toArray();

      for (const book of readyForTranslate) {
        if (!hasTimeBudget(startTime)) break;
        try {
          const res = await fetch(`${baseUrl}/api/books/${book.id}/batch-translate-async`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: book.pages_count || 500 }),
          });

          if (!res.ok) {
            log.errors.push(`Translate submit ${book.id}: HTTP ${res.status}`);
            continue;
          }

          const data = await res.json();

          if (data.jobName) {
            await setPipelineStatus(db, book.id, 'translate_submitted', {
              translate_job_name: data.jobName,
            });
            log.translate_submitted++;
          } else if (data.processed === 0 || data.message?.includes('No pages need translation')) {
            await setPipelineStatus(db, book.id, 'translate_complete');
            log.translate_advanced++;
          } else {
            log.errors.push(`Translate submit ${book.id}: unexpected response`);
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
        .project({ id: 1, 'pipeline_auto.translate_job_name': 1 })
        .toArray();

      for (const book of translatePending) {
        if (!hasTimeBudget(startTime)) break;
        const jobName = book.pipeline_auto?.translate_job_name;

        const batchJob = jobName
          ? await db.collection('batch_jobs').findOne({
              book_id: book.id,
              type: 'translation',
              $or: [
                { job_name: jobName },
                { gemini_job_name: jobName },
              ],
            })
          : null;

        const parentJob = await db.collection('batch_jobs').findOne({
          book_id: book.id,
          type: 'translation',
          child_job_ids: { $exists: true, $ne: [] },
          status: { $in: ['completed', 'saved', 'completed_with_errors'] },
        });

        if (
          batchJob && ['saved', 'completed', 'completed_with_errors'].includes(batchJob.status) ||
          parentJob
        ) {
          await setPipelineStatus(db, book.id, 'translate_complete');
          log.translate_advanced++;
        }
      }
    }

    // ── Phase 6: Enrich — generate summary + index (translate_complete -> complete) ──
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

          await setPipelineStatus(db, book.id, 'complete', {
            completed_at: new Date(),
            retry_count: 0,
          });
          log.enriched++;
        } catch (err) {
          log.errors.push(`Enrich ${book.id}: ${err instanceof Error ? err.message : 'unknown'}`);
        }
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
