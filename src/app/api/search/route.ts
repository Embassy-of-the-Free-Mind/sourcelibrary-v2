import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { Book } from '@/lib/types';
import type { SearchResult, SearchResponse } from '@/lib/api-client/types/search';

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
    const bookId = searchParams.get('book_id'); // Filter to specific book
    const searchContent = searchParams.get('search_content') !== 'false'; // Default true
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
      const filters: Record<string, unknown> = { hidden: { $ne: true } };
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
      return filters;
    }

    // Helper: convert book document to search result
    function bookToResult(typedBook: Book): SearchResult {
      const summaryText = typeof typedBook.summary === 'string'
        ? typedBook.summary
        : typedBook.summary?.data || (typedBook as any).reading_summary?.overview;
      return {
        id: typedBook.id,
        type: 'book',
        book_id: typedBook.id,
        title: typedBook.title,
        display_title: typedBook.display_title,
        author: typedBook.author,
        language: typedBook.language,
        published: typedBook.published,
        page_count: typedBook.pages_count,
        translated_count: typedBook.pages_translated,
        has_doi: !!typedBook.doi,
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
    const hasBookLevelFilters = !!(language || category || dateFrom || dateTo || hasDoi === 'true' || hasTranslation === 'true' || year || yearFrom || yearTo);

    const [bookDocs, pageDocs] = await Promise.all([
      // --- Book text search (skip when searching within a specific book) ---
      (async () => {
        if (bookId) return [];
        const bookFilters = buildBookFilters();
        try {
          return await db.collection('books')
            .find(
              { $text: { $search: query }, ...bookFilters },
              { projection: { score: { $meta: 'textScore' } } }
            )
            .sort({ score: { $meta: 'textScore' } })
            .limit(limit)
            .toArray();
        } catch {
          return await db.collection('books')
            .find({
              $or: [
                { title: queryRegex },
                { display_title: queryRegex },
                { author: queryRegex },
                { 'summary.data': queryRegex },
                { summary: queryRegex },
              ],
              ...bookFilters,
            })
            .limit(limit)
            .toArray();
        }
      })(),

      // --- Page content search (aggregation pipeline truncates text for snippets) ---
      (async () => {
        if (!searchContent) return [];

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

        const pageLimit = bookId ? limit : MAX_PAGE_RESULTS;

        try {
          return await db.collection('pages')
            .find(
              { $text: { $search: query }, ...pageFilter },
              { projection: { score: { $meta: 'textScore' }, id: 1, page_number: 1, book_id: 1, 'translation.data': 1, 'ocr.data': 1 } }
            )
            .sort({ score: { $meta: 'textScore' } })
            .limit(pageLimit)
            .toArray();
        } catch {
          return await db.collection('pages')
            .find(
              { $or: [{ 'translation.data': queryRegex }, { 'ocr.data': queryRegex }], ...pageFilter },
              { projection: { id: 1, page_number: 1, book_id: 1, 'translation.data': 1, 'ocr.data': 1 } }
            )
            .limit(pageLimit)
            .toArray();
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
            { projection: { id: 1, title: 1, display_title: 1, author: 1, thumbnail: 1, thumbnail_blob: 1, language: 1, published: 1, pages_count: 1, pages_translated: 1, doi: 1, categories: 1, hidden: 1, quality_score: 1 } }
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
        if (seenBooks.has(book.id)) continue;

        const translationText = page.translation?.data as string || '';
        const ocrText = page.ocr?.data as string || '';
        const snippetSource = translationText ? translationText : ocrText;
        const snippetType = translationText ? 'translation' : 'ocr';

        results.push({
          id: `${book.id}-p${page.page_number}`,
          type: 'page',
          book_id: book.id,
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
          snippet: extractSnippet(snippetSource, query),
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

        // Use $text for nearby search too, with year range filter
        let nearbyBooks;
        try {
          const nearbyFilter: Record<string, unknown> = {
            $text: { $search: query },
            published: { $regex: nearbyPattern },
          };
          if (seenBooks.size > 0) nearbyFilter.id = { $nin: Array.from(seenBooks) };
          if (language) nearbyFilter.language = language;
          if (category) nearbyFilter.categories = category;

          nearbyBooks = await db.collection('books')
            .find(nearbyFilter, { projection: { score: { $meta: 'textScore' } } })
            .sort({ score: { $meta: 'textScore' } })
            .limit(10)
            .toArray();
        } catch {
          // Fallback: regex
          const nearbyFilter: Record<string, unknown> = {
            $or: [
              { title: queryRegex },
              { display_title: queryRegex },
              { author: queryRegex },
              { 'summary.data': queryRegex },
              { summary: queryRegex },
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
      filters: { language, category, year, bookId },
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
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
