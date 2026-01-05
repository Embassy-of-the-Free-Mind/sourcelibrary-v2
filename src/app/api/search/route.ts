import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { Book } from '@/lib/types';
import { normalizeText } from '@/lib/utils';

interface SearchResult {
  id: string;
  type: 'book' | 'page';
  book_id: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  page_count?: number;
  translated_count?: number;
  has_doi: boolean;
  doi?: string;
  summary?: string;
  categories?: string[];
  // For page results
  page_number?: number;
  snippet?: string;
  snippet_type?: 'translation' | 'ocr' | 'summary';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSnippet(text: string, query: string, contextChars = 150): string {
  // Use normalized text for finding the match position (handles diacritics)
  const normalizedText = normalizeText(text);
  const normalizedQuery = normalizeText(query);
  const index = normalizedText.indexOf(normalizedQuery);

  if (index === -1) {
    // If exact match not found, return start of text
    return text.slice(0, contextChars * 2) + (text.length > contextChars * 2 ? '...' : '');
  }

  // Use original text for the snippet (preserves diacritics in output)
  const start = Math.max(0, index - contextChars);
  const end = Math.min(text.length, index + query.length + contextChars);

  let snippet = text.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

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
    const hasDoi = searchParams.get('has_doi');
    const hasTranslation = searchParams.get('has_translation');
    const bookId = searchParams.get('book_id'); // Filter to specific book
    const searchContent = searchParams.get('search_content') !== 'false'; // Default true
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

    // Build regex for text search
    // Note: MongoDB regex doesn't support diacritic-insensitive search natively.
    // Client-side filtering (BookLibrary) and snippet extraction handle diacritics.
    // For full DB-level diacritic support, consider text indexes with collation.
    const queryRegex = new RegExp(escapeRegex(query), 'i');

    // When searching within a specific book, skip book-level search
    // and only search page content
    if (!bookId) {
      // Build book filter
      const bookFilter: Record<string, unknown> = {};

      // Text search on books (title, author, display_title)
      bookFilter.$or = [
        { title: queryRegex },
        { display_title: queryRegex },
        { author: queryRegex },
        { 'summary.data': queryRegex },
        { summary: queryRegex }, // For string summaries
      ];

      if (language) {
        bookFilter.language = language;
      }

      if (category) {
        bookFilter.categories = category;
      }

      if (dateFrom || dateTo) {
        bookFilter.published = {};
        if (dateFrom) (bookFilter.published as Record<string, string>).$gte = dateFrom;
        if (dateTo) (bookFilter.published as Record<string, string>).$lte = dateTo;
      }

      if (hasDoi === 'true') {
        bookFilter.doi = { $exists: true, $ne: null };
      }

      if (hasTranslation === 'true') {
        bookFilter.pages_translated = { $gt: 0 };
      }

      // Search books
      const books = await db.collection('books')
        .find(bookFilter)
        .limit(limit)
        .toArray();

      for (const book of books) {
        const typedBook = book as unknown as Book;
        const summaryText = typeof typedBook.summary === 'string'
          ? typedBook.summary
          : typedBook.summary?.data;

        results.push({
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
        });
        seenBooks.add(typedBook.id);
      }
    }

    // Search page translations if requested and we have room
    // When searching within a specific book, always search content
    if (searchContent && (bookId || results.length < limit)) {
      const pageFilter: Record<string, unknown> = {
        'translation.data': queryRegex,
      };

      // If searching within a specific book, filter to that book only
      if (bookId) {
        pageFilter.book_id = bookId;
      }

      // Apply book-level filters via lookup or pre-fetch book IDs
      let allowedBookIds: string[] | null = null;
      if (!bookId && (language || category || dateFrom || dateTo || hasDoi === 'true' || hasTranslation === 'true')) {
        const bookIdFilter: Record<string, unknown> = {};
        if (language) bookIdFilter.language = language;
        if (category) bookIdFilter.categories = category;
        if (dateFrom || dateTo) {
          bookIdFilter.published = {};
          if (dateFrom) (bookIdFilter.published as Record<string, string>).$gte = dateFrom;
          if (dateTo) (bookIdFilter.published as Record<string, string>).$lte = dateTo;
        }
        if (hasDoi === 'true') {
          bookIdFilter.doi = { $exists: true, $ne: null };
        }

        const filteredBooks = await db.collection('books')
          .find(bookIdFilter)
          .project({ id: 1 })
          .toArray();
        allowedBookIds = filteredBooks.map(b => b.id);

        if (allowedBookIds.length > 0) {
          pageFilter.book_id = { $in: allowedBookIds };
        }
      }

      const pages = await db.collection('pages')
        .find(pageFilter)
        .limit(limit - results.length)
        .toArray();

      // Get book info for page results
      const bookIds = [...new Set(pages.map(p => p.book_id as string))];
      const bookMap = new Map<string, Book>();

      if (bookIds.length > 0) {
        const pageBooks = await db.collection('books')
          .find({ id: { $in: bookIds } })
          .toArray();
        for (const b of pageBooks) {
          bookMap.set(b.id as string, b as unknown as Book);
        }
      }

      for (const page of pages) {
        const book = bookMap.get(page.book_id as string);
        if (!book) continue;

        // Skip if we already have this book in results
        if (seenBooks.has(book.id)) continue;

        const translationText = page.translation?.data as string || '';

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
          snippet: extractSnippet(translationText, query),
          snippet_type: 'translation',
        });
      }
    }

    // Sort: books first, then by relevance (title match > content match)
    results.sort((a, b) => {
      // Books before pages
      if (a.type !== b.type) return a.type === 'book' ? -1 : 1;
      // Title matches first
      const aTitle = (a.display_title || a.title).toLowerCase();
      const bTitle = (b.display_title || b.title).toLowerCase();
      const queryLower = query.toLowerCase();
      const aTitleMatch = aTitle.includes(queryLower);
      const bTitleMatch = bTitle.includes(queryLower);
      if (aTitleMatch !== bTitleMatch) return aTitleMatch ? -1 : 1;
      return 0;
    });

    // Apply offset
    const paginatedResults = results.slice(offset, offset + limit);

    return NextResponse.json({
      query,
      total: results.length,
      offset,
      limit,
      results: paginatedResults,
      filters: {
        language,
        category,
        date_from: dateFrom,
        date_to: dateTo,
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
