import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { normalizeText } from '@/lib/utils';

interface BookResult {
  id: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  translation_percent?: number;
}

interface IndexResult {
  type: 'concept' | 'person' | 'place' | 'keyword';
  term: string;
  book_id: string;
  book_title: string;
  pages?: number[];
}

/**
 * GET /api/search/unified
 *
 * Fast unified search across books and index.
 * Returns grouped results for the homepage dropdown.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '5'), 10);

    if (!query || query.length < 2) {
      return NextResponse.json({
        query: '',
        books: { results: [], total: 0 },
        index: { results: [], total: 0 }
      });
    }

    const db = await getDb();
    const queryRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const queryNormalized = normalizeText(query);

    // Run book and index search in parallel
    const [booksResult, indexResult] = await Promise.all([
      searchBooks(db, queryRegex, limit),
      searchIndex(db, queryNormalized, limit)
    ]);

    return NextResponse.json({
      query,
      books: booksResult,
      index: indexResult
    });
  } catch (error) {
    console.error('Unified search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

async function searchBooks(db: any, queryRegex: RegExp, limit: number) {
  const books = await db.collection('books')
    .find({
      $or: [
        { title: queryRegex },
        { display_title: queryRegex },
        { author: queryRegex }
      ]
    })
    .project({
      id: 1,
      title: 1,
      display_title: 1,
      author: 1,
      language: 1,
      published: 1,
      pages_count: 1,
      pages_translated: 1
    })
    .limit(limit)
    .toArray();

  const total = await db.collection('books').countDocuments({
    $or: [
      { title: queryRegex },
      { display_title: queryRegex },
      { author: queryRegex }
    ]
  });

  return {
    results: books.map((b: any) => ({
      id: b.id,
      title: b.title,
      display_title: b.display_title,
      author: b.author || 'Unknown',
      language: b.language || 'Unknown',
      published: b.published || 'Unknown',
      translation_percent: b.pages_count > 0 ? Math.round((b.pages_translated || 0) / b.pages_count * 100) : 0
    })),
    total
  };
}

async function searchIndex(db: any, queryNormalized: string, limit: number) {
  const books = await db.collection('books')
    .find({ 'index.generatedAt': { $exists: true } })
    .project({
      id: 1,
      display_title: 1,
      title: 1,
      'index.keywords': 1,
      'index.people': 1,
      'index.places': 1,
      'index.concepts': 1
    })
    .toArray();

  const results: IndexResult[] = [];
  let total = 0;

  for (const book of books) {
    const bookTitle = book.display_title || book.title;
    const index = book.index || {};

    const searchInArray = (arr: any[], type: IndexResult['type']) => {
      for (const entry of (arr || [])) {
        if (entry.term && normalizeText(entry.term).includes(queryNormalized)) {
          total++;
          if (results.length < limit) {
            results.push({
              type,
              term: entry.term,
              book_id: book.id,
              book_title: bookTitle,
              pages: entry.pages
            });
          }
        }
      }
    };

    searchInArray(index.concepts, 'concept');
    searchInArray(index.people, 'person');
    searchInArray(index.places, 'place');
    searchInArray(index.keywords, 'keyword');
  }

  results.sort((a, b) => a.term.length - b.term.length);

  return { results, total };
}
