import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function GET(request: NextRequest) {
  try {
    const db = await getDb();
    const collection = db.collection('analytics_pageviews');

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Run all queries in parallel
    const [totalPageviews, totalVisitors, topPages, topReferrers, topCountries] = await Promise.all([
      collection.countDocuments(),
      collection.distinct('ip', { timestamp: { $gte: thirtyDaysAgo } }),
      collection.aggregate([
        { $match: { timestamp: { $gte: thirtyDaysAgo }, path: { $ne: null } } },
        { $group: { _id: '$path', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).toArray(),
      collection.aggregate([
        { $match: { timestamp: { $gte: thirtyDaysAgo } } },
        { $group: { _id: '$referrer', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).toArray(),
      collection.aggregate([
        { $match: { timestamp: { $gte: thirtyDaysAgo } } },
        { $group: { _id: '$country', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).toArray(),
    ]);

    return NextResponse.json({
      totalPageviews,
      totalVisitors: totalVisitors.length,
      topPages: topPages.map(p => ({ path: p._id, count: p.count })),
      topReferrers: topReferrers.map(r => ({ referrer: r._id, count: r.count })),
      topCountries: topCountries.map(c => ({ country: c._id, count: c.count })),
    });
  } catch (error) {
    console.error('Analytics API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}
