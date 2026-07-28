/**
 * Remap a gallery detection bbox into the deep-zoom master's coordinate space —
 * issue #2714.
 *
 * THE MISMATCH. Three resolution tiers exist and two of them disagree about what
 * "the page" is:
 *   - `gallery_images.bbox` is normalized to the image `getPageSource()` returns.
 *     On a split-from-spread scan that is the HALF (see the bbox coordinate-space
 *     invariant in CLAUDE.md, PRs #2516/#2517).
 *   - `pages.fullres_master` / `pages.deepzoom` are harvested from
 *     `page.photo_original` rewritten to `/full/full/`
 *     (`scripts/workers/deepzoom-harvest-page-masters.mjs`). The splitter
 *     overwrites `photo` / `archived_photo` / `display_photo` with the half but
 *     leaves `photo_original` alone, so for a two-leaf scan the master is the
 *     whole SPREAD.
 *
 * So a bbox of "the illustration" is fractions of the half, while the tile
 * pyramid is the spread. Focusing the viewer with the raw bbox would land the
 * rectangle in the wrong place on every split page.
 *
 * THE FIX. The splitter already records where each half sits: it writes
 * `crop: { xStart, xEnd }` on a **0–1000 scale of the spread's width**, with the
 * binding overlap baked into those numbers (`batch-split-bph.mjs`, the
 * `leftCrop` / `rightCrop` pair). Halves are cut full-height
 * (`extract({ top: 0, height: imgHeight })`), so only x/width need correction.
 *
 * WHY IT VALIDATES INSTEAD OF ASSUMING. Deep-zoom coverage and split pages
 * barely overlap today — a 400-page sample of tiled pages (17 books, all
 * BSB/Vatican single-leaf scans) contained zero split pages, so the split branch
 * has no production fixture to eyeball. Rather than trust the shape of the data,
 * this helper cross-checks the master's aspect ratio against the geometry the
 * crop implies and returns `null` on any disagreement. Callers fall back to the
 * existing lens magnifier, so the worst case is today's behaviour — never a
 * confidently misplaced rectangle.
 */

export interface NormalizedBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Structural subset of a page doc — only the fields the remap reads. */
export interface DeepZoomRemapPage {
  /** Horizontal slice of the spread this page occupies, 0–1000 scale. */
  crop?: { xStart?: number; xEnd?: number } | null;
  /** New-era split marker (`photo` rewritten to the `sp…` half). */
  split_from_spread?: boolean;
  /** Old-era split: materialized cropped half. */
  cropped_photo?: string | null;
  /** Dimensions of the image the bbox is normalized to (the half, when split). */
  image_width?: number | null;
  image_height?: number | null;
}

/** Master pixel dimensions — `pages.fullres_master` or `pages.deepzoom`. */
export interface MasterDimensions {
  width?: number | null;
  height?: number | null;
}

/**
 * Aspect-ratio agreement tolerance. Generous on purpose: the splitter adds a
 * small binding overlap and JPEG masters get rounded to whole pixels, so exact
 * equality never holds. Anything outside this means we have misread the
 * geometry, and a wrong rectangle is worse than no rectangle.
 *
 * Note the check rejects *incoherent* geometry, not every wrong master — a
 * transposed master can land inside the tolerance by coincidence (pinned in
 * `tests/unit/gallery-deepzoom-bbox.test.ts`). What makes that acceptable is
 * that the manifest and the crop are read from the same page document, so they
 * describe the same scan by construction.
 */
const ASPECT_TOLERANCE = 0.05;

function isPositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** A bbox with all four components present and finite. */
function isUsableBbox(b: Partial<NormalizedBbox> | null | undefined): b is NormalizedBbox {
  return (
    !!b &&
    [b.x, b.y, b.width, b.height].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    (b.width as number) > 0 &&
    (b.height as number) > 0
  );
}

/** Within `ASPECT_TOLERANCE` of each other, relative to `expected`. */
function aspectMatches(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) / expected <= ASPECT_TOLERANCE;
}

/**
 * Translate `bbox` from the page-source (possibly half-spread) coordinate space
 * into the deep-zoom master's space.
 *
 * Returns `null` when the remap cannot be established with confidence — no
 * bbox, no master dimensions, a split page with no usable `crop`, or geometry
 * that contradicts the master's aspect ratio. Callers MUST treat `null` as
 * "don't open the focused viewer" rather than falling back to the raw bbox.
 */
export function remapBboxToMaster(
  bbox: Partial<NormalizedBbox> | null | undefined,
  page: DeepZoomRemapPage | null | undefined,
  master: MasterDimensions | null | undefined,
): NormalizedBbox | null {
  if (!isUsableBbox(bbox) || !page) return null;
  if (!isPositive(master?.width) || !isPositive(master?.height)) return null;

  const isSplit = !!page.split_from_spread || !!page.cropped_photo;
  const masterAspect = master.width / master.height;

  // Non-split page: the master and the bbox share a coordinate space, so the
  // bbox passes through untouched. (Every tiled page in production today.)
  if (!isSplit) return { ...bbox };

  // From here we need the half's own dimensions to reason about the geometry at
  // all. Without them we cannot tell a half-master from a spread-master.
  if (!isPositive(page.image_width) || !isPositive(page.image_height)) return null;
  const halfAspect = page.image_width / page.image_height;

  // The master may already BE the half — e.g. a page whose `photo_original` was
  // itself a single leaf, or a future harvester pinned to `getPageSource()`.
  // Detected, not assumed, so this keeps working if the harvest source changes.
  if (aspectMatches(masterAspect, halfAspect)) return { ...bbox };

  // Split page against a spread master: the crop tells us which slice is ours.
  const xStart = page.crop?.xStart;
  const xEnd = page.crop?.xEnd;
  if (typeof xStart !== 'number' || typeof xEnd !== 'number') return null;
  if (!Number.isFinite(xStart) || !Number.isFinite(xEnd)) return null;
  if (xStart < 0 || xEnd > 1000 || xEnd <= xStart) return null;

  const originX = xStart / 1000;
  const frac = (xEnd - xStart) / 1000; // half's share of the spread's width
  if (frac <= 0 || frac > 1) return null;

  // Cross-check: if our half is `frac` of the spread's width and full height,
  // the spread must be proportionally wider than the half.
  if (!aspectMatches(masterAspect, halfAspect / frac)) return null;

  return {
    x: originX + bbox.x * frac,
    width: bbox.width * frac,
    // Halves are cut full-height, so the vertical axis needs no correction.
    y: bbox.y,
    height: bbox.height,
  };
}
