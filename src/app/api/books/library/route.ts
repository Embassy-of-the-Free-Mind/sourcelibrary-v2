import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getReadDb } from '@/lib/mongodb';
import { buildBookSearchStage } from '@/lib/atlas-search';
import { getTenantContextFromRequest, resolveTenantId } from '@/lib/tenant-context';
import { translationPercent } from '@/lib/translation-completeness';
import { buildSortStage, type SortOption } from '@/lib/book-sort';
import { resolveAuthorBookFilter } from '@/lib/author-thesaurus';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

// In-memory cache for common browse views (keyed by filter combination)
const browseCache = new Map<string, { data: string; timestamp: number }>();
// 5 minutes (was 1). A cold browse costs ~1 s even on the covered index, and
// list_books with no arguments arrives from crawlers minutes apart (#6854).
const BROWSE_CACHE_TTL = 5 * 60_000;
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
    // `author_id=<slug>`: exactly one person's books, resolved through the
    // authors thesaurus (variant slugs and merge tombstones follow to the
    // canonical person; membership is the same 3-key union as /author/[slug]).
    // Slugs come from /api/catalog/author-search or from `author_id` on rows.
    const authorIdParam = (searchParams.get('author_id') || '').trim();
    // `edition_key=<key>`: other digitizations of ONE printing. Gated to
    // full-quality keys on BOTH sides, exactly as the reader-facing "other
    // scans of this edition" rail is (isTrustedEditionKey) — a `no-year` key
    // collapses every printing of a title across centuries into one set, which
    // is fine for a review queue and wrong for a public answer.
    const editionKeyParam = (searchParams.get('edition_key') || '').trim();
    // Numeric edition-year range. Matches the `year` field only — the free-text
    // `published` is not comparable (see search-filters-and-lanes.md); books
    // without a numeric year (~40% of live books) never match a year filter.
    const yearFromRaw = parseInt(searchParams.get('year_from') || '', 10);
    const yearToRaw = parseInt(searchParams.get('year_to') || '', 10);
    const yearFrom = Number.isFinite(yearFromRaw) ? yearFromRaw : null;
    const yearTo = Number.isFinite(yearToRaw) ? yearToRaw : null;
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
    const cacheKey = `t:${tenantSlug}|s:${sort}|sk:${skip}|l:${limit}|ft:${firstTranslation}|ht:${hasTranslation}|he:${hasEdition}|lang:${language}|cat:${category}|col:${collection}|lib:${library}|w:${workId}|a:${authorIdParam}|yf:${yearFrom}|yt:${yearTo}|ek:${editionKeyParam}`;
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

    // Resolve the author filter FIRST: an unknown slug returns an empty page
    // (with author: null) rather than silently dropping the filter — an
    // ignored filter would serve the whole library labeled as one person's
    // books (search-filters-and-lanes.md).
    let authorFilter: Awaited<ReturnType<typeof resolveAuthorBookFilter>> = null;
    if (authorIdParam) {
      authorFilter = await resolveAuthorBookFilter(db, authorIdParam);
      if (!authorFilter) {
        return NextResponse.json(
          { books: [], total: 0, author: null, skip, limit },
          { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
        );
      }
    }
    const editionMatch: Record<string, unknown> | null = editionKeyParam
      ? { edition_key: editionKeyParam, edition_key_quality: 'full' }
      : null;
    const yearMatch: Record<string, unknown> | null = (yearFrom !== null || yearTo !== null)
      ? { year: { ...(yearFrom !== null ? { $gte: yearFrom } : {}), ...(yearTo !== null ? { $lte: yearTo } : {}) } }
      : null;

    // When a search term is present, use Atlas Search ($search must be first stage).
    // Language, category, firstTranslation are pushed as Atlas Search filters.
    // Collection is not in the search index so it stays as a post-$search $match.
    // When no search term, use a standard $match (cheaper for unfiltered browsing).
    let pipelineStart: Record<string, unknown>[];
    // Default-sort searches are ordered by Atlas Search itself (relevance, then
    // translated pages), so `$skip`/`$limit` stop the stream after one page.
    // A `$sort` after `$search` has to pull EVERY hit through mongod first: an
    // any-word match on "Catherine of Siena" is 22,034 books, and five of six
    // such list_books calls exceeded the 30 s maxTimeMS on 2026-10-17 (#6854).
    // Exact score ties used to break on has_translations then title; they now
    // break on pages_translated, which puts translated editions first just the same.
    const searchSortedByMongot = Boolean(search.trim()) && sort === 'recent-translation' && !collection;

    if (search.trim()) {
      const searchStage = buildBookSearchStage(search, {
        language: language || undefined,
        category: category || undefined,
        isFirstTranslation: firstTranslation || undefined,
      });
      if (searchSortedByMongot) {
        searchStage.$search.sort = { score: { $meta: 'searchScore' }, pages_translated: -1 };
      }
      pipelineStart = [
        searchStage,
        ...(collection ? [{ $match: { collections: collection } }] : []),
        ...(workId ? [{ $match: { work_id: workId } }] : []),
        ...(library ? [{ $match: { 'image_source.provider': library } }] : []),
        // Applied in BOTH branches. A filter honoured only when the caller
        // omits `search` is inert exactly where it is most likely to be used,
        // and reads as active either way (search-filters-and-lanes.md).
        ...(hasEdition ? [{ $match: { [`pages_translated_${hasEdition}`]: { $gt: 0 } } }] : []),
        ...(authorFilter ? [{ $match: authorFilter.match }] : []),
        ...(editionMatch ? [{ $match: editionMatch }] : []),
        ...(yearMatch ? [{ $match: yearMatch }] : []),
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
      if (authorFilter) matchConditions.push(authorFilter.match);
      if (editionMatch) matchConditions.push(editionMatch);
      if (yearMatch) matchConditions.push(yearMatch);
      // The aggregate below runs under an en/strength-1 collation, and an index
      // with the default collation cannot serve a STRING predicate under another
      // one. So `work_id` / `author_id` / `edition_key`, all indexed, were
      // answered by scanning the collection: 3.8 s for Hippocrates' 28 books,
      // 1.5 s for a work with 2 witnesses, while the same $match without
      // collation took 9–70 ms (2026-10-17, #6854). Resolve those selective
      // filters to _ids first, without collation; ObjectId bounds are not
      // strings, so the _id index serves the collated query. Only those three
      // filters go into the prefilter: they are machine-written keys (and the
      // thesaurus' own variant strings), and 50 of 50 sampled authors and 50 of
      // 50 works matched the same books with and without the collation. Free
      // strings such as `language` stay out of it, since "latin" must still
      // match "Latin"; the full collated $match runs on the narrowed set.
      if (workId || authorFilter || editionMatch) {
        const prefilter: Record<string, unknown>[] = [{ visible: true }, { pages_count: { $gt: 0 } }];
        if (workId) prefilter.push({ work_id: workId });
        if (authorFilter) prefilter.push(authorFilter.match);
        if (editionMatch) prefilter.push(editionMatch);
        const ids = await db.collection('books')
          .find({ $and: prefilter }, { projection: { _id: 1 }, maxTimeMS: 10000 })
          .limit(5000)
          .toArray()
          .then(rows => rows.map(r => r._id))
          .catch(() => null);
        // String _ids (479 legacy books) would put strings back in the bounds.
        if (ids && ids.length < 5000 && ids.every(id => id instanceof ObjectId)) {
          matchConditions.push({ _id: { $in: ids } });
        }
      }
      pipelineStart = [{ $match: { $and: matchConditions } }];
    }

    // Unfiltered default browse (list_books with no arguments: 17% of its
    // calls, p50 4 s). The sort keys are computed, so no index can order it;
    // what the index CAN do is cover it. `browse_default_sort_covered` holds
    // every field the match and the sort read, so phase 1 orders 42K index
    // entries without fetching a single 17 KB book document (2.3 s → 0.5–1.1 s),
    // and phase 2 hydrates only the page. If the index is missing the hinted
    // query errors and the route falls back to the one-pass pipeline below.
    const plainBrowse = !search.trim() && sort === 'recent-translation' && !tenantId && !language && !category
      && !collection && !library && !workId && !firstTranslation && !hasTranslation && !hasEdition
      && !authorFilter && !editionMatch && !yearMatch;

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
      // Canonical author slug + numeric edition year: without these a consumer
      // can SORT by year and SEARCH authors but never see either value —
      // `published` is free text and `author` is an uncanonicalized string.
      author_id: 1,
      year: 1,
      // The rest of the identity stack (#4509). `work_id` was filterable via
      // ?work_id= but never returned, so a consumer could not learn a book's
      // work without a per-book call — the same defect the author facet had.
      // `edition_key_quality` ships beside the key because only 'full' is
      // trustworthy: with the year slot empty a key merges every printing of a
      // title across centuries (edition-identity.md).
      work_id: 1,
      edition_key: 1,
      edition_key_quality: 1,
      thumbnail: 1, image_display: 1,
      thumbnail_blob: 1, image_thumb: 1,
      thumbnail_frame: 1,
      language: 1,
      published: 1,
      pages_count: 1,
      pages_ocr: 1,
      pages_translated: 1,
      // The denominator inputs for translationCompleteness() (#4505), and the
      // stamped rung (#5287) so a caller can tell `readable` from `complete`.
      pages_translatable: 1,
      pages_blank: 1,
      translation_state: { rung: 1, english_original: 1 },
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

    const sortStage = buildSortStage(sort, collection || undefined, Boolean(search.trim()));
    const collation = { locale: 'en', strength: 1 };
    const onePass = () => db.collection('books').aggregate([
      ...basePipeline,
      ...(searchSortedByMongot ? [] : [sortStage]),
      { $skip: skip },
      { $limit: limit },
      { $project: bookProject },
    ], { collation, maxTimeMS: 30000 }).toArray();
    const twoPhaseBrowse = async () => {
      const page = await db.collection('books').aggregate([
        ...pipelineStart,
        { $project: { _id: 1, id: 1, title: 1, last_translation_at: 1, last_processed: 1, quality_score: 1, pages_count: 1, pages_translated: 1, 'image_source.provider': 1 } },
        { $addFields: addFields },
        sortStage,
        { $skip: skip },
        { $limit: limit },
        { $project: { _id: 1 } },
      ], { collation, hint: 'browse_default_sort_covered', maxTimeMS: 30000 }).toArray();
      const order = new Map(page.map((d, i) => [String(d._id), i]));
      const docs = await db.collection('books').aggregate([
        { $match: { _id: { $in: page.map(d => d._id) } } },
        { $addFields: addFields },
        { $project: { ...bookProject, _id: 1 } },
      ], { maxTimeMS: 10000 }).toArray();
      return docs
        .sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0))
        .map(({ _id, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
    };

    // The count. A search with no post-$search filter is counted by Atlas
    // Search itself ($searchMeta, 11–290 ms); a `$count` after `$search` pulls
    // every hit through mongod, 3.7–13 s on a common word. Any other count that
    // fails or times out degrades to a lower bound, flagged as such, rather
    // than failing the whole request as it used to.
    const searchOnly = Boolean(search.trim()) && pipelineStart.length === 1;
    const countPromise: Promise<{ total: number; estimate: boolean }> = (searchOnly
      ? db.collection('books').aggregate([
        { $searchMeta: { ...(pipelineStart[0].$search as Record<string, unknown>), count: { type: 'total' } } },
      ], { maxTimeMS: 15000 }).toArray().then(r => (r[0]?.count?.total as number | undefined) ?? 0)
      // Same collation as the results: without it `language=latin` listed
      // Latin books under `total: 0`.
      : db.collection('books').aggregate([
        ...pipelineStart,
        { $count: 'count' },
      ], { collation, maxTimeMS: 15000 }).toArray().then(r => (r[0]?.count as number | undefined) ?? 0)
    ).then(total => ({ total, estimate: false }))
      .catch(() => ({ total: -1, estimate: true }));

    const [books, counted] = await Promise.all([
      plainBrowse ? twoPhaseBrowse().catch(onePass) : onePass(),
      countPromise,
    ]);

    const total = counted.estimate
      ? skip + books.length + (books.length === limit ? 1 : 0)
      : counted.total;

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
      // usable back (#3652 B). One formula: src/lib/translation-completeness.ts.
      translation_percent: translationPercent(book),
      tenant_slug: book.tenantId ? tenantSlugMap.get(book.tenantId) || null : null,
    }));

    const responseData = JSON.stringify({
      books: booksWithTenantSlug,
      total,
      // `total` is a lower bound (the count timed out), not the match count.
      ...(counted.estimate ? { total_is_lower_bound: true } : {}),
      // Echo the canonicalized author when filtering, so a caller that passed
      // a variant slug learns the canonical one.
      ...(authorFilter ? { author: { id: authorFilter.canonicalSlug, name: authorFilter.canonicalName } } : {}),
    });

    // Cache cacheable views (never a lower-bound total)
    if (isCacheable && !counted.estimate) {
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
