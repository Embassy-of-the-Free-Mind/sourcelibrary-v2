import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { normalizeText } from '@/lib/utils';

interface IndexSearchResult {
  type: 'keyword' | 'concept' | 'person' | 'place' | 'vocabulary' | 'quote';
  term: string;
  book_id: string;
  book_title: string;
  book_author: string;
  pages?: number[];
  // For quotes
  quote_text?: string;
  quote_page?: number;
  quote_significance?: string;
  section_title?: string;
}

// GET /api/search/index - Search across all book indexes
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const type = searchParams.get('type'); // Filter by type: keyword, concept, person, place, vocabulary, quote
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

    if (!query || query.length < 2) {
      return NextResponse.json({
        error: 'Query must be at least 2 characters',
        results: [],
        total: 0,
      }, { status: 400 });
    }

    const db = await getDb();
    const results: IndexSearchResult[] = [];
    const queryNormalized = normalizeText(query);

    // Get all books with indexes
    const books = await db.collection('books')
      .find({ 'index.generatedAt': { $exists: true } })
      .project({
        id: 1,
        display_title: 1,
        title: 1,
        author: 1,
        'index.vocabulary': 1,
        'index.keywords': 1,
        'index.people': 1,
        'index.places': 1,
        'index.concepts': 1,
        'index.sectionSummaries': 1,
      })
      .toArray();

    for (const book of books) {
      const bookTitle = book.display_title || book.title;
      const bookAuthor = book.author || 'Unknown';
      const index = book.index || {};

      // Search vocabulary (original language terms)
      if (!type || type === 'vocabulary') {
        for (const entry of (index.vocabulary || [])) {
          if (entry.term && normalizeText(entry.term).includes(queryNormalized)) {
            results.push({
              type: 'vocabulary',
              term: entry.term,
              book_id: book.id,
              book_title: bookTitle,
              book_author: bookAuthor,
              pages: entry.pages,
            });
          }
        }
      }

      // Search keywords
      if (!type || type === 'keyword') {
        for (const entry of (index.keywords || [])) {
          if (entry.term && normalizeText(entry.term).includes(queryNormalized)) {
            results.push({
              type: 'keyword',
              term: entry.term,
              book_id: book.id,
              book_title: bookTitle,
              book_author: bookAuthor,
              pages: entry.pages,
            });
          }
        }
      }

      // Search people
      if (!type || type === 'person') {
        for (const entry of (index.people || [])) {
          if (entry.term && normalizeText(entry.term).includes(queryNormalized)) {
            results.push({
              type: 'person',
              term: entry.term,
              book_id: book.id,
              book_title: bookTitle,
              book_author: bookAuthor,
              pages: entry.pages,
            });
          }
        }
      }

      // Search places
      if (!type || type === 'place') {
        for (const entry of (index.places || [])) {
          if (entry.term && normalizeText(entry.term).includes(queryNormalized)) {
            results.push({
              type: 'place',
              term: entry.term,
              book_id: book.id,
              book_title: bookTitle,
              book_author: bookAuthor,
              pages: entry.pages,
            });
          }
        }
      }

      // Search concepts
      if (!type || type === 'concept') {
        for (const entry of (index.concepts || [])) {
          if (entry.term && normalizeText(entry.term).includes(queryNormalized)) {
            results.push({
              type: 'concept',
              term: entry.term,
              book_id: book.id,
              book_title: bookTitle,
              book_author: bookAuthor,
              pages: entry.pages,
            });
          }
        }
      }

      // Search quotes in section summaries
      if (!type || type === 'quote') {
        for (const section of (index.sectionSummaries || [])) {
          for (const quote of (section.quotes || [])) {
            if (quote.text && normalizeText(quote.text).includes(queryNormalized)) {
              results.push({
                type: 'quote',
                term: quote.text.substring(0, 100) + (quote.text.length > 100 ? '...' : ''),
                book_id: book.id,
                book_title: bookTitle,
                book_author: bookAuthor,
                quote_text: quote.text,
                quote_page: quote.page,
                quote_significance: quote.significance,
                section_title: section.title,
              });
            }
          }
        }
      }
    }

    // Sort by relevance (exact matches first, then by frequency of pages)
    results.sort((a, b) => {
      const aExact = normalizeText(a.term) === queryNormalized;
      const bExact = normalizeText(b.term) === queryNormalized;
      if (aExact !== bExact) return aExact ? -1 : 1;

      // Then by number of page references (more = more important)
      const aPages = a.pages?.length || 0;
      const bPages = b.pages?.length || 0;
      return bPages - aPages;
    });

    // Group results by type for summary
    const byType = {
      vocabulary: results.filter(r => r.type === 'vocabulary').length,
      keyword: results.filter(r => r.type === 'keyword').length,
      concept: results.filter(r => r.type === 'concept').length,
      person: results.filter(r => r.type === 'person').length,
      place: results.filter(r => r.type === 'place').length,
      quote: results.filter(r => r.type === 'quote').length,
    };

    return NextResponse.json({
      query,
      total: results.length,
      byType,
      results: results.slice(0, limit),
    });
  } catch (error) {
    console.error('Index search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
