import type { Db } from 'mongodb';

/**
 * App-layer guard against hidden artworks leaking out of semantic search.
 *
 * `match_artworks_semantic` (Supabase) now filters `visible IS NOT FALSE`, but
 * that column is a snapshot of Mongo `books.visible` and can drift if an artwork
 * is hidden without re-running the sync. Callers that consume RPC rows *directly*
 * (librarian search_artworks, /api/search/unified, /api/identify) — i.e. without
 * re-resolving each result against Mongo the way /api/artwork/search and
 * /api/gallery do — run their results through this to drop anything not currently
 * visible in Mongo. Defense in depth for the books visible/hidden invariant.
 *
 * Despite the name it is generic over any `{ book_id }` row: the unified-search
 * gallery lane (gallery_images, whose book_visible mirror can drift) and CLIP
 * visual lane (clip_embeddings, no visibility column at all) run through it too.
 *
 * Returns the input rows minus any whose book is not `visible: true` in Mongo.
 */
export async function filterVisibleArtworks<T extends { book_id: string }>(
  db: Db,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const ids = rows.map(r => r.book_id);
  const hiddenDocs = await db.collection('books')
    .find({ id: { $in: ids }, visible: { $ne: true } }, { projection: { _id: 0, id: 1 }, maxTimeMS: 3000 })
    .toArray()
    .catch(() => [] as Array<{ id?: string }>);
  if (hiddenDocs.length === 0) return rows;
  const hidden = new Set(hiddenDocs.map(d => d.id));
  return rows.filter(r => !hidden.has(r.book_id));
}
