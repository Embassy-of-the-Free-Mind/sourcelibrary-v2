import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

/**
 * POST /api/jobs/[id]/cancel
 *
 * Cancel a job by setting its status to 'cancelled'.
 * Workers check job status before processing each page and will skip cancelled jobs.
 *
 * Note: Cannot stop a Lambda mid-execution. If a page is currently being
 * processed when user cancels, that page will finish. This is acceptable.
 */
export const POST = withAuth(async (request, session, context) => {
  const { id: jobId } = await context.params;
  const db = await getDb();

  const result = await db.collection('jobs').updateOne(
    { id: jobId },
    {
      $set: {
        status: 'cancelled',
        updated_at: new Date()
      }
    }
  );

  if (result.matchedCount === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Clear job from book
  const job = await db.collection('jobs').findOne({ id: jobId });
  if (job?.book_id) {
    await db.collection('books').updateOne(
      { id: job.book_id },
      { $unset: { job: '' } }
    );
  }

  return NextResponse.json({ success: true });
});
