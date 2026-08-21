import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getPageSource, getPageImageUrl as resolvePageImage } from '@/lib/page-image-url';
import { isBrowserRenderableImageUrl } from '@/lib/csp-img-hosts';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normalize text for search matching.
 * - Removes diacritics (ü→u, é→e, ñ→n)
 * - Converts to lowercase
 * - Trims whitespace
 *
 * This allows "durer" to match "Dürer", "cafe" to match "café", etc.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Check if a string is a usable HTTP(S) image URL (not a failure marker like "failed:HTTP 404") */
export function isUsableImageUrl(url: string | undefined | null): url is string {
  return !!url && (url.startsWith('http://') || url.startsWith('https://'));
}

/**
 * Locale-stable number formatter. Pins locale to en-US so server-side
 * rendering (Node's default) and client-side rendering (the user's browser
 * locale) produce identical strings — otherwise we trip React error #418
 * hydration mismatches for visitors whose browser locale isn't en-US.
 *
 * Use this instead of `n.toLocaleString()` anywhere a number is rendered to
 * JSX text. The bare `.toLocaleString()` is fine in side-effects and event
 * handlers, but not in render output.
 */
export function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US');
}

/**
 * Return the best book image URL for the given display context.
 *
 * R2 image variants (see src/lib/storage.ts for path helpers):
 *   - `-full.jpg`  — original resolution (OCR, zoom, download)
 *   - `.jpg`       — 1200px display variant (browser display, cards)
 *   - `-thumb.jpg` — 150px thumbnail (tiny previews, search dropdowns)
 *
 * @param size 'display' (default, 1200px) | 'thumb' (150px)
 *   - Use 'display' for any UI element >100px (book cards, grids, heroes)
 *   - Use 'thumb' for tiny previews (<100px, search results, list rows)
 */
export function getBookThumbnailUrl(
  book: { thumbnail?: string | null; thumbnail_blob?: string | null; image_display?: string | null; image_thumb?: string | null },
  size: 'display' | 'thumb' = 'display'
): string | null {
  // Prefer canonical image_* fields, fall back to legacy thumbnail/thumbnail_blob.
  //
  // Artwork exception: ~98% of artworks store a 150px `book-thumbnails/{id}-thumb.jpg`
  // in `image_thumb` while their real high-res lives at `artwork/art-*.jpg`
  // (which has a 600px `-thumb.jpg` variant). Card grids render ~300px CSS cells —
  // ~600px on a 2x-DPR display — so the 150px thumb upscales ~4x and looks badly
  // pixelated (reported on /collections/hermetic-image, 2026-06-03). When an
  // artwork source URL is available, derive the thumb from it (→ 600px) instead
  // of the 150px `book-thumbnails/` variant. (#1727 cost policy: still a tier-1
  // R2 variant, never /_next/image.)
  const artworkSource = (book.image_display?.includes('/artwork/') && book.image_display)
    || (book.thumbnail?.includes('/artwork/') && book.thumbnail)
    || null;
  let raw = size === 'display'
    ? (book.image_display || book.thumbnail || book.thumbnail_blob || null)
    : (artworkSource || book.image_thumb || book.thumbnail_blob || book.thumbnail || null);
  if (!raw) return null;
  raw = raw.trim(); // a handful of stored covers carry trailing whitespace

  // A stored cover the browser cannot load must read as "no cover", so cards
  // render the typographic placeholder instead of an <Image> stuck in its
  // shimmer state forever (the CSP block fires before React hydrates, so the
  // onError → placeholder swap never happens). Screens against the same host
  // list the CSP img-src is built from; notably rejects `archive.org/download/`
  // URLs, which 302 to un-allowlisted `ia*.us.archive.org` hosts.
  if (raw.startsWith('http') && !isBrowserRenderableImageUrl(raw)) return null;

  // Wikimedia Commons images: serve the upload.wikimedia.org CDN URL as-is.
  // We must NOT rewrite to commons.wikimedia.org/w/thumb.php — the site CSP
  // `img-src` whitelists upload.wikimedia.org but not commons.wikimedia.org,
  // so a thumb.php URL loads via curl yet is blocked by the browser. Manually
  // constructing /thumb/.../<w>px- URLs is also unreliable (Wikimedia 400s
  // widths it hasn't pre-rendered), so we keep the canonical CDN URL. Only ~43
  // legacy books still reference these; new imports rehost to R2.
  if (raw.includes('upload.wikimedia.org/wikipedia/commons/')) {
    return raw;
  }

  if (!raw.includes('images.sourcelibrary.org/')) return raw;

  // Artwork URLs: use thumb variants for 'thumb' size, full for 'display'.
  // Three R2 variants exist per artwork: `-thumb.jpg` (600px), `.jpg` (2000px),
  // `-full.jpg` (original, 3-4MB). Card grids want the 600px thumb; detail/hero
  // wants full. Normalize whichever suffix `raw` carries to the requested one.
  if (raw.includes('/artwork/')) {
    if (size === 'thumb') {
      // Prefer -thumb.jpg (600px) for card grids — map both -full and the bare
      // 2000px display variant down to it (the bare-.jpg case is the common one,
      // since image_display / thumbnail hold the 2000px URL).
      if (raw.endsWith('-thumb.jpg')) return raw;
      if (raw.endsWith('-full.jpg')) return raw.replace(/-full\.jpg$/, '-thumb.jpg');
      if (raw.endsWith('.jpg')) return raw.replace(/\.jpg$/, '-thumb.jpg');
      return raw;
    }
    // Display size: prefer -full.jpg
    if (raw.endsWith('-thumb.jpg')) return raw.replace(/-thumb\.jpg$/, '-full.jpg');
    return raw;
  }

  // Rewrite legacy /thumbnails/{bookId}/{num}.jpg → /pages/{bookId}/{0num}.jpg
  // The /thumbnails/ path has only small images, but /pages/ has all three variants.
  const thumbMatch = raw.match(/\/thumbnails\/([^/]+)\/(\d+)\.jpg$/);
  if (thumbMatch) {
    const [, bookId, num] = thumbMatch;
    const padded = num.padStart(4, '0');
    const suffix = size === 'thumb' ? '-thumb.jpg' : '.jpg';
    return `https://images.sourcelibrary.org/pages/${bookId}/${padded}${suffix}`;
  }

  // Rewrite /archived/{bookId}/{num}.jpg → /pages/{bookId}/{0num}.jpg
  const archivedMatch = raw.match(/\/archived\/([^/]+)\/(\d+)\.jpg$/);
  if (archivedMatch) {
    const [, bookId, num] = archivedMatch;
    const padded = num.padStart(4, '0');
    const suffix = size === 'thumb' ? '-thumb.jpg' : '.jpg';
    return `https://images.sourcelibrary.org/pages/${bookId}/${padded}${suffix}`;
  }

  // Standard /pages/ URLs — rewrite suffix to requested variant. Anchor to the
  // canonical `images.sourcelibrary.org/pages/{id}/` scan path so the PDF-import
  // blob path `/books/{bookId}/pages/NNNN.jpg` (which merely CONTAINS `/pages/`
  // and has ONLY the bare `.jpg`, no -thumb/-full siblings) is left untouched —
  // otherwise 'thumb' size returns a 404ing `-thumb.jpg` (cf. book-cover-loader).
  if (!raw.includes('images.sourcelibrary.org/pages/')) return raw;

  if (size === 'display') {
    // Rewrite -thumb.jpg or -full.jpg → .jpg (1200px display variant)
    return raw.replace(/-thumb\.jpg$/, '.jpg').replace(/-full\.jpg$/, '.jpg');
  }
  // size === 'thumb': ensure we get the -thumb variant
  if (raw.endsWith('-thumb.jpg')) return raw;
  if (raw.endsWith('-full.jpg')) return raw.replace(/-full\.jpg$/, '-thumb.jpg');
  // bare .jpg (display) → -thumb.jpg
  if (raw.endsWith('.jpg') && !raw.endsWith('-thumb.jpg')) {
    return raw.replace(/\.jpg$/, '-thumb.jpg');
  }
  return raw;
}

export function isArchiveFailed(photo: string | undefined | null): boolean {
  return typeof photo === 'string' && photo.startsWith('failed:');
}

/**
 * Gallery crops are materialized on R2 at deterministic sibling paths:
 *   gallery/{book}/{page}-{idx}-thumb.jpg  (300px)
 *   gallery/{book}/{page}-{idx}-card.jpg   (600px — #2401)
 *   gallery/{book}/{page}-{idx}.jpg        (full extracted crop, ~2MB)
 *
 * The 300px thumb is too small for the 324–443px card slots in gallery /
 * collection grids, so it blurs at ≥2× DPR. Derive the 600px `-card.jpg`
 * sibling by convention so cards can prefer it with no API/type change; callers
 * keep the original thumb as an onError fallback for crops whose card variant
 * hasn't been backfilled yet (scripts/maintenance/backfill-card-thumbs.mjs).
 *
 * Returns null when the url isn't a gallery `-thumb.jpg` (artwork thumbs are
 * already 600px; IIIF/other URLs have no card sibling) so we never point at a
 * variant that can't exist.
 */
export function toGalleryCardUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!/\/gallery\/.*-thumb\.jpg(\?|$)/.test(url)) return null;
  return url.replace('-thumb.jpg', '-card.jpg');
}

/**
 * Get the best available image URL for a page.
 *
 * Priority: cropped_photo > archived_photo > photo_original > photo
 *
 * IMPORTANT: cropped_photo is the single-page crop from a split two-page spread.
 * When it exists, bounding boxes (from image extraction) are in its coordinate space.
 * Using archived_photo (the full spread) with those bbox coordinates causes misalignment.
 * This function is the single source of truth for image source selection — all code paths
 * that select a page image URL should use this instead of inlining the priority logic.
 *
 * If archived_photo starts with "failed:" (a marker from failed archiving attempts),
 * the original source URLs are assumed dead and skipped.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * Format an author name for display.
 * Strips bibliographic square brackets (indicating attributed authorship)
 * and returns both the clean name and whether it was attributed.
 */
export function formatAuthor(author: string | undefined | null): { name: string; attributed: boolean } {
  if (!author) return { name: '', attributed: false };
  let trimmed = author.trim().replace(/[,;]+$/, '').trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return { name: trimmed.slice(1, -1), attributed: true };
  }
  return { name: trimmed, attributed: false };
}

/**
 * Resolve the best source image URL for a page (the file to OCR, download, or
 * resize from).
 *
 * Delegates to the canonical {@link getPageSource} (`@/lib/page-image-url`,
 * issue #1727). Kept as a named export for back-compat with existing callers;
 * for the size axis use `getPageImageUrl(page, size)` from that module, or the
 * `getPageDisplayUrl`/`getPageThumbUrl` variants below.
 */
export function getPageImageUrl(page: Record<string, any>): string | null {
  return getPageSource(page);
}

/**
 * Best display-size (~1200px) URL for a page. Back-compat wrapper over the
 * canonical `getPageImageUrl(page, 'display')` (`@/lib/page-image-url`, #1727),
 * which handles split-era source selection, the R2 variant → IIIF → proxy tiers,
 * and crop-coords pages.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPageDisplayUrl(page: Record<string, any>): string | null {
  return resolvePageImage(page, 'display');
}

/**
 * Pick a grid thumbnail URL appropriate to the page's aspect ratio.
 * Landscape pages (e.g. Bhutanese pecha folios at 1200x800) blur when
 * forced into a portrait cell with `object-cover` — the 150px thumb
 * gets upscaled to fit the cell's height before being cropped to width.
 * For those pages we serve a 400px variant through the /api/image proxy
 * (Cloudflare-cached); portrait pages keep the existing 150px thumb.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPageGridUrl(page: Record<string, any>): string | null {
  const w = page.image_width;
  const h = page.image_height;
  const isLandscape = typeof w === 'number' && typeof h === 'number' && h > 0 && w / h > 1.2;
  if (!isLandscape) return getPageThumbUrl(page);

  const baseUrl = page.archived_photo || page.photo_original || page.photo;
  if (!baseUrl || isArchiveFailed(baseUrl)) return getPageThumbUrl(page);
  return `/api/image?url=${encodeURIComponent(baseUrl)}&w=400&q=70`;
}

/**
 * Get the best thumbnail (150px) URL for a page.
 * Prefers pre-rendered thumbnail from R2 CDN.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPageThumbUrl(page: Record<string, any>): string | null {
  return resolvePageImage(page, 'thumb');
}

/**
 * Ordered URLs to try for the book detail cover (hero) image.
 * Matches browse/cards: book-level thumbnails via {@link getBookThumbnailUrl}, then
 * per-page thumbs so the cover still loads when the book document has no thumbnail fields
 * or stored URLs are stale/broken.
 */
export function getCoverImageCandidates(
  book: { thumbnail?: string | null; thumbnail_blob?: string | null },
  pages: ReadonlyArray<Record<string, unknown>>,
  maxPageFallbacks = 24,
): string[] {
  const out: string[] = [];
  const push = (u: string | null) => {
    if (u && !out.includes(u)) out.push(u);
  };
  push(getBookThumbnailUrl(book, 'display'));
  push(getBookThumbnailUrl(book, 'thumb'));
  const n = Math.min(pages.length, maxPageFallbacks);
  for (let i = 0; i < n; i++) {
    push(getPageThumbUrl(pages[i]!));
  }
  return out;
}
