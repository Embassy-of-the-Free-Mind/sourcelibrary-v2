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

  // Declared AI crawlers hitting the licensing funnel over the last 7 days —
  // these are warm licensing leads (#3327 Phase 2), not nuisance traffic.
  // Names from classifyBot in /api/analytics/bots. Caveat: 'google'/'bing'
  // lump search crawlers in with training tokens, so they're indicative only;
  // the unambiguous training-side signals are openai/anthropic/bytedance/
  // commoncrawl/meta/cohere.
  const AI_CRAWLER_BOTS = [
    'openai', 'anthropic', 'google', 'bing', 'perplexity',
    'bytedance', 'cohere', 'meta', 'you.com', 'commoncrawl',
  ];
  const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const aiCrawlersPromise = db.collection('analytics_bot_access').aggregate([
    { $match: { bot: { $in: AI_CRAWLER_BOTS }, date: { $gte: since } } },
    {
      $group: {
        _id: '$bot',
        hits: { $sum: '$hits' },
        path_prefixes: { $addToSet: '$path_prefix' },
        actions: { $addToSet: '$actions' },
      },
    },
    { $sort: { hits: -1 } },
    {
      $project: {
        _id: 0, bot: '$_id', hits: 1, path_prefixes: 1,
        actions: {
          $reduce: { input: '$actions', initialValue: [], in: { $setUnion: ['$$value', '$$this'] } },
        },
      },
    },
  ]).toArray().catch(() => []);

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
    ai_crawlers: {
      window_days: 7,
      note: 'declared AI crawlers on the licensing funnel — warm leads, see /licensing rate card',
      by_bot: await aiCrawlersPromise,
    },
  });
});
