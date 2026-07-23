import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { QUEUE_URLS, getQueueDepth } from '@/lib/sqs-client';
import { getSupabaseSyncHealth } from '@/lib/supabase-health';
import { supabaseAdmin } from '@/lib/supabase';

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
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  // Fetched ahead of the parallel batch: the supabase-sync check needs the
  // pause flag to avoid alarming on gemini_usage lag while the pipeline is
  // deliberately paused (nothing writes the table then).
  const systemConfig = await db.collection('system_config')
    .findOne({ _id: 'processing_control' as any });

  const [
    activeJobs,
    activeBatchJobs,
    errorRate,
    stalledBooks,
    sqsDepths,
    recentCronRuns,
    supabaseSync,
    notFound404s,
    librarianErrors,
    librarianTurns,
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
    // Read from Supabase (primary store since 2026-04-10, issue #567 Phase 3).
    // MongoDB gemini_usage is a near-empty stub now.
    (async () => {
      if (supabaseAdmin) {
        const { data, error } = await supabaseAdmin
          .from('gemini_usage')
          .select('status')
          .gte('timestamp', oneHourAgo.toISOString())
          .limit(50000);
        if (error) {
          console.warn('[admin/health] Supabase error_rate query failed:', error.message);
          return [] as Array<{ _id: string; count: number }>;
        }
        const counts = new Map<string, number>();
        for (const row of data || []) {
          const key = row.status || 'unknown';
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        return Array.from(counts.entries()).map(([_id, count]) => ({ _id, count }));
      }
      return db.collection('gemini_usage').aggregate([
        { $match: { timestamp: { $gte: oneHourAgo } } },
        { $group: {
          _id: '$status',
          count: { $sum: 1 },
        }},
      ]).toArray() as Promise<Array<{ _id: string; count: number }>>;
    })(),

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

    // Supabase sync health (pause-aware — see supabase-health.ts)
    getSupabaseSyncHealth({ pipelinePaused: systemConfig?.paused === true }).catch(() => null),

    // 404 reports: last 24h vs previous 24h, plus top URL buckets.
    // not_found_reports is otherwise write-only — the provider-prefix strip
    // regression (8e348991, ~770 404s/week) sat unnoticed for two weeks
    // because nothing read it. A day-over-day spike here is the alarm.
    db.collection('not_found_reports').aggregate([
      { $match: { created_at: { $gte: twoDaysAgo } } },
      { $facet: {
        last24h: [
          { $match: { created_at: { $gte: oneDayAgo } } },
          { $group: { _id: null, hits: { $sum: { $ifNull: ['$hit_count', 1] } } } },
        ],
        prev24h: [
          { $match: { created_at: { $lt: oneDayAgo } } },
          { $group: { _id: null, hits: { $sum: { $ifNull: ['$hit_count', 1] } } } },
        ],
        topUrls: [
          { $match: { created_at: { $gte: oneDayAgo } } },
          { $group: { _id: '$url', hits: { $sum: { $ifNull: ['$hit_count', 1] } } } },
          { $sort: { hits: -1 } },
          { $limit: 10 },
        ],
        topPrefixes: [
          { $match: { created_at: { $gte: oneDayAgo } } },
          { $group: {
            _id: { $arrayElemAt: [{ $split: ['$url', '/'] }, 1] },
            hits: { $sum: { $ifNull: ['$hit_count', 1] } },
          } },
          { $sort: { hits: -1 } },
          { $limit: 8 },
        ],
      } },
    ], { maxTimeMS: 10000 }).toArray().catch(() => null),

    // Librarian errors by kind (last 24h) — embassy_errors was also
    // write-only until 2026-06-10.
    db.collection('embassy_errors').aggregate([
      { $match: { createdAt: { $gte: oneDayAgo } } },
      { $group: {
        _id: '$kind',
        count: { $sum: 1 },
        unrepaired: { $sum: { $size: { $ifNull: ['$unrepaired', []] } } },
      } },
    ], { maxTimeMS: 10000 }).toArray().catch(() => null),

    // Librarian turns + token usage (last 24h) — usage is persisted per AI
    // message since PR #2508; this is the cost/cache-hit trend line.
    db.collection('embassy_messages').aggregate([
      { $match: { authorType: 'ai', createdAt: { $gte: oneDayAgo } } },
      { $group: {
        _id: null,
        turns: { $sum: 1 },
        promptTokens: { $sum: { $ifNull: ['$usage.promptTokens', 0] } },
        outputTokens: { $sum: { $ifNull: ['$usage.outputTokens', 0] } },
        cachedTokens: { $sum: { $ifNull: ['$usage.cachedTokens', 0] } },
        turnsWithUsage: { $sum: { $cond: [{ $gt: ['$usage.promptTokens', 0] }, 1, 0] } },
      } },
    ], { maxTimeMS: 10000 }).toArray().catch(() => null),
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

  // --- 9. Supabase sync ---
  if (supabaseSync) {
    checks.supabase_sync = { ...supabaseSync } as CheckResult;
  } else {
    checks.supabase_sync = { status: 'warning', error: 'sync_health RPC unavailable' };
  }

  // --- 10. 404 reports (last 24h vs previous 24h) ---
  if (notFound404s?.[0]) {
    const nf = notFound404s[0] as {
      last24h: Array<{ hits: number }>;
      prev24h: Array<{ hits: number }>;
      topUrls: Array<{ _id: string; hits: number }>;
      topPrefixes: Array<{ _id: string | null; hits: number }>;
    };
    const last24h = nf.last24h[0]?.hits || 0;
    const prev24h = nf.prev24h[0]?.hits || 0;
    // Baseline is ~200/day. Warn on a genuine spike, not normal jitter:
    // doubling day-over-day above a 300-hit floor, or 600+ outright.
    const spiking = last24h >= 600 || (last24h >= 300 && last24h > prev24h * 2);
    checks.not_found_404s = {
      status: spiking ? 'warning' : 'ok',
      last_24h: last24h,
      prev_24h: prev24h,
      top_urls: nf.topUrls.map(u => ({ url: u._id, hits: u.hits })),
      top_prefixes: nf.topPrefixes.map(p => ({ prefix: `/${p._id ?? ''}`, hits: p.hits })),
    };
  } else {
    checks.not_found_404s = { status: 'warning', error: '404-report query failed' };
  }

  // --- 11. Librarian (embassy chat) errors + usage (last 24h) ---
  {
    const errByKind: Record<string, number> = {};
    let unrepairedCitations = 0;
    for (const e of (librarianErrors || []) as Array<{ _id: string; count: number; unrepaired?: number }>) {
      errByKind[e._id || 'unknown'] = e.count;
      if (e._id === 'broken_citation') unrepairedCitations = e.unrepaired || 0;
    }
    const totalLibErrors = Object.values(errByKind).reduce((a, b) => a + b, 0);
    const turns = (librarianTurns?.[0] || null) as {
      turns: number; promptTokens: number; outputTokens: number;
      cachedTokens: number; turnsWithUsage: number;
    } | null;
    const turnCount = turns?.turns || 0;
    // broken_citation rows are the citation guard CATCHING (and usually
    // repairing) fabricated links (#3114) — the guard working, not a
    // reader-facing failure. Only unrepaired links (the reader gets a
    // dead-link disclaimer) count toward status; catches stay visible as info.
    const effectiveErrors = (totalLibErrors - (errByKind['broken_citation'] || 0)) + unrepairedCitations;
    checks.librarian = {
      // Errors on a meaningful share of turns = something is broken for
      // real readers, not a one-off.
      status: effectiveErrors > Math.max(5, turnCount * 0.2) ? 'warning' : 'ok',
      errors_24h: totalLibErrors,
      errors_by_kind: errByKind,
      citation_unrepaired_24h: unrepairedCitations,
      turns_24h: turnCount,
      ...(turns && turns.turnsWithUsage > 0 ? {
        avg_prompt_tokens: Math.round(turns.promptTokens / turns.turnsWithUsage),
        avg_output_tokens: Math.round(turns.outputTokens / turns.turnsWithUsage),
        cached_token_share: turns.promptTokens > 0
          ? Math.round((turns.cachedTokens / turns.promptTokens) * 1000) / 10 + '%'
          : '0%',
      } : {}),
    };
  }

  // --- Overall health ---
  const hasAnyCritical = Object.values(checks).some(c => c.status === 'critical');
  // A deliberate pause is an operator choice, not an incident — the system is
  // healthy, just paused. The pause stays visible as the system_paused
  // warning above; only critical checks flip the overall flag.
  const healthy = !hasAnyCritical;

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
