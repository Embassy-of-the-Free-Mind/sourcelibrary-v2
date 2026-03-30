import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { purgeAIQueues } from '@/lib/sqs-client';

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
export const POST = withAdminAuth(async (request: NextRequest) => {
  const db = await getDb();
  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry_run') === 'true';
  const resume = url.searchParams.get('resume') === 'true';

  // Resume mode: clear the pause flag and paused_phases
  if (resume) {
    await db.collection('system_config').updateOne(
      { _id: 'processing_control' as any },
      { $set: { paused: false, paused_phases: [], resumed_at: new Date(), resumed_by: 'emergency-stop-api' } },
    );
    await db.collection('processing_control_log').insertOne({
      action: 'resume', timestamp: new Date(), source: 'emergency-stop-api',
    });
    return NextResponse.json({ success: true, action: 'resumed' });
  }

  // Accept paused_phases from body (optional — defaults to pausing everything)
  let pausedPhases: string[] | undefined;
  try {
    const body = await request.json();
    if (Array.isArray(body?.paused_phases)) {
      pausedPhases = body.paused_phases;
    }
  } catch {
    // No body or invalid JSON — fine, will pause everything
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

  // 4. Set system pause flag (with optional paused_phases)
  if (!dryRun) {
    const pauseUpdate: Record<string, unknown> = {
      paused: true,
      paused_at: new Date(),
      paused_by: 'emergency-stop',
    };
    if (pausedPhases) {
      pauseUpdate.paused_phases = pausedPhases;
    }
    await db.collection('system_config').updateOne(
      { _id: 'processing_control' as any },
      { $set: pauseUpdate },
      { upsert: true }
    );
    await db.collection('processing_control_log').insertOne({
      action: 'pause', timestamp: new Date(), source: 'emergency-stop-api',
      reason: 'emergency stop', paused_phases: pausedPhases || 'all',
      jobs_cancelled: activeJobCount, batch_jobs_cancelled: activeBatchCount,
    });
  }

  // 5. Purge SQS AI queues (unless skipped or dry run)
  const skipPurge = url.searchParams.get('skip_purge') === 'true';
  let queuesPurged: { purged: string[]; errors: string[] } | null = null;

  if (!dryRun && !skipPurge) {
    try {
      queuesPurged = await purgeAIQueues();
    } catch (err) {
      queuesPurged = { purged: [], errors: [err instanceof Error ? err.message : String(err)] };
    }
  }

  return NextResponse.json({
    success: true,
    ...result,
    ...(queuesPurged ? { queues_purged: queuesPurged } : {}),
    ...(skipPurge ? { queues_skipped: true } : {}),
    ...(pausedPhases ? { paused_phases: pausedPhases } : {}),
    message: dryRun
      ? 'Dry run — no changes made'
      : `Emergency stop activated. ${activeJobCount} jobs + ${activeBatchCount} batch jobs cancelled.${queuesPurged ? ` Queues purged: ${queuesPurged.purged.join(', ') || 'none'}.` : ''} Call with ?resume=true to re-enable.`,
  });
});
