/**
 * The current hero-mosaic cache version. Bumping it invalidates every cached
 * mosaic (forces a full regen), so treat it as a deliberate cache-buster.
 *
 * Lives in its own tiny module (no heavy deps) so the book page — a server
 * component — can import it to decide whether a book's cached mosaic is
 * current, WITHOUT pulling in the mosaic route's sharp/image toolchain.
 */
export const HERO_MOSAIC_VERSION = 23;

/**
 * What the mosaic tiles. Pages by default: a book reads as its pages. An
 * editor can set `hero_mosaic_source: 'plates'` on a book whose scans make a
 * poor grid (scanner black, colour bars, spreads) but whose extracted plates
 * make a good one — an illustrated manual, a picture book. Per book, on
 * purpose: no global density rule, so no other book's hero changes.
 */
export type HeroMosaicSource = 'pages' | 'plates';

export interface HeroMosaicFields {
  hero_mosaic_url?: string | null;
  hero_mosaic_version?: number;
  hero_mosaic_source?: unknown;
  /** The source setting the cached mosaic was built under. */
  hero_mosaic_built_from?: unknown;
}

export function heroMosaicSource(book: Pick<HeroMosaicFields, 'hero_mosaic_source'>): HeroMosaicSource {
  return book.hero_mosaic_source === 'plates' ? 'plates' : 'pages';
}

/** True when the stored mosaic (or stored negative) is current: same version
 *  AND built under the book's current source setting. */
export function heroMosaicCurrent(book: HeroMosaicFields): boolean {
  if (book.hero_mosaic_version !== HERO_MOSAIC_VERSION) return false;
  const builtFrom = book.hero_mosaic_built_from === 'plates' ? 'plates' : 'pages';
  return builtFrom === heroMosaicSource(book);
}

/** The route URL for an un-warmed book. The source rides along as a query so
 *  a book switched to plates gets a fresh URL, not the CDN's week-old 302. */
export function heroMosaicRouteUrl(bookId: string, source: HeroMosaicSource): string {
  return `/api/books/${bookId}/hero-mosaic${source === 'plates' ? '?source=plates' : ''}`;
}
