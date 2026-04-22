import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';

export const revalidate = 3600; // Cache for 1 hour

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/embed/bph/stats
 *
 * Returns aggregate stats for BPH collection:
 * - catalog_total: total works in BPH catalog (Supabase bph_works)
 * - digitized: digitized books on Source Library
 * - translated: books with at least one translated page
 * - languages: number of distinct original languages
 * - pages_total: total pages across all BPH books
 * - pages_translated: total translated pages
 */
export async function GET() {
  try {
    const db = await getReadDb();
    const books = db.collection('books');

    const bphFilter = {
      held_by: 'bph',
      visible: true,
      pages_count: { $gt: 0 },
    };

    const [totalResult, translatedResult, languagesResult, pagesResult, catalogResult] = await Promise.all([
      books.countDocuments(bphFilter),
      books.countDocuments({ ...bphFilter, pages_translated: { $gt: 0 } }),
      books.distinct('language', bphFilter),
      books.aggregate([
        { $match: bphFilter },
        {
          $group: {
            _id: null,
            pages_total: { $sum: '$pages_count' },
            pages_translated: { $sum: '$pages_translated' },
          },
        },
      ]).toArray(),
      supabase.from('bph_works').select('*', { count: 'exact', head: true }),
    ]);

    const pageStats = pagesResult[0] || { pages_total: 0, pages_translated: 0 };

    return NextResponse.json({
      catalog_total: catalogResult.count || 0,
      digitized: totalResult,
      // Keep 'total' for backwards compat with existing consumers
      total: totalResult,
      translated: translatedResult,
      languages: languagesResult.filter(Boolean).length,
      language_list: languagesResult.filter(Boolean).sort(),
      pages_total: pageStats.pages_total,
      pages_translated: pageStats.pages_translated,
    }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('BPH stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
