import { supabase } from '@/lib/supabase';

/**
 * Generate query embedding via Gemini embedding-2-preview.
 * Must use the same model as the backfill (embed-gemini.mjs / backfill-book-embeddings.mjs).
 * Returns null if Gemini is unavailable (search degrades to keyword-only).
 */
export async function getQueryEmbedding(query: string): Promise<number[] | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return null;

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
    // Gemini unavailable — search degrades to keyword-only
  }

  return null;
}

// ── Book-level semantic search (issue #1158) ────────────────────────

export interface SemanticBookResult {
  book_id: string;
  title: string;
  author: string | null;
  year: number | null;
  language: string | null;
  summary_text: string | null;
  metadata: Record<string, unknown> | null;
  similarity: number;
}

/**
 * Semantic book discovery via book_embeddings table (HNSW, ~17K rows).
 * Replaces the broken hybrid_search on 3M+ page_translations.
 */
export async function semanticBookSearch(
  query: string,
  limit: number = 20,
  opts?: { language?: string; yearMin?: number; yearMax?: number; threshold?: number }
): Promise<SemanticBookResult[]> {
  const queryEmbedding = await getQueryEmbedding(query);
  if (!queryEmbedding) return [];

  const { data, error } = await supabase.rpc('match_books_semantic', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: opts?.threshold ?? 0.3,
    match_count: limit,
    filter_language: opts?.language ?? null,
    filter_year_min: opts?.yearMin ?? null,
    filter_year_max: opts?.yearMax ?? null,
  });

  if (error) {
    console.error('[semantic-search] match_books_semantic error:', error.message);
    return [];
  }

  return (data || []).map((row: any) => ({
    book_id: row.book_id,
    title: row.title,
    author: row.author,
    year: row.year,
    language: row.language,
    summary_text: row.summary_text,
    metadata: row.metadata,
    similarity: Number(row.similarity) || 0,
  }));
}

// ── Global page-level semantic search ────────────────────────────────

/**
 * Global page-level semantic search via match_semantic RPC.
 * Now that all 2.6M pages have embeddings, this finds specific passages
 * that book-level search misses (e.g. Martial's "masturbator" epigram
 * inside a 400-page book about Roman wit).
 */
export async function semanticPageSearchGlobal(
  query: string,
  limit: number = 15,
): Promise<SemanticPageResult[]> {
  const queryEmbedding = await getQueryEmbedding(query);
  if (!queryEmbedding) return [];

  const { data, error } = await supabase.rpc('match_semantic', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: 0.3,
    match_count: limit,
  });

  if (error) {
    console.error('[semantic-search] match_semantic error:', error.message);
    return [];
  }

  return (data || []).map((row: any) => ({
    page_id: row.page_id,
    book_id: row.book_id,
    page_number: row.page_number,
    snippet: (row.translation || '').slice(0, 300),
    score: Number(row.similarity) || 0,
    book_title: row.book_title,
    book_author: row.book_author,
    book_language: row.book_language,
    book_year: row.book_year,
  }));
}

// ── Page-level scoped search (step 2: within specific books) ────────

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
 * Scoped page-level semantic search within specific books.
 * Uses match_pages_in_books RPC — scans only pages for the given book_ids
 * (200-500 pages per book, instant without a global index).
 *
 * Used as step 2 after book discovery — never searches all pages globally.
 */
export async function semanticPageSearchScoped(
  query: string,
  bookIds: string[],
  limit: number = 10,
): Promise<SemanticPageResult[]> {
  if (bookIds.length === 0) return [];

  const queryEmbedding = await getQueryEmbedding(query);
  if (!queryEmbedding) return [];

  const { data, error } = await supabase.rpc('match_pages_in_books', {
    query_embedding: JSON.stringify(queryEmbedding),
    book_ids: bookIds,
    match_threshold: 0.3,
    match_count: limit,
  });

  if (error) {
    console.error('[semantic-search] match_pages_in_books error:', error.message);
    return [];
  }

  return (data || []).map((row: any) => ({
    page_id: row.page_id,
    book_id: row.book_id,
    page_number: row.page_number,
    snippet: (row.translation || '').slice(0, 300),
    score: Number(row.similarity) || 0,
    book_title: row.book_title,
    book_author: row.book_author,
    book_language: row.book_language,
    book_year: row.book_year,
  }));
}
