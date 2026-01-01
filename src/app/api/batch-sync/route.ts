import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getBatchJobStatus } from '@/lib/gemini-batch';

export const maxDuration = 300;

/**
 * POST /api/batch-sync?limit=20
 *
 * Sync pending/processing batch jobs with Gemini API.
 * Updates our database with latest status from Gemini.
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '0') || 0;

    const db = await getDb();

    console.log('[batch-sync] Starting sync...');

    // Get all jobs that aren't saved or terminal
    const query = db.collection('batch_jobs')
      .find({
        status: { $nin: ['saved', 'cancelled', 'failed', 'expired'] },
        gemini_job_name: { $exists: true, $nin: [null, ''] },
      })
      .sort({ created_at: 1 }); // Oldest first

    const jobs = await (limit > 0 ? query.limit(limit) : query).toArray();

    console.log(`[batch-sync] Found ${jobs.length} jobs to sync${limit ? ` (limit: ${limit})` : ''}`);

    const stats = {
      synced: 0,
      succeeded: 0,
      running: 0,
      pending: 0,
      failed: 0,
      cancelled: 0,
      errors: 0,
      unchanged: 0,
    };

    const readyToSave: string[] = [];

    for (const job of jobs) {
      try {
        const geminiStatus = await getBatchJobStatus(job.gemini_job_name);

        // Map Gemini state to our status
        let newStatus = job.status;
        if (geminiStatus.state === 'JOB_STATE_RUNNING') {
          newStatus = 'processing';
          stats.running++;
        } else if (geminiStatus.state === 'JOB_STATE_SUCCEEDED') {
          newStatus = 'completed';
          stats.succeeded++;
          readyToSave.push(job.id);
        } else if (geminiStatus.state === 'JOB_STATE_FAILED') {
          newStatus = 'failed';
          stats.failed++;
        } else if (geminiStatus.state === 'JOB_STATE_CANCELLED') {
          newStatus = 'cancelled';
          stats.cancelled++;
        } else if (geminiStatus.state === 'JOB_STATE_PENDING') {
          stats.pending++;
        }

        // Update if changed
        if (newStatus !== job.status || geminiStatus.state !== job.gemini_state) {
          await db.collection('batch_jobs').updateOne(
            { id: job.id },
            {
              $set: {
                status: newStatus,
                gemini_state: geminiStatus.state,
                gemini_stats: geminiStatus.stats,
                updated_at: new Date(),
              },
            }
          );
          stats.synced++;
        } else {
          stats.unchanged++;
        }
      } catch (e) {
        console.error(`[batch-jobs/sync] Error syncing ${job.id}:`, e);
        stats.errors++;
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    }

    console.log('[batch-jobs/sync] Sync complete:', stats);

    return NextResponse.json({
      success: true,
      stats,
      ready_to_save: readyToSave.length,
      ready_job_ids: readyToSave,
      message: `Synced ${stats.synced} jobs. ${stats.succeeded} ready to save.`,
      next_step: stats.succeeded > 0
        ? 'Call POST /api/batch-jobs/save-results to save completed OCR/translations'
        : undefined,
    });
  } catch (error) {
    console.error('[batch-jobs/sync] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to sync batch jobs',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/batch-jobs/sync
 *
 * Get current status of all batch jobs without syncing with Gemini.
 */
export async function GET() {
  try {
    const db = await getDb();

    const statusCounts = await db.collection('batch_jobs').aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total_pages: { $sum: '$total_pages' },
        },
      },
    ]).toArray();

    const typeCounts = await db.collection('batch_jobs').aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          total_pages: { $sum: '$total_pages' },
        },
      },
    ]).toArray();

    return NextResponse.json({
      by_status: Object.fromEntries(statusCounts.map(s => [s._id, { count: s.count, pages: s.total_pages }])),
      by_type: Object.fromEntries(typeCounts.map(t => [t._id, { count: t.count, pages: t.total_pages }])),
      actions: {
        sync: 'POST /api/batch-jobs/sync',
        save: 'POST /api/batch-jobs/save-results',
      },
    });
  } catch (error) {
    console.error('[batch-jobs/sync] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get batch job stats' },
      { status: 500 }
    );
  }
}
