import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 60;

// Simple in-memory cache keyed by days param (persists for serverless function lifetime)
const cache = new Map<number, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const GET = withAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);

    // Return cached result if fresh
    const cached = cache.get(days);
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

      // 3. Pre-aggregated daily usage from gemini_usage_daily (fast: ~30 docs instead of 1.4M)
      (async () => {
        const cutoffStr = cutoffDate.toISOString().slice(0, 10);
        const dailyDocs = await db.collection('gemini_usage_daily')
          .find({ date: { $gte: cutoffStr } })
          .sort({ date: 1 })
          .toArray();

        if (dailyDocs.length === 0) {
          return db.collection('gemini_usage').aggregate([
            { $match: { timestamp: { $gte: cutoffDate } } },
            { $facet: {
              costTotal: [{ $group: {
                _id: null,
                totalCost: { $sum: { $ifNull: ['$cost_usd', 0] } },
                totalTokens: { $sum: { $add: [{ $ifNull: ['$input_tokens', 0] }, { $ifNull: ['$output_tokens', 0] }] } },
              }}],
              costByDay: [
                { $group: {
                  _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
                  cost: { $sum: { $ifNull: ['$cost_usd', 0] } },
                  tokens: { $sum: { $add: [{ $ifNull: ['$input_tokens', 0] }, { $ifNull: ['$output_tokens', 0] }] } },
                }},
                { $sort: { _id: 1 } },
              ],
              costByAction: [
                { $group: { _id: '$type', cost: { $sum: { $ifNull: ['$cost_usd', 0] } }, count: { $sum: 1 } } },
                { $sort: { cost: -1 } },
              ],
              modelUsage: [
                { $match: { type: 'ocr', model: { $exists: true, $ne: null } } },
                { $group: { _id: '$model', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
              ],
              promptUsage: [
                { $match: { type: 'ocr', endpoint: { $exists: true, $ne: null } } },
                { $group: { _id: '$endpoint', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
              ],
              imageStats: [
                { $match: { type: 'extract_images', status: 'success' } },
                { $group: { _id: null, totalPages: { $sum: 1 } } },
              ],
              failuresByCategory: [
                { $match: { status: 'failed' } },
                { $group: { _id: '$error_category', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
              ],
            }}
          ], { maxTimeMS: 45000 }).toArray().catch((err: Error) => {
            console.warn('gemini_usage aggregate timed out or failed:', err.message?.substring(0, 100));
            return [{}];
          });
        }

        // Merge daily docs into the same shape the old $facet returned
        let totalCost = 0, totalTokens = 0;
        const costByDayMap = new Map<string, { cost: number; tokens: number }>();
        const costByActionMap = new Map<string, { cost: number; count: number }>();
        const modelUsageMap = new Map<string, number>();
        const promptUsageMap = new Map<string, number>();
        let imagePages = 0;
        const failuresMap = new Map<string, number>();

        for (const doc of dailyDocs) {
          totalCost += doc.totalCost || 0;
          totalTokens += (doc.totalInputTokens || 0) + (doc.totalOutputTokens || 0);

          costByDayMap.set(doc.date, {
            cost: doc.totalCost || 0,
            tokens: (doc.totalInputTokens || 0) + (doc.totalOutputTokens || 0),
          });

          for (const [type, stats] of Object.entries(doc.byType || {})) {
            const s = stats as any;
            const existing = costByActionMap.get(type) || { cost: 0, count: 0 };
            existing.cost += s.cost || 0;
            existing.count += s.count || 0;
            costByActionMap.set(type, existing);
            if (type === 'extract_images') imagePages += s.successCount || 0;
          }

          for (const [model, stats] of Object.entries(doc.byModel || {})) {
            const s = stats as any;
            modelUsageMap.set(model, (modelUsageMap.get(model) || 0) + (s.count || 0));
          }

          for (const [endpoint, count] of Object.entries(doc.byEndpoint || {})) {
            promptUsageMap.set(endpoint, (promptUsageMap.get(endpoint) || 0) + (count as number));
          }

          for (const [cat, stats] of Object.entries(doc.byErrorCategory || {})) {
            const s = stats as any;
            failuresMap.set(cat, (failuresMap.get(cat) || 0) + (s.count || 0));
          }
        }

        return [{
          costTotal: [{ totalCost, totalTokens }],
          costByDay: Array.from(costByDayMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, v]) => ({ _id: date, cost: v.cost, tokens: v.tokens })),
          costByAction: Array.from(costByActionMap.entries())
            .sort(([, a], [, b]) => b.cost - a.cost)
            .map(([type, v]) => ({ _id: type, cost: v.cost, count: v.count })),
          modelUsage: Array.from(modelUsageMap.entries())
            .sort(([, a], [, b]) => b - a)
            .map(([model, count]) => ({ _id: model, count })),
          promptUsage: Array.from(promptUsageMap.entries())
            .sort(([, a], [, b]) => b - a)
            .map(([endpoint, count]) => ({ _id: endpoint, count })),
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
    let snap = snapshot?.data;
    if (!snap) {
      // Fall back to dashboard_snapshot if analytics_usage hasn't been seeded yet
      const fallback = await db.collection('system_config').findOne({ _id: 'dashboard_snapshot' } as any);
      snap = fallback?.data;
    }

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
        pagesWithCroppedPhoto: 0,
        pagesWithArchivedPhoto: 0,
        totalBlobPages: 0,
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
      costByDay: (gu.costByDay || []).map((d: any) => ({ date: d._id, cost: d.cost || 0, tokens: d.tokens || 0 })),
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

    cache.set(days, { data: responseData, timestamp: Date.now() });

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Error fetching usage analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch usage analytics', details: String(error) },
      { status: 500 }
    );
  }
});
