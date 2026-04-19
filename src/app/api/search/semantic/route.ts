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

  try {
    const books = await semanticBookSearch(query, limit, {
      language,
      yearMin,
      yearMax,
    });

    // Enrich with thumbnail + slug from MongoDB
    const bookIds = books.map(b => b.book_id);
    let meta: Record<string, { thumbnail?: string; thumbnail_blob?: string; slug?: string }> = {};
    if (bookIds.length > 0) {
      try {
        const db = await getDb();
        const docs = await db.collection('books').find(
          { id: { $in: bookIds } },
          { projection: { id: 1, thumbnail: 1, thumbnail_blob: 1, slug: 1 } }
        ).toArray();
        for (const d of docs) meta[d.id] = { thumbnail: d.thumbnail, thumbnail_blob: d.thumbnail_blob, slug: d.slug };
      } catch { /* non-fatal */ }
    }

    const enriched = books.map(b => ({
      ...b,
      thumbnail: meta[b.book_id]?.thumbnail || null,
      thumbnail_blob: meta[b.book_id]?.thumbnail_blob || null,
      slug: meta[b.book_id]?.slug || b.book_id,
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
