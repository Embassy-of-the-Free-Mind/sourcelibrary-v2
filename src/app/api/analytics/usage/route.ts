import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 60;

// Simple in-memory cache (persists for serverless function lifetime)
let cachedResult: { data: any; timestamp: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);

    // Return cached result if fresh
    if (cachedResult && days === 30 && (Date.now() - cachedResult.timestamp) < CACHE_TTL_MS) {
      return NextResponse.json(cachedResult.data);
    }

    const db = await getDb();
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // === Run ALL independent query blocks in parallel ===
    const [
      countsResult,
      recentBooksResult,
      pagesWithOcrNoModelResult,
      modelUsageResult,
      promptUsageResult,
      collectionStatsResult,
      pipelineHealthResult,
      costTotalResult,
      costByDayResult,
      costByActionResult,
    ] = await Promise.all([
      // 1. Book and page counts
      Promise.all([
        db.collection('books').estimatedDocumentCount(),
        db.collection('pages').estimatedDocumentCount(),
        db.collection('pages').countDocuments({ 'ocr.data': { $exists: true, $ne: '' } }),
        db.collection('pages').countDocuments({ 'translation.data': { $exists: true, $ne: '' } }),
      ]).catch(() => [0, 0, 0, 0] as number[]),

      // 2. Recent books
      db.collection('books')
        .find({ created_at: { $gte: cutoffDate } })
        .sort({ created_at: -1 })
        .limit(10)
        .project({ title: 1, author: 1, created_at: 1, pages_count: 1 })
        .toArray().catch(() => []),

      // 3. Pages with OCR but no model
      db.collection('pages').countDocuments({
        'ocr.data': { $exists: true, $ne: '' },
        $or: [{ 'ocr.model': { $exists: false } }, { 'ocr.model': null }, { 'ocr.model': '' }],
      }).catch(() => 0),

      // 4. Model usage
      db.collection('pages').aggregate([
        { $match: { 'ocr.model': { $exists: true, $ne: null, $nin: ['', null] } } },
        { $group: { _id: '$ocr.model', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray().catch(() => []),

      // 5. Prompt usage
      db.collection('pages').aggregate([
        { $match: { 'ocr.prompt_name': { $exists: true, $ne: null, $nin: ['', null] } } },
        { $group: { _id: '$ocr.prompt_name', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray().catch(() => []),

      // 6. Collection stats
      Promise.all([
        db.collection('pages').countDocuments({ cropped_photo: { $exists: true, $nin: [null, ''] } }),
        db.collection('pages').countDocuments({ archived_photo: { $exists: true, $nin: [null, ''] } }),
        db.collection('pages').distinct('book_id', { 'crop.xStart': { $exists: true } }),
        db.collection('books').aggregate([
          { $group: { _id: '$language', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 15 }
        ]).toArray(),
        db.collection('books').aggregate([
          { $unwind: '$categories' },
          { $group: { _id: '$categories', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 15 }
        ]).toArray(),
        db.collection('books').aggregate([
          { $group: { _id: '$image_source.provider', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]).toArray(),
      ]).catch(() => [0, 0, [], [], [], []] as any),

      // 7. Pipeline health
      Promise.all([
        db.collection('books').countDocuments({ needs_splitting: true }),
        db.collection('books').countDocuments({ needs_splitting: false }),
        db.collection('books').countDocuments({ split_check: { $exists: true } }),
        db.collection('books').countDocuments({ $or: [
          { summary: { $exists: true, $ne: '', $type: 'string' } },
          { 'summary.data': { $exists: true, $ne: '' } }
        ]}),
        db.collection('books').countDocuments({ 'index.bookSummary': { $exists: true } }),
        db.collection('books').countDocuments({ chapters: { $exists: true, $not: { $size: 0 } } }),
        db.collection('books').countDocuments({ editions: { $exists: true, $not: { $size: 0 } } }),
        // Count books that are >=95% translated (computed from cached fields)
        db.collection('books').countDocuments({
          pages_count: { $gt: 0 },
          $expr: { $gte: [{ $divide: ['$pages_translated', '$pages_count'] }, 0.95] }
        }),
        db.collection('pages').countDocuments({ detected_images: { $exists: true, $not: { $size: 0 } } }),
        db.collection('pages').aggregate([
          { $match: { detected_images: { $exists: true, $not: { $size: 0 } } } },
          { $project: { count: { $size: '$detected_images' } } },
          { $group: { _id: null, total: { $sum: '$count' } } }
        ]).toArray(),
        db.collection('batch_jobs').aggregate([
          { $match: { status: { $in: ['pending', 'processing'] } } },
          { $group: { _id: { status: '$status', type: '$type' }, count: { $sum: 1 } } }
        ]).toArray(),
      ]).catch(() => [0, 0, 0, 0, 0, 0, 0, 0, 0, [], []] as any),

      // 8. Cost total
      db.collection('gemini_usage').aggregate([
        { $match: { timestamp: { $gte: cutoffDate } } },
        { $group: { _id: null, totalCost: { $sum: '$cost_usd' }, totalTokens: { $sum: { $add: ['$input_tokens', '$output_tokens'] } } } },
      ]).toArray().catch(() => []),

      // 9. Cost by day
      db.collection('gemini_usage').aggregate([
        { $match: { timestamp: { $gte: cutoffDate } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          cost: { $sum: '$cost_usd' },
          tokens: { $sum: { $add: ['$input_tokens', '$output_tokens'] } },
        }},
        { $sort: { _id: 1 } },
      ]).toArray().catch(() => []),

      // 10. Cost by action
      db.collection('gemini_usage').aggregate([
        { $match: { timestamp: { $gte: cutoffDate } } },
        { $group: { _id: '$type', cost: { $sum: '$cost_usd' }, count: { $sum: 1 } } },
        { $sort: { cost: -1 } },
      ]).toArray().catch(() => []),
    ]);

    // === Process results ===

    const [totalBooks, totalPages, pagesWithOcr, pagesWithTranslation] = countsResult;

    const recentBooks = (recentBooksResult as any[]).map(b => ({
      title: b.title, author: b.author, created_at: b.created_at, pages_count: b.pages_count,
    }));

    const modelUsage = (modelUsageResult as any[]).map(m => ({ _id: m._id, count: m.count }));
    if ((pagesWithOcrNoModelResult as number) > 0) {
      modelUsage.push({ _id: '__untracked__', count: pagesWithOcrNoModelResult as number });
    }

    const promptUsage = promptUsageResult as any[];

    // Collection stats
    const [croppedCount, archivedCount, splitBooks, langAgg, catAgg, providerAgg] = collectionStatsResult as any;
    const collectionStats = {
      blobStorage: {
        pagesWithCroppedPhoto: croppedCount || 0,
        pagesWithArchivedPhoto: archivedCount || 0,
        totalBlobPages: (croppedCount || 0) + (archivedCount || 0),
        booksWithSplitPages: splitBooks?.length || 0,
      },
      byLanguage: (langAgg || []).map((l: any) => ({ language: l._id || 'Unknown', count: l.count })),
      byCategory: (catAgg || []).map((c: any) => ({ category: c._id || 'Unknown', count: c.count })),
      byImageSource: (providerAgg || []).map((p: any) => ({ provider: p._id || 'unknown', count: p.count })),
    };

    // Pipeline health
    const [
      needsSplitting, noSplitNeeded, splitChecked,
      booksWithSummary, booksWithIndex, booksWithChapters, booksWithEditions, fullyTranslated,
      pagesWithDetectedImages, detectedImagesAgg, batchJobsAgg,
    ] = pipelineHealthResult as any;

    const alreadySplit = collectionStats.blobStorage.booksWithSplitPages;
    const unchecked = (totalBooks || 0) - (splitChecked || 0) - alreadySplit;

    let pendingJobs = 0;
    let processingJobs = 0;
    const jobsByType: Record<string, number> = {};
    for (const item of (batchJobsAgg || []) as any[]) {
      if (item._id.status === 'pending') pendingJobs += item.count;
      if (item._id.status === 'processing') processingJobs += item.count;
      const type = item._id.type || 'unknown';
      jobsByType[type] = (jobsByType[type] || 0) + item.count;
    }

    const pipelineHealth = {
      splitting: { needsSplitting: needsSplitting || 0, alreadySplit, noSplitNeeded: noSplitNeeded || 0, unchecked: Math.max(0, unchecked) },
      enrichment: {
        booksWithSummary: booksWithSummary || 0, booksWithIndex: booksWithIndex || 0,
        booksWithChapters: booksWithChapters || 0, booksWithEditions: booksWithEditions || 0,
        fullyTranslated: fullyTranslated || 0,
      },
      images: { pagesWithDetectedImages: pagesWithDetectedImages || 0, totalDetectedImages: detectedImagesAgg?.[0]?.total || 0 },
      batchJobs: { pending: pendingJobs, processing: processingJobs, byType: Object.entries(jobsByType).map(([type, count]) => ({ type, count })) },
    };

    // Cost stats
    const costStats = {
      totalCost: (costTotalResult as any[])[0]?.totalCost || 0,
      totalTokens: (costTotalResult as any[])[0]?.totalTokens || 0,
      costByDay: (costByDayResult as any[]).map(d => ({ date: d._id, cost: d.cost || 0, tokens: d.tokens || 0 })),
      costByAction: (costByActionResult as any[]).map(a => ({ action: a._id || 'unknown', cost: a.cost || 0, count: a.count || 0 })),
    };

    const responseData = {
      summary: {
        totalBooks, totalPages, pagesWithOcr, pagesWithTranslation,
        ocrPercentage: totalPages > 0 ? Math.round((pagesWithOcr / totalPages) * 100) : 0,
        translationPercentage: totalPages > 0 ? Math.round((pagesWithTranslation / totalPages) * 100) : 0,
      },
      recentBooks,
      modelUsage: modelUsage.map(m => ({ model: m._id, count: m.count })),
      promptUsage: promptUsage.map((p: any) => ({ prompt: p._id, count: p.count })),
      costStats,
      collectionStats,
      pipelineHealth,
      query: { days },
    };

    // Cache the result for 5 minutes (default 30-day query only)
    if (days === 30) {
      cachedResult = { data: responseData, timestamp: Date.now() };
    }

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Error fetching usage analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch usage analytics', details: String(error) },
      { status: 500 }
    );
  }
}
