import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest, resolveTenantId } from '@/lib/tenant-context';
import { resolveAuthorBookFilter } from '@/lib/author-thesaurus';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// In-memory cache: facet distributions move slowly and the aggregation walks
// the whole live set, so a short TTL removes almost all of the cost.
const facetCache = new Map<string, { data: string; timestamp: number }>();
const FACET_CACHE_TTL = 5 * 60_000;
const MAX_CACHE_ENTRIES = 50;

/**
 * GET /api/books/distributions
 *
 * Counts of the live catalog grouped by language, category, collection,
 * contributing library, and decade — under the same metadata filters as
 * /api/books/library (asked for by external visualization apps, #4491
 * follow-up). Filter params mirror the library route's BROWSE branch and must
 * stay in sync with it: language, category, collection, library, work_id,
 * author_id, year_from, year_to, first_translation, has_translation,
 * has_edition. There is deliberately no free-text `search` param — facets over
 * an Atlas relevance ranking need $searchMeta and a different contract; filter
 * facets are the 90% use case.
 *
 * `decades` only counts books with a numeric `year` (~60% of the library);
 * `total` counts all matches, so the decade counts summing below `total` is
 * expected, not drift.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const language = searchParams.get('language') || '';
    const category = searchParams.get('category') || '';
    const collection = searchParams.get('collection') || '';
    const library = searchParams.get('library') || '';
    const workId = searchParams.get('work_id') || '';
    const firstTranslation = searchParams.get('first_translation') === 'true';
    const hasTranslation = searchParams.get('has_translation') === 'true';
    const hasEditionParam = (searchParams.get('has_edition') || '').trim().toLowerCase();
    const hasEdition = /^[a-z]{2,3}$/.test(hasEditionParam) && hasEditionParam !== 'en' ? hasEditionParam : '';
    const authorIdParam = (searchParams.get('author_id') || '').trim();
    const yearFromRaw = parseInt(searchParams.get('year_from') || '', 10);
    const yearToRaw = parseInt(searchParams.get('year_to') || '', 10);
    const yearFrom = Number.isFinite(yearFromRaw) ? yearFromRaw : null;
    const yearTo = Number.isFinite(yearToRaw) ? yearToRaw : null;

    const { slug: tenantSlugHeader, id: tenantIdHeader } = getTenantContextFromRequest(request);
    const tenantSlugParam = searchParams.get('tenant_slug') || '';
    const tenantSlug = tenantSlugHeader || tenantSlugParam;
    let tenantId: string | null = tenantIdHeader;
    if (!tenantId && tenantSlugParam) tenantId = await resolveTenantId(tenantSlugParam);
    if (tenantSlug && !tenantId) {
      return NextResponse.json({ total: 0, facets: {} });
    }

    const cacheKey = `t:${tenantSlug}|lang:${language}|cat:${category}|col:${collection}|lib:${library}|w:${workId}|ft:${firstTranslation}|ht:${hasTranslation}|he:${hasEdition}|a:${authorIdParam}|yf:${yearFrom}|yt:${yearTo}`;
    const cached = facetCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < FACET_CACHE_TTL) {
      return new NextResponse(cached.data, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
        },
      });
    }

    const db = await getReadDb();

    // Unknown author slug → empty result with author: null, same contract as
    // the library route (never a silently dropped filter).
    let authorFilter: Awaited<ReturnType<typeof resolveAuthorBookFilter>> = null;
    if (authorIdParam) {
      authorFilter = await resolveAuthorBookFilter(db, authorIdParam);
      if (!authorFilter) {
        return NextResponse.json({ total: 0, facets: {}, author: null });
      }
    }

    // Keep in sync with /api/books/library's browse branch.
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
    if (authorFilter) matchConditions.push(authorFilter.match);
    if (yearFrom !== null || yearTo !== null) {
      matchConditions.push({
        year: {
          ...(yearFrom !== null ? { $gte: yearFrom } : {}),
          ...(yearTo !== null ? { $lte: yearTo } : {}),
        },
      });
    }

    const [result] = await db.collection('books').aggregate([
      { $match: { $and: matchConditions } },
      {
        $facet: {
          total: [{ $count: 'n' }],
          languages: [
            { $match: { language: { $type: 'string', $ne: '' } } },
            { $sortByCount: '$language' },
            { $limit: 500 },
          ],
          categories: [
            { $unwind: '$categories' },
            { $sortByCount: '$categories' },
            { $limit: 500 },
          ],
          collections: [
            { $unwind: '$collections' },
            { $sortByCount: '$collections' },
            { $limit: 500 },
          ],
          libraries: [
            { $match: { 'image_source.provider': { $type: 'string', $ne: '' } } },
            { $sortByCount: '$image_source.provider' },
            { $limit: 500 },
          ],
          decades: [
            { $match: { year: { $type: 'number' } } },
            { $group: { _id: { $multiply: [{ $floor: { $divide: ['$year', 10] } }, 10] }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
            { $limit: 500 },
          ],
        },
      },
    ], { maxTimeMS: 30000 }).toArray();

    const bucketize = (rows: Array<{ _id: unknown; count: number }>) =>
      rows.map((r) => ({ value: r._id, count: r.count }));

    const responseData = JSON.stringify({
      total: result?.total?.[0]?.n || 0,
      facets: {
        languages: bucketize(result?.languages || []),
        categories: bucketize(result?.categories || []),
        collections: bucketize(result?.collections || []),
        libraries: bucketize(result?.libraries || []),
        decades: bucketize(result?.decades || []),
      },
      ...(authorFilter ? { author: { id: authorFilter.canonicalSlug, name: authorFilter.canonicalName } } : {}),
    });

    if (facetCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = [...facetCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) facetCache.delete(oldest[0]);
    }
    facetCache.set(cacheKey, { data: responseData, timestamp: Date.now() });

    return new NextResponse(responseData, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error('Error in /api/books/distributions:', error);
    return NextResponse.json({ error: 'Failed to compute facets' }, { status: 500 });
  }
}
