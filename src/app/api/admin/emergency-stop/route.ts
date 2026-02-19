import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 60;

/**
 * POST /api/admin/emergency-stop
 *
 * Kill switch for runaway processing. Cancels all active jobs,
 * clears book.job refs, and sets a system pause flag.
 *
 * Actions:
 * 1. Cancel all pending/processing Lambda jobs
 * 2. Cancel all pending/processing batch jobs
 * 3. Clear book.job references
 * 4. Set system_config.paused = true (crons check this)
 *
 * Query params:
 *   ?dry_run=true — show what would be cancelled without doing it
 *   ?resume=true  — clear the pause flag (re-enable processing)
 */
export const POST = withAuth(async (request: NextRequest) => {
  const db = await getDb();
  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry_run') === 'true';
  const resume = url.searchParams.get('resume') === 'true';

  // Resume mode: clear the pause flag
  if (resume) {
    await db.collection('system_config').updateOne(
      { _id: 'processing_control' as any },
      { $set: { paused: false, resumed_at: new Date() } },
    );
    return NextResponse.json({ success: true, action: 'resumed' });
  }

  const result = {
    lambda_jobs_cancelled: 0,
    batch_jobs_cancelled: 0,
    book_refs_cleared: 0,
    dry_run: dryRun,
  };

  // 1. Count/cancel active Lambda jobs (jobs collection)
  const activeJobsFilter = {
    status: { $in: ['pending', 'processing'] },
  };
  const activeJobCount = await db.collection('jobs').countDocuments(activeJobsFilter);
  result.lambda_jobs_cancelled = activeJobCount;

  if (!dryRun && activeJobCount > 0) {
    await db.collection('jobs').updateMany(
      activeJobsFilter,
      {
        $set: {
          status: 'cancelled',
          updated_at: new Date(),
          cancelled_at: new Date(),
          cancelled_by: 'emergency-stop',
        },
      }
    );
  }

  // 2. Count/cancel active batch jobs (batch_jobs collection)
  const activeBatchFilter = {
    status: { $in: ['pending', 'processing'] },
  };
  const activeBatchCount = await db.collection('batch_jobs').countDocuments(activeBatchFilter);
  result.batch_jobs_cancelled = activeBatchCount;

  if (!dryRun && activeBatchCount > 0) {
    await db.collection('batch_jobs').updateMany(
      activeBatchFilter,
      {
        $set: {
          status: 'cancelled',
          updated_at: new Date(),
          cancelled_at: new Date(),
          cancelled_by: 'emergency-stop',
        },
      }
    );
  }

  // 3. Clear book.job references (so UI doesn't show stale progress)
  const bookJobFilter = { job: { $exists: true } };
  const bookJobCount = await db.collection('books').countDocuments(bookJobFilter);
  result.book_refs_cleared = bookJobCount;

  if (!dryRun && bookJobCount > 0) {
    await db.collection('books').updateMany(
      bookJobFilter,
      { $unset: { job: '' }, $set: { updated_at: new Date() } }
    );
  }

  // 4. Set system pause flag
  if (!dryRun) {
    await db.collection('system_config').updateOne(
      { _id: 'processing_control' as any },
      {
        $set: {
          paused: true,
          paused_at: new Date(),
          paused_by: 'emergency-stop',
        },
      },
      { upsert: true }
    );
  }

  return NextResponse.json({
    success: true,
    ...result,
    message: dryRun
      ? 'Dry run — no changes made'
      : `Emergency stop activated. ${activeJobCount} jobs + ${activeBatchCount} batch jobs cancelled. Call with ?resume=true to re-enable.`,
  });
});
