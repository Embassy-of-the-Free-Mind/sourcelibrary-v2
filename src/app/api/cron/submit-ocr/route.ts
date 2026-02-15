import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { nanoid } from 'nanoid';
import { DEFAULT_MODEL } from '@/lib/types/ai-models';
import { enqueuePagesForJob } from '@/lib/queue-utils';
import type { JobStatus } from '@/lib/types/job';

export const maxDuration = 300;

// Tunables
const MAX_ACTIVE_JOBS = 100;    // Don't submit if this many realtime jobs are active
const BOOKS_PER_RUN = 20;       // Books to submit per cron invocation
const PAGES_PER_BOOK = 500;     // Max pages to submit per book (Lambda handles concurrency)

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
  const startTime = Date.now();

  try {
    const db = await getDb();

    // Backpressure: check active realtime job count
    const activeJobs = await db.collection('jobs').countDocuments({
      type: 'ocr',
      status: { $in: ['pending', 'processing'] as JobStatus[] },
    });

    if (activeJobs >= MAX_ACTIVE_JOBS) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: `${activeJobs} active realtime OCR jobs (max ${MAX_ACTIVE_JOBS})`,
        duration_ms: Date.now() - startTime,
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
    const excludeBookIds = [...new Set([...booksWithRealtimeJobs, ...booksWithBatchJobs])];

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
      return NextResponse.json({
        success: true,
        message: 'All books have OCR or are already being processed',
        activeJobs,
        duration_ms: Date.now() - startTime,
      });
    }

    // Submit jobs
    const submitted: Array<{ bookId: string; title: string; jobId: string; pagesQueued: number }> = [];
    const errors: string[] = [];

    for (const book of eligibleBooks) {
      try {
        // Find pages without OCR for this book
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
          .project({ id: 1 })
          .toArray();

        if (pagesWithoutOcr.length === 0) {
          continue; // Book already fully OCR'd (cached count was stale)
        }

        const pageIds = pagesWithoutOcr.map(p => p.id);
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

    return NextResponse.json({
      success: true,
      activeJobsBefore: activeJobs,
      booksSubmitted: submitted.length,
      totalPages,
      submitted,
      errors: errors.length > 0 ? errors : undefined,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error('[cron/submit-ocr] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Submit cron failed' },
      { status: 500 }
    );
  }
}
