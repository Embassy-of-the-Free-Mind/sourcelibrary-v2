import { cache } from 'react';
import { getReadDb } from '@/lib/mongodb';
import { getRoomBySlug, type ReadingRoom } from '@/lib/reading-rooms';

/**
 * One room lookup per request, shared by the room layout (theme, chrome) and
 * whichever page renders under it (shelf, book, reader). Same shape as the
 * `getCachedTenant` memo in src/app/[tenant]/layout.tsx.
 */
export const getCachedRoom = cache(async (slug: string): Promise<ReadingRoom | null> => {
  const db = await getReadDb();
  return getRoomBySlug(db, slug);
});
