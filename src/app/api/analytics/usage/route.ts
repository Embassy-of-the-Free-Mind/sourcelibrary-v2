import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// Simple in-memory cache for IP geolocation (persists for serverless function lifetime)
const geoCache: Record<string, { country: string; countryCode: string; city: string; lat: number; lon: number }> = {};

async function getGeoLocation(ip: string) {
  if (ip === 'unknown' || ip === '::1' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
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
    const visitorLocations = await Promise.all(
      uniqueIps.map(async (v) => {
        const geo = await getGeoLocation(v._id);
        return {
          ip: v._id,
          hits: v.count,
          ...geo,
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
    const visitorsByCountry = Object.values(countryMap).sort((a, b) => b.hits - a.hits);

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
