import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { normalizeText } from '@/lib/utils';

export const preferredRegion = 'fra1';

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

interface GalleryResult {
  id: string;
  imageUrl: string;
  description: string;
  type?: string;
  bookTitle: string;
  bookId: string;
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

    // Run book, index, and gallery search in parallel
    const [booksResult, indexResult, galleryResult] = await Promise.all([
      searchBooks(db, query, queryRegex, limit),
      searchIndex(db, queryNormalized, limit),
      searchGallery(db, queryRegex, 3)
    ]);

    // Log search query (fire-and-forget)
    db.collection('analytics_events').insertOne({
      event: 'search_query',
      query,
      results_count: booksResult.total + indexResult.total + galleryResult.total,
      filters: { source: 'unified' },
      timestamp: new Date(),
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
      created_at: new Date(),
    }).catch(() => {});

    return NextResponse.json({
      query,
      books: booksResult,
      index: indexResult,
      gallery: galleryResult
    });
  } catch (error) {
    console.error('Unified search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

async function searchBooks(db: any, query: string, queryRegex: RegExp, limit: number) {
  let books;
  let total;

  try {
    // Use $text index for fast, relevance-ranked search
    const projection = {
      id: 1, title: 1, display_title: 1, author: 1,
      language: 1, published: 1, pages_count: 1, pages_translated: 1,
      score: { $meta: 'textScore' },
    };
    books = await db.collection('books')
      .find({ $text: { $search: query } }, { projection })
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .toArray();
    total = await db.collection('books').countDocuments({ $text: { $search: query } });
  } catch {
    // Fallback to regex
    const filter = {
      $or: [
        { title: queryRegex },
        { display_title: queryRegex },
        { author: queryRegex },
      ],
    };
    books = await db.collection('books')
      .find(filter)
      .project({ id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, pages_count: 1, pages_translated: 1 })
      .limit(limit)
      .toArray();
    total = await db.collection('books').countDocuments(filter);
  }

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

async function searchGallery(db: any, queryRegex: RegExp, limit: number): Promise<{ results: GalleryResult[]; total: number }> {
  try {
    const pages = await db.collection('pages').aggregate([
      {
        $match: {
          'detected_images.0': { $exists: true },
          $or: [
            { 'detected_images.description': queryRegex },
            { 'detected_images.museum_description': queryRegex },
            { 'detected_images.metadata.subjects': queryRegex },
            { 'detected_images.metadata.figures': queryRegex },
          ],
        },
      },
      { $limit: 20 },
      { $unwind: { path: '$detected_images', includeArrayIndex: 'detIdx' } },
      {
        $match: {
          'detected_images.gallery_quality': { $gte: 0.5 },
          'detected_images.bbox': { $exists: true },
          $or: [
            { 'detected_images.description': queryRegex },
            { 'detected_images.museum_description': queryRegex },
            { 'detected_images.metadata.subjects': queryRegex },
            { 'detected_images.metadata.figures': queryRegex },
          ],
        },
      },
      {
        $lookup: {
          from: 'books',
          localField: 'book_id',
          foreignField: 'id',
          as: 'book',
        },
      },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
      { $sort: { 'detected_images.gallery_quality': -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          id: { $concat: ['$id', '-', { $toString: '$detIdx' }] },
          imageUrl: {
            $ifNull: [
              '$detected_images.thumbnail_url',
              { $ifNull: ['$detected_images.extracted_url', '$cropped_photo'] },
            ],
          },
          description: '$detected_images.description',
          type: '$detected_images.type',
          bookTitle: { $ifNull: ['$book.display_title', '$book.title'] },
          bookId: '$book_id',
        },
      },
    ]).toArray();

    return {
      results: pages as GalleryResult[],
      total: pages.length,
    };
  } catch (err) {
    console.error('Gallery search error:', err);
    return { results: [], total: 0 };
  }
}
