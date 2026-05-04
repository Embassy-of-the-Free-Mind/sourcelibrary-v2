/**
 * MongoDB-based browse helpers for tenant-scoped browse pages.
 *
 * Used when x-tenant-id header is present so that /bph/browse/titles/A
 * shows only BPH books, matching the gallery pattern.
 *
 * Supabase books_catalog has no tenant_id column, so these MongoDB
 * equivalents are needed for tenant-filtered queries.
 */

import { getReadDb } from '@/lib/mongodb';

const BOOK_PROJECTION = {
  _id: 0,
  id: 1,
  slug: 1,
  title: 1,
  display_title: 1,
  author: 1,
  language: 1,
  published: 1,
  year: 1,
  pages_count: 1,
  pages_translated: 1,
  thumbnail: 1, image_display: 1,
  thumbnail_blob: 1, image_thumb: 1,
  is_first_translation: 1,
} as const;

export type TenantBrowseBook = {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  year: number;
  pages_count: number;
  pages_translated: number;
  thumbnail: string | null;
  thumbnail_blob: string | null;
  is_first_translation: boolean;
};

function mapBook(b: Record<string, unknown>): TenantBrowseBook {
  return {
    id: b.id as string,
    slug: (b.slug as string) || undefined,
    title: (b.title as string) || '',
    display_title: (b.display_title as string) || undefined,
    author: (b.author as string) || '',
    language: (b.language as string) || '',
    published: (b.published as string) || '',
    year: (b.year as number) || 0,
    pages_count: (b.pages_count as number) || 0,
    pages_translated: (b.pages_translated as number) || 0,
    thumbnail: (b.thumbnail as string) || null,
    thumbnail_blob: (b.thumbnail_blob as string) || null,
    is_first_translation: (b.is_first_translation as boolean) || false,
  };
}

export async function tenantBrowseTitles(tenantId: string, letter: string): Promise<TenantBrowseBook[]> {
  const db = await getReadDb();
  const l = letter.toUpperCase();
  const books = await db.collection('books').find(
    {
      tenantId,
      visible: true,
      pages_count: { $gt: 0 },
      pages_translated: { $gt: 0 },
      $or: [
        { display_title: { $regex: `^${l}`, $options: 'i' } },
        { title: { $regex: `^${l}`, $options: 'i' } },
      ],
    },
    { projection: BOOK_PROJECTION }
  ).sort({ title: 1 }).limit(2000).toArray();

  return books.map(mapBook);
}

export async function tenantBrowseYears(tenantId: string, yearMin: number, yearMax: number): Promise<TenantBrowseBook[]> {
  const db = await getReadDb();
  const books = await db.collection('books').find(
    {
      tenantId,
      visible: true,
      pages_count: { $gt: 0 },
      pages_translated: { $gt: 0 },
      year: { $gte: yearMin, $lte: yearMax },
    },
    { projection: BOOK_PROJECTION }
  ).sort({ year: 1 }).limit(2000).toArray();

  return books.map(mapBook);
}

export async function tenantBrowseAuthors(tenantId: string, letter: string): Promise<{ name: string; count: number }[]> {
  const db = await getReadDb();
  const l = letter.toUpperCase();
  const books = await db.collection('books').find(
    {
      tenantId,
      visible: true,
      pages_count: { $gt: 0 },
      pages_translated: { $gt: 0 },
      author: { $regex: `^${l}`, $options: 'i' },
    },
    { projection: { _id: 0, author: 1 } }
  ).toArray();

  const counts = new Map<string, number>();
  for (const row of books) {
    if (row.author) counts.set(row.author as string, (counts.get(row.author as string) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const VISUAL_RESOURCE_TYPES = ['painting', 'drawing', 'print', 'fresco', 'engraving', 'woodcut'];

export async function tenantBrowseArtists(tenantId: string, letter: string): Promise<{ name: string; count: number }[]> {
  const db = await getReadDb();
  const books = await db.collection('books').find(
    {
      tenantId,
      visible: true,
      resource_type: { $in: VISUAL_RESOURCE_TYPES },
    },
    { projection: { _id: 0, author: 1 } }
  ).toArray();

  const { authorSlug } = await import('@/lib/slugify');
  const slugGroups = new Map<string, Map<string, number>>();
  for (const row of books) {
    if (!row.author || row.author === 'Unknown' || row.author === 'Anonymous') continue;
    const slug = authorSlug(row.author as string);
    if (!slugGroups.has(slug)) slugGroups.set(slug, new Map());
    const variants = slugGroups.get(slug)!;
    variants.set(row.author as string, (variants.get(row.author as string) || 0) + 1);
  }

  const results: { name: string; count: number }[] = [];
  for (const [, variants] of slugGroups) {
    let bestName = '';
    let bestCount = 0;
    let total = 0;
    for (const [name, count] of variants) {
      total += count;
      if (count > bestCount) { bestName = name; bestCount = count; }
    }
    if (bestName.toUpperCase().startsWith(letter.toUpperCase())) {
      results.push({ name: bestName, count: total });
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
