// PRIOR ART: src/components/book/RelatedEditions.tsx — its work_id query (filter, projection,
// maxTimeMS) moved here unchanged apart from the bound, so the editions rail and the volume
// strip (#7527) share ONE query per render via React cache() instead of each running its own.
import { cache } from 'react';
import { getReadDb } from '@/lib/mongodb';

/** A work_id sibling as the book page's rails read it. Project only these. */
export interface WorkSibling {
  id?: string;
  slug?: string;
  title?: string;
  display_title?: string;
  year?: number;
  published?: string;
  language?: string;
  pages_count?: number;
  pages_translated?: number;
  work_slug?: string;
  edition_key?: string;
  image_source?: { provider_name?: string };
}

/**
 * Reader-safe sibling filter (#3730 §4 — do not relax): never a hidden book,
 * never an empty one, never a duplicate pointer whatever its visibility.
 */
export const SIBLING_FILTER = {
  visible: true,
  pages_count: { $gt: 0 },
  $or: [{ duplicate_of: { $exists: false } }, { duplicate_of: { $in: [null, ''] } }],
};

export const SIBLING_PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, year: 1, published: 1, language: 1,
  pages_count: 1, pages_translated: 1, work_slug: 1, edition_key: 1,
  'image_source.provider_name': 1,
};

/**
 * The largest set measured (2026-10-27) has 728 volumes under one work_id;
 * the bound sits above it so a whole set is listed, and still caps the read.
 */
const MAX_SIBLINGS = 1000;

/**
 * All reader-safe books sharing `workId`, INCLUDING the current one (callers
 * drop it) — so the cache key is the work alone. Served by the `work_id` index.
 *
 * A failed read yields [] (no rail), as the editions rail always did: the book
 * page revalidates daily (revalidate = 86400, not `false`), so a bad render
 * costs one window of a secondary rail, never a frozen page.
 */
export const getWorkSiblings = cache(async (workId: string): Promise<WorkSibling[]> => {
  const db = await getReadDb();
  return (await db.collection('books').find(
    { work_id: workId, ...SIBLING_FILTER },
    { projection: SIBLING_PROJECTION, limit: MAX_SIBLINGS, maxTimeMS: 3000 },
  ).toArray().catch(() => [])) as WorkSibling[];
});
