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

  // Contributing libraries (for tenant diversity insight)
  // Query books visible from any provider in this tenant
  const { data: contribData } = await supabase
    .from('books_catalog')
    .select('contributing_library')
    .eq('visible', true)
    .gt('pages_count', 0)
    .gt('pages_translated', 0)
    .not('contributing_library', 'is', null);

  const contribCounts = new Map<string, number>();
  for (const row of (contribData || [])) {
    if (row.contributing_library) {
      contribCounts.set(row.contributing_library, (contribCounts.get(row.contributing_library) || 0) + 1);
    }
  }
  const contributingLibraries = [...contribCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

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
 */
export async function getTenantDominantProvider(tenantId: string): Promise<string | null> {
  const db = await getReadDb();

  const result = await db.collection('books').aggregate([
    { $match: { tenantId, visible: true } },
    { $group: { _id: '$image_source.provider', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 },
  ], { maxTimeMS: 10_000 }).toArray();

  return result[0]?._id || null;
}

/**
 * Build UBN map for BPH books in a tenant (for catalog browser).
 */
export async function fetchTenantBphDigitizedMap(tenantId: string): Promise<Record<string, { id: string; slug: string }>> {
  try {
    const db = await getReadDb();
    const bphBooks = await db.collection('books').find(
      {
        tenantId,
        'image_source.provider': 'bph',
        'dublin_core.dc_identifier': { $exists: true },
      },
      { projection: { id: 1, slug: 1, 'dublin_core.dc_identifier': 1 }, maxTimeMS: 15_000 }
    ).toArray();

    const map: Record<string, { id: string; slug: string }> = {};
    for (const b of bphBooks) {
      const ubn = b.dublin_core?.dc_identifier;
      if (ubn) {
        map[ubn] = { id: b.id, slug: b.slug || b.id };
      }
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Get BPH catalog total for a tenant.
 */
export async function fetchTenantBphCatalogTotal(tenantId: string): Promise<number> {
  // For now, return the global BPH catalog total since it's not tenant-scoped in Supabase
  const { count } = await supabase
    .from('bph_works')
    .select('*', { count: 'exact', head: true });
  return count || 0;
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
export async function fetchTenantBphCataloguedBookIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('bph_works')
      .select('sl_book_id')
      .not('sl_book_id', 'is', null)
      .range(from, from + 999);
    if (error) break;
    if (!data || data.length === 0) break;
    for (const r of data) if (r.sl_book_id) ids.add(r.sl_book_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  return ids;
}
