import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

/**
 * GET /api/batch-jobs/[id]
 * Get a single batch job by ID
 */
export const GET = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;

    const db = await getDb();
    const job = await db.collection('batch_jobs').findOne({ id });

    if (!job) {
      return NextResponse.json(
        { error: 'Batch job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(job);
  } catch (error) {
    console.error('[batch-jobs/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch batch job' },
      { status: 500 }
    );
  }
});
