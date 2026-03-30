import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Pipeline velocity endpoint for the realtime monitor.
 * Returns current throughput, today's totals, hourly breakdown (24h), and daily breakdown (14d).
 * GET /api/analytics/pipeline-velocity
 */
export async function GET() {
  try {
    const db = await getDb();
    const pages = db.collection('pages');
    const now = new Date();

    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const todayStart = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    fourteenDaysAgo.setUTCHours(0, 0, 0, 0);

    const [
      ocr1h, trans1h,
      ocr6h, trans6h,
      ocrToday, transToday,
      hourlyOcr, hourlyTrans,
      dailyCosts,
    ] = await Promise.all([
      // Current velocity (1h)
      pages.countDocuments({ 'ocr.updated_at': { $gte: oneHourAgo } }),
      pages.countDocuments({ 'translation.updated_at': { $gte: oneHourAgo } }),
      // 6h for smoother rate
      pages.countDocuments({ 'ocr.updated_at': { $gte: sixHoursAgo } }),
      pages.countDocuments({ 'translation.updated_at': { $gte: sixHoursAgo } }),
      // Today
      pages.countDocuments({ 'ocr.updated_at': { $gte: todayStart } }),
      pages.countDocuments({ 'translation.updated_at': { $gte: todayStart } }),
      // Hourly OCR (24h)
      pages.aggregate([
        { $match: { 'ocr.updated_at': { $gte: twentyFourHoursAgo } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%dT%H', date: '$ocr.updated_at' } },
          count: { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]).toArray(),
      // Hourly Translation (24h)
      pages.aggregate([
        { $match: { 'translation.updated_at': { $gte: twentyFourHoursAgo } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%dT%H', date: '$translation.updated_at' } },
          count: { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]).toArray(),
      // Daily costs (14d) from pre-aggregated collection
      db.collection('gemini_usage_daily')
        .find({ date: { $gte: fourteenDaysAgo.toISOString().slice(0, 10) } })
        .sort({ date: 1 })
        .project({ date: 1, totalCost: 1, totalCostWithBatch: 1 })
        .toArray(),
    ]);

    // Build hourly breakdown (24h)
    const hourlyOcrMap = new Map(hourlyOcr.map(h => [h._id, h.count]));
    const hourlyTransMap = new Map(hourlyTrans.map(h => [h._id, h.count]));
    const hourly = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 13);
      const hour = d.getUTCHours();
      hourly.push({
        hour,
        ocr: hourlyOcrMap.get(key) || 0,
        trans: hourlyTransMap.get(key) || 0,
      });
    }

    // Build daily breakdown (14d) — merge page counts with costs
    const costMap = new Map(dailyCosts.map(d => [d.date, d.totalCostWithBatch || d.totalCost || 0]));
    const daily = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      daily.push({
        date: dateStr,
        ocr: 0, // filled below
        trans: 0,
        cost: Math.round((costMap.get(dateStr) || 0) * 100) / 100,
      });
    }

    // Fill daily OCR/translation from hourly data where we have it,
    // or from the today/yesterday counts for the most recent days
    // For simplicity, use the daily cost map dates
    // We already have ocrToday/transToday for today
    const todayStr = now.toISOString().slice(0, 10);
    for (const day of daily) {
      if (day.date === todayStr) {
        day.ocr = ocrToday;
        day.trans = transToday;
      }
    }

    // Use 6h rate for display (smoother than 1h)
    const ocrPerHour = Math.round(ocr6h / 6);
    const transPerHour = Math.round(trans6h / 6);

    // Today's cost
    const todayCost = costMap.get(todayStr) || 0;

    // 90-day total from daily rollups
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const allCosts = await db.collection('gemini_usage_daily')
      .find({ date: { $gte: ninetyDaysAgo.toISOString().slice(0, 10) } })
      .project({ totalCost: 1, totalCostWithBatch: 1 })
      .toArray();
    const totalCost90d = allCosts.reduce((s, d) => s + (d.totalCostWithBatch || d.totalCost || 0), 0);

    return NextResponse.json({
      ocrPerHour,
      transPerHour,
      ocr1h,
      trans1h,
      ocrToday,
      transToday,
      todayCost: Math.round(todayCost * 100) / 100,
      totalCost90d: Math.round(totalCost90d * 100) / 100,
      hourly,
      daily,
    });
  } catch (error) {
    console.error('Pipeline velocity error:', error);
    return NextResponse.json({ error: 'Failed to fetch velocity data' }, { status: 500 });
  }
}
