/**
 * Shared helper functions for job API routes
 * Follows DRY principle by centralizing common job operations
 */
import { getDb } from '@/lib/mongodb';
import type { JobStatus } from '@/lib/types';

/**
 * Fetch a job by ID
 * @throws Error with status code if job not found
 */
export async function getJobById(id: string) {
  const db = await getDb();
  const job = await db.collection('jobs').findOne({ id });

  if (!job) {
    const error = new Error('Job not found') as Error & { statusCode: number };
    error.statusCode = 404;
    throw error;
  }

  return { job, db };
}

/**
 * Validate if a job can transition to a new status
 */
export function canTransitionTo(
  currentStatus: JobStatus,
  action: 'cancel' | 'pause' | 'resume' | 'retry'
): { valid: boolean; error?: string } {
  switch (action) {
    case 'cancel':
      if (currentStatus === 'completed' || currentStatus === 'cancelled') {
        return { valid: false, error: 'Job already finished' };
      }
      return { valid: true };

    case 'pause':
      if (currentStatus !== 'processing' && currentStatus !== 'pending') {
        return { valid: false, error: 'Can only pause pending or processing jobs' };
      }
      return { valid: true };

    case 'resume':
      if (currentStatus !== 'paused') {
        return { valid: false, error: 'Can only resume paused jobs' };
      }
      return { valid: true };

    case 'retry':
      if (currentStatus !== 'failed' && currentStatus !== 'cancelled') {
        return { valid: false, error: 'Can only retry failed or cancelled jobs' };
      }
      return { valid: true };

    default:
      return { valid: false, error: 'Invalid action' };
  }
}

/**
 * Update job status with appropriate fields
 */
export async function updateJobStatus(
  db: Awaited<ReturnType<typeof getDb>>,
  jobId: string,
  action: 'cancel' | 'pause' | 'resume' | 'retry',
  job?: any
) {
  const updates: Record<string, any> = {
    updated_at: new Date(),
  };

  switch (action) {
    case 'cancel':
      updates.status = 'cancelled';
      updates.completed_at = new Date();
      break;

    case 'pause':
      updates.status = 'paused';
      break;

    case 'resume':
      updates.status = 'pending';
      break;

    case 'retry':
      if (!job) {
        throw new Error('Job data required for retry action');
      }
      updates.status = 'pending';
      updates.progress = {
        total: job.progress.total,
        completed: job.progress.completed,
        failed: 0,
      };
      // Filter out failed results to retry them
      updates.results = job.results.filter((r: { success: boolean }) => r.success);
      break;
  }

  await db.collection('jobs').updateOne({ id: jobId }, { $set: updates });
}
