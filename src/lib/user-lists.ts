/**
 * User lists — server-side helpers shared by the /api/lists routes.
 *
 * Storage: `user_lists` + `user_list_items` (separate collections by design —
 * field-sprawl.md forbids growing users/books). Lists are SIGNED-IN ONLY:
 * owner_id is always a NextAuth session user id. (Likes stay dual-identity;
 * lists are durable curation and live on an account.)
 *
 * Visibility: 'private' (default) or 'public'. Public list pages render the
 * list's content only — never the owner's name (safe-defaults.md).
 */

import { randomBytes } from 'crypto';
import type { Db } from 'mongodb';
import type { ListTargetType, ListVisibility, UserList } from '@/lib/types/lists';
import { getBookThumbnailUrl } from '@/lib/utils';
import { buildCropUrl } from '@/lib/social-image-selector';

export const LIST_TITLE_MAX = 100;
export const LIST_DESCRIPTION_MAX = 1000;
export const MAX_LISTS_PER_OWNER = 100;
export const MAX_ITEMS_PER_LIST = 500;

export const LIST_TARGET_TYPES: ListTargetType[] = ['book', 'page', 'image'];

export function newListId(): string {
  // Hex, URL-safe, no dots. 12 bytes ≈ collision-free at this scale.
  return 'l_' + randomBytes(12).toString('hex');
}

export function isValidVisibility(v: unknown): v is ListVisibility {
  return v === 'private' || v === 'public';
}

/** Shape a list doc for the API — never leak owner_id to non-owners. */
export function serializeList(list: UserList, isOwner: boolean) {
  return {
    id: list.id,
    title: list.title,
    description: list.description || '',
    visibility: list.visibility,
    items_count: list.items_count || 0,
    created_at: list.created_at,
    updated_at: list.updated_at,
    is_owner: isOwner,
  };
}

/**
 * Does the target exist? Same lookup the likes toggle does — book by id or
 * slug; page/image via the parent page (image ids are `{pageId}-{idx}` or
 * legacy `{pageId}:{idx}`).
 */
export async function targetExists(
  db: Db,
  targetType: ListTargetType,
  targetId: string
): Promise<boolean> {
  if (targetType === 'book') {
    const book = await db.collection('books').findOne(
      { $or: [{ id: targetId }, { slug: targetId }] },
      { projection: { _id: 1 } }
    );
    return !!book;
  }
  const pageId = targetType === 'page'
    ? targetId
    : targetId.includes(':')
      ? targetId.split(':')[0]
      : targetId.replace(/-\d+$/, '');
  if (!pageId) return false;
  const page = await db.collection('pages').findOne(
    { id: pageId },
    { projection: { _id: 1 } }
  );
  return !!page;
}

export interface EnrichedListItem {
  target_type: ListTargetType;
  target_id: string;
  added_at: Date | string;
  title: string;
  subtitle?: string;
  thumbnail?: string | null;
  /** Site-relative link to the item. */
  href: string;
  /** 'artwork' book records get tagged so cards can label them. */
  contentType?: string;
}

/**
 * Enrich raw list items into displayable cards. Modeled on
 * /api/likes/mine's per-type lookups; kept lean — one query per target type.
 */
export async function enrichListItems(
  db: Db,
  items: Array<{ target_type: ListTargetType; target_id: string; added_at: Date | string }>
): Promise<EnrichedListItem[]> {
  const byType = {
    book: items.filter(i => i.target_type === 'book').map(i => i.target_id),
    page: items.filter(i => i.target_type === 'page').map(i => i.target_id),
    image: items.filter(i => i.target_type === 'image').map(i => i.target_id),
  };

  // Books
  const bookDocs = byType.book.length
    ? await db.collection('books').find(
        { $or: [{ id: { $in: byType.book } }, { slug: { $in: byType.book } }] },
        { projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, cover_image: 1, content_type: 1 } }
      ).toArray()
    : [];
  const bookMap = new Map<string, (typeof bookDocs)[number]>();
  for (const b of bookDocs) {
    bookMap.set(b.id, b);
    if (b.slug) bookMap.set(b.slug, b);
  }

  // Pages (also parent pages of image targets)
  const imageParsed = byType.image.map(id => {
    const match = id.match(/^(.+)[:\-](\d+)$/);
    return { targetId: id, pageId: match?.[1] ?? id, detectionIndex: match ? parseInt(match[2]) : 0 };
  });
  const pageIds = [...new Set([...byType.page, ...imageParsed.map(p => p.pageId)])];
  const pageDocs = pageIds.length
    ? await db.collection('pages').find(
        { id: { $in: pageIds } },
        { projection: { id: 1, book_id: 1, page_number: 1, thumbnail_blob: 1, image_thumb: 1, archived_photo: 1, cropped_photo: 1, photo: 1, photo_original: 1, detected_images: 1 } }
      ).toArray()
    : [];
  const pageMap = new Map(pageDocs.map(p => [p.id, p]));

  // Parent books of pages, for card subtitles
  const parentBookIds = [...new Set(pageDocs.map(p => p.book_id).filter(Boolean))]
    .filter(id => !bookMap.has(id));
  const parentBooks = parentBookIds.length
    ? await db.collection('books').find(
        { id: { $in: parentBookIds } },
        { projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1 } }
      ).toArray()
    : [];
  const parentBookMap = new Map(parentBooks.map(b => [b.id, b]));
  const bookTitle = (bookId: string): string => {
    const b = bookMap.get(bookId) || parentBookMap.get(bookId);
    return b ? (b.display_title || b.title) : 'Unknown book';
  };

  const enriched: EnrichedListItem[] = [];
  for (const item of items) {
    if (item.target_type === 'book') {
      const book = bookMap.get(item.target_id);
      if (!book) continue;
      enriched.push({
        target_type: 'book',
        target_id: item.target_id,
        added_at: item.added_at,
        title: book.display_title || book.title,
        subtitle: [book.author, book.year || book.published].filter(Boolean).join(', '),
        thumbnail: book.cover_image || getBookThumbnailUrl(book as { thumbnail?: string | null; thumbnail_blob?: string | null; image_display?: string | null; image_thumb?: string | null }, 'thumb'),
        href: `/book/${book.slug || book.id}`,
        contentType: book.content_type,
      });
    } else if (item.target_type === 'page') {
      const page = pageMap.get(item.target_id);
      if (!page) continue;
      enriched.push({
        target_type: 'page',
        target_id: item.target_id,
        added_at: item.added_at,
        title: `Page ${page.page_number}`,
        subtitle: bookTitle(page.book_id),
        thumbnail: page.thumbnail_blob || page.archived_photo || page.cropped_photo || page.photo,
        href: `/book/${page.book_id}/page-number/${page.page_number}`,
      });
    } else {
      const parsed = imageParsed.find(p => p.targetId === item.target_id);
      const page = parsed ? pageMap.get(parsed.pageId) : undefined;
      const detection = page?.detected_images?.[parsed?.detectionIndex ?? 0];
      if (!parsed || !page || !detection) continue;
      const croppedUrl = buildCropUrl({
        pageId: parsed.pageId,
        detectionIndex: parsed.detectionIndex,
        galleryImageId: parsed.targetId,
        galleryQuality: detection.gallery_quality || 0,
        shareabilityScore: 0,
        description: detection.description || '',
        type: detection.type || 'illustration',
        bbox: detection.bbox,
        bookId: page.book_id,
        bookTitle: bookTitle(page.book_id),
        pageNumber: page.page_number,
        imageUrl: page.archived_photo || page.cropped_photo || page.photo_original || '',
      });
      enriched.push({
        target_type: 'image',
        target_id: item.target_id,
        added_at: item.added_at,
        title: detection.description || 'Illustration',
        subtitle: bookTitle(page.book_id),
        thumbnail: croppedUrl,
        href: `/gallery/image/${parsed.targetId}`,
      });
    }
  }
  return enriched;
}
