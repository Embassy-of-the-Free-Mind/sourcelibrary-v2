import { NextRequest, NextResponse } from 'next/server';
import { semanticBookSearch } from '@/lib/semantic-search';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search/semantic?q=transmutation+of+metals&limit=20
 *
 * Book-level semantic search via book_embeddings table (HNSW, ~17K vectors).
 * Replaces the broken hybrid_search on 3M+ page_translations (issue #1158).
 *
 * Query params:
 *   q        — search query (required)
 *   limit    — max results (default 20, max 50)
 *   language — filter by language
 *   year_min — filter by minimum year
 *   year_max — filter by maximum year
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
  const language = searchParams.get('language') || undefined;
  const yearMin = searchParams.get('year_min') ? parseInt(searchParams.get('year_min')!, 10) : undefined;
  const yearMax = searchParams.get('year_max') ? parseInt(searchParams.get('year_max')!, 10) : undefined;

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [], query: '' });
  }

  // Strip surrounding quotes for semantic search (embedding doesn't need them)
  const searchQuery = /^".*"$/.test(query) ? query.slice(1, -1) : query;

  try {
    const books = await semanticBookSearch(searchQuery, limit, {
      language,
      yearMin,
      yearMax,
    });

    // Enrich with thumbnail + slug from MongoDB
    const bookIds = books.map(b => b.book_id);
    let thumbnailMap: Record<string, { thumbnail?: string; thumbnail_blob?: string; slug?: string }> = {};
    if (bookIds.length > 0) {
      try {
        const db = await getDb();
        const mongoBooks = await db.collection('books').find(
          { id: { $in: bookIds } },
          { projection: { id: 1, _id: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, slug: 1 } }
        ).toArray();
        for (const mb of mongoBooks) {
          const bid = mb.id || mb._id?.toString();
          if (bid) thumbnailMap[bid] = { thumbnail: mb.thumbnail, thumbnail_blob: mb.thumbnail_blob, slug: mb.slug };
        }
      } catch (e) {
        // Non-fatal — results still work without thumbnails
      }
    }

    // Filter out low-similarity results that are effectively random matches.
    // Calibrated 2026-04-23: real queries score 0.67+, nonsense scores 0.57-0.63.
    // Use a relaxed floor (0.55) since this endpoint is called as a fallback —
    // the search page only shows these when keyword search returned nothing.
    const SEMANTIC_SIM_FLOOR = 0.55;
    const enriched = books
      .filter(b => b.similarity >= SEMANTIC_SIM_FLOOR)
      .map(b => ({
        ...b,
        thumbnail: thumbnailMap[b.book_id]?.thumbnail || null,
        thumbnail_blob: thumbnailMap[b.book_id]?.thumbnail_blob || null,
        slug: thumbnailMap[b.book_id]?.slug || b.book_id,
      }));

    return NextResponse.json({
      results: enriched,
      query,
      total: enriched.length,
      mode: 'semantic',
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    console.error('[semantic-search] Error:', error);
    return NextResponse.json(
      { error: 'Search failed', results: [], query },
      { status: 500 }
    );
  }
}
