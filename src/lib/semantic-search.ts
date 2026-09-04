import { supabase } from '@/lib/supabase';
import { expandLanguages } from '@/lib/language-utils';

/**
 * Thrown when a semantic-search RPC fails. Do NOT swallow this into an empty
 * result set.
 *
 * Why this class exists: every RPC here used to `console.error(...)` and
 * `return []` on failure, which makes a database fault indistinguishable from
 * "nothing matched". That is not hypothetical — it hid a completely undeployed
 * `match_semantic` function for months (see the header of
 * `scripts/migration/add-match-semantic-rpc.sql`: the lib "catches the error and
 * returns []"), and in Aug 2026 it caused a language filter returning zero rows
 * to be misdiagnosed as a filter bug when the filter was working correctly.
 *
 * An empty array is an *answer*. An error is not. Callers that genuinely want to
 * degrade (multi-lane search, the librarian) already wrap these calls in
 * try/catch and drop the lane; the API routes surface it as a 500. Both are
 * correct — what was wrong was the callee deciding silently on their behalf.
 *
 * Note `getQueryEmbedding` returning null is NOT this case: Gemini being absent
 * is a documented degrade to keyword-only search, and still returns [].
 */
export class SemanticSearchError extends Error {
  constructor(public readonly rpc: string, message: string) {
    super(`[semantic-search] ${rpc} failed: ${message}`);
    this.name = 'SemanticSearchError';
  }
}

/**
 * Generate query embedding via Gemini embedding-2-preview.
 * Must use the same model as the backfill (embed-gemini.mjs / backfill-book-embeddings.mjs).
 * Returns null if Gemini is unavailable (search degrades to keyword-only).
 */
// usage-ok: an embedding response carries no usageMetadata — there is no token
// count to record from it. What embedding costs is measured on the writer side
// instead (#4162, scripts/lib/embedding-usage.mjs); the two calls in this file
// are one short query embedding per search.
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
    throw new SemanticSearchError('match_books_semantic', error.message);
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
 * Stored as halfvec(3072) on Supabase so HNSW indexing works (vector_cosine_ops
 * caps at 2000 dims; halfvec_cosine_ops supports up to 4000). The RPC parameter
 * is declared halfvec; pg auto-parses the JSON.stringify'd array on the wire.
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
    throw new SemanticSearchError('match_artworks_semantic', error.message);
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
  /**
   * Which TEXT to search — an ISO code. `'en'` (the default) reads
   * `page_translations`; anything else reads the language-keyed `page_texts`
   * store via `match_page_texts` (#4095).
   *
   * Do not confuse this with `language` / `languages` / `excludeLanguages`,
   * which filter by the BOOK's edition language and keep that meaning on every
   * surface (`search-filters-and-lanes.md`). `textLang: 'es'` with
   * `language: 'Latin'` is a coherent query: the Spanish translation of Latin
   * editions.
   */
  textLang?: string;
}

/**
 * The default text language. A store keyed by language needs a name for the
 * unkeyed English one, and `page_translations` is it.
 */
export const DEFAULT_TEXT_LANG = 'en';

/** True when this request should read the language-keyed store rather than English. */
export function usesLangStore(textLang: string | undefined | null): boolean {
  return !!textLang && textLang !== DEFAULT_TEXT_LANG;
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

  // Over-request only for maxPerBook (JS post-hoc). Language filters (singular,
  // plural, exclude) now resolve in SQL via the seq-scan branch in match_semantic,
  // so no over-fetch is needed for them.
  const overRequest = (opts.maxPerBook ?? 0) > 0 ? Math.min(limit * 3, 50) : limit;

  const expandedLanguages = (opts.languages?.length ?? 0) > 0 ? expandLanguages(opts.languages!) : null;
  const expandedExcludeLanguages = (opts.excludeLanguages?.length ?? 0) > 0 ? expandLanguages(opts.excludeLanguages!) : null;

  // The language-keyed store lives in its own table with its own RPC; the two
  // return identical column names on purpose, so only the call differs.
  // `page_texts` carries no tenant column — neither does `page_translations`,
  // whose RPC accepts filter_tenant_id and ignores it — so tenant scoping stays
  // where it actually happens: the books join in the caller.
  const rpc = usesLangStore(opts.textLang) ? 'match_page_texts' : 'match_semantic';
  const { data, error } = usesLangStore(opts.textLang)
    ? await supabase.rpc('match_page_texts', {
      query_embedding: JSON.stringify(queryEmbedding),
      filter_lang: opts.textLang!,
      match_threshold: 0.3,
      match_count: overRequest,
      filter_language: opts.language ?? null,
      filter_year_min: opts.yearMin ?? null,
      filter_year_max: opts.yearMax ?? null,
      filter_languages: expandedLanguages,
      filter_exclude_languages: expandedExcludeLanguages,
    })
    : await supabase.rpc('match_semantic', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: 0.3,
      match_count: overRequest,
      filter_tenant_id: opts.tenantId ?? null,
      filter_language: opts.language ?? null,
      filter_year_min: opts.yearMin ?? null,
      filter_year_max: opts.yearMax ?? null,
      filter_languages: expandedLanguages,
      filter_exclude_languages: expandedExcludeLanguages,
    });

  if (error) {
    throw new SemanticSearchError(rpc, error.message);
  }

  let rows = (data || []) as any[];

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
  /**
   * The complete stored page text, when the lane has it (the lexical
   * `page_texts` lane does). Callers that want to centre a snippet on the hit —
   * the way the Atlas lane does with its highlights — use this instead of
   * re-reading the page from Mongo. Absent on the vector lanes, whose snippet
   * is already the answer.
   */
  full_text?: string;
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
  opts?: { textLang?: string },
): Promise<SemanticPageResult[]> {
  if (bookIds.length === 0) return [];

  const queryEmbedding = await getQueryEmbedding(query);
  if (!queryEmbedding) return [];

  const rpc = usesLangStore(opts?.textLang) ? 'match_page_texts_in_books' : 'match_pages_in_books';
  const { data, error } = usesLangStore(opts?.textLang)
    ? await supabase.rpc('match_page_texts_in_books', {
      query_embedding: JSON.stringify(queryEmbedding),
      filter_lang: opts!.textLang!,
      book_ids: bookIds,
      match_threshold: 0.3,
      match_count: limit,
    })
    : await supabase.rpc('match_pages_in_books', {
      query_embedding: JSON.stringify(queryEmbedding),
      book_ids: bookIds,
      match_threshold: 0.3,
      match_count: limit,
    });

  if (error) {
    throw new SemanticSearchError(rpc, error.message);
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

// ── Lexical page search in a non-English language (#4095) ────────────

/**
 * Keyword search over `page_texts` — the language-keyed twin of the Atlas
 * Search page lane.
 *
 * WHY THIS IS POSTGRES AND NOT ATLAS. English keyword search runs on the
 * `pages_search` Atlas index (`src/lib/atlas-search.ts`), whose mapping is
 * explicit — `translation.data` and `ocr.data`, `dynamic: false`. Reaching
 * `translations.es.data` would mean editing that definition, and a definition
 * change rebuilds the whole index over 18.9M pages, on shared search capacity,
 * to gain 38K Spanish rows. The Spanish text is already in Supabase for the
 * vector lane, so a GIN index over it costs nothing and buys something Atlas
 * would not have given: real Spanish stemming («alquimia» matches «alquímico»),
 * where `pages_search` uses `lucene.standard` for every language.
 *
 * Which stemmer a language gets is decided ONCE, in the SQL function
 * `page_text_config` — the same function the write-side trigger calls — so the
 * index and the query can never disagree about it. A language Postgres has no
 * dictionary for falls back to exact-token matching rather than being stemmed
 * as something it is not.
 *
 * Returns the same row shape as the semantic lanes, so callers merge the two
 * without a second mapper.
 */
export async function lexicalPageSearchLang(
  query: string,
  textLang: string,
  limit: number = 25,
  opts?: { language?: string; yearMin?: number; yearMax?: number; bookIds?: string[] },
): Promise<SemanticPageResult[]> {
  if (!usesLangStore(textLang) || !query.trim()) return [];

  const { data, error } = await supabase.rpc('search_page_texts', {
    query_text: query,
    filter_lang: textLang,
    match_count: limit,
    filter_language: opts?.language ?? null,
    filter_year_min: opts?.yearMin ?? null,
    filter_year_max: opts?.yearMax ?? null,
    filter_book_ids: opts?.bookIds ?? null,
  });

  if (error) {
    throw new SemanticSearchError('search_page_texts', error.message);
  }

  return (data || []).map((row: Record<string, unknown>) => {
    const text = (row.translation as string) || '';
    const { snippet, type } = stripContinuityPrefix(text);
    return {
      page_id: row.page_id as string,
      book_id: row.book_id as string,
      page_number: row.page_number as number,
      snippet,
      snippet_type: type,
      score: Number(row.similarity) || 0,
      book_title: row.book_title as string,
      book_author: (row.book_author as string) ?? null,
      book_language: (row.book_language as string) ?? null,
      book_year: (row.book_year as number) ?? null,
      full_text: text,
    };
  });
}
