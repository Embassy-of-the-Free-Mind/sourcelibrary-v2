import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { BatchJob } from '@/lib/types/batch-job';
import { withAuth } from '@/lib/auth-helpers';

/**
 * GET /api/batch-jobs/list
 *
 * List batch jobs (parent jobs only for UI display)
 *
 * Query params:
 *   limit: number - Maximum number of jobs to return (default: 100)
 */
export const GET = withAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');

    const db = await getDb();

    // Only fetch PARENT jobs (for UI display)
    // Child jobs are tracked internally but not shown in the main list
    const jobs = await db.collection<BatchJob>('batch_jobs')
      .find({
        parent_job_id: { $exists: false } // No parent = this IS a parent
      })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({
      success: true,
      jobs,
      total: jobs.length
    });
  } catch (error) {
    console.error('Error fetching batch jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch batch jobs' },
      { status: 500 }
    );
  }
});
