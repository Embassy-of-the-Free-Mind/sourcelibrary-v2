import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { POST as batchOcrPost } from '@/app/api/books/[id]/batch-ocr-async/route';
import { verifyCronAuth } from '@/lib/cron-auth';

export const maxDuration = 300;

// Tunables
const MAX_ACTIVE_JOBS = 100;    // Don't submit if this many batch jobs are already active
const BOOKS_PER_RUN = 15;       // Books to submit per cron invocation
const PAGES_PER_BOOK = 100;     // Pages to submit per book
const MODEL = 'gemini-3-flash-preview';

/**
 * GET /api/cron/submit-batch-ocr
 *
 * Auto-submits batch OCR jobs for books that need it.
 * Runs on Vercel cron — uses cached pages_count/pages_ocr fields
 * to quickly find books with un-OCR'd pages, then submits batch jobs.
 *
 * Backpressure: pauses when MAX_ACTIVE_JOBS are in flight.
 * Complements /api/cron/process-batches which collects results.
 */
export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const startTime = Date.now();

  try {
    const db = await getDb();

    // Backpressure: check active job count
    const activeJobs = await db.collection('batch_jobs').countDocuments({
      status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
    });

    if (activeJobs >= MAX_ACTIVE_JOBS) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: `${activeJobs} active jobs (max ${MAX_ACTIVE_JOBS}), waiting for results`,
        duration_ms: Date.now() - startTime,
      });
    }

    // Get book IDs that already have active batch jobs — exclude them
    const activeBookIds = await db.collection('batch_jobs').distinct('book_id', {
      status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
    });

    // Fast query using cached pages_count/pages_ocr fields on books
    // These are refreshed by sync-page-counts cron every 6h
    const eligibleBooks = await db.collection('books').find({
      pages_count: { $gt: 0 },
      $expr: { $gt: ['$pages_count', { $ifNull: ['$pages_ocr', 0] }] },
      id: { $nin: activeBookIds },
    })
      .sort({ pages_count: -1 }) // Biggest books first
      .limit(BOOKS_PER_RUN)
      .project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1 })
      .toArray();

    if (eligibleBooks.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All books have OCR or are already being processed',
        activeJobs,
        duration_ms: Date.now() - startTime,
      });
    }

    // Submit batch jobs
    const submitted: Array<{ bookId: string; title: string; jobName: string; pagesSubmitted: number }> = [];
    const errors: string[] = [];

    for (const book of eligibleBooks) {
      try {
        const fakeRequest = new NextRequest(
          `http://localhost/api/books/${book.id}/batch-ocr-async`,
          {
            method: 'POST',
            body: JSON.stringify({ limit: PAGES_PER_BOOK, model: MODEL }),
            headers: { 'Content-Type': 'application/json' },
          }
        );
        const result = await batchOcrPost(fakeRequest, {
          params: Promise.resolve({ id: book.id }),
        });
        const data = await result.json();

        if (data.success) {
          submitted.push({
            bookId: book.id,
            title: book.title,
            jobName: data.jobName,
            pagesSubmitted: data.pagesSubmitted,
          });
        } else {
          errors.push(`${book.title}: ${data.error || data.message || 'Unknown error'}`);
        }
      } catch (e) {
        errors.push(`${book.title}: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }

    const totalPages = submitted.reduce((sum, s) => sum + s.pagesSubmitted, 0);

    return NextResponse.json({
      success: true,
      activeJobsBefore: activeJobs,
      booksSubmitted: submitted.length,
      totalPages,
      estimatedCost: `$${(totalPages * 0.0003).toFixed(2)}`,
      submitted,
      errors: errors.length > 0 ? errors : undefined,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error('[cron/submit-batch-ocr] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Submit cron failed' },
      { status: 500 }
    );
  }
}
