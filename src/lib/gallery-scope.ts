/**
 * One definition of "which gallery images am I talking about".
 *
 * Every surface that shows a plate count next to a link into /gallery used to
 * decide the query twice: once to count, once to build the href. They drifted,
 * every time, in a different way:
 *
 *   - the collection page counted 60 (a fetch limit) and linked to 267
 *   - the same link then opened a page capped at 3 images per book, showing 9
 *   - mycology claimed 2,980 and its destination served 2,793, because the
 *     count did not apply /api/gallery's own extracted_url + image_url filters
 *   - a book-scoped gallery reported 206,230 — the whole corpus — because
 *     `bookId` was missing from the branch that counts instead of estimating
 *   - the book page counted at quality >= 0.7 and linked to a page defaulting
 *     to 0.5, so "View all 141 illustrations" opened 192
 *
 * Five bugs, one cause. So a scope is now a value: `galleryFilter` turns it into
 * the Mongo query, `galleryHref` turns the SAME value into the URL that
 * reproduces it, and `countGalleryImages` counts with that filter. A count and
 * the link beside it are derived from one object, so they cannot disagree
 * without someone deliberately passing two different scopes.
 */

/** Images per book on an unscoped browse; >= this means "no cap". */
export const NO_PER_BOOK_CAP = 999;
export const DEFAULT_MAX_PER_BOOK = 3;
/**
 * /api/gallery's own default. It is 0.7, not the 0.5 used by the collection
 * pages' own queries — which is how a collection counted 1,995 plates and its
 * link opened 758. Verified against the route, not assumed: getting this wrong
 * reproduces the exact bug this module exists to prevent.
 */
export const DEFAULT_MIN_QUALITY = 0.7;

export interface GalleryScope {
  /** A single book. */
  bookId?: string;
  /** A collection slug — resolved to book ids by the caller (see `bookIds`). */
  collection?: string;
  /** The books a collection resolves to. Required when `collection` is set. */
  bookIds?: string[];
  minQuality?: number;
  /** Cap per book. Omit for the default; NO_PER_BOOK_CAP to show everything. */
  maxPerBook?: number;
  /** Restrict to images whose description matches — subject collections. */
  descriptionMatch?: string;
}

/**
 * The Mongo filter for a scope, including the conditions /api/gallery applies to
 * everything it serves. Counting without these was how mycology promised 2,980
 * plates and delivered 2,793: images with no crop are not servable, so they must
 * not be counted either.
 */
export function galleryFilter(scope: GalleryScope, opts: { tenantId?: string | null } = {}): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    gallery_quality: { $gte: scope.minQuality ?? DEFAULT_MIN_QUALITY },
    book_visible: true,
    extracted_url: { $ne: null },
    image_url: { $ne: null },
  };

  if (scope.bookId) filter.book_id = scope.bookId;
  else if (scope.bookIds) filter.book_id = { $in: scope.bookIds.slice(0, 200) };

  // The per-book cap is part of what gets served, so it is part of the count.
  const cap = scope.maxPerBook ?? DEFAULT_MAX_PER_BOOK;
  if (!scope.bookId && cap < 100) filter.book_rank = { $lte: cap };

  if (scope.descriptionMatch) {
    filter.$or = [
      { description: { $regex: scope.descriptionMatch, $options: 'i' } },
      { museum_description: { $regex: scope.descriptionMatch, $options: 'i' } },
    ];
  }
  return filter;
}

/** The /gallery URL that reproduces this scope. Same value in, same set out. */
export function galleryHref(scope: GalleryScope, prefix = ''): string {
  const p = new URLSearchParams();
  if (scope.bookId) p.set('bookId', scope.bookId);
  if (scope.collection) p.set('collection', scope.collection);
  // Both are written even when they equal today's default. A URL that relies on
  // a default agrees with the count only until someone changes the default —
  // which is what happened here.
  p.set('minQuality', String(scope.minQuality ?? DEFAULT_MIN_QUALITY));
  p.set('maxPerBook', String(scope.maxPerBook ?? DEFAULT_MAX_PER_BOOK));
  // descriptionMatch is deliberately absent: /gallery cannot filter by subject,
  // so a scope that uses it must not claim its count for that link. Callers
  // showing a subject-filtered set link with the unfiltered scope and say so.
  const qs = p.toString();
  return `${prefix}/gallery${qs ? `?${qs}` : ''}`;
}

/** True when this scope cannot be reproduced by /gallery, so its count must not label a link there. */
export const isLinkableScope = (scope: GalleryScope) => !scope.descriptionMatch;

export interface CountableDb {
  collection(name: string): { countDocuments(filter: Record<string, unknown>, opts?: Record<string, unknown>): Promise<number> };
}

export async function countGalleryImages(db: CountableDb, scope: GalleryScope, opts: { tenantId?: string | null; maxTimeMS?: number } = {}): Promise<number> {
  return db.collection('gallery_images').countDocuments(
    galleryFilter(scope, { tenantId: opts.tenantId }),
    { maxTimeMS: opts.maxTimeMS ?? 5000 },
  );
}
