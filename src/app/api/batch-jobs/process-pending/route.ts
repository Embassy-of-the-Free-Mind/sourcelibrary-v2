import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 300;

/**
 * POST /api/batch-jobs/process-pending
 *
 * Processes all pending batch jobs (one chunk each).
 * Call repeatedly to make progress on all jobs.
 *
 * Query params:
 * - limit: max jobs to process per call (default: 5)
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '5', 10);

    const db = await getDb();

    // Get pending/processing batch jobs
    const jobs = await db.collection('jobs')
      .find({
        status: { $in: ['pending', 'processing'] },
        'config.use_batch_api': true,
      })
      .sort({ created_at: 1 }) // Oldest first
      .limit(limit)
      .toArray();

    if (jobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending batch jobs',
        processed: 0,
      });
    }

    const results: Array<{
      job_id: string;
      book_title: string;
      phase: string;
      prepared?: number;
      remaining?: number;
      gemini_state?: string;
      done?: boolean;
      error?: string;
    }> = [];

    // Process each job
    for (const job of jobs) {
      const jobId = job.id;

      try {
        // Call the process endpoint internally
        const baseUrl = request.headers.get('host') || 'localhost:3000';
        const protocol = request.headers.get('x-forwarded-proto') || 'http';

        const processResponse = await fetch(
          `${protocol}://${baseUrl}/api/jobs/${jobId}/process`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }
        );

        const result = await processResponse.json();

        results.push({
          job_id: jobId,
          book_title: job.book_title || 'Unknown',
          phase: result.phase || result.gemini_state || 'unknown',
          prepared: result.prepared,
          remaining: result.remaining,
          gemini_state: result.gemini_state,
          done: result.done,
        });

      } catch (e) {
        results.push({
          job_id: jobId,
          book_title: job.book_title || 'Unknown',
          phase: 'error',
          error: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }

    const duration = Date.now() - startTime;

    // Count what's still pending
    const stillPending = await db.collection('jobs')
      .countDocuments({
        status: { $in: ['pending', 'processing'] },
        'config.use_batch_api': true,
      });

    // Count jobs waiting for Gemini results
    const waitingForGemini = await db.collection('jobs')
      .countDocuments({
        status: 'processing',
        'config.use_batch_api': true,
        gemini_batch_job: { $exists: true },
      });

    return NextResponse.json({
      success: true,
      processed: results.length,
      duration_ms: duration,
      results,
      remaining: {
        total_pending: stillPending,
        waiting_for_gemini: waitingForGemini,
        needing_preparation: stillPending - waitingForGemini,
      },
      continue: stillPending > 0,
    });

  } catch (error) {
    console.error('[process-pending] Error:', error);
    return NextResponse.json({
      error: 'Failed to process pending jobs',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * GET /api/batch-jobs/process-pending
 *
 * Shows status of all pending batch jobs.
 */
export async function GET() {
  try {
    const db = await getDb();

    const jobs = await db.collection('jobs')
      .find({
        status: { $in: ['pending', 'processing'] },
        'config.use_batch_api': true,
      })
      .sort({ created_at: 1 })
      .toArray();

    const summary = {
      total: jobs.length,
      preparing: jobs.filter(j => !j.gemini_batch_job).length,
      submitted: jobs.filter(j => j.gemini_batch_job && j.gemini_state !== 'JOB_STATE_SUCCEEDED').length,
    };

    return NextResponse.json({
      summary,
      jobs: jobs.map(j => ({
        id: j.id,
        type: j.type,
        book_title: j.book_title,
        status: j.status,
        batch_phase: j.batch_phase || (j.gemini_batch_job ? 'submitted' : 'preparing'),
        gemini_state: j.gemini_state,
        progress: j.progress,
        created_at: j.created_at,
      })),
    });

  } catch (error) {
    console.error('[process-pending] Error:', error);
    return NextResponse.json({
      error: 'Failed to get pending jobs',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
