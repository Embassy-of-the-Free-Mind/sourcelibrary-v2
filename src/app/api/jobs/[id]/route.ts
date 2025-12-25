import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { JobStatus } from '@/lib/types';

// GET - Get job status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const job = await db.collection('jobs').findOne({ id });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    console.error('Error fetching job:', error);
    return NextResponse.json(
      { error: 'Failed to fetch job' },
      { status: 500 }
    );
  }
}

// PATCH - Update job (action-based: pause, resume, cancel, or progress updates)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const db = await getDb();
    const job = await db.collection('jobs').findOne({ id });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Handle progress/status/workflow_state updates (for batch processing)
    if (body.status || body.progress !== undefined || body.workflow_state !== undefined) {
      const updates: Record<string, unknown> = { updated_at: new Date() };

      if (body.status) {
        updates.status = body.status;
        if (body.status === 'processing' && !job.started_at) {
          updates.started_at = new Date();
        }
        if (body.status === 'completed' || body.status === 'failed') {
          updates.completed_at = new Date();
        }
      }

      if (body.progress) {
        if (body.progress.completed !== undefined) updates['progress.completed'] = body.progress.completed;
        if (body.progress.failed !== undefined) updates['progress.failed'] = body.progress.failed;
      }

      if (body.workflow_state) {
        updates.workflow_state = body.workflow_state;
      }

      if (body.error) {
        updates.error = body.error;
      }

      await db.collection('jobs').updateOne({ id }, { $set: updates });
      const updatedJob = await db.collection('jobs').findOne({ id });
      return NextResponse.json({ job: updatedJob });
    }

    // Handle action-based updates (pause, resume, cancel, retry)
    const { action } = body as { action: 'pause' | 'resume' | 'cancel' | 'retry' };

    let newStatus: JobStatus;
    const updates: Record<string, unknown> = { updated_at: new Date() };

    switch (action) {
      case 'pause':
        if (job.status !== 'processing' && job.status !== 'pending') {
          return NextResponse.json(
            { error: 'Can only pause pending or processing jobs' },
            { status: 400 }
          );
        }
        newStatus = 'paused';
        break;

      case 'resume':
        if (job.status !== 'paused') {
          return NextResponse.json(
            { error: 'Can only resume paused jobs' },
            { status: 400 }
          );
        }
        newStatus = 'pending';
        break;

      case 'cancel':
        if (job.status === 'completed' || job.status === 'cancelled') {
          return NextResponse.json(
            { error: 'Job already finished' },
            { status: 400 }
          );
        }
        newStatus = 'cancelled';
        updates.completed_at = new Date();
        break;

      case 'retry':
        if (job.status !== 'failed' && job.status !== 'cancelled') {
          return NextResponse.json(
            { error: 'Can only retry failed or cancelled jobs' },
            { status: 400 }
          );
        }
        newStatus = 'pending';
        // Reset progress for failed items only
        updates.progress = {
          total: job.progress.total,
          completed: job.progress.completed,
          failed: 0,
        };
        // Filter out failed results to retry them
        updates.results = job.results.filter((r: { success: boolean }) => r.success);
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: pause, resume, cancel, or retry' },
          { status: 400 }
        );
    }

    updates.status = newStatus;

    await db.collection('jobs').updateOne(
      { id },
      { $set: updates }
    );

    const updatedJob = await db.collection('jobs').findOne({ id });

    return NextResponse.json({
      job: updatedJob,
      message: `Job ${action}d successfully`,
    });
  } catch (error) {
    console.error('Error updating job:', error);
    return NextResponse.json(
      { error: 'Failed to update job' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a job
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const job = await db.collection('jobs').findOne({ id });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Don't allow deleting active jobs
    if (job.status === 'processing') {
      return NextResponse.json(
        { error: 'Cannot delete a processing job. Cancel it first.' },
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
}
