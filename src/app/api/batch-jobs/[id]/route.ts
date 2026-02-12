import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/batch-jobs/[id]
 * Get a single batch job by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

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
}
