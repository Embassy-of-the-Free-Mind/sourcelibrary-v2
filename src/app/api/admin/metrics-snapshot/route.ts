import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 15;

/**
 * GET /api/admin/metrics-snapshot
 *
 * Read-only JSON view of the cached analytics + corpus snapshots, for
 * automation that can't reach Mongo directly (e.g. the weekly digest
 * cloud routine). Everything served here is precomputed by existing
 * jobs — this route performs no aggregation of its own:
 * - `metrics`  — system_config.metrics_snapshot (audience/usage, written
 *   daily at 05:45 UTC by scripts/analytics/snapshot-metrics.mjs)
 * - `history`  — last N metrics_history rows (daily trend series for
 *   MAU/dwell/signups; N via ?history=, default 15, max 90)
 * - `corpus`   — system_config.data_page_snapshot (library totals,
 *   pipeline statuses, enrichment coverage — feeds /data)
 * - `homepageStats` — system_config.homepage_stats (canonical public counts)
 * - `pipeline` — pause flag + batch-collector health rollup
 *
 * Auth: same as other admin routes — session OR Bearer CRON_SECRET.
 */
export const GET = withAdminAuth(async (request: NextRequest) => {
  const db = await getDb();

  const historyParam = Number(new URL(request.url).searchParams.get('history'));
  const historyLimit = Number.isFinite(historyParam)
    ? Math.min(Math.max(Math.trunc(historyParam), 1), 90)
    : 15;

  const config = db.collection('system_config');
  const [metrics, corpus, homepageStats, processingControl, batchHealth, history] =
    await Promise.all([
      config.findOne({ _id: 'metrics_snapshot' } as never),
      config.findOne({ _id: 'data_page_snapshot' } as never),
      config.findOne({ _id: 'homepage_stats' } as never),
      config.findOne({ _id: 'processing_control' } as never),
      config.findOne({ _id: 'batch_health' } as never),
      db
        .collection('metrics_history')
        .find({}, { projection: { _id: 0 } })
        .sort({ date: -1 })
        .limit(historyLimit)
        .toArray(),
    ]);

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    metrics,
    history,
    corpus,
    homepageStats,
    pipeline: {
      paused: processingControl?.paused ?? false,
      paused_phases: processingControl?.paused_phases ?? [],
      batch_health: batchHealth,
    },
  });
});
