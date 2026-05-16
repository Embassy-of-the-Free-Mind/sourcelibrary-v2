import { supabase } from '@/lib/supabase';
import { expandLanguages } from '@/lib/language-utils';

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
  opts?: { language?: string; yearMin?: number; yearMax?: number; threshold?: number; tenantId?: string }
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

// ── Artwork semantic search (separate table, 3072 dims) ──────────────

export interface SemanticArtworkResult {
  book_id: string;
  title: string;
  display_title: string | null;
  author: string | null;
  summary_text: string | null;
  subjects: string[];
  figures: string[];
  symbols: string[];
  iconclass: string[];
  technique: string | null;
  period: string | null;
  culture: string | null;
  genre: string | null;
  collections: string[];
  resource_type: string | null;
  thumbnail_url: string | null;
  similarity: number;
}

/**
 * Full-dimensional query embedding (3072) for artwork_embeddings table.
 * Book embeddings truncate to 768 via outputDimensionality; artworks use full 3072.
 */
async function getQueryEmbeddingFull(query: string): Promise<number[] | null> {
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
            // No outputDimensionality — full 3072 dims for artwork_embeddings
          }],
        }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.embeddings?.[0]?.values) return data.embeddings[0].values;
    }
  } catch { /* Gemini unavailable */ }
  return null;
}

/**
 * Semantic artwork search via artwork_embeddings table.
 * Separate from book search — different embedding text composition,
 * structured metadata (subjects, figures, symbols, iconclass),
 * and filterable by genre/period/culture/collection.
 */
export async function semanticArtworkSearch(
  query: string,
  limit: number = 20,
  opts?: { genre?: string; period?: string; culture?: string; collection?: string; threshold?: number }
): Promise<SemanticArtworkResult[]> {
  const queryEmbedding = await getQueryEmbeddingFull(query);
  if (!queryEmbedding) return [];

  const { data, error } = await supabase.rpc('match_artworks_semantic', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: opts?.threshold ?? 0.3,
    match_count: limit,
    filter_genre: opts?.genre ?? null,
    filter_period: opts?.period ?? null,
    filter_culture: opts?.culture ?? null,
    filter_collection: opts?.collection ?? null,
  });

  if (error) {
    console.error('[semantic-search] match_artworks_semantic error:', error.message);
    return [];
  }

  return (data || []).map((row: any) => ({
    book_id: row.book_id,
    title: row.title,
    display_title: row.display_title,
    author: row.author,
    summary_text: row.summary_text,
    subjects: row.subjects || [],
    figures: row.figures || [],
    symbols: row.symbols || [],
    iconclass: row.iconclass || [],
    technique: row.technique,
    period: row.period,
    culture: row.culture,
    genre: row.genre,
    collections: row.collections || [],
    resource_type: row.resource_type,
    thumbnail_url: row.thumbnail_url,
    similarity: Number(row.similarity) || 0,
  }));
}

// ── Global page-level semantic search ────────────────────────────────

/**
 * Translations from books processed through the multi-page pipeline can begin
 * with an AI-written "Continuity:" preamble — a 1-3 sentence summary of what
 * came before, separated from the real verbatim translation by a markdown
 * heading. Snippets that lead with this preamble look quotable but aren't;
 * worse, the slice(0, 300) often truncates entirely inside the preamble so
 * the actual source text never surfaces.
 *
 * We try to detect the boundary (a heading marker like `. # `, `. -># `, or
 * an ALL-CAPS chapter title) and trim past it. When detected the snippet is
 * still verbatim translation. When not detected we keep the original text but
 * tag the snippet as 'summary' so consumers don't quote AI prose as source.
 */
function stripContinuityPrefix(text: string): { snippet: string; type: 'translation' | 'summary' } {
  if (!text) return { snippet: '', type: 'translation' };
  if (!/^Continuity:\s/i.test(text)) return { snippet: text.slice(0, 300), type: 'translation' };

  const head = text.slice(0, 1000);
  // Heading markers, in order of specificity:
  //   . # Heading  /  . ## Heading  /  . ### Heading
  //   . ->#  Heading  (arrow-prefixed markdown heading)
  //   . PART ONE.  /  . CHAPTER XII.  (ALL-CAPS chapter title)
  //   . 1.  /  . 23.  (numbered section)
  const headingMatch = head.match(/\.\s+(?:->#{1,4}\s|#{1,4}\s|[A-Z][A-Z\s']{3,}\.\s|\d+\.\s)/);
  if (headingMatch && headingMatch.index !== undefined) {
    const stripped = text.slice(headingMatch.index + 1).trimStart();
    return { snippet: stripped.slice(0, 300), type: 'translation' };
  }
  return { snippet: text.slice(0, 300), type: 'summary' };
}

export interface SemanticPageSearchOptions {
  yearMin?: number;
  yearMax?: number;
  maxPerBook?: number;
  tenantId?: string;
  language?: string;
  languages?: string[];
  excludeLanguages?: string[];
}

/**
 * Global page-level semantic search via match_semantic RPC.
 * Now that all 3.9M pages have embeddings, this finds specific passages
 * that book-level search misses (e.g. Martial's "masturbator" epigram
 * inside a 400-page book about Roman wit).
 *
 * yearMin / yearMax / maxPerBook are applied post-hoc in JS because the
 * underlying RPC doesn't accept these filters. We over-request from Supabase
 * (3x the requested limit, capped at 50 — the RPC's hard ceiling) so that
 * filtering still yields close to the requested count when filters are tight.
 *
 * The `tenantId` parameter is accepted as the 2nd positional arg for backward
 * compatibility with earlier callers that passed (query, limit, tenantId).
 */
export async function semanticPageSearchGlobal(
  query: string,
  limit: number = 15,
  optsOrTenantId?: SemanticPageSearchOptions | string,
): Promise<SemanticPageResult[]> {
  const opts: SemanticPageSearchOptions =
    typeof optsOrTenantId === 'string' ? { tenantId: optsOrTenantId } : (optsOrTenantId || {});
  const queryEmbedding = await getQueryEmbedding(query);
  if (!queryEmbedding) return [];

  // Over-request when post-hoc JS filtering is needed (maxPerBook, languages, excludeLanguages).
  const needsPostHocFilter = (opts.maxPerBook ?? 0) > 0 || (opts.languages?.length ?? 0) > 0 || (opts.excludeLanguages?.length ?? 0) > 0;
  const overRequest = needsPostHocFilter ? Math.min(limit * 3, 50) : limit;

  const { data, error } = await supabase.rpc('match_semantic', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: 0.3,
    match_count: overRequest,
    filter_tenant_id: opts.tenantId ?? null,
    filter_language: opts.language ?? null,
    filter_year_min: opts.yearMin ?? null,
    filter_year_max: opts.yearMax ?? null,
  });

  if (error) {
    console.error('[semantic-search] match_semantic error:', error.message);
    return [];
  }

  let rows = (data || []) as any[];

  if ((opts.languages?.length ?? 0) > 0) {
    const set = new Set(expandLanguages(opts.languages!).map(l => l.toLowerCase()));
    rows = rows.filter(r => r.book_language && set.has(String(r.book_language).toLowerCase()));
  }
  if ((opts.excludeLanguages?.length ?? 0) > 0) {
    const set = new Set(expandLanguages(opts.excludeLanguages!).map(l => l.toLowerCase()));
    rows = rows.filter(r => !r.book_language || !set.has(String(r.book_language).toLowerCase()));
  }
  if ((opts.maxPerBook ?? 0) > 0) {
    const perBook = new Map<string, number>();
    rows = rows.filter(r => {
      const n = (perBook.get(r.book_id) || 0) + 1;
      perBook.set(r.book_id, n);
      return n <= opts.maxPerBook!;
    });
  }

  return rows.slice(0, limit).map((row) => {
    const { snippet, type } = stripContinuityPrefix(row.translation || '');
    return {
      page_id: row.page_id,
      book_id: row.book_id,
      page_number: row.page_number,
      snippet,
      snippet_type: type,
      score: Number(row.similarity) || 0,
      book_title: row.book_title,
      book_author: row.book_author,
      book_language: row.book_language,
      book_year: row.book_year,
    };
  });
}

// ── Page-level scoped search (step 2: within specific books) ────────

export interface SemanticPageResult {
  page_id: string;
  book_id: string;
  page_number: number;
  snippet: string;
  // 'translation' = verbatim source text (safe to quote)
  // 'summary'     = AI-written continuity preamble that we could not cleanly strip
  snippet_type?: 'translation' | 'summary';
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

  return (data || []).map((row: any) => {
    const { snippet, type } = stripContinuityPrefix(row.translation || '');
    return {
      page_id: row.page_id,
      book_id: row.book_id,
      page_number: row.page_number,
      snippet,
      snippet_type: type,
      score: Number(row.similarity) || 0,
      book_title: row.book_title,
      book_author: row.book_author,
      book_language: row.book_language,
      book_year: row.book_year,
    };
  });
}
