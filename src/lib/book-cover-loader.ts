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
// The `-thumb.jpg` variant is 150px wide, so serving it into a 500px slot
// upscaled it 3.3x and covers rendered visibly soft (de Bary 1864 on
// /collections/slime-moulds, 2026-08-24). Cap the swap at a slot the 150px
// image can actually fill: beyond this the original is served instead.
//
// The right long-term fix is the 1200px `display` variant, which sits between
// these two — but it does not exist for every book yet (the archive-images
// worker only began writing it on 2026-08-24), so pointing mid-width slots at
// it would 404 for everything archived before that.
const THUMB_WIDTH_THRESHOLD = 200;

// Only these R2 path families actually materialize a `-thumb.jpg` sibling
// (page scans, gallery crops, cropped covers, artworks). Other single-variant
// uploads — notably PDF-import blobs at `/books/{bookId}/pages/NNNN.jpg` and
// raw `/archived/{id}/N.jpg` — have ONLY the bare `.jpg`, so rewriting them to
// `-thumb.jpg` 404s the small-viewport srcSet candidates and renders a broken
// cover (homepage smoke-test failure, 2026-07-08). Anchor each prefix to the
// host so the PDF-blob `/books/.../pages/` path is NOT matched by `/pages/`.
const THUMB_VARIANT_PREFIXES = ['/pages/', '/gallery/', '/cropped/', '/artwork/']
  .map(p => `${SOURCELIBRARY_HOST}${p}`);

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

  // Already-thumb URLs are kept regardless of path.
  if (src.endsWith('-thumb.jpg')) return src;

  // Only swap to the 150px thumb for paths that actually have that variant.
  if (!THUMB_VARIANT_PREFIXES.some(p => src.includes(p))) return src;

  if (src.endsWith('-full.jpg')) return src.replace(/-full\.jpg$/, '-thumb.jpg');
  if (src.endsWith('.jpg')) return src.replace(/\.jpg$/, '-thumb.jpg');

  return src;
}
