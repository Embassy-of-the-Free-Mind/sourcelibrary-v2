/**
 * Shared resolver for /gallery/collections/[slug] pages.
 *
 * Used by src/app/gallery/collections/[slug]/page.tsx. Tenant gallery collection
 * routes may be added later; this module exists so those pages would
 * (a) fetch gallery_images by id list, (b) dedup near-identical entries that
 * came from image extraction repeating the same illustration across many
 * pages, and (c) cap any single book's share of the rendered grid. Same code,
 * one place.
 *
 * The dedup is needed because:
 * - dhash is missing on a large fraction of historical `gallery_images`,
 *   so [[deduplicateByDHash]] alone does nothing for those rows.
 * - Image extraction emits one `gallery_images` row per detected image per
 *   page. A frontispiece reproduced on 24 different pages of a scan generates
 *   24 separate rows with near-identical AI descriptions.
 * - Without dedup, a single book's repeated frontispiece can dominate a
 *   curated 5-column grid (24 cards in a row of 5 = 5 rows of identical art).
 */
import type { Db } from 'mongodb';
import { deduplicateGalleryImages } from '@/lib/dhash';

export interface GalleryCollectionItem {
  id: string;
  imageUrl: string;
  bookTitle: string;
  description: string;
  type?: string;
  thumbnailUrl?: string;
  extractedUrl?: string;
  galleryQuality?: number;
}

// `book_id` and `dhash` are needed for dedup; they're stripped before return.
const IMAGE_PROJECTION = {
  id: 1, thumbnail_url: 1, extracted_url: 1, image_url: 1,
  book_id: 1, book_title: 1, description: 1, type: 1,
  gallery_quality: 1, dhash: 1,
  _id: 0,
};

/** Hard cap per book in the rendered grid — backstop when both dhash and
 *  description-prefix dedup miss (sparse data, scanned multilingual rebinds).
 *  3 lets a book legitimately contribute a handful of distinct illustrations
 *  to a collection while blocking 24-of-the-same-frontispiece displays. */
const MAX_PER_BOOK = 3;

export async function resolveGalleryCollectionImages(
  db: Db,
  imageIds: string[]
): Promise<GalleryCollectionItem[]> {
  if (imageIds.length === 0) return [];

  const docs = await db
    .collection('gallery_images')
    .find({ id: { $in: imageIds } }, { projection: IMAGE_PROJECTION })
    .toArray();

  const docMap = new Map<string, Record<string, unknown>>(
    docs.map(d => [d.id as string, d as Record<string, unknown>])
  );

  // Preserve curator-supplied order via imageIds, then sort by quality so the
  // dedup helpers keep the best copy of each cluster.
  const ordered: Record<string, unknown>[] = [];
  for (const id of imageIds) {
    const doc = docMap.get(id);
    if (doc) ordered.push(doc);
  }
  ordered.sort(
    (a, b) =>
      ((b.gallery_quality as number) ?? 0) -
      ((a.gallery_quality as number) ?? 0)
  );

  // The dedup helpers narrow generics on the constraint, not the full doc
  // shape. Re-attach the constraint fields onto the existing Record so the
  // post-dedup mapping below can read thumbnail_url/etc. without TS losing
  // them.
  type GalleryRow = Record<string, unknown> & {
    book_id: string;
    gallery_quality: number;
    dhash: string | undefined;
    description: string | undefined;
  };
  const rows: GalleryRow[] = ordered.map(d => ({
    ...d,
    book_id: (d.book_id as string) ?? '',
    gallery_quality: (d.gallery_quality as number) ?? 0,
    dhash: (d.dhash as string | undefined) ?? undefined,
    description: (d.description as string | undefined) ?? undefined,
  }));
  const deduped = deduplicateGalleryImages(rows);

  const perBook = new Map<string, number>();
  const capped: GalleryRow[] = [];
  for (const d of deduped) {
    const n = perBook.get(d.book_id) ?? 0;
    if (n >= MAX_PER_BOOK) continue;
    perBook.set(d.book_id, n + 1);
    capped.push(d);
  }

  return capped.map(doc => ({
    id: doc.id as string,
    imageUrl: (doc.thumbnail_url || doc.extracted_url || doc.image_url) as string,
    bookTitle: (doc.book_title as string) || 'Unknown',
    description: (doc.description as string) || '',
    type: doc.type as string | undefined,
    thumbnailUrl: doc.thumbnail_url as string | undefined,
    extractedUrl: doc.extracted_url as string | undefined,
    galleryQuality: doc.gallery_quality as number | undefined,
  }));
}
