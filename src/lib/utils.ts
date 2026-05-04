import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
  // Prefer canonical image_* fields, fall back to legacy thumbnail/thumbnail_blob
  const raw = size === 'display'
    ? (book.image_display || book.thumbnail || book.thumbnail_blob || null)
    : (book.image_thumb || book.thumbnail_blob || book.thumbnail || null);
  if (!raw) return null;

  // Wikimedia Commons: rewrite to thumb.php for CDN-cached resized images.
  // Loading full-res Wikimedia files (3000-8000px) directly causes 429 rate-limits
  // and wastes bandwidth. thumb.php serves fast, CDN-cached thumbnails.
  if (raw.includes('upload.wikimedia.org/wikipedia/commons/')) {
    const filename = raw.split('/').pop();
    if (filename) {
      const w = size === 'thumb' ? 400 : 800;
      return `https://commons.wikimedia.org/w/thumb.php?f=${filename}&w=${w}`;
    }
  }

  if (!raw.includes('images.sourcelibrary.org/')) return raw;

  // Artwork URLs: use thumb variants for 'thumb' size, full for 'display'.
  if (raw.includes('/artwork/')) {
    if (size === 'thumb') {
      // Prefer -thumb.jpg for card grids
      if (raw.endsWith('-full.jpg')) return raw.replace(/-full\.jpg$/, '-thumb.jpg');
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

  // Standard /pages/ URLs — rewrite suffix to requested variant
  if (!raw.includes('/pages/')) return raw;

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
 * Resolve the best source image URL for a page.
 *
 * IMPORTANT: All image resolution in the app should go through this function
 * or one of its variants (getPageDisplayUrl, getPageThumbUrl) to ensure
 * consistent behavior. In particular, split-from-spread pages bypass the
 * legacy fallback chain entirely — see `.claude/docs/page-system.md`.
 *
 * Legacy chain (non-split pages): cropped_photo > archived_photo > photo_original > photo
 * Split pages: photo directly (no fallback)
 */
export function getPageImageUrl(page: Record<string, any>): string | null {
  // Split-from-spread pages: photo is the single source of truth.
  // NEVER fall through to photo_original/archived_photo — those point to the unsplit spread.
  if (page.split_from_spread && isUsableImageUrl(page.photo)) return page.photo;

  if (isUsableImageUrl(page.cropped_photo)) return page.cropped_photo;
  if (isUsableImageUrl(page.archived_photo)) return page.archived_photo;
  // If archiving was attempted and failed ("failed:HTTP 404" etc), the source URL is dead.
  // Don't try photo/photo_original — archiving already proved those URLs don't work.
  if (isArchiveFailed(page.archived_photo)) return null;
  if (isUsableImageUrl(page.photo_original)) return page.photo_original;
  if (isUsableImageUrl(page.photo)) return page.photo;
  return null;
}

/**
 * Get the best display-size (1200px) URL for a page.
 * Prefers pre-rendered display_photo from R2 CDN (no proxy needed).
 * Falls back to /api/image proxy for pages without display variants.
 *
 * Split pages (with crop) always go through the proxy since the display
 * variant is generated from the full spread, not the cropped half.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPageDisplayUrl(page: Record<string, any>, width = 1200, quality = 80): string | null {
  // Split-from-spread pages have clean photo — use directly
  if (page.split_from_spread && isUsableImageUrl(page.photo)) return page.photo;

  // Split pages need server-side cropping — always use proxy
  if (page.crop?.xStart !== undefined && page.crop?.xEnd !== undefined) {
    const baseUrl = page.archived_photo || page.photo_original || page.photo;
    if (!baseUrl || isArchiveFailed(baseUrl)) return null;
    return `/api/image?url=${encodeURIComponent(baseUrl)}&w=${width}&q=${quality}&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`;
  }

  // Pre-rendered display photo — direct from R2 CDN, no proxy
  if (isUsableImageUrl(page.display_photo)) return page.display_photo;

  // Fallback: derive display URL from new path convention (handles sp prefix)
  const newPathMatch = page.photo?.match(/^(https:\/\/images\.sourcelibrary\.org\/pages\/[^/]+\/(?:sp[a-z0-9]*-?)?\d{4,})(-full)?\.jpg$/);
  if (newPathMatch) return `${newPathMatch[1]}.jpg`;

  // Legacy fallback: proxy for resize
  const baseUrl = page.archived_photo || page.photo_original || page.photo;
  if (!baseUrl || isArchiveFailed(baseUrl)) return null;
  return `/api/image?url=${encodeURIComponent(baseUrl)}&w=${width}&q=${quality}`;
}

/**
 * Get the best thumbnail (150px) URL for a page.
 * Prefers pre-rendered thumbnail from R2 CDN.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPageThumbUrl(page: Record<string, any>): string | null {
  // Split-from-spread pages have clean photo/thumbnail — skip legacy fallback chain
  if (page.split_from_spread) {
    if (isUsableImageUrl(page.thumbnail)) return page.thumbnail;
    if (isUsableImageUrl(page.photo)) return `/api/image?url=${encodeURIComponent(page.photo)}&w=150&q=60`;
    return null;
  }

  // Split pages with crop coordinates need proxy
  if (page.crop?.xStart !== undefined && page.crop?.xEnd !== undefined) {
    const baseUrl = page.archived_photo || page.photo_original || page.photo;
    if (!baseUrl || isArchiveFailed(baseUrl)) return null;
    return `/api/image?url=${encodeURIComponent(baseUrl)}&w=150&q=60&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`;
  }

  // Pre-rendered thumbnail
  if (isUsableImageUrl(page.thumbnail_blob)) return page.thumbnail_blob;

  // Derive from new path convention (handles sp prefix for split pages)
  const newPathMatch = page.photo?.match(/^(https:\/\/images\.sourcelibrary\.org\/pages\/[^/]+\/(?:sp[a-z0-9]*-?)?\d{4,})(-full)?\.jpg$/);
  if (newPathMatch) return `${newPathMatch[1]}-thumb.jpg`;

  // Existing thumbnail field
  if (isUsableImageUrl(page.thumbnail)) return page.thumbnail;

  // Legacy fallback: proxy
  const baseUrl = page.archived_photo || page.photo_original || page.photo;
  if (!baseUrl || isArchiveFailed(baseUrl)) return null;
  return `/api/image?url=${encodeURIComponent(baseUrl)}&w=150&q=60`;
}
