/**
 * What the PUBLIC API is allowed to hand out as a fetchable image URL.
 *
 * WHY THIS EXISTS
 * ---------------
 * Page documents carry two kinds of image URL side by side:
 *
 *   ours    archived_photo (full-res master), display_photo (~2000px serving
 *           variant), image_thumb / thumbnail_blob — all on our own CDN
 *   theirs  photo, photo_original, thumbnail — the ORIGINATING INSTITUTION's
 *           server: archive.org, the Bavarian State Library, the British
 *           Library, e-rara, Gallica, Harvard, the Bodleian and ~15 more
 *
 * Measured over a 60k-page sample (2026-08-31): 74% of `photo` values point
 * off our infrastructure. A consumer who takes the most obviously-named field
 * and paginates therefore sends thousands of requests to libraries that gave
 * us access — which is how an external consumer got as far as "I stopped
 * downloading, I didn't want to get spam-filtered by Leiden."
 *
 * We do not need to serve theirs. `archived_photo` is present on 100% of
 * sampled pages, and it EQUALS OR EXCEEDS the source: measured page-for-page,
 * Göttingen 3651x4652 both sides, HAB 3912x5000 both sides, Morgan 8308x10576
 * for our master against 2000x2546 at the source URL, and the Bodleian source
 * returned HTTP 504 while ours served fine. Handing out their URL is worse for
 * them AND worse for the consumer.
 *
 * PROVENANCE IS NOT LOST. Where a scan came from is a first-class fact and
 * still travels — as attribution (provider name, the item's landing page),
 * not as a per-page image endpoint to bulk-fetch. That distinction is the
 * whole point of this module: credit the library, don't hammer it.
 *
 * NOT for internal use. The pipeline legitimately fetches source URLs (that is
 * how the archive gets made), and `src/lib/page-image-url.ts` legitimately
 * falls back to them when rendering our own pages. This applies only where a
 * page object crosses the boundary into a public API response.
 */

/** Hosts we serve ourselves. */
const OUR_HOSTS = /(^|\.)sourcelibrary\.org$/i;

/** True when a URL is on our own infrastructure (or is a relative path). */
export function isOwnInfraUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false;
  if (url.startsWith('/')) return true; // our own route, e.g. /api/image
  try {
    return OUR_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Image-bearing fields that may hold a third party's URL. */
const SOURCE_URL_FIELDS = ['photo', 'photo_original', 'thumbnail'] as const;

export interface PublicPageImages {
  /** Full-resolution master on our CDN — what a bulk consumer should fetch. */
  image_full: string | null;
  /** ~2000px serving variant on our CDN — what a viewer should render. */
  image_display: string | null;
  /** Thumbnail on our CDN. */
  image_thumb: string | null;
  /**
   * True when we hold no copy of our own. Explicit rather than silent: a
   * consumer must be able to tell "we have no image" from "the field is
   * missing", and it is the honest alternative to substituting someone
   * else's URL (absence-is-not-failure).
   */
  image_unavailable?: true;
}

/**
 * Strip third-party image URLs from a page object and surface our own under
 * stable names. Unknown keys pass through untouched, so this is safe to apply
 * to any projection.
 */
export function toPublicPageImages<T extends Record<string, unknown>>(page: T): Omit<T, typeof SOURCE_URL_FIELDS[number]> & PublicPageImages {
  const out: Record<string, unknown> = { ...page };
  for (const f of SOURCE_URL_FIELDS) delete out[f];

  const pick = (...vals: unknown[]) => vals.find(isOwnInfraUrl) as string | undefined;

  const full = pick(page.archived_photo, page.cropped_photo, page.display_photo);
  const display = pick(page.display_photo, page.image_display, page.cropped_photo, page.archived_photo);
  const thumb = pick(page.image_thumb, page.thumbnail_blob, page.display_photo);

  out.image_full = full ?? null;
  out.image_display = display ?? null;
  out.image_thumb = thumb ?? null;
  if (!full && !display && !thumb) out.image_unavailable = true;

  // Legacy field names kept ONLY when they are already ours, so existing
  // consumers keep working without any of them becoming a third-party URL.
  for (const f of ['archived_photo', 'display_photo', 'cropped_photo', 'image_thumb', 'thumbnail_blob'] as const) {
    if (f in out && !isOwnInfraUrl(out[f])) delete out[f];
  }

  return out as Omit<T, typeof SOURCE_URL_FIELDS[number]> & PublicPageImages;
}
