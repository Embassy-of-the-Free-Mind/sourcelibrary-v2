import { NextRequest, NextResponse } from 'next/server';
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

    // === 4 queries total (down from ~25) using $facet ===
    const [booksFacetArr, recentBooksResult, geminiUsageFacetArr, batchJobsResult, highFailureBooks] = await Promise.all([
      // 1. SINGLE books $facet — one scan of ~5k docs for ALL book-level stats
      db.collection('books').aggregate([{
        $facet: {
          totals: [{ $group: {
            _id: null,
            totalBooks: { $sum: 1 },
            totalPages: { $sum: { $ifNull: ['$pages_count', 0] } },
            pagesWithOcr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
            pagesWithTranslation: { $sum: { $ifNull: ['$pages_translated', 0] } },
            // Pipeline health counts
            needsSplitting: { $sum: { $cond: [{ $eq: ['$needs_splitting', true] }, 1, 0] } },
            noSplitNeeded: { $sum: { $cond: [{ $eq: ['$needs_splitting', false] }, 1, 0] } },
            splitChecked: { $sum: { $cond: [{ $ne: [{ $type: '$split_check' }, 'missing'] }, 1, 0] } },
            booksWithSplitPages: { $sum: { $cond: [{ $eq: ['$split_check.needs_splitting', true] }, 1, 0] } },
            booksWithSummary: { $sum: { $cond: [{ $or: [
              { $and: [{ $eq: [{ $type: '$summary' }, 'string'] }, { $ne: ['$summary', ''] }] },
              { $ne: [{ $ifNull: ['$summary.data', ''] }, ''] },
            ]}, 1, 0] } },
            booksWithIndex: { $sum: { $cond: [{ $ne: [{ $type: '$index.bookSummary' }, 'missing'] }, 1, 0] } },
            booksWithChapters: { $sum: { $cond: [
              { $gt: [{ $size: { $ifNull: ['$chapters', []] } }, 0] }, 1, 0,
            ] } },
            booksWithEditions: { $sum: { $cond: [
              { $gt: [{ $size: { $ifNull: ['$editions', []] } }, 0] }, 1, 0,
            ] } },
            fullyTranslated: { $sum: { $cond: [{ $and: [
              { $gt: [{ $ifNull: ['$pages_count', 0] }, 0] },
              { $gte: [
                { $divide: [{ $ifNull: ['$pages_translated', 0] }, { $max: [{ $ifNull: ['$pages_count', 0] }, 1] }] },
                0.95,
              ] },
            ]}, 1, 0] } },
            // Backlog: old OCR pages not in pipeline
            oldOcrPages: { $sum: { $cond: [{ $and: [
              { $not: ['$pipeline_auto.status'] },
              { $gt: [{ $ifNull: ['$pages_ocr', 0] }, 0] },
            ]}, '$pages_ocr', 0] } },
            // Worker health: books blocked due to repeated OCR failures (dead images etc)
            ocrBlocked: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$ocr_blocked_until', null] }, new Date()] }, 1, 0] } },
          }}],
          pipelineFunnel: [
            { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          byLanguage: [
            { $group: { _id: '$language', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 15 },
          ],
          byCategory: [
            { $unwind: { path: '$categories', preserveNullAndEmptyArrays: false } },
            { $group: { _id: '$categories', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 15 },
          ],
          byProvider: [
            { $group: { _id: '$image_source.provider', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
        }
      }]).toArray().catch(() => [{}]),

      // 2. Recent books (fast find with projection + index on created_at)
      db.collection('books')
        .find({ created_at: { $gte: cutoffDate } })
        .sort({ created_at: -1 })
        .limit(10)
        .project({ title: 1, author: 1, created_at: 1, pages_count: 1 })
        .toArray().catch(() => []),

      // 3. SINGLE gemini_usage $facet — one scan with timestamp filter for all cost/model/prompt stats
      // maxTimeMS prevents 504 on missing timestamp index (1.4M+ docs); returns empty on timeout
      db.collection('gemini_usage').aggregate([
        { $match: { timestamp: { $gte: cutoffDate } } },
        { $facet: {
          costTotal: [
            { $group: {
              _id: null,
              totalCost: { $sum: { $ifNull: ['$cost_usd', 0] } },
              totalTokens: { $sum: { $add: [{ $ifNull: ['$input_tokens', 0] }, { $ifNull: ['$output_tokens', 0] }] } },
            }},
          ],
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
      ], { maxTimeMS: 45000 }).toArray().catch((err) => {
        console.warn('gemini_usage aggregate timed out or failed:', err.message?.substring(0, 100));
        return [{}];
      }),

      // 4. Active batch jobs (small collection, fast)
      db.collection('batch_jobs').aggregate([
        { $match: { status: { $in: ['pending', 'processing'] } } },
        { $group: { _id: { status: '$status', type: '$type' }, count: { $sum: 1 } } },
      ]).toArray().catch(() => []),

      // 5. High-failure-rate OCR jobs — books that keep failing (>90% failure)
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

    // === Unpack book facet ===
    const bf = (booksFacetArr as any[])[0] || {};
    const totals = bf.totals?.[0] || {};
    const totalBooks = totals.totalBooks || 0;
    const totalPages = totals.totalPages || 0;
    const pagesWithOcr = totals.pagesWithOcr || 0;
    const pagesWithTranslation = totals.pagesWithTranslation || 0;

    const recentBooks = (recentBooksResult as any[]).map(b => ({
      title: b.title, author: b.author, created_at: b.created_at, pages_count: b.pages_count,
    }));

    // === Unpack gemini_usage facet ===
    const gu = (geminiUsageFacetArr as any[])[0] || {};

    const modelUsage = (gu.modelUsage || []).map((m: any) => ({ model: m._id, count: m.count }));
    const promptUsage = (gu.promptUsage || []).map((p: any) => ({ prompt: p._id, count: p.count }));

    // Collection stats (from book facet)
    const alreadySplit = totals.booksWithSplitPages || 0;
    const collectionStats = {
      blobStorage: {
        pagesWithCroppedPhoto: 0,
        pagesWithArchivedPhoto: 0,
        totalBlobPages: 0,
        booksWithSplitPages: alreadySplit,
      },
      byLanguage: (bf.byLanguage || []).map((l: any) => ({ language: l._id || 'Unknown', count: l.count })),
      byCategory: (bf.byCategory || []).map((c: any) => ({ category: c._id || 'Unknown', count: c.count })),
      byImageSource: (bf.byProvider || []).map((p: any) => ({ provider: p._id || 'unknown', count: p.count })),
    };

    // Pipeline health (from book facet totals + batch jobs)
    const unchecked = totalBooks - (totals.splitChecked || 0) - alreadySplit;

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
      splitting: {
        needsSplitting: totals.needsSplitting || 0,
        alreadySplit,
        noSplitNeeded: totals.noSplitNeeded || 0,
        unchecked: Math.max(0, unchecked),
      },
      enrichment: {
        booksWithSummary: totals.booksWithSummary || 0,
        booksWithIndex: totals.booksWithIndex || 0,
        booksWithChapters: totals.booksWithChapters || 0,
        booksWithEditions: totals.booksWithEditions || 0,
        fullyTranslated: totals.fullyTranslated || 0,
      },
      images: { pagesWithDetectedImages: gu.imageStats?.[0]?.totalPages || 0, totalDetectedImages: 0 },
      batchJobs: {
        pending: pendingJobs,
        processing: processingJobs,
        byType: Object.entries(jobsByType).map(([type, count]) => ({ type, count })),
      },
      workerHealth: {
        ocrBlocked: totals.ocrBlocked || 0,
        needsAttention: (bf.pipelineFunnel || []).find((s: any) => s._id === 'needs_attention')?.count || 0,
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

    // Cost stats (from gemini_usage facet)
    const costStats = {
      totalCost: gu.costTotal?.[0]?.totalCost || 0,
      totalTokens: gu.costTotal?.[0]?.totalTokens || 0,
      costByDay: (gu.costByDay || []).map((d: any) => ({ date: d._id, cost: d.cost || 0, tokens: d.tokens || 0 })),
      costByAction: (gu.costByAction || []).map((a: any) => ({ action: a._id || 'unknown', cost: a.cost || 0, count: a.count || 0 })),
    };

    // Pipeline funnel (from book facet)
    const pipelineFunnel = (bf.pipelineFunnel || []).map((s: any) => ({
      status: s._id || 'not_enrolled',
      count: s.count,
    }));

    // Backlog (reuse totals from book facet)
    const backlog = {
      needsOcr: Math.max(0, totalPages - pagesWithOcr),
      needsTranslation: Math.max(0, pagesWithOcr - pagesWithTranslation),
      oldOcrPages: totals.oldOcrPages || 0,
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
      query: { days },
    };

    // Cache the result for 5 minutes (all time ranges)
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
