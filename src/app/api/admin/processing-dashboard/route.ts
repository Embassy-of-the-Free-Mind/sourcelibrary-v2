import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Processing Dashboard
 * GET /api/admin/processing-dashboard
 *
 * Returns campaign-level metrics:
 * - Progress: Books by OCR/translation completion tier, filterable by provider
 * - Costs: Total spend this week/month from gemini_usage
 * - Errors: Top error categories (last 7 days)
 * - Velocity: Pages processed per day (last 7 days)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider'); // Optional: filter by image_source.provider

    const db = await getDb();
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // --- Progress: Books by completion tier ---
    const bookMatch: Record<string, unknown> = {};
    if (provider) {
      bookMatch['image_source.provider'] = provider;
    }

    const [ocrTiers, translationTiers] = await Promise.all([
      db.collection('books').aggregate([
        { $match: bookMatch },
        {
          $project: {
            ocr_pct: {
              $cond: {
                if: { $or: [{ $eq: ['$pages_count', null] }, { $eq: ['$pages_count', 0] }] },
                then: 0,
                else: { $multiply: [{ $divide: [{ $ifNull: ['$pages_ocr', 0] }, '$pages_count'] }, 100] }
              }
            }
          }
        },
        {
          $bucket: {
            groupBy: '$ocr_pct',
            boundaries: [0, 1, 50, 100, 101],
            default: 'other',
            output: { count: { $sum: 1 } }
          }
        }
      ]).toArray(),

      db.collection('books').aggregate([
        { $match: bookMatch },
        {
          $project: {
            trans_pct: { $ifNull: ['$translation_percent', 0] }
          }
        },
        {
          $bucket: {
            groupBy: '$trans_pct',
            boundaries: [0, 1, 50, 100, 101],
            default: 'other',
            output: { count: { $sum: 1 } }
          }
        }
      ]).toArray(),
    ]);

    function tierLabel(id: number | string): string {
      if (id === 0) return '0%';
      if (id === 1) return '1-49%';
      if (id === 50) return '50-99%';
      if (id === 100) return '100%';
      return 'other';
    }

    const progress = {
      ocr: Object.fromEntries(ocrTiers.map(t => [tierLabel(t._id), t.count])),
      translation: Object.fromEntries(translationTiers.map(t => [tierLabel(t._id), t.count])),
    };

    // --- Costs: This week and this month ---
    const [weekCosts, monthCosts] = await Promise.all([
      db.collection('gemini_usage').aggregate([
        { $match: { timestamp: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: null,
            total_cost_usd: { $sum: '$cost_usd' },
            total_calls: { $sum: 1 },
            total_input_tokens: { $sum: '$input_tokens' },
            total_output_tokens: { $sum: '$output_tokens' },
          }
        }
      ]).toArray(),

      db.collection('gemini_usage').aggregate([
        { $match: { timestamp: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: null,
            total_cost_usd: { $sum: '$cost_usd' },
            total_calls: { $sum: 1 },
            total_input_tokens: { $sum: '$input_tokens' },
            total_output_tokens: { $sum: '$output_tokens' },
          }
        }
      ]).toArray(),
    ]);

    const costs = {
      last_7_days: weekCosts[0] || { total_cost_usd: 0, total_calls: 0, total_input_tokens: 0, total_output_tokens: 0 },
      last_30_days: monthCosts[0] || { total_cost_usd: 0, total_calls: 0, total_input_tokens: 0, total_output_tokens: 0 },
    };
    // Remove MongoDB _id from cost objects
    delete costs.last_7_days._id;
    delete costs.last_30_days._id;

    // --- Errors: Top categories (last 7 days) ---
    const errorStats = await db.collection('gemini_usage').aggregate([
      { $match: { timestamp: { $gte: sevenDaysAgo }, status: 'failed' } },
      {
        $group: {
          _id: { $ifNull: ['$error_category', 'unknown'] },
          count: { $sum: 1 },
          latest_message: { $last: '$error_message' },
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray();

    const errors = errorStats.map(e => ({
      category: e._id,
      count: e.count,
      latest_message: e.latest_message,
    }));

    // --- Velocity: Pages per day (last 7 days) ---
    const velocityStats = await db.collection('gemini_usage').aggregate([
      { $match: { timestamp: { $gte: sevenDaysAgo }, status: 'success' } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            type: '$type',
          },
          pages: { $sum: { $ifNull: ['$page_count', 1] } },
        }
      },
      { $sort: { '_id.date': 1 } },
    ]).toArray();

    // Reshape: { "2025-01-15": { ocr: 50, translate: 30 }, ... }
    const velocity: Record<string, Record<string, number>> = {};
    for (const v of velocityStats) {
      const date = v._id.date;
      if (!velocity[date]) velocity[date] = {};
      velocity[date][v._id.type] = v.pages;
    }

    return NextResponse.json({
      generated_at: now.toISOString(),
      provider_filter: provider || 'all',
      progress,
      costs,
      errors,
      velocity,
    });
  } catch (error) {
    console.error('[processing-dashboard] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate dashboard' },
      { status: 500 }
    );
  }
}
