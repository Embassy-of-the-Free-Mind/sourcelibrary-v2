import { NextRequest, NextResponse } from 'next/server';
import { semanticBookSearch, semanticPageSearchGlobal } from '@/lib/semantic-search';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search/semantic?q=transmutation+of+metals&limit=20
 *
 * Semantic search via Supabase pgvector. Two modes:
 *  - level=book (default): book_embeddings HNSW (~17K vectors)
 *  - level=page:           page-level embeddings (~2.6M vectors) — for finding
 *                          specific passages by concept (e.g. "distributed
 *                          cognition" → active intellect, art of memory passages).
 *
 * Replaces the broken hybrid_search on 3M+ page_translations (issue #1158).
 *
 * Query params:
 *   q             — search query (required)
 *   level         — 'book' (default) or 'page'
 *   limit         — max results (default 20, max 50)
 *   language      — filter by language (book-level only)
 *   year_min      — filter by minimum year (book + page level)
 *   year_max      — filter by maximum year (book + page level)
 *   max_per_book  — page-level only: cap on passages from any single book
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim();
  const level = searchParams.get('level') === 'page' ? 'page' : 'book';
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
  const language = searchParams.get('language') || undefined;
  const languagesParam = searchParams.get('languages');
  const excludeLanguagesParam = searchParams.get('exclude_languages');
  const languages = languagesParam ? languagesParam.split(',').map(l => l.trim()).filter(Boolean) : undefined;
  const excludeLanguages = excludeLanguagesParam ? excludeLanguagesParam.split(',').map(l => l.trim()).filter(Boolean) : undefined;
  const yearMin = searchParams.get('year_min') ? parseInt(searchParams.get('year_min')!, 10) : undefined;
  const yearMax = searchParams.get('year_max') ? parseInt(searchParams.get('year_max')!, 10) : undefined;
  const maxPerBook = searchParams.get('max_per_book') ? parseInt(searchParams.get('max_per_book')!, 10) : undefined;

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [], query: '' });
  }

  // Strip surrounding quotes for semantic search (embedding doesn't need them)
  const searchQuery = /^".*"$/.test(query) ? query.slice(1, -1) : query;

  if (level === 'page') {
    try {
      const pages = await semanticPageSearchGlobal(searchQuery, limit, { language, languages, excludeLanguages, yearMin, yearMax, maxPerBook });
      const bookIds = [...new Set(pages.map(p => p.book_id))];
      let slugMap: Record<string, string> = {};
      if (bookIds.length > 0) {
        try {
          const db = await getDb();
          const books = await db.collection('books').find(
            { id: { $in: bookIds } },
            { projection: { id: 1, slug: 1 } }
          ).toArray();
          for (const b of books) if (b.id && b.slug) slugMap[b.id as string] = b.slug as string;
        } catch { /* slug enrichment is best-effort */ }
      }
      const enriched = pages.map(p => ({
        ...p,
        slug: slugMap[p.book_id] || null,
      }));
      return NextResponse.json({
        results: enriched,
        query,
        total: enriched.length,
        mode: 'semantic',
        level: 'page',
      }, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
      });
    } catch (error) {
      console.error('[semantic-search] page-level error:', error);
      return NextResponse.json(
        { error: 'Search failed', results: [], query },
        { status: 500 }
      );
    }
  }

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
