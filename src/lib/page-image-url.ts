/**
 * Canonical page-image URL resolver — issue #1727.
 *
 * Two orthogonal axes, and only one is universal:
 *  - SIZE (100% of pages): every page needs thumb / display / original / hires.
 *    This is the spine — `getPageImageUrl(page, size)`.
 *  - SOURCE IDENTITY (~10% need care): which file *is* this page. Obvious for
 *    most pages; the only non-trivial case is split-from-spread scans, where
 *    "the page" is half a physical scan. Handled once in `getPageSource()`.
 *
 * Invariants:
 *  - `thumb` / `display` always return a browser-safe, size-bounded URL — a
 *    pre-sized R2 variant, an IIIF-native resize, or the /api/image proxy.
 *    Never the raw full-res original, never a .jp2/.tif.
 *  - The raw original is reserved for `original` (OCR/download) and `hires`.
 *  - Never routes through /_next/image (metered Vercel image optimization).
 *
 * Size tiers (cheapest → fallback):
 *   pre-sized R2 variant (free egress)
 *     → IIIF-native resize `/full/{w},/` (origin server resizes, free, blockable)
 *       → /api/image sharp proxy (our compute, cached 1 week)
 *         → raw original (only for `original`/`hires`)
 *
 * JP2/TIFF never reach here: providers' IIIF servers transcode to JPEG, and our
 * archive pipeline runs opj_decompress → JPEG on R2. 100% of stored URLs are .jpg.
 */
import { isUsableImageUrl, isArchiveFailed } from '@/lib/utils';
import { isBrowserRenderableImageUrl } from '@/lib/csp-img-hosts';
import { isAllowedImageHost } from '@/lib/image-proxy-hosts';

export type ImageSize = 'thumb' | 'display' | 'original' | 'hires';

const DISPLAY_WIDTH = 1200;
const THUMB_WIDTH = 150;
const HIRES_WIDTH = 4000;

/**
 * Structural subset of a page document. Works with Mongo docs, Partial<Page>,
 * and API projections — only the image-bearing fields matter here.
 */
export interface PageImageFields {
  photo?: string | null;
  photo_original?: string | null;
  archived_photo?: string | null;
  enhanced_photo?: string | null;
  cropped_photo?: string | null;
  display_photo?: string | null;
  image_thumb?: string | null;
  /** @deprecated superseded by image_thumb; still read as a fallback */
  thumbnail_blob?: string | null;
  thumbnail?: string | null;
  split_from_spread?: boolean;
  crop?: { xStart?: number; xEnd?: number } | null;
}

/** Formats a browser cannot render — must never be returned for display/thumb. */
const UNSAFE_FORMAT = /\.(jp2|jpx|jpf|j2k|tiff?)(\?|$)/i;

/**
 * True if the URL is safe to hand straight to an <img>. Note: an IIIF URL that
 * merely *contains* `.jp2` as its source identifier but ends in `default.jpg`
 * is safe — we only reject URLs whose final extension is non-renderable.
 */
function isBrowserSafe(url: string): boolean {
  return !UNSAFE_FORMAT.test(url);
}

/**
 * Will `/api/image` agree to fetch this? The proxy keeps its own, narrower
 * allowlist (it is an outbound-fetch boundary, not a render policy), so routing
 * an un-allowlisted host through it produces a 400, not a picture.
 */
function isProxyableUrl(url: string): boolean {
  try {
    return isAllowedImageHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Candidate screening for the browser-facing sizes, and the reason this module
 * screens at all.
 *
 * Until 2026-08-21 it did not. `media.getty.edu` was absent from
 * `CSP_IMG_HOSTS`, so all 2,506 Florentine Codex pages resolved to a Getty
 * `image_thumb` that every browser refused — the page grid and the cover picker
 * rendered nothing — while curl got a clean 200 from every one of those URLs.
 * The book-cover resolver (`getBookThumbnailUrl`) had screened against this same
 * list since 2026-08-04; the page resolver never did, and an R2 thumbnail that
 * would have worked sat one field away the whole time.
 *
 * Note the blast radius is per SIZE TIER, not per book: those same pages carry
 * `display_photo` on R2, so the reader's main image was never affected. A host
 * can be missing for one tier and present for another.
 *
 * But not every consumer here is a browser. Exports (PDF/EPUB/ZIP) hand the
 * result to a server-side fetcher, where CSP does not apply — so a URL the
 * browser would refuse is still perfectly usable there. Hence: a renderable
 * candidate wins outright, and a non-renderable but size-bounded one is
 * *remembered* rather than discarded, returned only when nothing renderable and
 * nothing proxyable exists. That case is empty in the corpus today (every
 * page-image host is allowlisted), but discarding the only working URL would
 * have broken `pageExportImageUrl` for any future one.
 *
 * Same-origin URLs (`/api/image?…`) never reach here — they are built, not
 * chosen, and `'self'` always passes.
 */
class SizedCandidates {
  private fallback: string | null = null;

  /** True when `url` can go straight to an <img>; otherwise it may be kept. */
  accept(url: string | null | undefined): url is string {
    if (!isUsableImageUrl(url) || !isBrowserSafe(url)) return false;
    if (isBrowserRenderableImageUrl(url)) return true;
    this.fallback ??= url;
    return false;
  }

  /** The best non-renderable candidate seen, for server-side consumers. */
  get lastResort(): string | null {
    return this.fallback;
  }
}

/**
 * IIIF-native resize: ask the origin server for a given width by rewriting the
 * size segment of a IIIF Image API URL (`/full/{size}/{rot}/{quality}.jpg`).
 * Returns null for non-IIIF URLs. Free, but the origin can rate-limit/block —
 * callers fall back to the /api/image proxy.
 */
function iiifResize(url: string, width: number): string | null {
  if (!/\/full\/(full|max|\d+,|,\d+|pct:[\d.]+)\/\d+\/(default|color|gray|bitonal)\.(jpe?g|png)$/i.test(url)) {
    return null;
  }
  return url.replace(/\/full\/(full|max|\d+,|,\d+|pct:[\d.]+)\//, `/full/${width},/`);
}

/** Build an /api/image proxy URL (our sharp resizer, Cloudflare-cached). */
function proxyUrl(
  base: string,
  width: number,
  quality: number,
  crop?: { xStart?: number; xEnd?: number } | null,
): string {
  let url = `/api/image?url=${encodeURIComponent(base)}&w=${width}&q=${quality}`;
  if (crop && crop.xStart !== undefined && crop.xEnd !== undefined) {
    url += `&cx=${crop.xStart}&cw=${crop.xEnd}`;
  }
  return url;
}

/**
 * Derive a pre-sized R2 variant from a canonical `pages/{bookId}/{NNNN}` photo
 * URL (handles the `sp` prefix for new-era split halves). Returns null if the
 * photo isn't a canonical pages/ URL.
 */
function deriveVariant(photo: string | null | undefined, size: 'display' | 'thumb'): string | null {
  if (!photo) return null;
  const m = photo.match(
    /^(https:\/\/images\.sourcelibrary\.org\/pages\/[^/]+\/(?:sp[a-z0-9]*-?)?\d{4,})(-full)?\.jpg$/,
  );
  if (!m) return null;
  return size === 'thumb' ? `${m[1]}-thumb.jpg` : `${m[1]}.jpg`;
}

/**
 * The original-resolution source image for a page — the file to OCR, download,
 * or resize from. This is the SOURCE-identity axis: trivial for most pages, but
 * split-aware for the ~10% split-from-spread scans.
 *
 * Precedence:
 *   1. `cropped_photo` — old-era split: the materialized cropped half (unambiguous).
 *   2. split-from-spread `photo` — new-era split: the splitter rewrote `photo`
 *      to the `sp…` cropped half.
 *   3. archiving failed → null (archiving already proved the source URLs dead).
 *   4. `enhanced_photo` — contrast/brightness-enhanced copy, preferred when present
 *      (currently ~0% populated, but a deliberate cover-selection preference; placed
 *      *after* split handling so it can never reintroduce the full-spread).
 *   5. `archived_photo` → `photo_original` → `photo` (normal pages).
 */
export function getPageSource(page: PageImageFields): string | null {
  if (isUsableImageUrl(page.cropped_photo)) return page.cropped_photo;
  if (page.split_from_spread && isUsableImageUrl(page.photo)) return page.photo;
  if (isArchiveFailed(page.archived_photo)) return null;
  if (isUsableImageUrl(page.enhanced_photo)) return page.enhanced_photo;
  if (isUsableImageUrl(page.archived_photo)) return page.archived_photo;
  if (isUsableImageUrl(page.photo_original)) return page.photo_original;
  if (isUsableImageUrl(page.photo)) return page.photo;
  return null;
}

/**
 * The crop region to apply, or undefined. Crop coords reference the *full
 * uncropped* source, so they apply only to a non-split page with no materialized
 * cropped half: split pages already resolve to the half via getPageSource, and a
 * materialized `cropped_photo` is already pre-cropped. (~0.04% of pages — rare,
 * but real and verified, so we preserve the legacy proxy-crop behavior.)
 */
function cropRegion(page: PageImageFields): { xStart?: number; xEnd?: number } | undefined {
  return !page.split_from_spread &&
    !isUsableImageUrl(page.cropped_photo) &&
    page.crop?.xStart !== undefined &&
    page.crop?.xEnd !== undefined
    ? page.crop
    : undefined;
}

/**
 * Resolve a display- or thumb-sized URL. Prefers a pre-sized R2 variant, then an
 * IIIF-native resize, then the /api/image proxy. Always browser-safe and bounded.
 */
function resolveSized(page: PageImageFields, size: 'display' | 'thumb'): string | null {
  const width = size === 'thumb' ? THUMB_WIDTH : DISPLAY_WIDTH;
  const quality = size === 'thumb' ? 60 : 80;
  const hasCroppedHalf = isUsableImageUrl(page.cropped_photo);

  // Crop-coords page: the pre-sized variant is the UNcropped image, so we must
  // proxy-crop the source instead of returning display_photo/-thumb.
  const crop = cropRegion(page);
  if (crop) {
    const base = getPageSource(page);
    return base && isBrowserSafe(base) ? proxyUrl(base, width, quality, crop) : null;
  }

  const candidates = new SizedCandidates();

  // (A) Pre-sized R2 variant — only when it matches the *displayed* content.
  // Skip for old-era split pages: their display_photo / image_thumb are resizes
  // of the UNcropped image, so using them would show more than the cropped half.
  if (!hasCroppedHalf) {
    if (size === 'display' && candidates.accept(page.display_photo)) return page.display_photo;
    if (size === 'thumb') {
      if (candidates.accept(page.image_thumb)) return page.image_thumb;
      if (candidates.accept(page.thumbnail_blob)) return page.thumbnail_blob;
    }
    const derived = deriveVariant(page.photo, size);
    if (derived) return derived;
  }

  // (B) No matching pre-sized variant → resize the logical source on the fly.
  const base = getPageSource(page);
  if (!base || !isBrowserSafe(base)) {
    // Source unusable for display; last-resort browser-safe thumbnail field.
    if (candidates.accept(page.thumbnail) && size === 'thumb') return page.thumbnail!;
    return candidates.lastResort;
  }
  // IIIF-native resize is free but lands on the provider's host — worth it only
  // when the CSP allows that host; otherwise proxy, which is same-origin and so
  // always renders. A host the proxy will not fetch either leaves the bounded
  // stored variant as the only thing that works anywhere.
  const iiif = iiifResize(base, width);
  if (iiif && candidates.accept(iiif)) return iiif;
  if (isProxyableUrl(base)) return proxyUrl(base, width, quality);
  return candidates.lastResort ?? proxyUrl(base, width, quality);
}

/** Resolve a large (zoom/magnifier) URL — IIIF-native at high width, else proxy. */
function resolveHires(page: PageImageFields): string | null {
  const base = getPageSource(page);
  if (!base || !isBrowserSafe(base)) return null;
  const crop = cropRegion(page);
  if (!crop) {
    const iiif = iiifResize(base, HIRES_WIDTH);
    // Renderable → use it. Un-allowlisted but the proxy can't fetch the host
    // either → it is still the only bounded URL that works at all.
    if (iiif && (isBrowserRenderableImageUrl(iiif) || !isProxyableUrl(base))) return iiif;
  }
  return proxyUrl(base, HIRES_WIDTH, 85, crop);
}

/**
 * Canonical entry point. Resolve the URL for a page at the requested size.
 *
 * - `thumb` (~150px) / `display` (~1200px): browser-safe, bounded, free-first.
 * - `original`: the raw full-res source (OCR, download). May be large; not for
 *   browser display unless you know it's safe.
 * - `hires`: large bounded image for zoom/magnifier (~4000px via IIIF or proxy).
 *
 * Returns null when the page has no usable image (e.g. archiving failed).
 */
export function getPageImageUrl(page: PageImageFields, size: ImageSize = 'display'): string | null {
  switch (size) {
    case 'original':
      return getPageSource(page);
    case 'hires':
      return resolveHires(page);
    case 'thumb':
    case 'display':
      return resolveSized(page, size);
  }
}
