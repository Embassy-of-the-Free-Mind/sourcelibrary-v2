import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { buildBookSearchStage } from '@/lib/atlas-search';

const ENTITIES_SEARCH_INDEX = 'entities_search';
const GALLERY_SEARCH_INDEX = 'gallery_search';

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
      searchGallery(db, query, queryRegex, 3)
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
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Unified search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

async function searchBooks(db: any, query: string, queryRegex: RegExp, limit: number) {
  let books;

  try {
    // Use Atlas Search for fast, relevance-ranked search
    books = await db.collection('books').aggregate([
      buildBookSearchStage(query),
      { $limit: limit },
      { $project: { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, pages_count: 1, pages_translated: 1, pages_ocr: 1, thumbnail: 1, thumbnail_blob: 1 } },
    ], { maxTimeMS: 5000 }).toArray();
  } catch {
    // Fallback to regex if Atlas Search index not available
    books = await db.collection('books')
      .find({
        $or: [
          { title: queryRegex },
          { display_title: queryRegex },
          { author: queryRegex },
          { 'reading_summary.overview': queryRegex },
        ],
        hidden: { $ne: true },
        pages_count: { $gt: 0 },
      })
      .project({ id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, pages_count: 1, pages_translated: 1, pages_ocr: 1, thumbnail: 1, thumbnail_blob: 1 })
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
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const queryRegex = new RegExp(escapedQuery, 'i');

  let entities;
  try {
    // Use Atlas Search for fast, relevance-ranked entity search
    entities = await db.collection('entities').aggregate([
      {
        $search: {
          index: ENTITIES_SEARCH_INDEX,
          compound: {
            should: [
              { text: { query, path: 'name', score: { boost: { value: 3 } } } },
              { text: { query, path: 'aliases' } },
            ],
            minimumShouldMatch: 1,
          },
        },
      },
      { $sort: { book_count: -1 } },
      { $limit: limit * 3 },
      { $project: { name: 1, type: 1, books: 1 } },
    ], { maxTimeMS: 5000 }).toArray();
  } catch {
    // Fallback to regex if Atlas Search index not ready
    entities = await db.collection('entities')
      .find({
        $or: [
          { name: queryRegex },
          { aliases: queryRegex },
        ],
      })
      .project({ name: 1, type: 1, books: 1 })
      .sort({ book_count: -1 })
      .limit(limit * 3)
      .maxTimeMS(5000)
      .toArray();
  }

  // Expand each entity into per-book results (matching the IndexResult shape)
  const results: IndexResult[] = [];
  for (const entity of entities) {
    for (const book of (entity.books || []).slice(0, 2)) { // top 2 books per entity
      results.push({
        type: entity.type === 'person' ? 'person' : entity.type === 'place' ? 'place' : 'concept',
        term: entity.name,
        book_id: book.book_id,
        book_title: book.book_title || '',
        pages: book.pages?.slice(0, 10),
      });
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  // Fallback: if entities returned nothing, check book keyword indexes
  // (covers multi-word phrases like "sky people" not synced to entities)
  if (results.length === 0 && query.length >= 4) {
    const books = await db.collection('books').find({
      'index.generatedAt': { $exists: true },
      hidden: { $ne: true },
      $or: [
        { 'index.concepts.term': queryRegex },
        { 'index.people.term': queryRegex },
        { 'index.places.term': queryRegex },
        { 'index.keywords.term': queryRegex },
      ],
    }).project({
      id: 1, slug: 1, title: 1, display_title: 1,
      'index.concepts': 1, 'index.people': 1, 'index.places': 1, 'index.keywords': 1,
    }).limit(limit).maxTimeMS(5000).toArray();

    for (const book of books) {
      const allEntries = [
        ...(book.index?.concepts || []).map((e: any) => ({ ...e, type: 'concept' as const })),
        ...(book.index?.people || []).map((e: any) => ({ ...e, type: 'person' as const })),
        ...(book.index?.places || []).map((e: any) => ({ ...e, type: 'place' as const })),
        ...(book.index?.keywords || []).map((e: any) => ({ ...e, type: 'keyword' as const })),
      ];
      const match = allEntries.find(e => queryRegex.test(e.term));
      if (match) {
        results.push({
          type: match.type,
          term: match.term,
          book_id: book.id,
          book_slug: book.slug,
          book_title: book.display_title || book.title || '',
          pages: match.pages?.slice(0, 10),
        });
      }
      if (results.length >= limit) break;
    }
  }

  return { results, total: results.length };
}

async function searchGallery(db: any, query: string, queryRegex: RegExp, limit: number): Promise<{ results: GalleryResult[]; total: number }> {
  try {
    let images;
    try {
      // Use Atlas Search for fast, relevance-ranked gallery search
      images = await db.collection('gallery_images').aggregate([
        {
          $search: {
            index: GALLERY_SEARCH_INDEX,
            compound: {
              should: [
                { text: { query, path: 'description', score: { boost: { value: 3 } } } },
                { text: { query, path: 'museum_description', score: { boost: { value: 2 } } } },
                { text: { query, path: 'metadata.subjects' } },
                { text: { query, path: 'metadata.figures' } },
              ],
              minimumShouldMatch: 1,
              filter: [
                { range: { path: 'gallery_quality', gte: 0.5 } },
              ],
            },
          },
        },
        { $limit: limit },
        { $project: { page_id: 1, detection_index: 1, description: 1, type: 1, thumbnail_url: 1, extracted_url: 1, book_id: 1, book_title: 1, gallery_quality: 1 } },
      ], { maxTimeMS: 3000 }).toArray();
    } catch {
      // Fallback to regex if Atlas Search index not ready
      images = await db.collection('gallery_images')
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
    }

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
