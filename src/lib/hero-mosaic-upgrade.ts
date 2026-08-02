/**
 * Decides whether a book's CACHED hero mosaic is worth rebuilding.
 *
 * The mosaic is a cached artifact, and its grid shape is fixed by how many
 * tiles survived fetching at the moment it was generated — not by how many
 * pages the book has. `rows = floor(tiles / cols)`, so a run where a handful of
 * page-image fetches flaked leaves a permanent 10×2 (20 tiles) on a book with
 * 600 usable pages, and nothing ever retries it: the stored version still
 * matches HERO_MOSAIC_VERSION, so the route short-circuits to the stored image
 * forever.
 *
 * Measured on production 2026-08-02 (400 random books with a cached mosaic and
 * ≥40 pages, each decoded and its grid counted): 30% were short of a full 10×4,
 * and 115 of those 119 had ≥40 unused non-junk pages sitting there. About 1,500
 * books are a full-width grid missing rows; ~840 more are short in both
 * dimensions.
 *
 * The fix is deliberately NOT a version bump: that would rebuild all ~12,660
 * cached mosaics, including the ~70% that are already correct. Instead a book
 * whose stored grid is short serves its existing mosaic (instant, no flash) and
 * the reader's browser kicks off ONE background rebuild, so the next visitor
 * gets the fuller grid. Books that are already full, or that genuinely cannot
 * do better, are never touched.
 *
 * This module stays free of `sharp` and `mongodb` so the book page — a server
 * component — can import the predicate without pulling in the image toolchain
 * (same reason hero-mosaic-version.ts is its own tiny module).
 */

/** A full grid: 10 columns × 4 rows. The most the hero can ever show. */
export const MOSAIC_FULL_TILES = 40;

/** Give up after this many rebuilds that failed to improve the grid, so a book
 *  whose pages genuinely can't fill a 10×4 stops being retried on every view. */
export const MOSAIC_MAX_UPGRADE_ATTEMPTS = 2;

/** Ignore repeat triggers within this window. The book page is ISR-cached, so
 *  every visitor in the cache window sees the same "upgradeable" flag and fires
 *  the same request — this is what stops a popular book rebuilding in a loop. */
export const MOSAIC_UPGRADE_COOLDOWN_MS = 10 * 60 * 1000;

/** Fields the book page and the upgrade path both read. */
/** Which pool the stored mosaic was tiled from. `plates` means the generator
 *  fell back to extracted illustrations because almost no PAGE images were
 *  fetchable at the time — a state that outlives its cause, since the page
 *  images usually land minutes or hours later. */
export type MosaicSource = 'pages' | 'plates';

export interface MosaicUpgradeState {
  /** cols × rows of the STORED mosaic. Undefined for mosaics built before the
   *  generator started recording it — treated as "unknown, worth measuring",
   *  which costs one fetch + decode rather than a rebuild. */
  tiles?: number | null;
  /** Set once a rebuild has failed to improve the grid MAX_ATTEMPTS times. */
  maxed?: boolean | null;
  /** Last time an upgrade was attempted (cooldown anchor). */
  upgradeAt?: Date | string | null;
  /** Total pages on the book — a cheap upper bound on available tiles. */
  pagesCount?: number | null;
  /** What the stored mosaic was tiled from. */
  source?: MosaicSource | string | null;
}

/**
 * Should the page offer a background upgrade for this book?
 *
 * Cheap and page-safe: it reads only fields already on the book document, so it
 * adds no query to the ISR render. The expensive checks (does the book really
 * have 40 usable page images? does a rebuild actually do better?) happen in the
 * upgrade route, which records its verdict so this predicate stops firing.
 */
export function shouldOfferMosaicUpgrade(state: MosaicUpgradeState): boolean {
  if (state.maxed) return false;
  // A book with fewer pages than a full grid can never fill one — and page
  // count is an UPPER bound, since blanks and scanner junk are filtered out.
  if ((state.pagesCount ?? 0) < MOSAIC_FULL_TILES) return false;
  // A plate-tiled mosaic is worth retrying even at a FULL grid. The fallback
  // fires only when almost no page image was fetchable in that one moment
  // (Pal. lat. 1370: 322 pages, all fetchable today, tiled from 30 cropped
  // diagrams on 26 July), and a book reads as its pages — plates are a last
  // resort, not a better answer. Tile count alone would miss a plate mosaic
  // that happens to fill 10x4.
  if (state.source === 'plates') return true;
  if (typeof state.tiles === 'number' && state.tiles >= MOSAIC_FULL_TILES) return false;
  return true;
}

/**
 * Is an upgrade attempt allowed to run right now? Applied inside the upgrade
 * route, where `upgradeAt` is authoritative (the page's copy can be up to a
 * full ISR window stale).
 */
export function mosaicUpgradeCooledDown(upgradeAt: Date | string | null | undefined, now: number): boolean {
  if (!upgradeAt) return true;
  const last = upgradeAt instanceof Date ? upgradeAt.getTime() : Date.parse(upgradeAt);
  if (Number.isNaN(last)) return true;
  return now - last >= MOSAIC_UPGRADE_COOLDOWN_MS;
}

/**
 * After a rebuild: did it earn its keep, and should we keep trying?
 *
 * A rebuild that reaches a full grid is done. One that improves but is still
 * short stays eligible (the next visitor may catch a moment when more page
 * fetches succeed). One that does no better burns an attempt, and after
 * MAX_ATTEMPTS the book is marked maxed and left alone.
 */
export function nextUpgradeVerdict(
  before: number | null | undefined,
  after: number,
  attempts: number,
  sources?: { before?: MosaicSource | string | null; after?: MosaicSource | string },
): { maxed: boolean; attempts: number } {
  // Swapping plates for real page scans is the win we were after, whatever it
  // did to the tile count — a 10x3 of pages beats a 10x4 of cropped diagrams.
  const switchedToPages = sources?.before === 'plates' && sources?.after === 'pages';
  if (switchedToPages) return { maxed: false, attempts: 0 };
  // Still on plates: the page images are evidently still unavailable, so this
  // burns an attempt rather than retrying on every reader.
  const stuckOnPlates = sources?.after === 'plates';
  if (!stuckOnPlates && after >= MOSAIC_FULL_TILES) return { maxed: false, attempts: 0 };
  const improved = !stuckOnPlates && (typeof before === 'number' ? after > before : true);
  const nextAttempts = improved ? attempts : attempts + 1;
  return { maxed: nextAttempts >= MOSAIC_MAX_UPGRADE_ATTEMPTS, attempts: nextAttempts };
}
