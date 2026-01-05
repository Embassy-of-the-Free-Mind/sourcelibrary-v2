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
  pages_count?: number;
  pages_translated?: number;
  translation_percent?: number;
  thumbnail?: string;
}

interface ImageResult {
  id: string;
  pageId: string;
  detectionIndex: number;
  imageUrl: string;
  description: string;
  type?: string;
  bookTitle: string;
  bookId: string;
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface IndexResult {
  type: 'keyword' | 'concept' | 'person' | 'place' | 'vocabulary' | 'quote';
  term: string;
  book_id: string;
  book_title: string;
  pages?: number[];
}

interface UnifiedSearchResponse {
  query: string;
  books: {
    results: BookResult[];
    total: number;
  };
  images: {
    results: ImageResult[];
    total: number;
  };
  index: {
    results: IndexResult[];
    total: number;
    byType: Record<string, number>;
  };
}

/**
 * GET /api/search/unified
 *
 * Unified search across books, images, and index.
 * Returns grouped results from all three sources.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '6'), 20);

    if (!query || query.length < 2) {
      return NextResponse.json({
        error: 'Query must be at least 2 characters',
        query: '',
        books: { results: [], total: 0 },
        images: { results: [], total: 0 },
        index: { results: [], total: 0, byType: {} }
      }, { status: 400 });
    }

    const db = await getDb();
    const queryNormalized = normalizeText(query);
    const queryRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    // Run all three searches in parallel
    const [booksResult, imagesResult, indexResult] = await Promise.all([
      // 1. Search books
      searchBooks(db, queryRegex, limit),
      // 2. Search images
      searchImages(db, queryRegex, limit),
      // 3. Search index
      searchIndex(db, queryNormalized, limit)
    ]);

    const response: UnifiedSearchResponse = {
      query,
      books: booksResult,
      images: imagesResult,
      index: indexResult
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Unified search error:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
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
      pages_translated: 1,
      thumbnail: 1
    })
    .limit(limit)
    .toArray();

  // Get total count
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
      pages_count: b.pages_count,
      pages_translated: b.pages_translated,
      translation_percent: b.pages_count > 0 ? Math.round((b.pages_translated || 0) / b.pages_count * 100) : 0,
      thumbnail: b.thumbnail
    })),
    total
  };
}

async function searchImages(db: any, queryRegex: RegExp, limit: number) {
  const pipeline = [
    {
      $match: {
        'detected_images': { $exists: true, $ne: [] },
        $or: [
          { cropped_photo: { $exists: true, $ne: '' } },
          { photo_original: { $exists: true, $ne: '' } }
        ]
      }
    },
    { $unwind: { path: '$detected_images', includeArrayIndex: 'detectionIndex' } },
    {
      $match: {
        'detected_images.gallery_quality': { $gte: 0.5 },
        'detected_images.bbox': { $exists: true },
        $or: [
          { 'detected_images.description': queryRegex },
          { 'detected_images.museum_description': queryRegex },
          { 'detected_images.metadata.subjects': queryRegex },
          { 'detected_images.metadata.figures': queryRegex },
          { 'detected_images.metadata.symbols': queryRegex }
        ]
      }
    },
    {
      $lookup: {
        from: 'books',
        localField: 'book_id',
        foreignField: 'id',
        as: 'book'
      }
    },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
    { $sort: { 'detected_images.gallery_quality': -1 } },
    {
      $facet: {
        results: [
          { $limit: limit },
          {
            $project: {
              id: { $concat: ['$id', ':', { $toString: '$detectionIndex' }] },
              pageId: '$id',
              detectionIndex: '$detectionIndex',
              imageUrl: { $ifNull: ['$cropped_photo', { $ifNull: ['$photo_original', '$photo'] }] },
              description: '$detected_images.description',
              type: '$detected_images.type',
              bbox: '$detected_images.bbox',
              bookId: '$book_id',
              bookTitle: { $ifNull: ['$book.display_title', { $ifNull: ['$book.title', 'Unknown'] }] }
            }
          }
        ],
        total: [{ $count: 'count' }]
      }
    }
  ];

  const [result] = await db.collection('pages').aggregate(pipeline).toArray();

  return {
    results: result.results || [],
    total: result.total[0]?.count || 0
  };
}

async function searchIndex(db: any, queryNormalized: string, limit: number) {
  const books = await db.collection('books')
    .find({ 'index.generatedAt': { $exists: true } })
    .project({
      id: 1,
      display_title: 1,
      title: 1,
      'index.vocabulary': 1,
      'index.keywords': 1,
      'index.people': 1,
      'index.places': 1,
      'index.concepts': 1
    })
    .toArray();

  const results: IndexResult[] = [];
  const byType: Record<string, number> = {
    vocabulary: 0,
    keyword: 0,
    concept: 0,
    person: 0,
    place: 0
  };

  for (const book of books) {
    const bookTitle = book.display_title || book.title;
    const index = book.index || {};

    const searchInArray = (arr: any[], type: IndexResult['type']) => {
      for (const entry of (arr || [])) {
        if (entry.term && normalizeText(entry.term).includes(queryNormalized)) {
          byType[type]++;
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
    searchInArray(index.vocabulary, 'vocabulary');
  }

  // Sort by term length (shorter = more exact match)
  results.sort((a, b) => a.term.length - b.term.length);

  return {
    results: results.slice(0, limit),
    total: Object.values(byType).reduce((a, b) => a + b, 0),
    byType
  };
}
