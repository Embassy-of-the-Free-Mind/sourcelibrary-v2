import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { buildBookSearchStage, type BookSearchFilters } from '@/lib/atlas-search';
import type { SearchResult } from '@/lib/api-client/types/search';

const ENTITIES_SEARCH_INDEX = 'entities_search';
const GALLERY_SEARCH_INDEX = 'gallery_search';

export const preferredRegion = 'fra1';

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
 * Fast unified search across books, index, and gallery in ONE request.
 * Designed for typeahead — no page content search (that's the slow part).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '5'), 10);
    const galleryLimit = Math.min(parseInt(searchParams.get('gallery_limit') || '6'), 12);

    // Parse filters
    const language = searchParams.get('language') || undefined;
    const category = searchParams.get('category') || undefined;
    const firstTranslation = searchParams.get('first_translation') === 'true';
    const hasTranslation = searchParams.get('has_translation') === 'true';
    const library = searchParams.get('library') || undefined;

    if (!query || query.length < 2) {
      return NextResponse.json({
        query: '',
        books: { results: [], total: 0 },
        index: { results: [], total: 0 },
        gallery: { results: [], total: 0 },
      });
    }

    const db = await getDb();
    const queryRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    // Build Atlas Search filters
    const searchFilters: BookSearchFilters = {};
    if (language) searchFilters.language = language;
    if (category) searchFilters.category = category;
    if (firstTranslation) searchFilters.isFirstTranslation = true;
    if (hasTranslation) searchFilters.hasTranslation = true;

    // Run book, index, and gallery search in parallel (each handles its own errors)
    const [booksResult, indexResult, galleryResult] = await Promise.all([
      searchBooks(db, query, queryRegex, limit, searchFilters, library),
      searchIndex(db, query, limit).catch((err) => {
        console.error('Index search error:', err);
        return { results: [] as IndexResult[], total: 0 };
      }),
      searchGallery(db, query, queryRegex, galleryLimit),
    ]);

    // Log search query (fire-and-forget)
    db.collection('analytics_events').insertOne({
      event: 'search_query',
      query,
      results_count: booksResult.total + indexResult.total + galleryResult.total,
      filters: { language, category, library, source: 'unified' },
      timestamp: new Date(),
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
      created_at: new Date(),
    }).catch(() => {});

    return NextResponse.json({
      query,
      books: booksResult,
      index: indexResult,
      gallery: galleryResult,
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

async function searchBooks(
  db: any,
  query: string,
  queryRegex: RegExp,
  limit: number,
  searchFilters: BookSearchFilters,
  library?: string,
) {
  const bookProjection = {
    id: 1, slug: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1,
    pages_count: 1, pages_translated: 1, pages_ocr: 1, pages_blank: 1,
    thumbnail: 1, thumbnail_blob: 1, doi: 1, categories: 1, quality_score: 1,
    'reading_summary.overview': 1,
  };

  let books;

  try {
    // Use Atlas Search with autocomplete + fuzzy for instant prefix matching
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipeline: any[] = [
      buildBookSearchStage(query, searchFilters, { autocomplete: true, fuzzy: true }),
    ];

    // Post-filter for fields not in Atlas Search index
    const postMatch: Record<string, unknown> = {};
    if (library) postMatch['image_source.provider'] = library;
    if (Object.keys(postMatch).length > 0) {
      pipeline.push({ $limit: limit * 3 });
      pipeline.push({ $match: postMatch });
    }

    pipeline.push({ $limit: limit });
    pipeline.push({ $project: bookProjection });

    books = await db.collection('books').aggregate(pipeline, { maxTimeMS: 5000 }).toArray();
  } catch {
    // Fallback to regex if Atlas Search index not available
    const regexFilter: Record<string, unknown> = {
      $or: [
        { title: queryRegex },
        { display_title: queryRegex },
        { author: queryRegex },
        { 'reading_summary.overview': queryRegex },
      ],
      visible: true,
      pages_count: { $gt: 0 },
    };
    if (searchFilters.language) regexFilter.language = searchFilters.language;
    if (searchFilters.category) regexFilter.categories = searchFilters.category;
    if (searchFilters.isFirstTranslation) regexFilter.is_first_translation = true;
    if (searchFilters.hasTranslation) regexFilter.pages_translated = { $gt: 0 };
    if (library) regexFilter['image_source.provider'] = library;

    books = await db.collection('books')
      .find(regexFilter)
      .project(bookProjection)
      .limit(limit)
      .toArray();
  }

  // Author alias expansion: if results are sparse and query matches an entity alias,
  // include books linked to that entity (catches variant name searches like "Marsilius Ficinus")
  if (books.length < limit) {
    const seenIds = new Set(books.map((b: any) => b.id));
    const entity = await db.collection('entities').findOne({
      type: 'person',
      canonical_name: { $exists: true },
      $or: [
        { canonical_name: queryRegex },
        { aliases: queryRegex },
        { name: queryRegex },
      ],
    }, { projection: { _id: 1 }, maxTimeMS: 2000 }).catch(() => null);

    if (entity) {
      const aliasFilter: Record<string, unknown> = {
        author_entity_id: entity._id.toString(),
        visible: true,
        pages_count: { $gt: 0 },
      };
      if (library) aliasFilter['image_source.provider'] = library;

      const aliasBooks = await db.collection('books')
        .find(aliasFilter)
        .project(bookProjection)
        .limit(limit - books.length)
        .maxTimeMS(3000)
        .toArray();

      for (const ab of aliasBooks) {
        if (!seenIds.has(ab.id)) {
          books.push(ab);
          seenIds.add(ab.id);
        }
      }
    }
  }

  return {
    results: books.map((b: any): SearchResult => {
      const summaryText = b.reading_summary?.overview;
      return {
        id: b.id,
        type: 'book',
        book_id: b.id,
        slug: b.slug,
        title: b.title,
        display_title: b.display_title,
        author: b.author || 'Unknown',
        language: b.language || 'Unknown',
        published: b.published || 'Unknown',
        page_count: b.pages_count,
        translated_count: b.pages_translated,
        has_doi: !!b.doi,
        doi: b.doi,
        categories: b.categories,
        summary: summaryText ? summaryText.slice(0, 300) : undefined,
        snippet_type: summaryText ? 'summary' : undefined,
        thumbnail: b.thumbnail,
        thumbnail_blob: b.thumbnail_blob,
        quality_score: b.quality_score,
      };
    }),
    total: books.length,
  };
}

async function searchIndex(db: any, query: string, limit: number) {
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const queryRegex = new RegExp(escapedQuery, 'i');

  let entities;
  try {
    // Use Atlas Search with autocomplete + fuzzy, boost by book_count for popularity
    entities = await db.collection('entities').aggregate([
      {
        $search: {
          index: ENTITIES_SEARCH_INDEX,
          compound: {
            should: [
              { autocomplete: { query, path: 'name', score: { boost: { value: 3 } }, fuzzy: { maxEdits: 1, prefixLength: 2 } } },
              { autocomplete: { query, path: 'aliases', fuzzy: { maxEdits: 1, prefixLength: 2 } } },
            ],
            minimumShouldMatch: 1,
            // Boost score by book_count so popular entities rank higher
            score: { boost: { path: 'book_count', undefined: 1 } },
          },
        },
      },
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
      visible: true,
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
      // Use Atlas Search with autocomplete on description + fuzzy text on other fields
      images = await db.collection('gallery_images').aggregate([
        {
          $search: {
            index: GALLERY_SEARCH_INDEX,
            compound: {
              should: [
                { autocomplete: { query, path: 'description', score: { boost: { value: 3 } }, fuzzy: { maxEdits: 1, prefixLength: 2 } } },
                { text: { query, path: 'museum_description', score: { boost: { value: 2 } }, fuzzy: { maxEdits: 1, prefixLength: 2 } } },
                { text: { query, path: 'metadata.subjects', fuzzy: { maxEdits: 1, prefixLength: 2 } } },
                { text: { query, path: 'metadata.figures', fuzzy: { maxEdits: 1, prefixLength: 2 } } },
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
