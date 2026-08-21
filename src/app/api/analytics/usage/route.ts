import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { supabase } from '@/lib/supabase';

export const maxDuration = 30;

// Simple in-memory cache keyed by days param (persists for serverless function lifetime)
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute (Supabase queries are fast)

// Oldest a snapshot may be and still be served. `analytics_usage` is refreshed
// hourly, so anything past a couple of days means its writer has stopped and
// the honest answer is "not measurable", not a plausible stale total.
const MAX_SNAPSHOT_AGE_MS = 2 * 24 * 60 * 60 * 1000;

export const GET = withAuth(async (request: NextRequest, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);        
    // Return cached result if fresh
    const cacheKey = `${days}-all`;
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    const db = await getDb();
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // === Read pre-computed snapshots (instant) + small queries ===
    const [snapshot, recentBooksResult, geminiUsageFacetArr, batchJobsResult, highFailureBooks] = await Promise.all([
      // 1. Pre-computed dashboard snapshot (updated by Hetzner cron)
      db.collection('system_config').findOne({ _id: 'analytics_usage' } as any).catch(() => null),

      // 2. Recent books (fast find with projection + index on created_at)
      db.collection('books')
        .find({ created_at: { $gte: cutoffDate } })
        .sort({ created_at: -1 })
        .limit(10)
        .project({ title: 1, author: 1, created_at: 1, pages_count: 1 })
        .toArray().catch(() => []),

      // 3. Cost/usage data from Supabase materialized view (instant — replaces 45s MongoDB aggregation)
      (async () => {
        const cutoffStr = cutoffDate.toISOString().slice(0, 10);

        const { data: rows } = await supabase
          .from('dashboard_usage')
          .select('*')
          .gte('day', cutoffStr)
          .order('day', { ascending: true });

        if (!rows || rows.length === 0) return [{}];

        let totalCost = 0, totalTokens = 0;
        const costByDayMap = new Map<string, { cost: number; tokens: number; requests: number }>();
        const costByActionMap = new Map<string, { cost: number; count: number }>();
        const modelUsageMap = new Map<string, number>();
        let imagePages = 0;
        const failuresMap = new Map<string, number>();

        for (const row of rows) {
          const cost = Number(row.total_cost) || 0;
          const tokens = (Number(row.total_input_tokens) || 0) + (Number(row.total_output_tokens) || 0);
          totalCost += cost;
          totalTokens += tokens;

          // Aggregate by day
          const dayStr = row.day;
          const existing = costByDayMap.get(dayStr) || { cost: 0, tokens: 0, requests: 0 };
          existing.cost += cost;
          existing.tokens += tokens;
          existing.requests += Number(row.call_count) || 0;
          costByDayMap.set(dayStr, existing);

          // Aggregate by type
          if (row.type) {
            const actionExisting = costByActionMap.get(row.type) || { cost: 0, count: 0 };
            actionExisting.cost += cost;
            actionExisting.count += Number(row.call_count) || 0;
            costByActionMap.set(row.type, actionExisting);
            if (row.type === 'extract_images') imagePages += Number(row.success_count) || 0;
          }

          // Aggregate by model
          if (row.model) {
            modelUsageMap.set(row.model, (modelUsageMap.get(row.model) || 0) + (Number(row.call_count) || 0));
          }

          // Aggregate failures
          const failCount = Number(row.failed_count) || 0;
          if (failCount > 0 && row.type) {
            failuresMap.set(row.type, (failuresMap.get(row.type) || 0) + failCount);
          }
        }

        return [{
          costTotal: [{ totalCost, totalTokens }],
          costByDay: Array.from(costByDayMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, v]) => ({ _id: date, cost: v.cost, tokens: v.tokens, requests: v.requests })),
          costByAction: Array.from(costByActionMap.entries())
            .sort(([, a], [, b]) => b.cost - a.cost)
            .map(([type, v]) => ({ _id: type, cost: v.cost, count: v.count })),
          modelUsage: Array.from(modelUsageMap.entries())
            .sort(([, a], [, b]) => b - a)
            .map(([model, count]) => ({ _id: model, count })),
          promptUsage: [],  // Not available from materialized view; add if needed
          imageStats: imagePages > 0 ? [{ totalPages: imagePages }] : [],
          failuresByCategory: Array.from(failuresMap.entries())
            .sort(([, a], [, b]) => b - a)
            .map(([cat, count]) => ({ _id: cat, count })),
        }];
      })(),

      // 4. Active batch jobs (small collection, fast)
      db.collection('batch_jobs').aggregate([
        { $match: { status: { $in: ['pending', 'processing'] } } },
        { $group: { _id: { status: '$status', type: '$type' }, count: { $sum: 1 } } },
      ]).toArray().catch(() => []),

      // 5. High-failure-rate OCR jobs
      db.collection('jobs').aggregate([
        { $match: { type: 'ocr', status: 'completed_with_errors', updated_at: { $gte: cutoffDate } } },
        { $addFields: { failRate: { $cond: [
          { $gt: ['$progress.total', 0] },
          { $divide: ['$progress.failed', '$progress.total'] },
          0,
        ] } } },
        { $match: { failRate: { $gte: 0.9 } } },
        { $group: {
          _id: '$book_id',
          title: { $first: '$book_title' },
          jobCount: { $sum: 1 },
          totalPagesFailed: { $sum: '$progress.failed' },
          lastFailure: { $max: '$updated_at' },
        } },
        { $sort: { jobCount: -1 } },
        { $limit: 15 },
      ]).toArray().catch(() => []),
    ]);

    // === Unpack snapshot (or fall back to dashboard_snapshot) ===
    //
    // The fallback exists for the cold case where `analytics_usage` has never
    // been seeded. It is NOT a stand-in for a rollup that has stopped writing:
    // `dashboard_snapshot` has no writer on any current path and was measured
    // at 126 days old on 2026-08-06, so serving it silently would put
    // four-month-old totals on the dashboard with nothing to say so.
    //
    // A number that looks authoritative and is wrong is worse than no number
    // (`.claude/docs/invariants/measurement-instruments.md`). So: refuse
    // anything past MAX_SNAPSHOT_AGE_MS, and always report the age and source
    // of whatever we did serve, so the UI can label it.
    let snap = snapshot?.data;
    let snapshotSource: 'analytics_usage' | 'dashboard_snapshot' | 'none' =
      snap ? 'analytics_usage' : 'none';
    let snapshotUpdatedAt: string | null = snapshot?.updated_at
      ? new Date(snapshot.updated_at).toISOString()
      : null;

    if (!snap) {
      const fallback = await db.collection('system_config').findOne({ _id: 'dashboard_snapshot' } as any);
      const fallbackAt = fallback?.updated_at ? new Date(fallback.updated_at) : null;
      const fallbackAge = fallbackAt ? Date.now() - fallbackAt.getTime() : Infinity;

      if (fallback?.data && fallbackAge <= MAX_SNAPSHOT_AGE_MS) {
        snap = fallback.data;
        snapshotSource = 'dashboard_snapshot';
        snapshotUpdatedAt = fallbackAt!.toISOString();
      } else {
        console.warn(
          `[analytics/usage] analytics_usage missing and dashboard_snapshot is ` +
          `${Number.isFinite(fallbackAge) ? Math.round(fallbackAge / 86_400_000) + 'd' : 'undated'} old ` +
          `(max ${MAX_SNAPSHOT_AGE_MS / 86_400_000}d) — serving no snapshot rather than stale totals`
        );
      }
    }

    const snapshotAgeMs = snapshotUpdatedAt
      ? Date.now() - new Date(snapshotUpdatedAt).getTime()
      : null;

    const canon = snap?.canon || {};
    const coverage = snap?.coverage || {};
    const enrichment = snap?.enrichment || {};

    const totalBooks = canon.total_books || 0;
    const totalPages = canon.total_pages || 0;
    const pagesWithOcr = coverage.ocr_pages || 0;
    const pagesWithTranslation = coverage.translated_pages || 0;

    const recentBooks = (recentBooksResult as any[]).map(b => ({
      title: b.title, author: b.author, created_at: b.created_at, pages_count: b.pages_count,
    }));

    // === Unpack gemini_usage ===
    const gu = (geminiUsageFacetArr as any[])[0] || {};

    const modelUsage = (gu.modelUsage || []).map((m: any) => ({ model: m._id, count: m.count }));
    const promptUsage = (gu.promptUsage || []).map((p: any) => ({ prompt: p._id, count: p.count }));

    // Collection stats from snapshot
    const collectionStats = {
      blobStorage: {
        booksWithSplitPages: snap?.splitting?.booksWithSplitPages || 0,
      },
      byLanguage: (snap?.byLanguage || []).map((l: any) => ({ language: l._id || 'Unknown', count: l.count })),
      byCategory: (snap?.byCategory || []).map((c: any) => ({ category: c._id || 'Unknown', count: c.count })),
      byImageSource: (snap?.byProvider || []).map((p: any) => ({ provider: p._id || 'unknown', count: p.count })),
    };

    // Pipeline health
    let pendingJobs = 0;
    let processingJobs = 0;
    const jobsByType: Record<string, number> = {};
    for (const item of (batchJobsResult || []) as any[]) {
      if (item._id.status === 'pending') pendingJobs += item.count;
      if (item._id.status === 'processing') processingJobs += item.count;
      const type = item._id.type || 'unknown';
      jobsByType[type] = (jobsByType[type] || 0) + item.count;
    }

    const pipelineHealth = {
      splitting: snap?.splitting || { needsSplitting: 0, alreadySplit: 0, noSplitNeeded: 0, unchecked: 0 },
      enrichment: {
        booksWithSummary: enrichment.with_summary || 0,
        booksWithIndex: enrichment.with_index || 0,
        booksWithChapters: 0,
        booksWithEditions: 0,
        fullyTranslated: canon.first_translations_complete || 0,
      },
      images: { pagesWithDetectedImages: gu.imageStats?.[0]?.totalPages || 0, totalDetectedImages: 0 },
      batchJobs: {
        pending: pendingJobs,
        processing: processingJobs,
        byType: Object.entries(jobsByType).map(([type, count]) => ({ type, count })),
      },
      workerHealth: {
        ocrBlocked: snap?.ocrBlocked || 0,
        needsAttention: (snap?.pipelineFunnel || []).find((s: any) => s.status === 'needs_attention')?.count || 0,
        failuresByCategory: (gu.failuresByCategory || []).map((f: any) => ({
          category: f._id || 'unknown',
          count: f.count,
        })),
        highFailureBooks: ((highFailureBooks || []) as any[]).map((b: any) => ({
          bookId: b._id,
          title: b.title,
          jobCount: b.jobCount,
          totalPagesFailed: b.totalPagesFailed,
          lastFailure: b.lastFailure,
        })),
      },
    };

    // Cost stats
    const costStats = {
      totalCost: gu.costTotal?.[0]?.totalCost || 0,
      totalTokens: gu.costTotal?.[0]?.totalTokens || 0,
      costByDay: (gu.costByDay || []).map((d: any) => ({ date: d._id, cost: d.cost || 0, tokens: d.tokens || 0, requests: d.requests || 0 })),
      costByAction: (gu.costByAction || []).map((a: any) => ({ action: a._id || 'unknown', cost: a.cost || 0, count: a.count || 0 })),
    };

    // Pipeline funnel from snapshot
    const pipelineFunnel = (snap?.pipelineFunnel || []).map((s: any) => ({
      status: s.status || s._id || 'not_enrolled',
      count: s.count,
    }));

    // Backlog
    const backlog = {
      needsOcr: Math.max(0, totalPages - pagesWithOcr),
      needsTranslation: Math.max(0, pagesWithOcr - pagesWithTranslation),
      oldOcrPages: snap?.oldOcrPages || 0,
    };

    const responseData = {
      // Provenance for the corpus totals below. `summary` comes from a
      // periodic rollup, not from a live count, so the UI must be able to say
      // how old it is — and `source: 'none'` means we refused a stale snapshot
      // and the totals are zeroes, which must NOT be rendered as real figures.
      snapshot: {
        source: snapshotSource,
        updatedAt: snapshotUpdatedAt,
        ageMs: snapshotAgeMs,
        stale: snapshotAgeMs !== null && snapshotAgeMs > MAX_SNAPSHOT_AGE_MS,
      },
      summary: {
        totalBooks, totalPages, pagesWithOcr, pagesWithTranslation,
        ocrPercentage: totalPages > 0 ? Math.round((pagesWithOcr / totalPages) * 100) : 0,
        translationPercentage: totalPages > 0 ? Math.round((pagesWithTranslation / totalPages) * 100) : 0,
      },
      recentBooks,
      modelUsage,
      promptUsage,
      costStats,
      collectionStats,
      pipelineHealth,
      pipelineFunnel,
      backlog,
      snapshotAge: snapshot?.updated_at ? Math.round((Date.now() - new Date(snapshot.updated_at).getTime()) / 60000) + ' min ago' : 'using dashboard_snapshot fallback',
      query: { days },
    };

    cache.set(cacheKey, { data: responseData, timestamp: Date.now() });

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Error fetching usage analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch usage analytics', details: String(error) },
      { status: 500 }
    );
  }
});
