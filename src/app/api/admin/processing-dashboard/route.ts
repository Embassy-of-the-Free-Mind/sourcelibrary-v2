import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Processing Dashboard
 * GET /api/admin/processing-dashboard
 *
 * Returns campaign-level metrics:
 * - Progress: Books by OCR/translation completion tier, filterable by provider
 *   (computed from pages collection, not stale book summary fields)
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
    // Computed from actual pages data, not stale book summary fields
    const bookMatch: Record<string, unknown> = {};
    if (provider) {
      bookMatch['image_source.provider'] = provider;
    }

    const progressPipeline = [
      { $match: bookMatch },
      {
        $lookup: {
          from: 'pages',
          let: { bookId: '$id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$book_id', '$$bookId'] } } },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                has_ocr: {
                  $sum: {
                    $cond: [
                      { $and: [
                        { $ne: ['$ocr.data', null] },
                        { $ne: ['$ocr.data', ''] },
                        { $ifNull: ['$ocr.data', false] }
                      ]},
                      1, 0
                    ]
                  }
                },
                has_translation: {
                  $sum: {
                    $cond: [
                      { $and: [
                        { $ne: ['$translation.data', null] },
                        { $ne: ['$translation.data', ''] },
                        { $ifNull: ['$translation.data', false] }
                      ]},
                      1, 0
                    ]
                  }
                },
              }
            }
          ],
          as: 'page_stats'
        }
      },
      {
        $project: {
          page_stats: { $arrayElemAt: ['$page_stats', 0] },
        }
      },
      {
        $project: {
          total: { $ifNull: ['$page_stats.total', 0] },
          has_ocr: { $ifNull: ['$page_stats.has_ocr', 0] },
          has_translation: { $ifNull: ['$page_stats.has_translation', 0] },
          ocr_pct: {
            $cond: {
              if: { $or: [
                { $eq: [{ $ifNull: ['$page_stats.total', 0] }, 0] },
                { $eq: ['$page_stats', null] }
              ]},
              then: 0,
              else: { $multiply: [
                { $divide: ['$page_stats.has_ocr', '$page_stats.total'] },
                100
              ]}
            }
          },
          trans_pct: {
            $cond: {
              if: { $or: [
                { $eq: [{ $ifNull: ['$page_stats.total', 0] }, 0] },
                { $eq: ['$page_stats', null] }
              ]},
              then: 0,
              else: { $multiply: [
                { $divide: ['$page_stats.has_translation', '$page_stats.total'] },
                100
              ]}
            }
          },
        }
      },
    ];

    const booksWithStats = await db.collection('books').aggregate(progressPipeline).toArray();

    // Bucket into tiers
    function getTier(pct: number): string {
      if (pct === 0) return '0%';
      if (pct < 50) return '1-49%';
      if (pct < 100) return '50-99%';
      return '100%';
    }

    const ocrTiers: Record<string, number> = { '0%': 0, '1-49%': 0, '50-99%': 0, '100%': 0 };
    const transTiers: Record<string, number> = { '0%': 0, '1-49%': 0, '50-99%': 0, '100%': 0 };

    for (const book of booksWithStats) {
      ocrTiers[getTier(book.ocr_pct)]++;
      transTiers[getTier(book.trans_pct)]++;
    }

    const progress = {
      total_books: booksWithStats.length,
      ocr: ocrTiers,
      translation: transTiers,
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
