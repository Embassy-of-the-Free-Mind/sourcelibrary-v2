import { NextResponse } from 'next/server';
import { getJobById, canTransitionTo, updateJobStatus } from '@/lib/job-helpers';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { job, db } = await getJobById(id);

    // Validate state transition
    const validation = canTransitionTo(job.status, 'retry');
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Update job status (retry needs job data to filter results)
    await updateJobStatus(db, id, 'retry', job);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error retrying job:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to retry job' },
      { status: error.statusCode || 500 }
    );
  }
}
