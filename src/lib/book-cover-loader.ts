/**
 * Per-image `loader` for the Next.js `<Image>` component, optimised for
 * book-cover grids.
 *
 * The Next.js Image optimiser still runs on top of whatever URL this
 * returns — it fetches the source from R2 and serves an AVIF/WebP at the
 * requested width. The only thing the loader controls is **which R2
 * source URL gets fetched**.
 *
 * R2 stores three variants per cover:
 *   - `*-thumb.jpg`  ≈ 150px   (~10 KB)
 *   - `*.jpg`        ≈ 1200px  (~200 KB)   ← "display"
 *   - `*-full.jpg`   = original
 *
 * Without a loader, every `<Image fill src={image_display}>` fetches the
 * 1200px source from R2 at every breakpoint — including mobile 50vw cards
 * that only need ~187 image pixels. That's a ~95% R2 egress overhead on
 * the mobile catalogue grid (60 covers × 200 KB instead of 10 KB).
 *
 * This loader swaps to the 150px `-thumb.jpg` source for requested
 * widths ≤ 500. Combined with Next.js's `imageSizes: [150, 400, 800]` +
 * `deviceSizes: [640, 828, 1200, 1920]`, the srcSet candidates split
 * cleanly:
 *
 *   srcSet width      Loader returns           Picked by
 *   ──────────────────────────────────────────────────────────────
 *   150 / 400         thumb URL  (10 KB R2)    mobile, low-DPR small cards
 *   640+              display URL (200 KB R2)  retina/desktop
 *
 * Quality impact: mobile 2x-DPR cards display the 400w srcSet candidate;
 * the loader returns thumb so the optimiser upscales 150 → 400 (slight
 * softness on faint engravings — acceptable for thumbnails). 3x DPR
 * mobile and 2x DPR desktop both pick 640+, getting the crisp 1200 source.
 * Only 1x DPR desktops (increasingly rare) see thumb-quality grids.
 *
 * Falls through to the original `src` for any URL we don't recognise —
 * external IIIF, Wikimedia, etc. — so it's safe to use as a default
 * loader anywhere.
 */

const SOURCELIBRARY_HOST = 'images.sourcelibrary.org';
const THUMB_WIDTH_THRESHOLD = 500;

export function bookCoverResponsiveLoader({
  src,
  width,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  if (width > THUMB_WIDTH_THRESHOLD) return src;
  if (!src.includes(SOURCELIBRARY_HOST)) return src;

  // Standard pages URL: `.../pages/{book_id}/{page}.jpg` → swap to `-thumb.jpg`.
  // Already-thumb URLs are kept; full-resolution suffix gets normalised.
  if (src.endsWith('-thumb.jpg')) return src;
  if (src.endsWith('-full.jpg')) return src.replace(/-full\.jpg$/, '-thumb.jpg');
  if (src.endsWith('.jpg')) return src.replace(/\.jpg$/, '-thumb.jpg');

  return src;
}

/**
 * Loader for collection hero / gallery thumbnails.
 *
 * These render gallery illustrations (`gallery_images.extracted_url` /
 * `image_url`), which point at the **full-resolution** `-full.jpg` R2 source
 * — 3–4 MB scans (e.g. 3409×5254). The slots that show them are small:
 * 4:3 cards (~400px) and full-width hero banners (~1200px). The original is
 * never needed here.
 *
 * Unlike `bookCoverResponsiveLoader` (which falls through to the source for
 * large widths), this loader **caps at the medium variant** (`.jpg`,
 * ~1200px, ~150 KB) and never returns `-full`. Tiny widths get `-thumb.jpg`
 * (~150px, ~2 KB). A 4 MB scan becomes ~150 KB — roughly 26× smaller.
 *
 * Falls through to the original `src` for any URL we don't recognise.
 */
export function galleryThumbLoader({
  src,
  width,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  if (!src.includes(SOURCELIBRARY_HOST)) return src;
  const variant = width <= 200 ? '-thumb.jpg' : '.jpg';
  if (src.endsWith('-full.jpg')) return src.replace(/-full\.jpg$/, variant);
  if (src.endsWith('-thumb.jpg')) return src.replace(/-thumb\.jpg$/, variant);
  if (src.endsWith('.jpg')) return src.replace(/\.jpg$/, variant);
  return src;
}
