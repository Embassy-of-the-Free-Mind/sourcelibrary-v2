import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { resolveTenantId } from '@/lib/tenant-context';

// In-memory cache for global stats (called on every page load via footer)
let globalStatsCache: { key: string; data: Record<string, unknown>; timestamp: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get analytics stats
 *
 * GET /api/analytics/stats
 * Query params:
 *   - book_id: optional, get stats for specific book
 *   - global: if true, get global stats
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tenant: string }> }
) {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('book_id');
    const { tenant } = await context.params;
    const tenantId = await resolveTenantId(tenant);

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const db = await getReadDb();

    if (bookId) {
      // Get stats for specific book
      const book = await db.collection('books').findOne(
        { id: bookId, tenantId },
        { projection: { read_count: 1, edit_count: 1 } }
      );

      return NextResponse.json({
        book_id: bookId,
        reads: book?.read_count || 0,
        edits: book?.edit_count || 0,
      });
    }

    // Return cached global stats if fresh
    const cacheKey = tenantId;
    if (globalStatsCache && globalStatsCache.key === cacheKey && (Date.now() - globalStatsCache.timestamp) < CACHE_TTL_MS) {
      return NextResponse.json(globalStatsCache.data, {
        headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
      });
    }

    // Get global stats - fast queries only (called on every page load via footer)
    // Uses cached pages_translated from books instead of scanning 916k pages
    const [bookStats, totalBooks, totalPages] = await Promise.all([
      db.collection('books').aggregate([
        { $match: { tenantId, visible: true, pages_count: { $gt: 0 } } },
        { $group: {
          _id: null,
          totalReads: { $sum: '$read_count' },
          totalEdits: { $sum: '$edit_count' },
          pagesTranslated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        } }
      ]).toArray(),
      db.collection('books').countDocuments({ tenantId, visible: true, pages_count: { $gt: 0 } }),
      db.collection('pages').countDocuments({ tenantId }),
    ]);
    const pagesTranslated = bookStats[0]?.pagesTranslated || 0;

    const data = {
      global: true,
      totalReads: bookStats[0]?.totalReads || 0,
      totalEdits: bookStats[0]?.totalEdits || 0,
      totalBooks,
      totalPages,
      pagesTranslated,
    };

    globalStatsCache = { key: cacheKey, data, timestamp: Date.now() };

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('Analytics stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
