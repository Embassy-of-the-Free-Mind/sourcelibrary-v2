import { supabase } from '@/lib/supabase';

/**
 * Generate query embedding via Gemini embedding-2-preview.
 * Must use the same model as the backfill (embed-gemini.mjs).
 * Falls back to Hetzner e5-base if Gemini fails.
 */
export async function getQueryEmbedding(query: string): Promise<number[] | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:batchEmbedContents?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              model: 'models/gemini-embedding-2-preview',
              content: { parts: [{ text: query }] },
              outputDimensionality: 768,
            }],
          }),
          signal: AbortSignal.timeout(5000),
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.embeddings?.[0]?.values) return data.embeddings[0].values;
      }
    } catch {
      // Fall through to Hetzner fallback
    }
  }

  // Fallback: Hetzner e5-base (for legacy embeddings or if Gemini is down)
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

export interface SemanticPageResult {
  page_id: string;
  book_id: string;
  page_number: number;
  snippet: string;
  score: number;
  book_title: string;
  book_author: string | null;
  book_language: string | null;
  book_year: number | null;
}

/**
 * Run hybrid semantic + keyword search on page_translations.
 * Returns flat page results (not grouped by book) for easy merging.
 */
export async function semanticPageSearch(
  query: string,
  limit: number = 20,
  opts?: { keywordWeight?: number; semanticWeight?: number }
): Promise<SemanticPageResult[]> {
  const keywordWeight = opts?.keywordWeight ?? 0.3;
  const semanticWeight = opts?.semanticWeight ?? 0.7;

  const queryEmbedding = await getQueryEmbedding(query);
  if (!queryEmbedding) return [];

  const { data, error } = await supabase.rpc('hybrid_search', {
    query_text: query,
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: limit,
    keyword_weight: keywordWeight,
    semantic_weight: semanticWeight,
  });

  if (error) {
    console.error('[semantic-search] Supabase hybrid_search error:', error.message);
    return [];
  }

  return (data || []).map((row: any) => ({
    page_id: row.page_id,
    book_id: row.book_id,
    page_number: row.page_number,
    snippet: (row.translation || '').slice(0, 300),
    score: Number(row.score) || 0,
    book_title: row.book_title,
    book_author: row.book_author,
    book_language: row.book_language,
    book_year: row.book_year,
  }));
}
