import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;

export async function GET(request: NextRequest) {
  if (!MONGODB_URI || !MONGODB_DB) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 500 }
    );
  }

  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(MONGODB_DB);

    const collection = db.collection('analytics_pageviews');

    // Get totals
    const totalPageviews = await collection.countDocuments();
    const totalVisitors = await collection.distinct('ip');

    // Get top pages (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const topPages = await collection
      .aggregate([
        { $match: { timestamp: { $gte: thirtyDaysAgo } } },
        { $group: { _id: '$path', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .toArray();

    // Get top referrers
    const topReferrers = await collection
      .aggregate([
        { $match: { timestamp: { $gte: thirtyDaysAgo } } },
        { $group: { _id: '$referrer', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .toArray();

    // Get top countries
    const topCountries = await collection
      .aggregate([
        { $match: { timestamp: { $gte: thirtyDaysAgo } } },
        { $group: { _id: '$country', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .toArray();

    await client.close();

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
