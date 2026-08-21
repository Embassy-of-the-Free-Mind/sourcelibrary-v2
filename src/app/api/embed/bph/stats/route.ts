import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';

export const revalidate = 3600; // Cache for 1 hour

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Tell Vercel/Cloudflare to serve the stale value while regenerating in
// background. Without this, the first user after a deploy (or after the
// 1-hour ISR window expires) eats the full cold-rebuild latency — which on
// this endpoint was 8–12s for the BPH iframe. With stale-while-revalidate,
// users see the previous value instantly and the new value fills in for
// the next request.
const CACHE_HEADERS = {
  ...CORS_HEADERS,
  'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
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
 *
 * Previously this ran 4 parallel MongoDB queries (2 countDocuments, distinct,
 * aggregate). The `pages_translated > 0` countDocuments wasn't covered by
 * the held_by_visible_pages index and had to FETCH every BPH book — the
 * single slowest call (~1s locally, multi-second cold on Vercel). All four
 * are now folded into one aggregation that walks the index once and emits
 * every metric in a single $group stage.
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

    const [aggResult, catalogResult] = await Promise.all([
      books.aggregate([
        { $match: bphFilter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            translated: {
              $sum: { $cond: [{ $gt: ['$pages_translated', 0] }, 1, 0] },
            },
            pages_total: { $sum: '$pages_count' },
            pages_translated: { $sum: '$pages_translated' },
            languages: { $addToSet: '$language' },
          },
        },
      ]).toArray(),
      supabase.from('bph_works').select('*', { count: 'exact', head: true }),
    ]);

    const row = aggResult[0] || {
      total: 0,
      translated: 0,
      pages_total: 0,
      pages_translated: 0,
      languages: [],
    };
    const languageList = (row.languages as Array<string | null | undefined> | undefined ?? [])
      .filter((l): l is string => Boolean(l))
      .sort();

    return NextResponse.json({
      catalog_total: catalogResult.count || 0,
      digitized: row.total,
      // Keep 'total' for backwards compat with existing consumers
      total: row.total,
      translated: row.translated,
      languages: languageList.length,
      language_list: languageList,
      pages_total: row.pages_total,
      pages_translated: row.pages_translated,
    }, { headers: CACHE_HEADERS });
  } catch (error) {
    console.error('BPH stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
