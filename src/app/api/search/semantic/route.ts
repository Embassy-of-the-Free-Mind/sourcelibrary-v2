import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search/semantic?q=how+to+transmute+metals&limit=20
 *
 * Hybrid semantic + keyword search across translated pages.
 * Uses pgvector (semantic similarity) + tsvector (keyword matching)
 * in a single Supabase query for ranked results.
 *
 * Query params:
 *   q      — search query (required)
 *   limit  — max results (default 20, max 50)
 *   kw     — keyword weight 0-1 (default 0.4)
 *   sem    — semantic weight 0-1 (default 0.6)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
  const keywordWeight = Math.max(0, Math.min(1, parseFloat(searchParams.get('kw') || '0.4')));
  const semanticWeight = Math.max(0, Math.min(1, parseFloat(searchParams.get('sem') || '0.6')));

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [], query: '' });
  }

  try {
    // Generate query embedding server-side
    const queryEmbedding = await getQueryEmbedding(query);

    if (!queryEmbedding) {
      // Fall back to keyword-only search if embedding fails
      return keywordOnlySearch(query, limit);
    }

    // Call hybrid search function
    const { data, error } = await supabase.rpc('hybrid_search', {
      query_text: query,
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: limit,
      keyword_weight: keywordWeight,
      semantic_weight: semanticWeight,
    });

    if (error) {
      console.error('[semantic-search] Supabase error:', error.message);
      return keywordOnlySearch(query, limit);
    }

    // Group by book for better UX
    interface PageResult {
      page_id: string;
      page_number: number;
      snippet: string;
      score: number;
      keyword_rank: number;
      semantic_distance: number;
    }

    interface BookGroup {
      book_id: string;
      book_title: string;
      book_author: string | null;
      book_language: string | null;
      book_year: number | null;
      pages: PageResult[];
      best_score: number;
    }

    const bookGroups = new Map<string, BookGroup>();

    for (const row of (data || [])) {
      const group: BookGroup = bookGroups.get(row.book_id) || {
        book_id: row.book_id,
        book_title: row.book_title,
        book_author: row.book_author,
        book_language: row.book_language,
        book_year: row.book_year,
        pages: [],
        best_score: 0,
      };

      group.pages.push({
        page_id: row.page_id,
        page_number: row.page_number,
        snippet: row.translation || '',
        score: Number(row.score) || 0,
        keyword_rank: Number(row.keyword_rank) || 0,
        semantic_distance: Number(row.semantic_distance) || 1,
      });

      group.best_score = Math.max(group.best_score, Number(row.score) || 0);
      bookGroups.set(row.book_id, group);
    }

    // Sort books by best page score
    const results = Array.from(bookGroups.values())
      .sort((a, b) => b.best_score - a.best_score);

    return NextResponse.json({
      results,
      query,
      total: data?.length || 0,
      mode: 'hybrid',
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

/**
 * Generate query embedding via the Hetzner embedding server.
 * Uses multilingual-e5-base (same model as the backfill).
 * Cost: $0 (local model on Hetzner).
 */
async function getQueryEmbedding(query: string): Promise<number[] | null> {
  const embedUrl = process.env.EMBED_URL || 'http://46.224.122.120:3456';
  try {
    const res = await fetch(`${embedUrl}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: [query], task: 'query' }),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data?.embeddings?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Fallback: keyword-only search via tsvector
 */
async function keywordOnlySearch(query: string, limit: number) {
  const { data, error } = await supabase
    .from('page_translations')
    .select('page_id, book_id, page_number, translation, book_title, book_author, book_language, book_year')
    .textSearch('tsv', query, { type: 'websearch' })
    .limit(limit);

  if (error) {
    return NextResponse.json({ results: [], query, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    results: (data || []).map(r => ({
      book_id: r.book_id,
      book_title: r.book_title,
      book_author: r.book_author,
      pages: [{
        page_id: r.page_id,
        page_number: r.page_number,
        snippet: (r.translation || '').slice(0, 500),
        score: 1,
      }],
      best_score: 1,
    })),
    query,
    total: data?.length || 0,
    mode: 'keyword',
  });
}
