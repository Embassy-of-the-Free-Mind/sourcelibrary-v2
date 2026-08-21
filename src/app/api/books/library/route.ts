import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { buildBookSearchStage } from '@/lib/atlas-search';
import { getTenantContextFromRequest, resolveTenantId } from '@/lib/tenant-context';
import { translationPercent } from '@/lib/translation-percent';
import { buildSortStage, type SortOption } from '@/lib/book-sort';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

// In-memory cache for common browse views (keyed by filter combination)
const browseCache = new Map<string, { data: string; timestamp: number }>();
const BROWSE_CACHE_TTL = 60_000; // 1 minute
const MAX_CACHE_ENTRIES = 50;

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
    // Every edition of one work. Handled as a post-$search $match like
    // `collection`, so it needs no Atlas index mapping. 98.5% of live books
    // carry a work_id, which is what makes this cheap.
    const workId = searchParams.get('work_id') || '';
    const firstTranslation = searchParams.get('first_translation') === 'true';
    const hasTranslation = searchParams.get('has_translation') === 'true';
    // `has_edition=<iso>`: books that carry a reader-ready edition in that
    // language (#4095). Distinct from `language`, which is the language printed
    // on the leaves of the original scan — a Latin book with a Spanish edition
    // matches `language=Latin` AND `has_edition=es`.
    const hasEditionParam = (searchParams.get('has_edition') || '').trim().toLowerCase();
    const hasEdition = /^[a-z]{2,3}$/.test(hasEditionParam) && hasEditionParam !== 'en' ? hasEditionParam : '';
    const sort = (searchParams.get('sort') || 'recent-translation') as SortOption;
    const { slug: tenantSlugHeader, id: tenantIdHeader } = getTenantContextFromRequest(request);
    const tenantSlugParam = searchParams.get('tenant_slug') || '';
    const tenantSlug = tenantSlugHeader || tenantSlugParam;

    // Prefer proxy-resolved x-tenant-id header. Fallback to slug param resolution.
    let tenantId: string | null = tenantIdHeader;
    if (!tenantId && tenantSlugParam) {
      tenantId = await resolveTenantId(tenantSlugParam);
    }
    if (tenantSlug && !tenantId) {
      // Unknown tenant slug — return empty results
      return NextResponse.json({ books: [], total: 0, skip, limit });
    }

    // Serve cached response for cacheable requests (no text search, reasonable pagination)
    const isCacheable = !search.trim() && skip < 200;
    const cacheKey = `t:${tenantSlug}|s:${sort}|sk:${skip}|l:${limit}|ft:${firstTranslation}|ht:${hasTranslation}|he:${hasEdition}|lang:${language}|cat:${category}|col:${collection}|lib:${library}|w:${workId}`;
    if (isCacheable) {
      const cached = browseCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < BROWSE_CACHE_TTL) {
        return new NextResponse(cached.data, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
          },
        });
      }
    }

    const db = await getReadDb();

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
        ...(workId ? [{ $match: { work_id: workId } }] : []),
        ...(library ? [{ $match: { 'image_source.provider': library } }] : []),
        // Applied in BOTH branches. A filter honoured only when the caller
        // omits `search` is inert exactly where it is most likely to be used,
        // and reads as active either way (search-filters-and-lanes.md).
        ...(hasEdition ? [{ $match: { [`pages_translated_${hasEdition}`]: { $gt: 0 } } }] : []),
        ...(tenantId ? [{ $match: { tenantId } }] : []),
      ];
    } else {
      const matchConditions: Record<string, unknown>[] = [
        { visible: true },
        { pages_count: { $gt: 0 } },
      ];
      if (tenantId) matchConditions.push({ tenantId });
      if (language) matchConditions.push({ language });
      if (category) matchConditions.push({ categories: category });
      if (collection) matchConditions.push({ collections: collection });
      if (workId) matchConditions.push({ work_id: workId });
      if (library) matchConditions.push({ 'image_source.provider': library });
      if (firstTranslation) matchConditions.push({ is_first_translation: true });
      if (hasTranslation) matchConditions.push({ pages_translated: { $gt: 0 } });
      if (hasEdition) matchConditions.push({ [`pages_translated_${hasEdition}`]: { $gt: 0 } });
      pipelineStart = [{ $match: { $and: matchConditions } }];
    }

    // Only compute the fields needed for the current sort mode
    // This avoids the expensive full-scan $addFields on every book
    const addFields: Record<string, unknown> = {
      id: { $ifNull: ['$id', { $toString: '$_id' }] },
    };

    // Carry Atlas Search's relevance out of $search so the sort can use it.
    // Only valid in a pipeline that actually began with $search.
    if (search.trim()) {
      addFields.search_score = { $meta: 'searchScore' };
    }

    // Only add computed fields required by the active sort
    if (sort === 'title-asc' || sort === 'title-desc') {
      addFields.sort_title = { $toLower: { $ifNull: ['$display_title', '$title'] } };
    } else if (sort === 'recent-translation') {
      addFields.has_translations = { $cond: { if: { $gt: ['$last_translation_at', null] }, then: 1, else: 0 } };
      if (!collection) {
        addFields.is_bph_translated = {
          $cond: {
            if: {
              $and: [
                { $eq: ['$image_source.provider', 'bph'] },
                { $gt: ['$pages_count', 0] },
                { $gte: [{ $multiply: [{ $divide: [{ $ifNull: ['$pages_translated', 0] }, { $max: [{ $ifNull: ['$pages_count', 1] }, 1] }] }, 100] }, 90] },
              ],
            },
            then: 1,
            else: 0,
          },
        };
      }
      if (collection) {
        addFields._collection_relevance = { $ifNull: [`$collection_relevance.${collection}`, 0] };
      }
    } else if (sort === 'recent') {
      addFields.last_processed = { $ifNull: ['$updated_at', '$created_at'] };
    }

    const bookProject = {
      _id: 0,
      id: 1,
      slug: 1,
      tenantId: 1,
      title: 1,
      display_title: 1,
      author: 1,
      thumbnail: 1, image_display: 1,
      thumbnail_blob: 1, image_thumb: 1,
      language: 1,
      published: 1,
      pages_count: 1,
      pages_ocr: 1,
      pages_translated: 1,
      translation_percent: 1,
      // Only when asked for. Projecting every language's counter would put a
      // field on 22,000 rows to describe 103 of them, and the counter set grows
      // with each language.
      ...(hasEdition ? { [`pages_translated_${hasEdition}`]: 1 } : {}),
      is_first_translation: 1,
      last_processed: 1,
      last_translation_at: 1,
    };

    // Run count and paginated results in parallel (avoids $facet double-scan)
    const basePipeline = [...pipelineStart, { $addFields: addFields }];

    const [books, countResult] = await Promise.all([
      db.collection('books').aggregate([
        ...basePipeline,
        buildSortStage(sort, collection || undefined, Boolean(search.trim())),
        { $skip: skip },
        { $limit: limit },
        { $project: bookProject },
      ], {
        collation: { locale: 'en', strength: 1 },
        maxTimeMS: 30000,
      }).toArray(),
      // Count query — skip the sort/project, just count matches
      db.collection('books').aggregate([
        ...pipelineStart,
        { $count: 'count' },
      ], { maxTimeMS: 15000 }).toArray(),
    ]);

    const total = countResult[0]?.count || 0;

    const tenantIds = [...new Set(books.map((b: any) => b.tenantId).filter(Boolean))];
    const tenantSlugMap = new Map<string, string>();
    if (tenantIds.length > 0) {
      const tenants = await db.collection('tenants')
        .find({ id: { $in: tenantIds }, status: { $ne: 'deleted' } }, { projection: { _id: 0, id: 1, slug: 1 }, maxTimeMS: 5000 })
        .toArray();
      for (const tenant of tenants) {
        if (tenant?.id && tenant?.slug) tenantSlugMap.set(tenant.id, tenant.slug);
      }
    }

    const booksWithTenantSlug = books.map((book: any) => ({
      ...book,
      // Computed, not projected. The stored `translation_percent` is absent on
      // 8,928 of 19,419 live books — its writer (`sync-page-counts`) is archived
      // — and this route feeds MCP `list_books`, so callers were getting nothing
      // usable back (#3652 B). See src/lib/translation-percent.ts.
      translation_percent: translationPercent(book),
      tenant_slug: book.tenantId ? tenantSlugMap.get(book.tenantId) || null : null,
    }));

    const responseData = JSON.stringify({ books: booksWithTenantSlug, total });

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
