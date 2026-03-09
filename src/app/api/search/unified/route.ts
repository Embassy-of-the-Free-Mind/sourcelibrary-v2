import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const preferredRegion = 'fra1';

interface BookResult {
  id: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  translation_percent?: number;
  thumbnail?: string;
  thumbnail_blob?: string;
}

interface IndexResult {
  type: 'concept' | 'person' | 'place' | 'keyword';
  term: string;
  book_id: string;
  book_slug?: string;
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

    // Run book, index, and gallery search in parallel (each handles its own errors)
    const [booksResult, indexResult, galleryResult] = await Promise.all([
      searchBooks(db, query, queryRegex, limit),
      searchIndex(db, query, limit).catch((err) => {
        console.error('Index search error:', err);
        return { results: [] as IndexResult[], total: 0 };
      }),
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

  try {
    // Use $text index for fast, relevance-ranked search
    const projection = {
      id: 1, title: 1, display_title: 1, author: 1,
      language: 1, published: 1, pages_count: 1, pages_translated: 1,
      thumbnail: 1, thumbnail_blob: 1,
      score: { $meta: 'textScore' },
    };
    books = await db.collection('books')
      .find({ $text: { $search: query }, hidden: { $ne: true } }, { projection })
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .toArray();
  } catch {
    // Fallback to regex
    books = await db.collection('books')
      .find({
        $or: [
          { title: queryRegex },
          { display_title: queryRegex },
          { author: queryRegex },
          { 'reading_summary.overview': queryRegex },
        ],
        hidden: { $ne: true },
      })
      .project({ id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, pages_count: 1, pages_translated: 1, thumbnail: 1, thumbnail_blob: 1 })
      .limit(limit)
      .toArray();
  }

  return {
    results: books.map((b: any) => ({
      id: b.id,
      title: b.title,
      display_title: b.display_title,
      author: b.author || 'Unknown',
      language: b.language || 'Unknown',
      published: b.published || 'Unknown',
      translation_percent: (b.pages_ocr || 0) > 0 ? Math.round((b.pages_translated || 0) / (b.pages_ocr || 1) * 100) : 0,
      thumbnail: b.thumbnail,
      thumbnail_blob: b.thumbnail_blob,
    })),
    total: books.length
  };
}

async function searchIndex(db: any, query: string, limit: number) {
  // Use MongoDB aggregation to filter server-side instead of loading all indexes into memory
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const queryRegex = new RegExp(escapedQuery, 'i');

  const results = await db.collection('books').aggregate([
    // Pre-filter: only books with at least one matching term
    { $match: {
        'index.generatedAt': { $exists: true },
        hidden: { $ne: true },
        $or: [
          { 'index.concepts.term': queryRegex },
          { 'index.people.term': queryRegex },
          { 'index.places.term': queryRegex },
          { 'index.keywords.term': queryRegex }
        ]
      }
    },
    // Merge all index arrays with type labels
    { $project: {
        id: 1,
        slug: 1,
        book_title: { $ifNull: ['$display_title', '$title'] },
        entries: { $concatArrays: [
          { $map: { input: { $ifNull: ['$index.concepts', []] }, as: 'e', in: { term: '$$e.term', pages: '$$e.pages', type: 'concept' } } },
          { $map: { input: { $ifNull: ['$index.people', []] }, as: 'e', in: { term: '$$e.term', pages: '$$e.pages', type: 'person' } } },
          { $map: { input: { $ifNull: ['$index.places', []] }, as: 'e', in: { term: '$$e.term', pages: '$$e.pages', type: 'place' } } },
          { $map: { input: { $ifNull: ['$index.keywords', []] }, as: 'e', in: { term: '$$e.term', pages: '$$e.pages', type: 'keyword' } } }
        ] }
      }
    },
    { $unwind: '$entries' },
    { $match: { 'entries.term': queryRegex } },
    { $addFields: { _termLen: { $strLenCP: '$entries.term' } } },
    { $sort: { _termLen: 1 } },
    { $limit: limit },
    { $project: {
        _id: 0,
        type: '$entries.type',
        term: '$entries.term',
        book_id: '$id',
        book_slug: '$slug',
        book_title: 1,
        pages: '$entries.pages'
      }
    }
  ], { maxTimeMS: 5000 }).toArray();

  return { results: results as IndexResult[], total: results.length };
}

async function searchGallery(db: any, queryRegex: RegExp, limit: number): Promise<{ results: GalleryResult[]; total: number }> {
  try {
    // Use materialized gallery_images collection (indexed, much faster than scanning pages)
    const images = await db.collection('gallery_images')
      .find(
        {
          gallery_quality: { $gte: 0.5 },
          $or: [
            { description: queryRegex },
            { museum_description: queryRegex },
            { 'metadata.subjects': queryRegex },
            { 'metadata.figures': queryRegex },
          ],
        },
        { projection: { page_id: 1, detection_index: 1, description: 1, type: 1, thumbnail_url: 1, extracted_url: 1, book_id: 1, book_title: 1, gallery_quality: 1 } }
      )
      .sort({ gallery_quality: -1 })
      .limit(limit)
      .maxTimeMS(3000)
      .toArray();

    return {
      results: images.map((img: any) => ({
        id: `${img.page_id}-${img.detection_index}`,
        imageUrl: img.thumbnail_url || img.extracted_url || '',
        description: img.description || '',
        type: img.type,
        bookTitle: img.book_title || '',
        bookId: img.book_id || '',
      })),
      total: images.length,
    };
  } catch (err) {
    console.error('Gallery search error:', err);
    return { results: [], total: 0 };
  }
}
