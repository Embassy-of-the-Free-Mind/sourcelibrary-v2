import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 60;

/**
 * Processing Dashboard
 * GET /api/admin/processing-dashboard
 *
 * Returns campaign-level metrics:
 * - Progress: Books by OCR/translation completion tier (from cached book fields)
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

    // --- Run all queries in parallel ---
    const bookMatch: Record<string, unknown> = {};
    if (provider) {
      bookMatch['image_source.provider'] = provider;
    }

    const [booksWithStats, weekCosts, monthCosts, errorStats, velocityStats] = await Promise.all([
      // Progress: use cached pages_count/pages_ocr/pages_translated from books
      // (refreshed every 6h by sync-page-counts cron, updated inline by workers)
      db.collection('books')
        .find(bookMatch, {
          projection: {
            pages_count: 1, pages_ocr: 1, pages_translated: 1,
          }
        })
        .toArray(),

      // Costs: This week
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

      // Costs: This month
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

      // Errors: Top categories (last 7 days)
      db.collection('gemini_usage').aggregate([
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
      ]).toArray(),

      // Velocity: Pages per day (last 7 days)
      db.collection('gemini_usage').aggregate([
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
      ]).toArray(),
    ]);

    // Bucket books into tiers using cached fields
    function getTier(pct: number): string {
      if (pct === 0) return '0%';
      if (pct < 50) return '1-49%';
      if (pct < 100) return '50-99%';
      return '100%';
    }

    const ocrTiers: Record<string, number> = { '0%': 0, '1-49%': 0, '50-99%': 0, '100%': 0 };
    const transTiers: Record<string, number> = { '0%': 0, '1-49%': 0, '50-99%': 0, '100%': 0 };

    for (const book of booksWithStats) {
      const total = (book.pages_count as number) || 0;
      const ocr = (book.pages_ocr as number) || 0;
      const trans = (book.pages_translated as number) || 0;
      const ocrPct = total > 0 ? (ocr / total) * 100 : 0;
      const transPct = total > 0 ? (trans / total) * 100 : 0;
      ocrTiers[getTier(ocrPct)]++;
      transTiers[getTier(transPct)]++;
    }

    const progress = {
      total_books: booksWithStats.length,
      ocr: ocrTiers,
      translation: transTiers,
    };

    // Format costs
    const costs = {
      last_7_days: weekCosts[0] || { total_cost_usd: 0, total_calls: 0, total_input_tokens: 0, total_output_tokens: 0 },
      last_30_days: monthCosts[0] || { total_cost_usd: 0, total_calls: 0, total_input_tokens: 0, total_output_tokens: 0 },
    };
    delete costs.last_7_days._id;
    delete costs.last_30_days._id;

    // Format errors
    const errors = errorStats.map(e => ({
      category: e._id,
      count: e.count,
      latest_message: e.latest_message,
    }));

    // Format velocity: { "2025-01-15": { ocr: 50, translate: 30 }, ... }
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
