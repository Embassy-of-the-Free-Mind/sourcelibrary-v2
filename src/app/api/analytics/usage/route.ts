import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);

    const db = await getDb();
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(cutoffMs);

    // Get book and page counts
    const [
      totalBooks,
      totalPages,
      pagesWithOcr,
      pagesWithTranslation,
    ] = await Promise.all([
      db.collection('books').countDocuments(),
      db.collection('pages').countDocuments(),
      db.collection('pages').countDocuments({ 'ocr.data': { $exists: true, $ne: '' } }),
      db.collection('pages').countDocuments({ 'translation.data': { $exists: true, $ne: '' } }),
    ]);

    // Get unique visitors and total hits from loading_metrics
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

    const totalHits = visitorStats[0]?.totalHits || 0;
    const uniqueVisitors = visitorStats[0]?.uniqueIps?.length || 0;

    // Get hits by day for chart
    const hitsByDay = await db.collection('loading_metrics').aggregate([
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
    const processingMap: Record<string, { ocr: number; translation: number }> = {};
    for (const item of processingByDay) {
      const date = item._id.date;
      if (!processingMap[date]) {
        processingMap[date] = { ocr: 0, translation: 0 };
      }
      processingMap[date][item._id.type as 'ocr' | 'translation'] = item.count;
    }

    // Get visitor locations (country from IP - simplified, just group by IP prefix)
    const ipPrefixes = await db.collection('loading_metrics').aggregate([
      { $match: { timestamp: { $gte: cutoffMs }, ip: { $ne: 'unknown' } } },
      {
        $group: {
          _id: '$ip',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]).toArray();

    // Get recent books added
    const recentBooks = await db.collection('books')
      .find({ created_at: { $gte: cutoffDate } })
      .sort({ created_at: -1 })
      .limit(10)
      .project({ title: 1, author: 1, created_at: 1, pages_count: 1 })
      .toArray();

    // Get model usage breakdown
    const modelUsage = await db.collection('pages').aggregate([
      { $match: { 'ocr.model': { $exists: true } } },
      {
        $group: {
          _id: '$ocr.model',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]).toArray();

    // Get prompt usage breakdown
    const promptUsage = await db.collection('pages').aggregate([
      { $match: { 'ocr.prompt_name': { $exists: true } } },
      {
        $group: {
          _id: '$ocr.prompt_name',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]).toArray();

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
      topVisitors: ipPrefixes.map((v) => ({
        ip: v._id,
        hits: v.count,
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
      query: { days },
    });
  } catch (error) {
    console.error('Error fetching usage analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch usage analytics' },
      { status: 500 }
    );
  }
}
