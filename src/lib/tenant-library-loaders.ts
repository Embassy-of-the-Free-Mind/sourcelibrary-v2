/**
 * Tenant-scoped library data loaders.
 * Queries books by tenantId instead of provider, to support tenant-native library landing pages.
 */

import { getReadDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import { ObjectId } from 'mongodb';

const PER_PAGE = 60;

interface BrowseOptions {
  tenantId: string;
  sort: 'popular' | 'title' | 'year_asc' | 'year_desc' | 'recent';
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

  let pipelineStart: Record<string, unknown>[];

  if (opts.search && opts.search.trim()) {
    // For search, could use Atlas Search; for now use text index as fallback
    pipelineStart = [
      { $match: { $text: { $search: opts.search } } },
      { $match: { $and: matchConditions } },
    ];
  } else {
    pipelineStart = [
      { $match: { $and: matchConditions } },
    ];
  }

  const sortStage: Record<string, 1 | -1> = {
    title: 1,
  };
  switch (opts.sort) {
    case 'popular':
      sortStage['quality_score'] = -1;
      sortStage['has_translations'] = -1;
      sortStage['last_translation_at'] = -1;
      break;
    case 'title':
      sortStage['title'] = 1;
      break;
    case 'year_asc':
      sortStage['year'] = 1;
      break;
    case 'year_desc':
      sortStage['year'] = -1;
      break;
    case 'recent':
      sortStage['last_processed'] = -1;
      break;
  }

  const projection = {
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

/**
 * Fetch all library data for a tenant, scoped by tenantId instead of provider.
 */
export async function fetchTenantLibraryData(
  tenantId: string,
  sort: string,
  language: string,
  offset: number,
  q?: string
): Promise<TenantLibraryData> {
  const db = await getReadDb();

  // Fetch paginated books, top books for gallery, and languages in parallel
  const [booksResult, languages, topBooksResult] = await Promise.all([
    browseTenantBooks({
      tenantId,
      sort: (sort as 'popular' | 'title' | 'year_asc' | 'year_desc' | 'recent') || 'popular',
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
    galleryImages,
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
