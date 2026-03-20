import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { Book } from '@/lib/types';
import type { SearchResult, SearchResponse } from '@/lib/api-client/types/search';
import { buildBookSearchStage, buildPageSearchStage, type BookSearchFilters } from '@/lib/atlas-search';

export const preferredRegion = 'fra1';

const MAX_PAGE_RESULTS = 10;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip XML/HTML tags and clean up OCR artifacts for display */
function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')        // strip all XML/HTML tags
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
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const language = searchParams.get('language');
    const category = searchParams.get('category'); // Category filter
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const year = searchParams.get('year'); // Exact year filter
    const yearFrom = searchParams.get('year_from'); // Year range start
    const yearTo = searchParams.get('year_to'); // Year range end
    const hasDoi = searchParams.get('has_doi');
    const hasTranslation = searchParams.get('has_translation');
    const firstTranslation = searchParams.get('first_translation');
    const library = searchParams.get('library');
    const bookId = searchParams.get('book_id'); // Filter to specific book
    const searchContent = searchParams.get('search_content') === 'true'; // Default false (page search is slow on 300K+ docs)
    const pagesOnly = searchParams.get('pages_only') === 'true'; // Return only page-level results (for MCP passage search)
    const sortBy = searchParams.get('sort') || 'relevance'; // relevance | date_asc | date_desc | title
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!query || query.length < 2) {
      return NextResponse.json({
        error: 'Query must be at least 2 characters',
        results: [],
        total: 0
      }, { status: 400 });
    }

    const db = await getDb();
    const results: SearchResult[] = [];
    const seenBooks = new Set<string>();

    // Build regex for fallback text search
    const queryRegex = new RegExp(escapeRegex(query), 'i');

    // Helper: build common book-level filters (language, category, year, etc.)
    function buildBookFilters(): Record<string, unknown> {
      const filters: Record<string, unknown> = { hidden: { $ne: true }, pages_count: { $gt: 0 } };
      if (language) filters.language = language;
      if (category) filters.categories = category;
      if (dateFrom || dateTo) {
        filters.published = {};
        if (dateFrom) (filters.published as Record<string, string>).$gte = dateFrom;
        if (dateTo) (filters.published as Record<string, string>).$lte = dateTo;
      }
      if (year || yearFrom || yearTo) {
        const yearFilter: Record<string, number> = {};
        if (year) {
          const yearNum = parseInt(year);
          if (!isNaN(yearNum)) filters.year = yearNum;
        } else {
          if (yearFrom) {
            const yearNum = parseInt(yearFrom);
            if (!isNaN(yearNum)) yearFilter.$gte = yearNum;
          }
          if (yearTo) {
            const yearNum = parseInt(yearTo);
            if (!isNaN(yearNum)) yearFilter.$lte = yearNum;
          }
          if (Object.keys(yearFilter).length > 0) filters.year = yearFilter;
        }
      }
      if (hasDoi === 'true') filters.doi = { $exists: true, $ne: null };
      if (hasTranslation === 'true') filters.pages_translated = { $gt: 0 };
      if (firstTranslation === 'true') filters.is_first_translation = true;
      if (library) filters['image_source.provider'] = library;
      return filters;
    }

    // Helper: convert book document to search result
    function bookToResult(typedBook: Book): SearchResult {
      const summaryText = (typedBook as any).reading_summary?.overview
        || (typeof typedBook.summary === 'string' ? typedBook.summary : typedBook.summary?.data);
      return {
        id: typedBook.id,
        type: 'book',
        book_id: typedBook.id,
        slug: (typedBook as any).slug,
        title: typedBook.title,
        display_title: typedBook.display_title,
        author: typedBook.author,
        language: typedBook.language,
        published: typedBook.published,
        page_count: typedBook.pages_count,
        translated_count: typedBook.pages_translated,
        has_doi: !!typedBook.doi,
        is_first_translation: !!(typedBook as any).is_first_translation,
        doi: typedBook.doi,
        categories: typedBook.categories,
        summary: summaryText ? extractSnippet(summaryText, query) : undefined,
        snippet_type: summaryText ? 'summary' : undefined,
        thumbnail: (typedBook as any).thumbnail,
        thumbnail_blob: (typedBook as any).thumbnail_blob,
        quality_score: (typedBook as any).quality_score,
      };
    }

    // Run book search and page content search in parallel
    const hasBookLevelFilters = !!(language || category || dateFrom || dateTo || hasDoi === 'true' || hasTranslation === 'true' || firstTranslation === 'true' || year || yearFrom || yearTo || library);

    const [bookDocs, pageDocs] = await Promise.all([
      // --- Book search via Atlas Search (skip when searching within a specific book or pages_only mode) ---
      (async () => {
        if (bookId || pagesOnly) return [];
        try {
          const searchFilters: BookSearchFilters = {};
          if (language) searchFilters.language = language;
          if (category) searchFilters.category = category;
          if (firstTranslation === 'true') searchFilters.isFirstTranslation = true;
          if (hasTranslation === 'true') searchFilters.hasTranslation = true;
          if (year) {
            const yearNum = parseInt(year);
            if (!isNaN(yearNum)) searchFilters.yearExact = yearNum;
          } else {
            if (yearFrom) { const n = parseInt(yearFrom); if (!isNaN(n)) searchFilters.yearFrom = n; }
            if (yearTo) { const n = parseInt(yearTo); if (!isNaN(n)) searchFilters.yearTo = n; }
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pipeline: any[] = [buildBookSearchStage(query, searchFilters, { fuzzy: true })];

          // Post-filters for fields not in the Atlas Search index
          const postMatch: Record<string, unknown> = {};
          if (hasDoi === 'true') postMatch.doi = { $exists: true, $ne: null };
          if (library) postMatch['image_source.provider'] = library;
          if (dateFrom || dateTo) {
            postMatch.published = {};
            if (dateFrom) (postMatch.published as Record<string, string>).$gte = dateFrom;
            if (dateTo) (postMatch.published as Record<string, string>).$lte = dateTo;
          }
          if (Object.keys(postMatch).length > 0) {
            pipeline.push({ $limit: Math.max(limit * 3, 60) });
            pipeline.push({ $match: postMatch });
          }
          pipeline.push({ $limit: limit });

          return await db.collection('books').aggregate(pipeline, { maxTimeMS: 5000 }).toArray();
        } catch {
          const bookFilters = buildBookFilters();
          return await db.collection('books')
            .find({
              $or: [
                { title: queryRegex },
                { display_title: queryRegex },
                { author: queryRegex },
                { 'reading_summary.overview': queryRegex },
              ],
              ...bookFilters,
            })
            .limit(limit)
            .toArray();
        }
      })(),

      // --- Page content search (aggregation pipeline truncates text for snippets) ---
      (async () => {
        if (!searchContent && !pagesOnly) return [];

        const pageFilter: Record<string, unknown> = {};
        if (bookId) {
          pageFilter.book_id = bookId;
        } else if (hasBookLevelFilters) {
          const bookIdFilter: Record<string, unknown> = { hidden: { $ne: true } };
          if (language) bookIdFilter.language = language;
          if (category) bookIdFilter.categories = category;
          if (dateFrom || dateTo) {
            bookIdFilter.published = {};
            if (dateFrom) (bookIdFilter.published as Record<string, string>).$gte = dateFrom;
            if (dateTo) (bookIdFilter.published as Record<string, string>).$lte = dateTo;
          }
          if (hasDoi === 'true') bookIdFilter.doi = { $exists: true, $ne: null };

          const filteredBooks = await db.collection('books')
            .find(bookIdFilter)
            .project({ id: 1 })
            .toArray();
          const allowedBookIds = filteredBooks.map(b => b.id);
          if (allowedBookIds.length > 0) {
            pageFilter.book_id = { $in: allowedBookIds };
          }
        }

        const pageLimit = (bookId || pagesOnly) ? limit : MAX_PAGE_RESULTS;

        try {
          // Extract book IDs for Atlas Search filter
          let searchBookIds: string | string[] | undefined;
          if (pageFilter.book_id) {
            if (typeof pageFilter.book_id === 'string') {
              searchBookIds = pageFilter.book_id;
            } else if (typeof pageFilter.book_id === 'object' && '$in' in (pageFilter.book_id as Record<string, unknown>)) {
              searchBookIds = (pageFilter.book_id as { $in: string[] }).$in;
            }
          }

          return await db.collection('pages').aggregate([
            buildPageSearchStage(query, searchBookIds),
            { $limit: pageLimit },
            {
              $project: {
                id: 1,
                page_number: 1,
                book_id: 1,
                highlights: { $meta: 'searchHighlights' },
                // Only fetch full text as fallback if highlights are empty
                'translation.data': 1,
                'ocr.data': 1,
              },
            },
          ], { maxTimeMS: 10000 }).toArray();
        } catch {
          // Fallback: skip page search if Atlas Search index unavailable
          return [];
        }
      })(),
    ]);

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
            { id: { $in: pageBookIds } },
            { projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, thumbnail: 1, thumbnail_blob: 1, language: 1, published: 1, pages_count: 1, pages_translated: 1, doi: 1, categories: 1, hidden: 1, quality_score: 1 } }
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
          snippet = hl.texts.map(t => t.value).join('');
          snippetType = hl.path === 'translation.data' ? 'translation' : 'ocr';
        } else {
          // Fallback to full text extraction
          const translationText = page.translation?.data as string || '';
          const ocrText = page.ocr?.data as string || '';
          const snippetSource = translationText || ocrText;
          snippetType = translationText ? 'translation' : 'ocr';
          snippet = extractSnippet(snippetSource, query);
        }

        results.push({
          id: `${book.id}-p${page.page_number}`,
          page_id: page.id as string,
          type: 'page',
          book_id: book.id,
          slug: (book as any).slug,
          title: book.title,
          display_title: book.display_title,
          author: book.author,
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
        });
      }
    }

    // Sort results
    if (sortBy === 'date_asc' || sortBy === 'date_desc') {
      const dir = sortBy === 'date_asc' ? 1 : -1;
      results.sort((a, b) => {
        const aYear = parseInt(a.published?.match(/\d{4}/)?.[0] || '0');
        const bYear = parseInt(b.published?.match(/\d{4}/)?.[0] || '0');
        return (aYear - bYear) * dir;
      });
    } else if (sortBy === 'title') {
      results.sort((a, b) => {
        const aTitle = (a.display_title || a.title).toLowerCase();
        const bTitle = (b.display_title || b.title).toLowerCase();
        return aTitle.localeCompare(bTitle);
      });
    } else {
      // Default: relevance — books first, title matches first, quality score tie-breaker
      results.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'book' ? -1 : 1;
        const aTitle = (a.display_title || a.title).toLowerCase();
        const bTitle = (b.display_title || b.title).toLowerCase();
        const queryLower = query.toLowerCase();
        const aTitleMatch = aTitle.includes(queryLower);
        const bTitleMatch = bTitle.includes(queryLower);
        if (aTitleMatch !== bTitleMatch) return aTitleMatch ? -1 : 1;
        // Quality score tie-breaker
        const aScore = (a as any).quality_score || 0;
        const bScore = (b as any).quality_score || 0;
        return bScore - aScore;
      });
    }

    // Apply offset
    const paginatedResults = results.slice(offset, offset + limit);

    // For exact year searches, find nearby books (within 5 years)
    let nearby: SearchResult[] = [];
    if (year && !bookId) {
      const yearNum = parseInt(year);
      if (!isNaN(yearNum)) {
        const nearbyYears: number[] = [];
        for (let y = yearNum - 5; y <= yearNum + 5; y++) {
          if (y !== yearNum && y > 1400) nearbyYears.push(y);
        }

        const nearbyPattern = new RegExp(`\\b(${nearbyYears.join('|')})\\b`);

        // Use Atlas Search for nearby books with year range filter
        let nearbyBooks;
        try {
          const nearbyFilters: BookSearchFilters = {
            yearFrom: yearNum - 5,
            yearTo: yearNum + 5,
          };
          if (language) nearbyFilters.language = language;
          if (category) nearbyFilters.category = category;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nearbyPipeline: any[] = [
            buildBookSearchStage(query, nearbyFilters),
            { $limit: 20 },
          ];
          // Exclude exact year and already-seen books
          const nearbyExclude: Record<string, unknown> = { year: { $ne: yearNum } };
          if (seenBooks.size > 0) nearbyExclude.id = { $nin: Array.from(seenBooks) };
          nearbyPipeline.push({ $match: nearbyExclude });
          nearbyPipeline.push({ $limit: 10 });

          nearbyBooks = await db.collection('books').aggregate(nearbyPipeline, { maxTimeMS: 5000 }).toArray();
        } catch {
          // Fallback: regex
          const nearbyFilter: Record<string, unknown> = {
            $or: [
              { title: queryRegex },
              { display_title: queryRegex },
              { author: queryRegex },
              { 'reading_summary.overview': queryRegex },
            ],
            published: { $regex: nearbyPattern },
          };
          if (seenBooks.size > 0) nearbyFilter.id = { $nin: Array.from(seenBooks) };
          if (language) nearbyFilter.language = language;
          if (category) nearbyFilter.categories = category;

          nearbyBooks = await db.collection('books')
            .find(nearbyFilter)
            .limit(10)
            .toArray();
        }

        nearby = nearbyBooks.map(book => bookToResult(book as unknown as Book));

        // Sort nearby by year distance from target
        nearby.sort((a, b) => {
          const aYear = parseInt(a.published?.match(/\d{4}/)?.[0] || '0');
          const bYear = parseInt(b.published?.match(/\d{4}/)?.[0] || '0');
          return Math.abs(aYear - yearNum) - Math.abs(bYear - yearNum);
        });
      }
    }

    // Log search query (fire-and-forget)
    db.collection('analytics_events').insertOne({
      event: 'search_query',
      query,
      results_count: results.length,
      filters: { language, category, year, bookId, library, source: 'global' },
      timestamp: new Date(),
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
      created_at: new Date(),
    }).catch(() => {});

    return NextResponse.json({
      query,
      total: results.length,
      offset,
      limit,
      sort: sortBy,
      license: {
        spdx: 'CC-BY-SA-4.0',
        url: 'https://creativecommons.org/licenses/by-sa/4.0/',
        attribution: 'Source Library (https://sourcelibrary.org)',
        terms: 'https://sourcelibrary.org/terms',
      },
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
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({
      error: 'Search failed',
      message: error instanceof Error ? error.message : String(error),
    }, {
      status: 500,
      headers: {
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
      },
    });
  }
}
