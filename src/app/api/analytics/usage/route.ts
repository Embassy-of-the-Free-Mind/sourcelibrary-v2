import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// Simple in-memory cache for IP geolocation (persists for serverless function lifetime)
const geoCache: Record<string, { country: string; countryCode: string; city: string; lat: number; lon: number }> = {};

async function getGeoLocation(ip: string | null) {
  if (!ip || ip === 'unknown' || ip === '::1' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return { country: 'Local', countryCode: 'XX', city: 'Local', lat: 0, lon: 0 };
  }

  if (geoCache[ip]) {
    return geoCache[ip];
  }

  try {
    // Using ip-api.com (free, no API key needed, 45 requests/minute limit)
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,lat,lon`, {
      next: { revalidate: 86400 } // Cache for 24 hours
    });
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'success') {
        const geo = {
          country: data.country || 'Unknown',
          countryCode: data.countryCode || 'XX',
          city: data.city || 'Unknown',
          lat: data.lat || 0,
          lon: data.lon || 0,
        };
        geoCache[ip] = geo;
        return geo;
      }
    }
  } catch (e) {
    console.error('Geo lookup failed for', ip, e);
  }

  return { country: 'Unknown', countryCode: 'XX', city: 'Unknown', lat: 0, lon: 0 };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);

    const db = await getDb();
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(cutoffMs);

    // Get book and page counts with fallbacks
    let totalBooks = 0;
    let totalPages = 0;
    let pagesWithOcr = 0;
    let pagesWithTranslation = 0;

    try {
      const results = await Promise.all([
        db.collection('books').countDocuments(),
        db.collection('pages').countDocuments(),
        db.collection('pages').countDocuments({ 'ocr.data': { $exists: true, $ne: '' } }),
        db.collection('pages').countDocuments({ 'translation.data': { $exists: true, $ne: '' } }),
      ]);
      totalBooks = results[0];
      totalPages = results[1];
      pagesWithOcr = results[2];
      pagesWithTranslation = results[3];
    } catch (e) {
      console.error('Error fetching counts:', e);
    }

    // Get visitor stats - with fallback if loading_metrics doesn't exist or times out
    let totalHits = 0;
    let uniqueVisitors = 0;
    try {
      const visitorStats = await db.collection('loading_metrics').aggregate([
        { $match: { timestamp: { $gte: cutoffMs } } },
        {
          $group: {
            _id: null,
            totalHits: { $sum: 1 },
            uniqueIps: { $addToSet: '$ip' },
          },
        },
      ]).toArray();
      totalHits = visitorStats[0]?.totalHits || 0;
      uniqueVisitors = visitorStats[0]?.uniqueIps?.length || 0;
    } catch (e) {
      console.error('Error fetching visitor stats:', e);
    }

    // Get hits by day for chart - with fallback
    let hitsByDay: Array<{ date: string; hits: number; uniqueVisitors: number }> = [];
    let processingMap: Record<string, { ocr: number; translation: number }> = {};
    let visitorsByCountry: Array<{ country: string; countryCode: string; hits: number; visitors: number }> = [];
    let visitorLocations: Array<{ city: string; country: string; countryCode: string; hits: number; lat: number; lon: number }> = [];

    try {
      const hitsByDayResult = await db.collection('loading_metrics').aggregate([
        { $match: { timestamp: { $gte: cutoffMs } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: { $toDate: '$timestamp' },
              },
            },
            hits: { $sum: 1 },
            uniqueIps: { $addToSet: '$ip' },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            date: '$_id',
            hits: 1,
            uniqueVisitors: { $size: '$uniqueIps' },
          },
        },
      ]).toArray();
      hitsByDay = hitsByDayResult.map(d => ({ date: d.date, hits: d.hits, uniqueVisitors: d.uniqueVisitors }));
    } catch (e) {
      console.error('Error fetching hits by day:', e);
    }

    try {
      // Get OCR/translation activity by day
      const processingByDay = await db.collection('loading_metrics').aggregate([
        {
          $match: {
            timestamp: { $gte: cutoffMs },
            name: { $in: ['ocr_processing', 'ocr_processing_batch', 'translation_processing'] },
          },
        },
        {
          $group: {
            _id: {
              date: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: { $toDate: '$timestamp' },
                },
              },
              type: {
                $cond: [
                  { $in: ['$name', ['ocr_processing', 'ocr_processing_batch']] },
                  'ocr',
                  'translation',
                ],
              },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.date': 1 } },
      ]).toArray();

      // Reshape processing data by day
      for (const item of processingByDay) {
        const date = item._id.date;
        if (!processingMap[date]) {
          processingMap[date] = { ocr: 0, translation: 0 };
        }
        processingMap[date][item._id.type as 'ocr' | 'translation'] = item.count;
      }
    } catch (e) {
      console.error('Error fetching processing by day:', e);
    }

    try {
      // Get unique IPs for geolocation
      const uniqueIps = await db.collection('loading_metrics').aggregate([
        { $match: { timestamp: { $gte: cutoffMs }, ip: { $ne: 'unknown' } } },
        {
          $group: {
            _id: '$ip',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 30 }, // Limit to avoid rate limiting on geo API
      ]).toArray();

      // Get geolocation for top IPs (in parallel, but limited)
      visitorLocations = await Promise.all(
        uniqueIps.map(async (v) => {
          const geo = await getGeoLocation(v._id);
          return {
            ip: v._id,
            hits: v.count,
            city: geo.city,
            country: geo.country,
            countryCode: geo.countryCode,
            lat: geo.lat,
            lon: geo.lon,
          };
        })
      );

      // Aggregate by country
      const countryMap: Record<string, { country: string; countryCode: string; hits: number; visitors: number }> = {};
      for (const v of visitorLocations) {
        if (!countryMap[v.countryCode]) {
          countryMap[v.countryCode] = { country: v.country, countryCode: v.countryCode, hits: 0, visitors: 0 };
        }
        countryMap[v.countryCode].hits += v.hits;
        countryMap[v.countryCode].visitors += 1;
      }
      visitorsByCountry = Object.values(countryMap).sort((a, b) => b.hits - a.hits);
    } catch (e) {
      console.error('Error fetching visitor locations:', e);
    }

    // Get recent books added
    let recentBooks: Array<{ title: string; author: string; created_at: Date; pages_count: number }> = [];
    let modelUsage: Array<{ _id: string; count: number }> = [];
    let promptUsage: Array<{ _id: string; count: number }> = [];
    let costStats = { totalCost: 0, totalTokens: 0, costByDay: [] as Array<{ date: string; cost: number; tokens: number }>, costByAction: [] as Array<{ action: string; cost: number; count: number }> };

    try {
      recentBooks = await db.collection('books')
        .find({ created_at: { $gte: cutoffDate } })
        .sort({ created_at: -1 })
        .limit(10)
        .project({ title: 1, author: 1, created_at: 1, pages_count: 1 })
        .toArray() as Array<{ title: string; author: string; created_at: Date; pages_count: number }>;
    } catch (e) {
      console.error('Error fetching recent books:', e);
    }

    // Count pages with OCR but no model info (historical data before model tracking)
    let pagesWithOcrNoModel = 0;
    try {
      pagesWithOcrNoModel = await db.collection('pages').countDocuments({
        'ocr.data': { $exists: true, $ne: '' },
        $or: [
          { 'ocr.model': { $exists: false } },
          { 'ocr.model': null },
          { 'ocr.model': '' },
        ],
      });
    } catch (e) {
      console.error('Error counting pages without model:', e);
    }

    try {
      // Get model usage breakdown (exclude null/empty values from historical data)
      modelUsage = await db.collection('pages').aggregate([
        { $match: { 'ocr.model': { $exists: true, $ne: null, $nin: ['', null] } } },
        {
          $group: {
            _id: '$ocr.model',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]).toArray() as Array<{ _id: string; count: number }>;

      // Add untracked count as a special entry if there are any
      if (pagesWithOcrNoModel > 0) {
        modelUsage.push({ _id: '__untracked__', count: pagesWithOcrNoModel });
      }
    } catch (e) {
      console.error('Error fetching model usage:', e);
    }

    try {
      // Get prompt usage breakdown (exclude null/empty values from historical data)
      promptUsage = await db.collection('pages').aggregate([
        { $match: { 'ocr.prompt_name': { $exists: true, $ne: null, $nin: ['', null] } } },
        {
          $group: {
            _id: '$ocr.prompt_name',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]).toArray() as Array<{ _id: string; count: number }>;
    } catch (e) {
      console.error('Error fetching prompt usage:', e);
    }

    // Get collection breakdown stats
    let collectionStats = {
      blobStorage: {
        pagesWithCroppedPhoto: 0,
        pagesWithArchivedPhoto: 0,
        totalBlobPages: 0,
        booksWithSplitPages: 0,
      },
      byLanguage: [] as Array<{ language: string; count: number }>,
      byCategory: [] as Array<{ category: string; count: number }>,
      byImageSource: [] as Array<{ provider: string; count: number }>,
    };

    // Pipeline health stats
    let pipelineHealth = {
      splitting: {
        needsSplitting: 0,
        alreadySplit: 0,
        noSplitNeeded: 0,
        unchecked: 0,
      },
      enrichment: {
        booksWithSummary: 0,
        booksWithIndex: 0,
        booksWithChapters: 0,
        booksWithEditions: 0,
        fullyTranslated: 0,
      },
      images: {
        pagesWithDetectedImages: 0,
        totalDetectedImages: 0,
      },
      batchJobs: {
        pending: 0,
        processing: 0,
        byType: [] as Array<{ type: string; count: number }>,
      },
    };

    try {
      const [croppedCount, archivedCount, splitBooks, langAgg, catAgg, providerAgg] = await Promise.all([
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
      ]);

      collectionStats = {
        blobStorage: {
          pagesWithCroppedPhoto: croppedCount,
          pagesWithArchivedPhoto: archivedCount,
          totalBlobPages: croppedCount + archivedCount,
          booksWithSplitPages: splitBooks.length,
        },
        byLanguage: langAgg.map(l => ({ language: l._id || 'Unknown', count: l.count })),
        byCategory: catAgg.map(c => ({ category: c._id || 'Unknown', count: c.count })),
        byImageSource: providerAgg.map(p => ({ provider: p._id || 'unknown', count: p.count })),
      };
    } catch (e) {
      console.error('Error fetching collection stats:', e);
    }

    // Fetch pipeline health stats
    try {
      const [
        needsSplitting,
        noSplitNeeded,
        splitChecked,
        booksWithSummary,
        booksWithIndex,
        booksWithChapters,
        booksWithEditions,
        fullyTranslated,
        pagesWithDetectedImages,
        detectedImagesAgg,
        batchJobsAgg,
      ] = await Promise.all([
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
        db.collection('books').countDocuments({ translation_percent: { $gte: 95 } }),
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
      ]);

      // Calculate unchecked (not split_checked and not already split)
      const alreadySplit = collectionStats.blobStorage.booksWithSplitPages;
      const unchecked = totalBooks - splitChecked - alreadySplit;

      // Process batch jobs aggregation
      let pendingJobs = 0;
      let processingJobs = 0;
      const jobsByType: Record<string, number> = {};
      for (const item of batchJobsAgg) {
        if (item._id.status === 'pending') pendingJobs += item.count;
        if (item._id.status === 'processing') processingJobs += item.count;
        const type = item._id.type || 'unknown';
        jobsByType[type] = (jobsByType[type] || 0) + item.count;
      }

      pipelineHealth = {
        splitting: {
          needsSplitting,
          alreadySplit,
          noSplitNeeded,
          unchecked: Math.max(0, unchecked),
        },
        enrichment: {
          booksWithSummary,
          booksWithIndex,
          booksWithChapters,
          booksWithEditions,
          fullyTranslated,
        },
        images: {
          pagesWithDetectedImages,
          totalDetectedImages: detectedImagesAgg[0]?.total || 0,
        },
        batchJobs: {
          pending: pendingJobs,
          processing: processingJobs,
          byType: Object.entries(jobsByType).map(([type, count]) => ({ type, count })),
        },
      };
    } catch (e) {
      console.error('Error fetching pipeline health stats:', e);
    }

    // Get cost tracking stats
    try {
      // Total costs
      const totalCostResult = await db.collection('cost_tracking').aggregate([
        { $match: { timestamp: { $gte: cutoffMs } } },
        {
          $group: {
            _id: null,
            totalCost: { $sum: '$costUsd' },
            totalTokens: { $sum: '$totalTokens' },
          },
        },
      ]).toArray();

      if (totalCostResult[0]) {
        costStats.totalCost = totalCostResult[0].totalCost || 0;
        costStats.totalTokens = totalCostResult[0].totalTokens || 0;
      }

      // Cost by day
      const costByDayResult = await db.collection('cost_tracking').aggregate([
        { $match: { timestamp: { $gte: cutoffMs } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: { $toDate: '$timestamp' },
              },
            },
            cost: { $sum: '$costUsd' },
            tokens: { $sum: '$totalTokens' },
          },
        },
        { $sort: { _id: 1 } },
      ]).toArray();

      costStats.costByDay = costByDayResult.map(d => ({
        date: d._id,
        cost: d.cost || 0,
        tokens: d.tokens || 0,
      }));

      // Cost by action type
      const costByActionResult = await db.collection('cost_tracking').aggregate([
        { $match: { timestamp: { $gte: cutoffMs } } },
        {
          $group: {
            _id: '$action',
            cost: { $sum: '$costUsd' },
            count: { $sum: 1 },
          },
        },
        { $sort: { cost: -1 } },
      ]).toArray();

      costStats.costByAction = costByActionResult.map(a => ({
        action: a._id || 'unknown',
        cost: a.cost || 0,
        count: a.count || 0,
      }));
    } catch (e) {
      console.error('Error fetching cost stats:', e);
    }

    return NextResponse.json({
      summary: {
        totalBooks,
        totalPages,
        pagesWithOcr,
        pagesWithTranslation,
        ocrPercentage: totalPages > 0 ? Math.round((pagesWithOcr / totalPages) * 100) : 0,
        translationPercentage: totalPages > 0 ? Math.round((pagesWithTranslation / totalPages) * 100) : 0,
        totalHits,
        uniqueVisitors,
      },
      hitsByDay: hitsByDay.map((d) => ({
        date: d.date,
        hits: d.hits,
        uniqueVisitors: d.uniqueVisitors,
      })),
      processingByDay: Object.entries(processingMap).map(([date, data]) => ({
        date,
        ...data,
      })),
      visitorsByCountry,
      visitorLocations: visitorLocations.filter(v => v.lat !== 0 && v.lon !== 0).map(v => ({
        city: v.city,
        country: v.country,
        countryCode: v.countryCode,
        hits: v.hits,
        lat: v.lat,
        lon: v.lon,
      })),
      recentBooks: recentBooks.map((b) => ({
        title: b.title,
        author: b.author,
        created_at: b.created_at,
        pages_count: b.pages_count,
      })),
      modelUsage: modelUsage.map((m) => ({
        model: m._id,
        count: m.count,
      })),
      promptUsage: promptUsage.map((p) => ({
        prompt: p._id,
        count: p.count,
      })),
      costStats: {
        totalCost: costStats.totalCost,
        totalTokens: costStats.totalTokens,
        costByDay: costStats.costByDay,
        costByAction: costStats.costByAction,
      },
      collectionStats,
      pipelineHealth,
      query: { days },
    });
  } catch (error) {
    console.error('Error fetching usage analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch usage analytics', details: String(error) },
      { status: 500 }
    );
  }
}
