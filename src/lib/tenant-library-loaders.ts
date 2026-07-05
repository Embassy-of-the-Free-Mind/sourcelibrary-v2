/**
 * Tenant-scoped library data loaders.
 * Queries books by tenantId instead of provider, to support tenant-native library landing pages.
 */

import { getReadDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import { ObjectId } from 'mongodb';
import { searchBookIds } from '@/lib/books-catalog';
import { buildPageSearchStage } from '@/lib/atlas-search';

const PER_PAGE = 60;

interface BrowseOptions {
  tenantId: string;
  sort: 'popular' | 'title' | 'author' | 'year_asc' | 'year_desc' | 'shelfmark' | 'recent';
  language?: string;
  search?: string;
  offset: number;
  limit: number;
}

interface BrowseResult {
  books: Array<{
    id: string;
    slug?: string;
    title: string;
    display_title?: string;
    author?: string;
    year?: number;
    language?: string;
    pages_count?: number;
    pages_ocr?: number;
    pages_translated?: number;
    pages_blank?: number;
    photo?: string;
    thumbnail?: string;
    thumbnail_blob?: string;
    published?: string;
  }>;
  total: number;
}

async function browseTenantBooks(opts: BrowseOptions): Promise<BrowseResult> {
  const db = await getReadDb();

  const matchConditions: Record<string, unknown>[] = [
    { visible: true },
    { pages_count: { $gt: 0 } },
    { tenantId: opts.tenantId },
  ];

  if (opts.language) {
    matchConditions.push({ language: opts.language });
  }

  if (opts.search && opts.search.trim()) {
    // search_content=true parity for in-place /[tenant]?q=:
    // combine book-level matches with page-content matches, then render books.
    const [bookLevelIds, pageLevelRows] = await Promise.all([
      searchBookIds(opts.search, { limit: 5000 }),
      db.collection('pages').aggregate<{ _id: string }>([
        buildPageSearchStage(opts.search),
        { $limit: 300 },
        { $project: { _id: 0, book_id: 1 } },
        {
          $lookup: {
            from: 'books',
            let: { bid: '$book_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$id', '$$bid'] },
                  tenantId: opts.tenantId,
                  visible: true,
                  pages_count: { $gt: 0 },
                  ...(opts.language ? { language: opts.language } : {}),
                },
              },
              { $project: { _id: 0, id: 1 } },
            ],
            as: 'book',
          },
        },
        { $unwind: '$book' },
        { $group: { _id: '$book.id' } },
        { $limit: 5000 },
      ], { maxTimeMS: 8_000 }).toArray().catch(() => []),
    ]);

    const pageLevelIds = pageLevelRows.map(row => row._id);
    const matchingIds = [...new Set([...bookLevelIds, ...pageLevelIds])];

    if (matchingIds.length === 0) {
      return { books: [], total: 0 };
    }
    matchConditions.push({ id: { $in: matchingIds } });
  }

  const pipelineStart: Record<string, unknown>[] = [
    { $match: { $and: matchConditions } },
  ];

  // MongoDB applies sort keys in declaration order — the first key is the
  // primary sort, the rest are tiebreakers. Previously this object seeded
  // `{ title: 1 }` *before* the switch, so every sort silently behaved like
  // Title A-Z because `title` always came first in the key order. Each case
  // now declares its own primary key, with `title` appended as a stable
  // tiebreaker (so equal years still come out alphabetically).
  const sortStage: Record<string, 1 | -1> = {};
  switch (opts.sort) {
    case 'popular':
      sortStage['quality_score'] = -1;
      sortStage['has_translations'] = -1;
      sortStage['last_translation_at'] = -1;
      break;
    case 'title':
      sortStage['title'] = 1;
      break;
    case 'author':
      sortStage['author'] = 1;
      break;
    case 'year_asc':
      sortStage['year'] = 1;
      break;
    case 'year_desc':
      sortStage['year'] = -1;
      break;
    case 'shelfmark':
      sortStage['dublin_core.dc_source'] = 1;
      break;
    case 'recent':
      sortStage['last_processed'] = -1;
      break;
  }
  if (!('title' in sortStage)) sortStage['title'] = 1;

  const projection = {
    _id: 0,
    id: 1,
    slug: 1,
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
    pages_blank: 1,
    photo: 1,
  };

  const [books, countResult] = await Promise.all([
    db.collection('books').aggregate<BrowseResult['books'][number]>([
      ...pipelineStart,
      { $sort: sortStage },
      { $skip: opts.offset },
      { $limit: opts.limit },
      { $project: projection },
    ], { maxTimeMS: 30_000 }).toArray(),
    db.collection('books').aggregate<{ count: number }>([
      ...pipelineStart,
      { $count: 'count' },
    ], { maxTimeMS: 15_000 }).toArray(),
  ]);

  const total = countResult[0]?.count || 0;

  return { books, total };
}

interface TenantLanguage {
  lang: string;
  count: number;
}

async function getTenantLanguageCounts(tenantId: string): Promise<TenantLanguage[]> {
  const db = await getReadDb();

  const result = await db.collection('books').aggregate([
    { $match: { tenantId, visible: true, pages_count: { $gt: 0 } } },
    { $group: { _id: '$language', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ], { maxTimeMS: 10_000 }).toArray();

  return result.map(r => ({ lang: r._id || 'Unknown', count: r.count }));
}

interface TenantLibraryData {
  books: Array<{
    id: string;
    slug?: string;
    title: string;
    display_title?: string;
    author?: string;
    year?: number;
    language?: string;
    pages_count?: number;
    pages_ocr?: number;
    pages_translated?: number;
    pages_blank?: number;
    photo?: string;
    thumbnail?: string;
    thumbnail_blob?: string;
    published?: string;
  }>;
  total: number;
  topBooks: Array<{
    id: string;
    slug?: string;
    title: string;
    display_title?: string;
    author?: string;
    year?: number;
    language?: string;
    pages_count?: number;
    pages_ocr?: number;
    pages_translated?: number;
    pages_blank?: number;
    photo?: string;
    thumbnail?: string;
    thumbnail_blob?: string;
    published?: string;
  }>;
  languages: TenantLanguage[];
  galleryImages: Array<Record<string, unknown>>;
  contributingLibraries: Array<{ name: string; count: number }>;
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function sanitizeGalleryImageDoc(doc: Record<string, unknown>): Record<string, unknown> {
  return {
    id: toStringOrUndefined(doc.id),
    pageId: toStringOrUndefined(doc.pageId),
    page_id: toStringOrUndefined(doc.page_id),
    detectionIndex: toNumberOrUndefined(doc.detectionIndex),
    detection_index: toNumberOrUndefined(doc.detection_index),
    thumbnailUrl: toStringOrUndefined(doc.thumbnailUrl),
    thumbnail_url: toStringOrUndefined(doc.thumbnail_url),
    extractedUrl: toStringOrUndefined(doc.extractedUrl),
    extracted_url: toStringOrUndefined(doc.extracted_url),
    imageUrl: toStringOrUndefined(doc.imageUrl),
    image_url: toStringOrUndefined(doc.image_url),
    museumDescription: toStringOrUndefined(doc.museumDescription),
    museum_description: toStringOrUndefined(doc.museum_description),
    description: toStringOrUndefined(doc.description),
    bookTitle: toStringOrUndefined(doc.bookTitle),
    book_title: toStringOrUndefined(doc.book_title),
    type: toStringOrUndefined(doc.type),
  };
}

// In-memory TTL cache for fetchTenantLibraryData.
// The function runs 5+ queries (Mongo + Supabase) and gates the entire embed
// /embed/[tenant] render. Without a cache, every iframe load eats the full
// 4-6s rebuild because pages with `await searchParams` are dynamic — Next.js
// can't cache them with `revalidate`. A 5-min in-memory TTL is enough to
// span normal browsing sessions while staying near-live. Cache is per-Vercel-
// function-instance (no shared cross-instance state needed); cold function
// starts pay the rebuild but warm ones serve from RAM.
const TENANT_LIBRARY_CACHE_TTL_MS = 5 * 60_000;
const tenantLibraryCache = new Map<string, { value: TenantLibraryData; expiresAt: number }>();

/**
 * Fetch all library data for a tenant, scoped by tenantId instead of provider.
 */
export async function fetchTenantLibraryData(
  tenantId: string,
  sort: string,
  language: string,
  offset: number,
  q?: string,
): Promise<TenantLibraryData> {
  const cacheKey = JSON.stringify([tenantId, sort, language, offset, q || '']);
  const now = Date.now();
  const cached = tenantLibraryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const result = await fetchTenantLibraryDataUncached(tenantId, sort, language, offset, q);
  tenantLibraryCache.set(cacheKey, { value: result, expiresAt: now + TENANT_LIBRARY_CACHE_TTL_MS });

  // Trim if cache grows unbounded (shouldn't, but defence-in-depth).
  if (tenantLibraryCache.size > 200) {
    const cutoff = now;
    for (const [k, v] of tenantLibraryCache) {
      if (v.expiresAt <= cutoff) tenantLibraryCache.delete(k);
    }
  }
  return result;
}

async function fetchTenantLibraryDataUncached(
  tenantId: string,
  sort: string,
  language: string,
  offset: number,
  q?: string,
): Promise<TenantLibraryData> {
  const db = await getReadDb();

  // Fetch paginated books, top books for gallery, and languages in parallel
  const [booksResult, languages, topBooksResult] = await Promise.all([
    browseTenantBooks({
      tenantId,
      sort: (sort as BrowseOptions['sort']) || 'popular',
      language: language || undefined,
      search: q && q.length >= 2 ? q : undefined,
      offset,
      limit: PER_PAGE,
    }),
    getTenantLanguageCounts(tenantId),
    browseTenantBooks({
      tenantId,
      sort: 'popular',
      offset: 0,
      limit: 50,
    }),
  ]);

  const topBookIds = topBooksResult.books.map(b => b.id);

  // Gallery images from MongoDB
  let galleryImages: Array<Record<string, unknown>> = [];
  if (topBookIds.length > 0) {
    try {
      galleryImages = await db.collection('gallery_images').aggregate([
        { $match: {
          book_id: { $in: topBookIds },
          gallery_quality: { $gte: 0.7 },
          book_visible: true,
          type: { $nin: ['decorative', 'symbol', 'musical_score', 'exlibris', 'bookplate'] },
        }},
        { $sort: { gallery_quality: -1 } },
        { $group: { _id: '$book_id', images: { $push: '$$ROOT' } } },
        { $project: { images: { $slice: ['$images', 2] } } },
        { $unwind: '$images' },
        { $replaceRoot: { newRoot: '$images' } },
        { $sort: { gallery_quality: -1 } },
        { $limit: 12 },
      ], { maxTimeMS: 15_000 }).toArray();
    } catch { /* Gallery is optional */ }
  }

  // Contributing libraries — query MongoDB scoped to this tenant.
  // Supabase books_catalog has no tenant_id column (see tenant-browse.ts),
  // so the previous Supabase path returned global counts and leaked
  // unrelated institutions onto tenant subdomains.
  const contribAgg = await db.collection('books').aggregate<{ _id: string; count: number }>([
    { $match: {
        tenantId,
        visible: true,
        pages_count: { $gt: 0 },
        pages_translated: { $gt: 0 },
        'image_source.contributing_library': { $exists: true, $nin: [null, ''] },
    }},
    { $group: { _id: '$image_source.contributing_library', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]).toArray();

  const contributingLibraries = contribAgg.map(row => ({ name: row._id, count: row.count }));

  return {
    books: booksResult.books,
    total: booksResult.total,
    topBooks: topBooksResult.books.slice(0, 5),
    languages,
    galleryImages: galleryImages.map((img) => sanitizeGalleryImageDoc(img)),
    contributingLibraries,
  };
}

/**
 * Determine the dominant image source provider for a tenant.
 * Used to apply provider-specific defaults (e.g., BPH catalog).
 *
 * Callers should prefer `getPartnerBySlug(tenant)` and only fall back
 * to this when the slug doesn't map to a known partner — the $group
 * over the tenant's books collection is expensive on large tenants.
 */
export async function getTenantDominantProvider(tenantId: string): Promise<string | null> {
  try {
    const db = await getReadDb();
    const result = await db.collection('books').aggregate([
      { $match: { tenantId, visible: true } },
      { $group: { _id: '$image_source.provider', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ], { maxTimeMS: 4_000 }).toArray();
    return (result[0]?._id as string | undefined) || null;
  } catch (err) {
    console.warn('[tenant-library-loaders] getTenantDominantProvider failed:', err);
    return null;
  }
}

/**
 * Build UBN map for BPH books in a tenant (for catalog browser).
 */
let cachedBphDigitizedMap: { value: Record<string, { id: string; slug: string }>; expiresAt: number } | null = null;
const BPH_DIGITIZED_MAP_TTL_MS = 60_000;

export async function fetchTenantBphDigitizedMap(tenantId: string): Promise<Record<string, { id: string; slug: string }>> {
  const now = Date.now();
  if (cachedBphDigitizedMap && cachedBphDigitizedMap.expiresAt > now) {
    return cachedBphDigitizedMap.value;
  }
  try {
    const db = await getReadDb();
    const bphBooks = await db.collection('books').find(
      {
        tenantId,
        'image_source.provider': 'bph',
        'dublin_core.dc_identifier': { $exists: true },
        // Only map catalogue entries to a *readable* book. Hidden books
        // (`visible: false`) 404 at the reader's visibility gate, so a "Read"
        // link built from them is dead — the catalogue then reads as broken.
        // Match the reader gate exactly (only `visible === false` is blocked;
        // null/missing stays public) and require digitised pages.
        visible: { $ne: false },
        pages_count: { $gt: 0 },
      },
      { projection: { id: 1, slug: 1, 'dublin_core.dc_identifier': 1 }, maxTimeMS: 4_000 }
    ).toArray();

    const map: Record<string, { id: string; slug: string }> = {};
    for (const b of bphBooks) {
      const ubn = b.dublin_core?.dc_identifier;
      if (ubn) {
        map[ubn] = { id: b.id, slug: b.slug || b.id };
      }
    }
    cachedBphDigitizedMap = { value: map, expiresAt: now + BPH_DIGITIZED_MAP_TTL_MS };
    return map;
  } catch (err) {
    console.warn('[tenant-library-loaders] fetchTenantBphDigitizedMap failed, serving stale or empty:', err);
    if (cachedBphDigitizedMap) return cachedBphDigitizedMap.value;
    return {};
  }
}

/**
 * Get BPH catalog total for a tenant.
 *
 * Module-level TTL cache keeps the displayed total stable across rapid page
 * navigations. Without it, ongoing imports (e.g. PR #1712 adding 101 Allard
 * Pierson manuscripts mid-session) cause the counter to drift between pages
 * — partner perceived this as a count bug (B11). A 60s window is short
 * enough to stay near-live but long enough to span a normal browsing
 * session.
 */
let cachedBphCatalogTotal: { value: number; expiresAt: number } | null = null;
const BPH_CATALOG_TOTAL_TTL_MS = 60_000;
const SUPABASE_CALL_TIMEOUT_MS = 4_000;

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(promise).then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

export async function fetchTenantBphCatalogTotal(_tenantId: string): Promise<number> {
  const now = Date.now();
  if (cachedBphCatalogTotal && cachedBphCatalogTotal.expiresAt > now) {
    return cachedBphCatalogTotal.value;
  }
  try {
    // bph_works isn't tenant-scoped in Supabase today — return the global total.
    const { count } = await withTimeout(
      supabase.from('bph_works').select('*', { count: 'exact', head: true }),
      SUPABASE_CALL_TIMEOUT_MS,
      'fetchTenantBphCatalogTotal',
    );
    const value = count || 0;
    cachedBphCatalogTotal = { value, expiresAt: now + BPH_CATALOG_TOTAL_TTL_MS };
    return value;
  } catch (err) {
    console.warn('[tenant-library-loaders] fetchTenantBphCatalogTotal failed, serving stale or 0:', err);
    // Serve the last cached value even if expired — better than 0 for the UI count.
    if (cachedBphCatalogTotal) return cachedBphCatalogTotal.value;
    return 0;
  }
}

/**
 * Canonical "is this book in the BPH catalogue?" set, drawn from Supabase
 * `bph_works.sl_book_id`. Used to keep the Selected Books row consistent
 * with the catalogue list view (both view the same set of linked books).
 *
 * Returns the set of MongoDB book ids that appear as `sl_book_id` on any
 * bph_works row — about 2,200 books at last count, fits in memory easily.
 * Paginates around the Supabase 1,000-row default cap.
 */
let cachedBphCataloguedIds: { value: Set<string>; expiresAt: number } | null = null;
const BPH_CATALOGUED_IDS_TTL_MS = 60_000;

export async function fetchTenantBphCataloguedBookIds(): Promise<Set<string> | null> {
  const now = Date.now();
  if (cachedBphCataloguedIds && cachedBphCataloguedIds.expiresAt > now) {
    return cachedBphCataloguedIds.value;
  }
  try {
    const ids = new Set<string>();
    let from = 0;
    while (true) {
      const { data, error } = await withTimeout(
        supabase
          .from('bph_works')
          .select('sl_book_id')
          .not('sl_book_id', 'is', null)
          .range(from, from + 999),
        SUPABASE_CALL_TIMEOUT_MS,
        'fetchTenantBphCataloguedBookIds',
      );
      if (error) throw new Error(`Supabase error: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const r of data) if (r.sl_book_id) ids.add(r.sl_book_id);
      if (data.length < 1000) break;
      from += 1000;
    }
    cachedBphCataloguedIds = { value: ids, expiresAt: now + BPH_CATALOGUED_IDS_TTL_MS };
    return ids;
  } catch (err) {
    console.warn('[tenant-library-loaders] fetchTenantBphCataloguedBookIds failed:', err);
    // Serve the last cached value even if expired; otherwise null so the caller
    // falls back to the unfiltered topBooks list (page.tsx already handles null).
    if (cachedBphCataloguedIds) return cachedBphCataloguedIds.value;
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic catalogue loaders (library_catalog_records)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build catalog_id → { id, slug } map for digitised books in a tenant's
 * catalogue. Reads live Mongo books filtered by tenantId + providerKey, where
 * `image_source.identifier` matches the catalogue's primary key (e.g. priref
 * for Kloss). Overrides whatever's stored in the row at ETL time.
 *
 * Each tenant has its own short cache keyed by (tenantId, providerKey) so
 * BPH-style cron sync isn't required for the visible counter to stay fresh
 * within a single browsing session.
 */
const catalogDigitizedMapCache = new Map<string, { value: Record<string, { id: string; slug: string }>; expiresAt: number }>();
const CATALOG_DIGITIZED_MAP_TTL_MS = 60_000;

export async function fetchTenantCatalogDigitizedMap(
  tenantId: string,
  providerKey: string,
): Promise<Record<string, { id: string; slug: string }>> {
  const cacheKey = `${tenantId}::${providerKey}`;
  const now = Date.now();
  const cached = catalogDigitizedMapCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  try {
    const db = await getReadDb();
    const books = await db.collection('books').find(
      {
        tenantId,
        'image_source.provider': providerKey,
        'image_source.identifier': { $exists: true },
        // Readable-only, same as fetchTenantBphDigitizedMap: a catalogue "Read"
        // link to a hidden book (`visible: false`) dead-ends at the reader gate.
        visible: { $ne: false },
        pages_count: { $gt: 0 },
      },
      { projection: { id: 1, slug: 1, 'image_source.identifier': 1 }, maxTimeMS: 4_000 }
    ).toArray();

    const map: Record<string, { id: string; slug: string }> = {};
    for (const b of books as unknown as Array<{ id: string; slug?: string; image_source?: { identifier?: string | number } }>) {
      const ident = b.image_source?.identifier;
      if (ident !== undefined && ident !== null) {
        map[String(ident)] = { id: b.id, slug: b.slug || b.id };
      }
    }
    catalogDigitizedMapCache.set(cacheKey, { value: map, expiresAt: now + CATALOG_DIGITIZED_MAP_TTL_MS });
    return map;
  } catch (err) {
    console.warn('[tenant-library-loaders] fetchTenantCatalogDigitizedMap failed, serving stale or empty:', err);
    if (cached) return cached.value;
    return {};
  }
}

/**
 * Total catalogue rows for a tenant in `library_catalog_records`. Cached
 * for 60s so the displayed total stays stable across page navigations.
 */
const catalogTotalCache = new Map<string, { value: number; expiresAt: number }>();
const CATALOG_TOTAL_TTL_MS = 60_000;

export async function fetchTenantCatalogTotal(tenantSlug: string): Promise<number> {
  const now = Date.now();
  const cached = catalogTotalCache.get(tenantSlug);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  try {
    const { count } = await withTimeout(
      supabase
        .from('library_catalog_records')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantSlug),
      SUPABASE_CALL_TIMEOUT_MS,
      'fetchTenantCatalogTotal',
    );
    const value = count || 0;
    catalogTotalCache.set(tenantSlug, { value, expiresAt: now + CATALOG_TOTAL_TTL_MS });
    return value;
  } catch (err) {
    console.warn('[tenant-library-loaders] fetchTenantCatalogTotal failed, serving stale or 0:', err);
    if (cached) return cached.value;
    return 0;
  }
}
