import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

// GET - Get job status
export const GET = withAdminAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const db = await getDb();

    const job = await db.collection('jobs').findOne({ id });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (error) {
    console.error('Error fetching job:', error);
    return NextResponse.json(
      { error: 'Failed to fetch job' },
      { status: 500 }
    );
  }
});

// DELETE - Delete a job
export const DELETE = withAdminAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const db = await getDb();

    const job = await db.collection('jobs').findOne({ id });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Don't allow deleting active jobs
    if (job.status === 'processing' || job.status === 'pending') {
      return NextResponse.json(
        { error: 'Cannot delete an active job. Cancel it first.' },
        { status: 400 }
      );
    }

    await db.collection('jobs').deleteOne({ id });

    return NextResponse.json({ message: 'Job deleted' });
  } catch (error) {
    console.error('Error deleting job:', error);
    return NextResponse.json(
      { error: 'Failed to delete job' },
      { status: 500 }
    );
  }
});
