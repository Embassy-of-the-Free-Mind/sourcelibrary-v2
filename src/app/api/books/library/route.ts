import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { buildBookSearchStage } from '@/lib/atlas-search';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

// In-memory cache for common browse views (keyed by filter combination)
const browseCache = new Map<string, { data: string; timestamp: number }>();
const BROWSE_CACHE_TTL = 60_000; // 1 minute
const MAX_CACHE_ENTRIES = 50;

type SortOption = 'recent-translation' | 'recent' | 'title-asc' | 'title-desc' | 'date_asc' | 'date_desc';

function buildSortStage(sort: SortOption, collection?: string): { $sort: Record<string, 1 | -1> } {
  switch (sort) {
    case 'recent':
      return { $sort: { last_processed: -1, title: 1 } as Record<string, 1 | -1> };
    case 'title-asc':
      return { $sort: { sort_title: 1 } as Record<string, 1 | -1> };
    case 'title-desc':
      return { $sort: { sort_title: -1 } as Record<string, 1 | -1> };
    case 'date_asc':
      return { $sort: { year: 1, title: 1 } as Record<string, 1 | -1> };
    case 'date_desc':
      return { $sort: { year: -1, title: 1 } as Record<string, 1 | -1> };
    case 'recent-translation':
    default:
      // When viewing a collection, sort by relevance score first
      if (collection) {
        return { $sort: { _collection_relevance: -1, has_translations: -1, title: 1 } as Record<string, 1 | -1> };
      }
      return { $sort: { is_bph_translated: -1, quality_score: -1, has_translations: -1, last_translation_at: -1, last_processed: -1, title: 1 } as Record<string, 1 | -1> };
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT)), MAX_LIMIT);
    const skip = Math.max(parseInt(searchParams.get('skip') || '0'), 0);
    const search = searchParams.get('search') || '';
    const language = searchParams.get('language') || '';
    const category = searchParams.get('category') || '';
    const collection = searchParams.get('collection') || '';
    const library = searchParams.get('library') || '';
    const firstTranslation = searchParams.get('first_translation') === 'true';
    const hasTranslation = searchParams.get('has_translation') === 'true';
    const sort = (searchParams.get('sort') || 'recent-translation') as SortOption;

    // Serve cached response for cacheable requests (no text search, reasonable pagination)
    const isCacheable = !search.trim() && skip < 200;
    const cacheKey = `s:${sort}|sk:${skip}|l:${limit}|ft:${firstTranslation}|ht:${hasTranslation}|lang:${language}|cat:${category}|col:${collection}|lib:${library}`;
    if (isCacheable) {
      const cached = browseCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < BROWSE_CACHE_TTL) {
        return new NextResponse(cached.data, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          },
        });
      }
    }

    const db = await getDb();

    // When a search term is present, use Atlas Search ($search must be first stage).
    // Language, category, firstTranslation are pushed as Atlas Search filters.
    // Collection is not in the search index so it stays as a post-$search $match.
    // When no search term, use a standard $match (cheaper for unfiltered browsing).
    let pipelineStart: Record<string, unknown>[];

    if (search.trim()) {
      pipelineStart = [
        buildBookSearchStage(search, {
          language: language || undefined,
          category: category || undefined,
          isFirstTranslation: firstTranslation || undefined,
        }),
        ...(collection ? [{ $match: { collections: collection } }] : []),
        ...(library ? [{ $match: { 'image_source.provider': library } }] : []),
      ];
    } else {
      const matchConditions: Record<string, unknown>[] = [
        { hidden: { $ne: true } },
        { pages_count: { $gt: 0 } },
      ];
      if (language) matchConditions.push({ language });
      if (category) matchConditions.push({ categories: category });
      if (collection) matchConditions.push({ collections: collection });
      if (library) matchConditions.push({ 'image_source.provider': library });
      if (firstTranslation) matchConditions.push({ is_first_translation: true });
      if (hasTranslation) matchConditions.push({ pages_translated: { $gt: 0 } });
      pipelineStart = [{ $match: { $and: matchConditions } }];
    }

    const pipeline = [
      ...pipelineStart,
      {
        $addFields: {
          id: { $ifNull: ['$id', { $toString: '$_id' }] },
          pages_count: { $ifNull: ['$pages_count', 0] },
          pages_translated: { $ifNull: ['$pages_translated', 0] },
          pages_ocr: { $ifNull: ['$pages_ocr', 0] },
          last_processed: { $ifNull: ['$updated_at', '$created_at'] },
          last_translation_at: { $ifNull: ['$last_translation_at', null] },
          translation_percent: { $ifNull: ['$translation_percent', 0] },
          has_translations: { $cond: { if: { $gt: ['$last_translation_at', null] }, then: 1, else: 0 } },
          is_bph_translated: {
            $cond: {
              if: {
                $and: [
                  { $eq: ['$image_source.provider', 'bph'] },
                  { $gt: ['$pages_count', 0] },
                  { $gte: [{ $multiply: [{ $divide: ['$pages_translated', { $max: ['$pages_count', 1] }] }, 100] }, 90] },
                ],
              },
              then: 1,
              else: 0,
            },
          },
          quality_score: { $ifNull: ['$quality_score', 0] },
          sort_title: { $toLower: { $ifNull: ['$display_title', '$title'] } },
          ...(collection ? {
            _collection_relevance: {
              $ifNull: [`$collection_relevance.${collection}`, 0],
            },
          } : {}),
        },
      },
      buildSortStage(sort, collection || undefined),
      {
        $facet: {
          books: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                id: 1,
                slug: 1,
                title: 1,
                display_title: 1,
                author: 1,
                thumbnail: 1,
                thumbnail_blob: 1,
                language: 1,
                published: 1,
                pages_count: 1,
                pages_ocr: 1,
                pages_translated: 1,
                translation_percent: 1,
                is_first_translation: 1,
                last_processed: 1,
                last_translation_at: 1,
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await db.collection('books').aggregate(pipeline, {
      collation: { locale: 'en', strength: 1 },
      maxTimeMS: 30000,
    }).toArray();

    const books = result.books || [];
    const total = result.total[0]?.count || 0;

    const responseData = JSON.stringify({ books, total });

    // Cache cacheable views
    if (isCacheable) {
      if (browseCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = [...browseCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
        if (oldest) browseCache.delete(oldest[0]);
      }
      browseCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
    }

    return new NextResponse(responseData, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Error in /api/books/library:', error);
    return NextResponse.json(
      { error: 'Failed to fetch books' },
      { status: 500 }
    );
  }
}
