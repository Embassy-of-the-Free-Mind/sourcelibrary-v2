import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { textRoleRank } from '@/lib/text-role';
import { Book } from '@/lib/types';
import type { SearchResult, SearchResponse } from '@/lib/api-client/types/search';
import { buildPageSearchStage, NON_CONTENT_PAGE_TYPES } from '@/lib/atlas-search';
import { CONTENT_LICENSE } from '@/lib/license-info';
import { searchBookIds } from '@/lib/books-catalog';
import { semanticBookSearch, semanticPageSearchGlobal } from '@/lib/semantic-search';
import { rrfScores } from '@/lib/search/rrf';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { withApiAuth } from '@/lib/api-auth';
import { expandLanguages } from '@/lib/language-utils';
import { logSearchQuery } from '@/lib/search-log';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { logSearchEvent } from '@/lib/search-event-log';

export const preferredRegion = 'fra1';

const MAX_PAGE_RESULTS = 25;

/** Strip XML/HTML tags and clean up OCR artifacts for display */
function cleanText(text: string): string {
  return stripEditorialWrappers(text) // drop <meta>/<summary>/<keywords>/<vocab> prose first
    .replace(/<[^>]+>/g, '')        // strip remaining tags, keep inner body text
    .replace(/\*\*([^*]+)\*\*/g, '$1') // strip markdown bold
    .replace(/\s+/g, ' ')           // collapse whitespace
    .trim();
}

function extractSnippet(text: string, query: string, contextChars = 150): string {
  const cleaned = cleanText(text);
  const lowerText = cleaned.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) {
    // If exact match not found, return start of text
    return cleaned.slice(0, contextChars * 2) + (cleaned.length > contextChars * 2 ? '...' : '');
  }

  const start = Math.max(0, index - contextChars);
  const end = Math.min(cleaned.length, index + query.length + contextChars);

  let snippet = cleaned.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < cleaned.length) snippet = snippet + '...';

  return snippet;
}

// GET /api/search - Search across books and translations
export const GET = withApiAuth(async (request: NextRequest, _ctx, identity) => {
  const _searchStart = Date.now();
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const language = searchParams.get('language');
    const languagesParam = searchParams.get('languages');
    const excludeLanguagesParam = searchParams.get('exclude_languages');
    const languages = expandLanguages(languagesParam ? languagesParam.split(',').map(l => l.trim()).filter(Boolean) : []);
    const excludeLanguages = expandLanguages(excludeLanguagesParam ? excludeLanguagesParam.split(',').map(l => l.trim()).filter(Boolean) : []);
    const category = searchParams.get('category'); // Category filter
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const year = searchParams.get('year'); // Exact year filter
    const yearFrom = searchParams.get('year_from'); // Year range start
    const yearTo = searchParams.get('year_to'); // Year range end
    // date_from/date_to are publication-year bounds (the search UI's "Published
    // after/before"). They used to be applied as a STRING comparison on
    // `published` — a free-text field ("circa 1600", "[1620]", "n.d.") — where
    // the comparison silently misfires. Normalize to the numeric `year` field,
    // which is what every other surface filters on, and share one range between
    // the book lane, the page lane, and the semantic lanes.
    const parseYear = (v: string | null): number | undefined => {
      const n = parseInt(v || '', 10);
      return Number.isFinite(n) ? n : undefined;
    };
    const exactYear = parseYear(year);
    const yearMin = parseYear(yearFrom) ?? parseYear(dateFrom);
    const yearMax = parseYear(yearTo) ?? parseYear(dateTo);
    const hasYearRange = exactYear !== undefined || yearMin !== undefined || yearMax !== undefined;
    /** True when a book's year satisfies the requested range. Undated books drop out of a bounded range. */
    const yearInRange = (y: number | null | undefined): boolean => {
      if (!hasYearRange) return true;
      if (typeof y !== 'number') return false;
      if (exactYear !== undefined) return y === exactYear;
      if (yearMin !== undefined && y < yearMin) return false;
      if (yearMax !== undefined && y > yearMax) return false;
      return true;
    };
    /** Attach the year predicate to a MongoDB book-level filter object. */
    const applyYearFilter = (target: Record<string, unknown>) => {
      if (exactYear !== undefined) { target.year = exactYear; return; }
      const range: Record<string, number> = {};
      if (yearMin !== undefined) range.$gte = yearMin;
      if (yearMax !== undefined) range.$lte = yearMax;
      if (Object.keys(range).length > 0) target.year = range;
    };
    const hasDoi = searchParams.get('has_doi');
    const hasTranslation = searchParams.get('has_translation');
    const firstTranslation = searchParams.get('first_translation');
    const library = searchParams.get('library');
    const bookId = searchParams.get('book_id'); // Filter to specific book
    const searchContent = searchParams.get('search_content') !== 'false'; // Default true — only skip page search if explicitly disabled
    const pagesOnly = searchParams.get('pages_only') === 'true'; // Return only page-level results (for MCP passage search)
    const sortBy = searchParams.get('sort') || 'relevance'; // relevance | date_asc | date_desc | title
    // Ranking strategy for the relevance sort:
    //   'auto'  (default) — route by query shape: navigational queries (1–2
    //            words, ~84% of real traffic) keep the curated ladder, which is
    //            strong for title/author lookups and original-edition ordering;
    //            conceptual queries (3+ words, the ~16% tail) use RRF, which the
    //            eval shows wins niche-passage/concept recall there. Captures
    //            RRF's upside without risking the navigational majority.
    //   'ladder' / 'rrf' — force a single strategy (used by the compare page A/B
    //            and for debugging).
    // SEARCH_RANKING_DEFAULT can override the default without a code change.
    const rankingParam = (searchParams.get('ranking') || process.env.SEARCH_RANKING_DEFAULT || 'auto').toLowerCase();
    // Optional LLM-classified intent from /api/search/ai-expand. When present it
    // routes 'auto' better than word count: only 'navigational' (known
    // book/author/title lookup) wants the ladder; 'conceptual' and 'verbatim'
    // both do better with RRF (the eval shows semantic finds the English-quote
    // passage in a Latin original that keyword/ladder miss).
    const intentParam = (searchParams.get('intent') || '').toLowerCase();
    const llmIntent = ['navigational', 'conceptual', 'verbatim'].includes(intentParam) ? intentParam : '';
    const rrfK = Math.max(1, parseInt(searchParams.get('rrf_k') || '60') || 60);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!query || query.length < 2) {
      return NextResponse.json({
        error: 'Query must be at least 2 characters',
        results: [],
        total: 0
      }, { status: 400 });
    }

    // Strip surrounding quotes for matching (phrase detection handled by subsystems)
    const isPhrase = /^".*"$/.test(query.trim());
    const matchQuery = isPhrase ? query.trim().slice(1, -1) : query;

    // Resolve the ranking strategy for 'auto': prefer the LLM intent when the
    // client passed one (navigational → ladder, else → RRF); otherwise fall back
    // to query word count (1–2 words → ladder, 3+ → RRF) so 'auto' still works
    // with zero added latency when no intent is supplied.
    const queryWordCount = matchQuery.trim().split(/\s+/).filter(w => w.length >= 2).length;
    const useRrf = rankingParam === 'rrf'
      ? true
      : rankingParam === 'ladder'
        ? false
        : llmIntent
          ? llmIntent !== 'navigational'
          : queryWordCount >= 3;
    const rankingApplied = rankingParam === 'auto'
      ? `${useRrf ? 'auto-rrf' : 'auto-ladder'}:${llmIntent || 'words'}`
      : rankingParam;

    const db = await getReadDb();
    const results: SearchResult[] = [];
    const seenBooks = new Set<string>();

    // Read tenant context resolved by proxy.ts
    const { slug: tenantSlug, id: tenantId } = getTenantContextFromRequest(request.headers);
    if (tenantSlug && !tenantId) {
      return NextResponse.json({ results: [], total: 0 });
    }

    // Helper: build common book-level filters (language, category, year, etc.)
    function buildBookFilters(): Record<string, unknown> {
      const filters: Record<string, unknown> = { visible: true, pages_count: { $gt: 0 } };
      if (tenantId) filters.tenantId = tenantId;
      if (languages.length > 0) filters.language = { $in: languages };
      else if (excludeLanguages.length > 0) filters.language = { $nin: excludeLanguages };
      else if (language) filters.language = language;
      if (category) filters.categories = category;
      applyYearFilter(filters);
      if (hasDoi === 'true') filters.doi = { $exists: true, $ne: null };
      if (hasTranslation === 'true') filters.pages_translated = { $gt: 0 };
      if (firstTranslation === 'true') filters.is_first_translation = true;
      if (library) filters.$or = [{ held_by: library }, { 'image_source.provider': library }];
      return filters;
    }

    // Helper: convert book document to search result
    function bookToResult(typedBook: Book): SearchResult {
      const summaryText = (typedBook as any).reading_summary?.overview
        || (typeof typedBook.summary === 'string' ? typedBook.summary : typedBook.summary?.data);
      const result: SearchResult = {
        id: typedBook.id,
        type: 'book',
        book_id: typedBook.id,
        slug: (typedBook as any).slug,
        title: typedBook.title,
        display_title: typedBook.display_title,
        author: typedBook.author,
        editor: (typedBook as any).editor,
        language: typedBook.language,
        published: typedBook.published,
        page_count: typedBook.pages_count,
        translated_count: typedBook.pages_translated,
        has_doi: !!typedBook.doi,
        is_first_translation: !!(typedBook as any).is_first_translation,
        doi: typedBook.doi,
        categories: typedBook.categories,
        summary: summaryText ? extractSnippet(summaryText, matchQuery) : undefined,
        snippet_type: summaryText ? 'summary' : undefined,
        thumbnail: (typedBook as any).thumbnail,
        thumbnail_blob: (typedBook as any).thumbnail_blob,
        quality_score: (typedBook as any).quality_score,
      };
      // Transient field for work-level dedup (stripped before response)
      if ((typedBook as any).work_id) (result as any)._work_id = (typedBook as any).work_id;
      if ((typedBook as any).text_role) (result as any)._text_role = (typedBook as any).text_role;
      return result;
    }

    // Run book search and page content search in parallel
    const hasBookLevelFilters = !!(language || languages.length > 0 || excludeLanguages.length > 0 || category || dateFrom || dateTo || hasDoi === 'true' || hasTranslation === 'true' || firstTranslation === 'true' || year || yearFrom || yearTo || library);

    // Per-stage timing so we can see which lane is dragging the total wall-clock.
    // Total latency = max(stages) since they run in parallel; recording each
    // individually tells us where to optimize.
    async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
      const start = Date.now();
      const value = await fn();
      return { value, ms: Date.now() - start };
    }

    // BUG 2: `total` (below) is the size of THIS request's merged + deduped result
    // window — not a stable corpus-wide match count. Each lane (Supabase book
    // trigram, Atlas page search, semantic book, semantic page) can silently
    // degrade to [] on timeout or error, which shrinks the merged set and makes
    // `total` vary run-to-run for the same query. We can't make it a true corpus
    // count without a backend redesign (follow-up), but we CAN stop it from being
    // reported as authoritative when a lane dropped out: any lane that fails flips
    // `lanesDegraded`, surfaced as `partial: true` so callers know the count is
    // incomplete rather than silently smaller.
    const degradedLanes: string[] = [];

    const [bookResult, pageResult, semanticResult, semanticPageResult] = await Promise.all([
      // --- Book search via Supabase trigram (fast, no cold-start penalty) ---
      timed(async () => {
        if (bookId || pagesOnly) return [];
        try {
          const matchingIds = await searchBookIds(query, { limit: limit * 2 });
          const bookFilters = buildBookFilters();
          const bookProjection = { id: 1, slug: 1, title: 1, display_title: 1, author: 1, editor: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, language: 1, published: 1, pages_count: 1, pages_translated: 1, doi: 1, categories: 1, is_first_translation: 1, quality_score: 1, summary: 1, reading_summary: 1, work_id: 1, text_role: 1 };

          let books: any[] = [];
          if (matchingIds.length > 0) {
            books = await db.collection('books')
              .find({ id: { $in: matchingIds }, ...bookFilters })
              .project(bookProjection)
              .limit(limit)
              .maxTimeMS(5000)
              .toArray();
          }

          // Metadata fallback: search categories/subject_keywords/language in MongoDB
          // Only fires when Supabase found nothing (avoids slow regex on common queries)
          if (books.length === 0) {
            const STOPWORDS = new Set(['a', 'an', 'and', 'at', 'by', 'de', 'der', 'des', 'di', 'du', 'el', 'en', 'et', 'for', 'from', 'in', 'la', 'le', 'les', 'of', 'on', 'or', 'the', 'to', 'und', 'von', 'with']);
            const words = matchQuery.trim().split(/\s+/).filter((w: string) => w.length >= 3 && !STOPWORDS.has(w.toLowerCase()));
            if (words.length >= 2) {
              const wordRegexes = words.map((w: string) => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
              books = await db.collection('books')
                .find({
                  $and: wordRegexes.map(rx => ({
                    $or: [
                      { categories: rx },
                      { subject_keywords: rx },
                      { language: rx },
                      { title: rx },
                      { display_title: rx },
                    ],
                  })),
                  ...bookFilters,
                })
                .project(bookProjection)
                .limit(limit)
                .maxTimeMS(3000)
                .toArray();
            }
          }
          return books;
        } catch (err) {
          // Fail-soft: a Supabase trigram timeout or MongoDB error should not 500 the whole route.
          // The other 3 lanes (Atlas Search, semantic books, semantic pages) can still produce results.
          console.warn('[search] Book lane failed:', err instanceof Error ? err.message : String(err));
          degradedLanes.push('book'); // BUG 2: lane dropped out — total is now incomplete.
          return [];
        }
      }),

      // --- Page content search (aggregation pipeline truncates text for snippets) ---
      // Wrapped in a timeout race to prevent Atlas Search from blocking the response
      timed(async () => {
        if (!searchContent && !pagesOnly) return [];

        const pageSearchPromise = (async () => {
          const pageFilter: Record<string, unknown> = {};
          if (bookId) {
            pageFilter.book_id = bookId;
          } else if (hasBookLevelFilters) {
            const bookIdFilter: Record<string, unknown> = { visible: true };
            if (tenantId) bookIdFilter.tenantId = tenantId;
            if (languages.length > 0) bookIdFilter.language = { $in: languages };
            else if (excludeLanguages.length > 0) bookIdFilter.language = { $nin: excludeLanguages };
            else if (language) bookIdFilter.language = language;
            if (category) bookIdFilter.categories = category;
            applyYearFilter(bookIdFilter);
            if (hasDoi === 'true') bookIdFilter.doi = { $exists: true, $ne: null };

            const filteredBooks = await db.collection('books')
              .find(bookIdFilter)
              .project({ id: 1 })
              .toArray();
            const allowedBookIds = filteredBooks.map(b => b.id);
            // If the book-level filter (e.g. a language that matches no books)
            // yields an empty set, the page search must return NOTHING — never
            // fall through to an unconstrained whole-corpus search (fail-open).
            // Short-circuit here: `$in: []` does NOT survive the trip through
            // buildPageSearchStage (it drops an empty array, reopening the
            // leak), so bail at the lane rather than rely on it. (#2760)
            if (allowedBookIds.length === 0) return [];
            pageFilter.book_id = { $in: allowedBookIds };
          }

          const pageLimit = (bookId || pagesOnly) ? limit : MAX_PAGE_RESULTS;

          // Extract book IDs for Atlas Search filter
          let filteredBookIds: string | string[] | undefined;
          if (pageFilter.book_id) {
            if (typeof pageFilter.book_id === 'string') {
              filteredBookIds = pageFilter.book_id;
            } else if (typeof pageFilter.book_id === 'object' && '$in' in (pageFilter.book_id as Record<string, unknown>)) {
              filteredBookIds = (pageFilter.book_id as { $in: string[] }).$in;
            }
          }

          return await db.collection('pages').aggregate([
            buildPageSearchStage(query, filteredBookIds),
            { $match: { page_number: { $gt: 0 }, page_type: { $nin: NON_CONTENT_PAGE_TYPES } } },
            { $limit: pageLimit },
            {
              $project: {
                id: 1,
                page_number: 1,
                book_id: 1,
                highlights: { $meta: 'searchHighlights' },
                'translation.data': 1,
                'ocr.data': 1,
              },
            },
          ], { maxTimeMS: 8000 }).toArray();
        })();

        // Hard timeout: Atlas Search $search ignores maxTimeMS, so race against a timer
        return Promise.race([
          pageSearchPromise,
          new Promise<any[]>((resolve) => setTimeout(() => {
            console.warn('[search] Page search timed out after 8s');
            degradedLanes.push('page'); // BUG 2: lane dropped out — total is now incomplete.
            resolve([]);
          }, 8000)),
        ]).catch(() => { degradedLanes.push('page'); return []; });
      }),

      // --- Semantic book search (finds conceptually related books) ---
      timed(async () => {
        if (bookId || !searchContent) return [];
        try {
          const books = await semanticBookSearch(matchQuery, MAX_PAGE_RESULTS, {
            language: language || undefined,
            tenantId: tenantId || undefined,
          });
          return books.filter(b => yearInRange(b.year)).map(b => ({
            page_id: '',
            book_id: b.book_id,
            page_number: 0,
            snippet: (b.summary_text || '').slice(0, 300),
            score: b.similarity,
            book_title: b.title,
            book_author: b.author,
            book_language: b.language,
            book_year: b.year,
          }));
        } catch {
          degradedLanes.push('semantic_book'); // BUG 2: lane dropped out — total is now incomplete.
          return [];
        }
      }),

      // --- Semantic page search (finds specific passages across all 3.9M pages) ---
      // Catches passages buried inside large works that book-level search misses
      // (e.g. Martial's "masturbator" epigram, Diogenes's public acts in Laertius)
      timed(async () => {
        if (bookId || !searchContent) return [];
        try {
          const pages = await semanticPageSearchGlobal(matchQuery, 15, { tenantId: tenantId || undefined });
          if (pages.length === 0) return pages;
          // Drop semantic matches on non-content pages (cover/blank/illustration/etc.).
          // The Supabase embedding table has these — they pollute conceptual queries.
          const ids = pages.map(p => p.page_id);
          const typeDocs = await db.collection('pages')
            .find({ id: { $in: ids } }, { projection: { id: 1, page_type: 1 } })
            .toArray();
          const badIds = new Set(
            typeDocs
              .filter(d => (NON_CONTENT_PAGE_TYPES as readonly string[]).includes(d.page_type as string))
              .map(d => d.id as string),
          );
          // Year range applies to the semantic page lane too — its hits are
          // rendered as book-attributed passages, so an out-of-range book
          // arriving here reads exactly like an unfiltered result.
          return pages.filter(p => !badIds.has(p.page_id) && yearInRange(p.book_year));
        } catch {
          degradedLanes.push('semantic_page'); // BUG 2: lane dropped out — total is now incomplete.
          return [];
        }
      }),
    ]);
    const lanesDegraded = degradedLanes.length > 0;

    const bookDocs = bookResult.value;
    const pageDocs = pageResult.value;
    const semanticDocs = semanticResult.value;
    const semanticPageDocs = semanticPageResult.value;
    const stageMs = {
      book: bookResult.ms,
      page: pageResult.ms,
      semantic_book: semanticResult.ms,
      semantic_page: semanticPageResult.ms,
    };
    // Surface if the page lane hit its 8s ceiling — likely degraded results.
    const pageSearchHitTimeout = pageResult.ms >= 8000 && pageDocs.length === 0;

    // Reciprocal Rank Fusion scores, keyed by the same result.id scheme used
    // when results are built below (books → book.id, pages → `${book_id}-p${n}`).
    // Each lane contributes its own ranked order; a book/page surfaced by
    // several lanes gets summed reciprocal-rank credit. Only used when
    // ?ranking=rrf — computed unconditionally (cheap, pure) so it's available
    // to log/compare even on ladder requests.
    const rrf = rrfScores([
      bookDocs.map(b => (b as any).id as string),                              // keyword book lane
      pageDocs.map(p => `${p.book_id}-p${p.page_number}`),                     // keyword page lane
      semanticDocs.map(s => (s as any).book_id as string),                    // semantic book lane
      semanticPageDocs.map(s => `${(s as any).book_id}-p${(s as any).page_number}`), // semantic page lane
    ], rrfK);

    // Process book results
    for (const book of bookDocs) {
      results.push(bookToResult(book as unknown as Book));
      seenBooks.add((book as any).id);
    }

    // Process page results (skip if book results already fill the limit)
    if (pageDocs.length > 0 && (bookId || results.length < limit)) {
      const pageBookIds = [...new Set(pageDocs.map(p => p.book_id as string))];
      const bookMap = new Map<string, Book>();

      if (pageBookIds.length > 0) {
        const pageBooks = await db.collection('books')
          .find(
            { id: { $in: pageBookIds }, ...(tenantId ? { tenantId } : {}) },
            { projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, editor: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, language: 1, published: 1, pages_count: 1, pages_translated: 1, doi: 1, categories: 1, hidden: 1, quality_score: 1, work_id: 1, text_role: 1 } }
          )
          .toArray();
        for (const b of pageBooks) {
          bookMap.set(b.id as string, b as unknown as Book);
        }
      }

      for (const page of pageDocs) {
        const book = bookMap.get(page.book_id as string);
        if (!book) continue;
        if ((book as any).hidden === true) continue;
        if (!book.pages_count || book.pages_count === 0) continue;
        if (!pagesOnly && seenBooks.has(book.id)) continue;

        // Prefer Atlas Search highlights (faster, more precise) over full-text extraction
        let snippet = '';
        let snippetType: 'translation' | 'ocr' = 'ocr';
        const highlights = page.highlights as Array<{ path: string; texts: Array<{ value: string; type: string }> }> | undefined;
        if (highlights && highlights.length > 0) {
          // Prefer translation highlights over OCR
          const translationHL = highlights.find(h => h.path === 'translation.data');
          const hl = translationHL || highlights[0];
          snippetType = hl.path === 'translation.data' ? 'translation' : 'ocr';
          // Center on the Atlas hit but extract from the FULL field, not the
          // highlight fragments. Fragments are a window around the hit, so a hit
          // inside a <meta>/<summary>/<keywords>/<vocab> block arrives WITHOUT
          // its wrapper tags and stripEditorialWrappers can't remove it — that
          // leaked the AI page-description as a quote ("mercury on page 89").
          // extractSnippet runs cleanText over the complete field (tags intact),
          // so the block is stripped; if the hit was editorial-only it falls back
          // to real body text rather than the description.
          const fullData = (snippetType === 'translation' ? page.translation?.data : page.ocr?.data) as string || '';
          const hitText = hl.texts.find(t => t.type === 'hit')?.value || matchQuery;
          snippet = extractSnippet(fullData || hl.texts.map(t => t.value).join(''), hitText);
        } else {
          // Fallback to full text extraction
          const translationText = page.translation?.data as string || '';
          const ocrText = page.ocr?.data as string || '';
          const snippetSource = translationText || ocrText;
          snippetType = translationText ? 'translation' : 'ocr';
          snippet = extractSnippet(snippetSource, matchQuery);
        }

        const pageResult: SearchResult = {
          id: `${book.id}-p${page.page_number}`,
          page_id: page.id as string,
          type: 'page',
          book_id: book.id,
          slug: (book as any).slug,
          title: book.title,
          display_title: book.display_title,
          author: book.author,
          editor: (book as any).editor,
          language: book.language,
          published: book.published,
          page_count: book.pages_count,
          translated_count: book.pages_translated,
          has_doi: !!book.doi,
          doi: book.doi,
          categories: book.categories,
          page_number: page.page_number as number,
          snippet,
          snippet_type: snippetType,
          thumbnail: (book as any).thumbnail,
          thumbnail_blob: (book as any).thumbnail_blob,
        };
        if ((book as any).work_id) (pageResult as any)._work_id = (book as any).work_id;
        if ((book as any).text_role) (pageResult as any)._text_role = (book as any).text_role;
        results.push(pageResult);
      }
    }

    // Merge semantic book results as BOOK-LEVEL results (not page-level).
    // Semantic search finds conceptually related books that keyword search missed.
    // These should rank alongside Supabase trigram hits, not be buried as page entries.
    // Lower floor when keyword search found nothing — semantic becomes the primary results.
    //
    // SKIP entirely in pages_only mode (the MCP passage-search contract): book-level
    // results carry no page_number/snippet, so the MCP filters them out — but they
    // still rank above page hits and inflate `total`. With a small limit they fill the
    // whole window and the caller gets 0 passages despite a high total_matches. The
    // keyword book lane already short-circuits for pagesOnly (see line ~231); mirror it
    // here so pages_only means pages only. (Saves the semBooks lookup too.)
    const hasKeywordResults = bookDocs.length > 0 || pageDocs.length > 0;
    const SEMANTIC_SIM_FLOOR = hasKeywordResults ? 0.65 : 0.55;
    if (semanticDocs.length > 0 && !pagesOnly) {
      // Collect unique book IDs from semantic results (skip books already in results)
      const semanticBookIds = [...new Set(
        semanticDocs
          .filter(s => (s.score ?? 0) >= SEMANTIC_SIM_FLOOR && !seenBooks.has(s.book_id))
          .map(s => s.book_id)
      )];

      if (semanticBookIds.length > 0) {
        const semBooks = await db.collection('books')
          .find(
            {
              id: { $in: semanticBookIds }, visible: true, pages_count: { $gt: 0 },
              // Tenant scope: match_books_semantic is GLOBAL (book_embeddings has
              // no tenant_id column, so the RPC can't filter), so a tenant request
              // must re-apply the tenant filter here or global books leak into the
              // partner reading room (Tenant Subdomain Lockdown). See keyword
              // page-lane materialization which already does this.
              ...(tenantId ? { tenantId } : {}),
              // Honor the singular `language` param too — not just the `languages`
              // array. buildBookFilters() (keyword lane) checks all three, but these
              // semantic lanes only checked the array, so `?language=Sanskrit` leaked
              // English-edition translations of Sanskrit works through semantic
              // promotion (the search-eval "Sanskrit filter" failure). Mirror the
              // keyword-lane precedence: languages → excludeLanguages → language.
              ...(languages.length > 0 ? { language: { $in: languages } }
                : excludeLanguages.length > 0 ? { language: { $nin: excludeLanguages } }
                : language ? { language } : {}),
            },
            { projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, editor: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, language: 1, published: 1, pages_count: 1, pages_translated: 1, doi: 1, categories: 1, quality_score: 1, work_id: 1, summary: 1, reading_summary: 1, text_role: 1 } }
          )
          .maxTimeMS(3000)
          .toArray();

        // Build a snippet map from semantic results
        const snippetMap = new Map(semanticDocs.map(s => [s.book_id, s.snippet]));

        for (const book of semBooks) {
          if (seenBooks.has(book.id as string)) continue;
          seenBooks.add(book.id as string);

          const summaryText = (book as any).reading_summary?.overview
            || (typeof (book as any).summary === 'string' ? (book as any).summary : (book as any).summary?.data)
            || snippetMap.get(book.id as string) || '';

          const semResult: SearchResult = {
            id: book.id as string,
            type: 'book',
            book_id: book.id as string,
            slug: book.slug as string,
            title: book.title as string,
            display_title: book.display_title as string | undefined,
            author: (book.author as string) || 'Unknown',
            editor: (book as any).editor,
            language: (book.language as string) || 'Unknown',
            published: (book.published as string) || 'Unknown',
            page_count: book.pages_count as number,
            translated_count: book.pages_translated as number,
            has_doi: !!(book as any).doi,
            doi: (book as any).doi,
            categories: book.categories as string[],
            summary: summaryText ? extractSnippet(summaryText, matchQuery) : undefined,
            snippet_type: summaryText ? 'summary' : undefined,
            thumbnail: book.thumbnail as string | undefined,
            thumbnail_blob: book.thumbnail_blob as string | undefined,
            quality_score: (book as any).quality_score,
          };
          if ((book as any).work_id) (semResult as any)._work_id = (book as any).work_id;
          if ((book as any).text_role) (semResult as any)._text_role = (book as any).text_role;
          results.push(semResult);
        }
      }
    }

    // Merge page-level semantic results (specific passages across all pages)
    if (semanticPageDocs.length > 0) {
      const seenPageKeys = new Set(
        results
          .filter(r => r.type === 'page' && r.page_number)
          .map(r => `${r.book_id}-${r.page_number}`)
      );

      // Collect book IDs needing metadata
      const pageBookIds = [...new Set(
        semanticPageDocs
          .filter(s => !seenPageKeys.has(`${s.book_id}-${s.page_number}`))
          .map(s => s.book_id)
      )];

      const pageBookMap = new Map<string, any>();
      if (pageBookIds.length > 0) {
        const semPageBooks = await db.collection('books')
          .find(
            {
              id: { $in: pageBookIds }, visible: true, pages_count: { $gt: 0 },
              // match_semantic already filters by filter_tenant_id, so this is
              // defense-in-depth — but keep it consistent with the book lane so a
              // future RPC change can't silently leak cross-tenant pages.
              ...(tenantId ? { tenantId } : {}),
              // Honor the singular `language` param too — not just the `languages`
              // array. buildBookFilters() (keyword lane) checks all three, but these
              // semantic lanes only checked the array, so `?language=Sanskrit` leaked
              // English-edition translations of Sanskrit works through semantic
              // promotion (the search-eval "Sanskrit filter" failure). Mirror the
              // keyword-lane precedence: languages → excludeLanguages → language.
              ...(languages.length > 0 ? { language: { $in: languages } }
                : excludeLanguages.length > 0 ? { language: { $nin: excludeLanguages } }
                : language ? { language } : {}),
            },
            { projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, editor: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, language: 1, published: 1, pages_count: 1, pages_translated: 1, doi: 1, categories: 1, quality_score: 1, work_id: 1, text_role: 1 } }
          )
          .maxTimeMS(3000)
          .toArray();
        for (const b of semPageBooks) pageBookMap.set(b.id as string, b);
      }

      for (const sp of semanticPageDocs) {
        const pageKey = `${sp.book_id}-${sp.page_number}`;
        if (seenPageKeys.has(pageKey)) continue;
        seenPageKeys.add(pageKey);

        const book = pageBookMap.get(sp.book_id);
        if (!book) continue;

        const spResult: SearchResult = {
          id: `${sp.book_id}-p${sp.page_number}`,
          page_id: sp.page_id,
          type: 'page',
          book_id: sp.book_id,
          slug: book.slug,
          title: book.title || sp.book_title,
          display_title: book.display_title,
          author: book.author || sp.book_author || undefined,
          editor: book.editor,
          language: book.language || sp.book_language || undefined,
          published: book.published,
          page_count: book.pages_count,
          translated_count: book.pages_translated,
          has_doi: !!book.doi,
          doi: book.doi,
          categories: book.categories,
          page_number: sp.page_number,
          snippet: sp.snippet,
          snippet_type: 'translation' as const,
          thumbnail: book.thumbnail,
          thumbnail_blob: book.thumbnail_blob,
        };
        if (book.work_id) (spResult as any)._work_id = book.work_id;
        if ((book as any).text_role) (spResult as any)._text_role = (book as any).text_role;
        results.push(spResult);
      }
    }

    // Sort results
    if (sortBy === 'date_asc' || sortBy === 'date_desc') {
      const dir = sortBy === 'date_asc' ? 1 : -1;
      results.sort((a, b) => {
        const aYear = parseInt(a.published?.match(/\d{3,4}/)?.[0] || '0');
        const bYear = parseInt(b.published?.match(/\d{3,4}/)?.[0] || '0');
        return (aYear - bYear) * dir;
      });
    } else if (sortBy === 'title') {
      results.sort((a, b) => {
        const aTitle = (a.display_title || a.title).toLowerCase();
        const bTitle = (b.display_title || b.title).toLowerCase();
        return aTitle.localeCompare(bTitle);
      });
    } else {
      // Default: canon-weighted relevance
      // Priority: books > pages, title match, original language, older editions, quality
      const ENGLISH = 'English';
      const queryLower = matchQuery.toLowerCase();
      const queryWords = queryLower.split(/\s+/).filter(w => w.length >= 3);

      // The legacy heuristic ladder. Used directly for ranking=ladder, and as
      // the tiebreaker when ranking=rrf (so equal fused scores still get a
      // deterministic, sensible order).
      const ladderCompare = (a: SearchResult, b: SearchResult): number => {
        // 1. Books before pages
        if (a.type !== b.type) return a.type === 'book' ? -1 : 1;

        // 2. Title/author match (strongest signal)
        // Check both title and display_title, and for multi-word queries
        // count how many query words appear across title+author fields
        const aAllText = `${(a.display_title || '').toLowerCase()} ${a.title.toLowerCase()} ${(a.author || '').toLowerCase()}`;
        const bAllText = `${(b.display_title || '').toLowerCase()} ${b.title.toLowerCase()} ${(b.author || '').toLowerCase()}`;

        const aWordHits = queryWords.filter(w => aAllText.includes(w)).length;
        const bWordHits = queryWords.filter(w => bAllText.includes(w)).length;
        if (aWordHits !== bWordHits) return bWordHits - aWordHits;

        // 2c. Does the query name this book's AUTHOR? A commentary ON Aristotle
        // is not Aristotle.
        //
        // Measured on "Aristotle Metaphysics": Bekker's 1831 Greek critical
        // edition ranked 7th and Taylor's translation 9th, behind commentaries
        // by Aquinas, Asclepius and Tartaretus. All of those carry both query
        // words in their titles, so rung 2 tied — and the tie fell through to
        // rung 4, "older editions rank higher", which handed the top of the page
        // to whichever commentary happened to be oldest.
        //
        // Rung 4 is right BETWEEN EDITIONS OF ONE WORK, where earlier really
        // does mean closer to the source. It says nothing ACROSS works: a 1480
        // commentary is not a better witness to the Metaphysics than an 1831
        // critical edition of it. This rung stops that comparison being reached
        // in the one case where the corpus can tell the difference.
        //
        // It sits ABOVE the exact-phrase rung deliberately. Asclepius's volume
        // is titled "…Commentary on Aristotle Metaphysics", so it contains the
        // query as a literal phrase and won that rung by coincidence. Being the
        // named author's own text is better evidence than a phrase that happens
        // to fall contiguously in a title about them. Measured across eight
        // queries, moving it up promoted Aristotle over both commentaries and
        // Newton over Descartes, and changed nothing else.
        //
        // WHAT THIS DOES NOT FIX: rung 2 counts query words across title AND
        // author together, so a commentary whose title names both the author and
        // the work ("Averroes' Paraphrase of Plato's Republic", "Proclus in
        // Politiam Platonis") scores 2 where Plato's own manuscripts score 1,
        // and is separated before this rung is reached. Searching "Plato
        // Republic" still returns Proclus at #2 and Averroes at #3. That needs
        // the work/commentary distinction represented in the data rather than
        // inferred from title strings — see the issue linked in the PR.
        const authorHits = (r: SearchResult) => {
          const author = (r.author || '').toLowerCase();
          return author ? queryWords.filter((w) => author.includes(w)).length : 0;
        };
        const aAuthorHits = authorHits(a);
        const bAuthorHits = authorHits(b);
        if (aAuthorHits !== bAuthorHits) return bAuthorHits - aAuthorHits;

        // Exact phrase match in title is stronger than scattered word matches
        const aTitle = (a.display_title || a.title).toLowerCase();
        const bTitle = (b.display_title || b.title).toLowerCase();
        const aTitleExact = aTitle.includes(queryLower);
        const bTitleExact = bTitle.includes(queryLower);
        if (aTitleExact !== bTitleExact) return aTitleExact ? -1 : 1;

        // 3. Closeness to the source (#2395): original-language texts beat
        // period translations beat modern translations. text_role is the
        // classified signal; language is the fallback proxy for pages and
        // unclassified imports (see src/lib/text-role.ts).
        const aRank = textRoleRank((a as any)._text_role, a.language);
        const bRank = textRoleRank((b as any)._text_role, b.language);
        if (aRank !== bRank) return aRank - bRank;

        // 4. Older editions rank higher (earlier = closer to source)
        const aYear = parseInt(a.published?.match(/\d{3,4}/)?.[0] || '9999');
        const bYear = parseInt(b.published?.match(/\d{3,4}/)?.[0] || '9999');
        if (aYear !== bYear) return aYear - bYear;

        // 5. Quality score tie-breaker
        const aScore = (a as any).quality_score || 0;
        const bScore = (b as any).quality_score || 0;
        return bScore - aScore;
      };

      if (useRrf) {
        // Reciprocal Rank Fusion: primary sort by fused lane score (desc),
        // ladder as the deterministic tiebreaker. Unlike the ladder, this lets
        // a strongly-cross-confirmed page outrank a weakly-matched book.
        //
        // text_role demotion (#2395): the ladder tier only breaks RRF ties, so
        // a popular old translation (Evans-Wentz, Jowett) still outranked the
        // original via lane cross-confirmation. Scale the fused score down for
        // CLASSIFIED translations only — unclassified results are untouched,
        // so this is surgical (265 books + their pages), not a filter.
        const rrfAdjusted = (r: SearchResult) => {
          const s = rrf.get(r.id) ?? 0;
          const tr = (r as any)._text_role;
          if (tr === 'modern-translation') return s / 1.5;
          if (tr === 'period-translation') return s / 1.2;
          return s;
        };
        results.sort((a, b) => {
          const sa = rrfAdjusted(a);
          const sb = rrfAdjusted(b);
          if (sb !== sa) return sb - sa;
          return ladderCompare(a, b);
        });
      } else {
        results.sort(ladderCompare);
      }
    }

    // Dedup by work_id: keep the first (best-ranked) edition of each work.
    // Results are already sorted by relevance, so the first hit for a work_id wins.
    // Books without work_id are always kept (they can't be deduped).
    const seenWorkIds = new Set<string>();
    const dedupedResults: SearchResult[] = [];
    for (const r of results) {
      const workId = (r as any)._work_id as string | undefined;
      if (workId) {
        if (seenWorkIds.has(workId)) continue;
        seenWorkIds.add(workId);
      }
      dedupedResults.push(r);
    }

    // Apply offset and strip transient fields
    const paginatedResults = dedupedResults.slice(offset, offset + limit)
      .map(r => { const { _work_id, _text_role, ...clean } = r as any; return clean as SearchResult; });

    // For exact year searches, find nearby books (within 5 years)
    let nearby: SearchResult[] = [];
    if (year && !bookId) {
      const yearNum = parseInt(year);
      if (!isNaN(yearNum)) {
        // Find nearby books via Supabase + MongoDB filter for year range
        let nearbyBooks: Record<string, unknown>[];
        const matchingIds = await searchBookIds(query, { limit: 50 });
        if (matchingIds.length > 0) {
          const nearbyFilter: Record<string, unknown> = {
            id: { $in: matchingIds.filter(id => !seenBooks.has(id)) },
            year: { $gte: yearNum - 5, $lte: yearNum + 5, $ne: yearNum },
          };
          if (language) nearbyFilter.language = language;
          if (category) nearbyFilter.categories = category;

          nearbyBooks = await db.collection('books')
            .find(nearbyFilter)
            .limit(10)
            .maxTimeMS(5000)
            .toArray();
        } else {
          nearbyBooks = [];
        }

        nearby = nearbyBooks.map(book => bookToResult(book as unknown as Book));

        // Sort nearby by year distance from target
        nearby.sort((a, b) => {
          const aYear = parseInt(a.published?.match(/\d{3,4}/)?.[0] || '0');
          const bYear = parseInt(b.published?.match(/\d{3,4}/)?.[0] || '0');
          return Math.abs(aYear - yearNum) - Math.abs(bYear - yearNum);
        });
      }
    }

    // Log search query (fire-and-forget) — see src/lib/search-event-log.ts
    logSearchEvent({
      request, db, query, resultsCount: results.length, source: 'global',
      // `tenantId` is already resolved above for scoping the query itself.
      // Omitting it here (as the first pass did) left every "global" search
      // unattributable even though the value was sitting in scope — the same
      // blind spot that made the pre-existing rows unsplittable.
      tenantId,
      filters: { language, category, year, bookId, library, semantic_count: semanticDocs.length },
    });

    logSearchQuery({
      request, identity, route: 'search', query,
      total: dedupedResults.length, ms: Date.now() - _searchStart, ok: true,
      stage_ms: stageMs,
      page_search_timed_out: pageSearchHitTimeout || degradedLanes.includes('page'),
      filters: {
        language, category, year, year_from: yearFrom, year_to: yearTo,
        languages, exclude_languages: excludeLanguages,
        has_doi: hasDoi, has_translation: hasTranslation, book_id: bookId,
        pages_only: pagesOnly, sort: sortBy, ranking: rankingApplied,
      },
    });
    return NextResponse.json({
      query,
      // NOTE: `total` is the size of THIS request's merged + deduped result window,
      // not a stable corpus-wide match count (see BUG 2 note above). When `partial`
      // is true a search lane timed out / errored, so this count is incomplete and
      // should not be treated as authoritative. Identical queries under normal
      // (no-timeout) conditions return the same `total`.
      total: dedupedResults.length,
      ...(lanesDegraded ? { partial: true, degraded_lanes: degradedLanes } : {}),
      offset,
      limit,
      sort: sortBy,
      ranking: rankingApplied,
      license: CONTENT_LICENSE,
      results: paginatedResults,
      ...(nearby.length > 0 && { nearby, nearby_range: `${parseInt(year!) - 5}-${parseInt(year!) + 5}` }),
      filters: {
        language,
        category,
        date_from: dateFrom,
        date_to: dateTo,
        year,
        year_from: yearFrom,
        year_to: yearTo,
        has_doi: hasDoi,
        has_translation: hasTranslation,
        book_id: bookId,
      },
    }, {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    logSearchQuery({
      request, identity, route: 'search',
      query: new URL(request.url).searchParams.get('q') || '',
      ms: Date.now() - _searchStart, ok: false,
    });
    return NextResponse.json({
      error: 'Search failed',
      message: error instanceof Error ? error.message : String(error),
    }, {
      status: 500,
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=10, stale-while-revalidate=30',
      },
    });
  }
}, { route: 'search' });
