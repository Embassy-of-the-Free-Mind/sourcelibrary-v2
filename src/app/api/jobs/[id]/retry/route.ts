import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { JobStatus, JobType } from '@/lib/types/job';
import { enqueuePagesForJob } from '@/lib/queue-utils';
import { withAuth } from '@/lib/auth-helpers';

/**
 * POST /api/jobs/[id]/retry
 *
 * Retry a failed/cancelled/partial job by re-enqueueing failed pages.
 * Workers will process the failed pages again.
 */
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id: jobId } = await context.params;
    const db = await getDb();

    const job = await db.collection('jobs').findOne({ id: jobId });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Can only retry jobs that have failures
    if (job.status !== 'failed' && job.status !== 'cancelled' && job.status !== 'partial' && job.status !== 'completed_with_errors') {
      return NextResponse.json(
        { error: 'Can only retry failed, cancelled, or completed_with_errors jobs' },
        { status: 400 }
      );
    }

    // Get failed page IDs
    const failedPageIds = job.failed_page_ids || [];
    if (failedPageIds.length === 0) {
      return NextResponse.json(
        { error: 'No failed pages to retry' },
        { status: 400 }
      );
    }

    // Re-enqueue failed pages using shared utility
    await enqueuePagesForJob(
      job.book_id,
      failedPageIds,
      job.type as JobType,
      jobId,
      job.config.custom_prompt
    );

    // Reset job status and clear failed_page_ids
    await db.collection('jobs').updateOne(
      { id: jobId },
      {
        $set: {
          status: 'pending' as JobStatus,
          'progress.failed': 0,
          failed_page_ids: [],
          updated_at: new Date()
        }
      }
    );

    return NextResponse.json({
      success: true,
      message: `Retrying ${failedPageIds.length} failed pages`,
      retried: failedPageIds.length
    });
  } catch (error) {
    console.error('Error retrying job:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retry job' },
      { status: 500 }
    );
  }
});
