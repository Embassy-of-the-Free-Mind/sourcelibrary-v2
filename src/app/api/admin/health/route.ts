import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { QUEUE_URLS, getQueueDepth } from '@/lib/sqs-client';

export const maxDuration = 30;

/**
 * GET /api/admin/health
 *
 * System health check. Returns:
 * - MongoDB connectivity + server status
 * - Active job counts (Lambda + Batch)
 * - SQS queue depths (OCR, Translation, Image Extraction)
 * - Recent error rate (last 1h)
 * - Pipeline stalls (books stuck in a state too long)
 * - Emergency stop / pause status
 *
 * Overall `healthy` flag is true when no checks are in `critical` status.
 */
export const GET = withAdminAuth(async () => {
  const started = Date.now();
  const checks: Record<string, CheckResult> = {};

  // --- 1. MongoDB connectivity ---
  let db;
  try {
    db = await getDb();
    const pingStart = Date.now();
    await db.command({ ping: 1 });
    checks.mongodb = {
      status: 'ok',
      latency_ms: Date.now() - pingStart,
    };
  } catch (error) {
    checks.mongodb = {
      status: 'critical',
      error: error instanceof Error ? error.message : String(error),
    };
    // Can't check anything else without DB
    return NextResponse.json({
      healthy: false,
      checked_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      checks,
    });
  }

  // --- 1b. User-facing query latency ---
  // Tests the actual query pattern users hit (browse page).
  // ping can return 14ms while this takes 300s if cache is thrashed.
  // See: GitHub issue #567
  try {
    const browseStart = Date.now();
    await db.collection('books')
      .find({ visible: true, pages_count: { $gt: 0 } })
      .sort({ created_at: -1 })
      .limit(10)
      .maxTimeMS(10000)
      .project({ id: 1, title: 1 })
      .toArray();
    const browseMs = Date.now() - browseStart;
    checks.browse_query = {
      status: browseMs > 5000 ? 'critical'
            : browseMs > 2000 ? 'warning'
            : 'ok',
      latency_ms: browseMs,
    };
  } catch (error) {
    checks.browse_query = {
      status: 'critical',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // --- Run remaining checks in parallel ---
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

  const [
    activeJobs,
    activeBatchJobs,
    errorRate,
    stalledBooks,
    systemConfig,
    sqsDepths,
    recentCronRuns,
  ] = await Promise.all([
    // Active Lambda jobs
    db.collection('jobs').aggregate([
      { $match: { status: { $in: ['pending', 'processing'] } } },
      { $group: { _id: '$type', count: { $sum: 1 }, pages: { $sum: '$progress.total' } } },
    ]).toArray(),

    // Active batch jobs
    db.collection('batch_jobs').aggregate([
      { $match: { status: { $in: ['pending', 'processing'] } } },
      { $group: { _id: '$type', count: { $sum: 1 }, pages: { $sum: '$total_pages' } } },
    ]).toArray(),

    // Error rate (last 1h): success vs failed
    db.collection('gemini_usage').aggregate([
      { $match: { timestamp: { $gte: oneHourAgo } } },
      { $group: {
        _id: '$status',
        count: { $sum: 1 },
      }},
    ]).toArray(),

    // Pipeline stalls: books stuck in a transitional state for 4+ hours
    db.collection('books').aggregate([
      { $match: {
        'pipeline_auto.status': { $in: [
          'archiving', 'ocr_submitted', 'translate_submitted',
          'enriching', 'chapters', 'images_submitted',
        ]},
        'pipeline_auto.last_updated': { $lt: fourHoursAgo },
      }},
      { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
    ]).toArray(),

    // System config (pause flag)
    db.collection('system_config').findOne({ _id: 'processing_control' as any }),

    // SQS queue depths (all queues in parallel)
    getQueueDepths(),

    // Recent cron health (last 4 hours)
    db.collection('cron_runs').aggregate([
      { $match: { timestamp: { $gte: fourHoursAgo } } },
      { $group: {
        _id: '$cron',
        runs: { $sum: 1 },
        failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        last_run: { $max: '$timestamp' },
      }},
    ]).toArray(),
  ]);

  // --- 2. Active jobs ---
  const jobSummary: Record<string, { jobs: number; pages: number }> = {};
  for (const j of activeJobs) {
    jobSummary[j._id] = { jobs: j.count, pages: j.pages };
  }
  const totalActiveJobs = activeJobs.reduce((n, j) => n + j.count, 0);
  checks.active_jobs = {
    status: totalActiveJobs > 500 ? 'warning' : 'ok',
    total: totalActiveJobs,
    by_type: jobSummary,
  };

  // --- 3. Active batch jobs ---
  const batchSummary: Record<string, { jobs: number; pages: number }> = {};
  for (const b of activeBatchJobs) {
    batchSummary[b._id] = { jobs: b.count, pages: b.pages };
  }
  checks.active_batch_jobs = {
    status: 'ok',
    total: activeBatchJobs.reduce((n, b) => n + b.count, 0),
    by_type: batchSummary,
  };

  // --- 4. Error rate (last 1h) ---
  const successCount = errorRate.find(e => e._id === 'success')?.count || 0;
  const failedCount = errorRate.find(e => e._id === 'failed')?.count || 0;
  const totalCalls = successCount + failedCount;
  const failRate = totalCalls > 0 ? failedCount / totalCalls : 0;
  checks.error_rate = {
    status: failRate > 0.5 && totalCalls > 10 ? 'critical'
          : failRate > 0.2 && totalCalls > 10 ? 'warning'
          : 'ok',
    last_hour: {
      total: totalCalls,
      succeeded: successCount,
      failed: failedCount,
      rate: Math.round(failRate * 1000) / 10 + '%',
    },
  };

  // --- 5. SQS queue depths ---
  const totalQueuedMessages = Object.values(sqsDepths).reduce(
    (sum, d) => sum + (d.total || 0), 0
  );
  checks.sqs_queues = {
    status: Object.values(sqsDepths).some(d => d.error) ? 'warning'
          : totalQueuedMessages > 5000 ? 'warning'
          : 'ok',
    total_messages: totalQueuedMessages,
    ...sqsDepths,
  };

  // --- 6. Pipeline stalls ---
  const stallSummary: Record<string, number> = {};
  let totalStalled = 0;
  for (const s of stalledBooks) {
    stallSummary[s._id] = s.count;
    totalStalled += s.count;
  }
  checks.pipeline_stalls = {
    status: totalStalled > 20 ? 'warning' : 'ok',
    stalled_4h: totalStalled,
    by_status: stallSummary,
  };

  // --- 7. System pause flag ---
  const paused = systemConfig?.paused === true;
  checks.system_paused = {
    status: paused ? 'warning' : 'ok',
    paused,
    ...(paused && systemConfig?.paused_at ? { paused_at: systemConfig.paused_at } : {}),
  };

  // --- 8. Cron health ---
  const cronSummary: Record<string, { runs: number; failures: number; last_run: string }> = {};
  for (const c of recentCronRuns) {
    cronSummary[c._id] = {
      runs: c.runs,
      failures: c.failures,
      last_run: c.last_run?.toISOString(),
    };
  }
  const cronFailures = recentCronRuns.reduce((n, c) => n + c.failures, 0);
  checks.crons = {
    status: cronFailures > 5 ? 'warning' : 'ok',
    last_4h: cronSummary,
    total_failures: cronFailures,
  };

  // --- Overall health ---
  const hasAnyCritical = Object.values(checks).some(c => c.status === 'critical');
  const healthy = !hasAnyCritical && !paused;

  return NextResponse.json({
    healthy,
    checked_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    checks,
  });
});

// --- Helpers ---

interface CheckResult {
  status: 'ok' | 'warning' | 'critical';
  [key: string]: unknown;
}

interface HealthQueueDepth {
  visible?: number;
  in_flight?: number;
  total?: number;
  error?: string;
}

async function getQueueDepths(): Promise<Record<string, HealthQueueDepth>> {
  const queues = {
    ocr: QUEUE_URLS.pageOcr,
    translation: QUEUE_URLS.pageTranslation,
    image_extraction: QUEUE_URLS.pageImageExtraction,
    write_results: QUEUE_URLS.writeResults,
  };

  const results: Record<string, HealthQueueDepth> = {};

  await Promise.all(
    Object.entries(queues).map(async ([name, url]) => {
      if (!url) {
        results[name] = { error: 'queue URL not configured' };
        return;
      }
      try {
        const depth = await getQueueDepth(url);
        results[name] = {
          visible: depth.visible,
          in_flight: depth.inFlight,
          total: depth.total,
        };
      } catch (error) {
        results[name] = { error: error instanceof Error ? error.message : String(error) };
      }
    })
  );

  return results;
}
