/**
 * The hero mosaic repairs itself in the background, so the rules that decide
 * WHEN it may do that are the ones worth pinning: they are all that stands
 * between "a short grid quietly gets better" and "11,000 books rebuild an image
 * on every page view".
 *
 * Context (measured on production 2026-08-02, 400 random books with a cached
 * mosaic and ≥40 pages, each decoded and its grid counted): 30% were short of a
 * full 10×4, and 115 of those 119 had 40+ unused non-junk pages. The grid is
 * fixed by how many tiles survived fetching at generation time, and nothing
 * retried it because the stored cache version still matched.
 */
import { describe, it, expect } from 'vitest';
import {
  MOSAIC_FULL_TILES,
  MOSAIC_MAX_UPGRADE_ATTEMPTS,
  MOSAIC_UPGRADE_COOLDOWN_MS,
  shouldOfferMosaicUpgrade,
  mosaicUpgradeCooledDown,
  nextUpgradeVerdict,
} from '@/lib/hero-mosaic-upgrade';

describe('shouldOfferMosaicUpgrade', () => {
  it('offers for the measured failure case: full width, missing rows', () => {
    // Alciato's Emblemata: 182 pages, cached as 10×2 since 27 July.
    expect(shouldOfferMosaicUpgrade({ tiles: 20, pagesCount: 182 })).toBe(true);
    // Corpus Inscriptionum Latinarum: 880 pages, cached as 10×3.
    expect(shouldOfferMosaicUpgrade({ tiles: 30, pagesCount: 880 })).toBe(true);
  });

  it('leaves a full grid alone — this must not become a corpus-wide regen', () => {
    expect(shouldOfferMosaicUpgrade({ tiles: MOSAIC_FULL_TILES, pagesCount: 400 })).toBe(false);
    expect(shouldOfferMosaicUpgrade({ tiles: 50, pagesCount: 400 })).toBe(false);
  });

  it('offers when the grid is unknown, so pre-existing mosaics get measured', () => {
    // No stored mosaic carries a tile count yet; the route measures rather than
    // rebuilds, which is what keeps the backlog cheap.
    expect(shouldOfferMosaicUpgrade({ pagesCount: 200 })).toBe(true);
    expect(shouldOfferMosaicUpgrade({ tiles: null, pagesCount: 200 })).toBe(true);
  });

  it('never offers for a book that cannot fill a grid', () => {
    // pages_count is an UPPER bound — blanks and scanner junk are filtered out
    // later — so anything under a full grid is hopeless before we even look.
    expect(shouldOfferMosaicUpgrade({ tiles: 20, pagesCount: 39 })).toBe(false);
    expect(shouldOfferMosaicUpgrade({ tiles: 20, pagesCount: 0 })).toBe(false);
    expect(shouldOfferMosaicUpgrade({ tiles: 20 })).toBe(false);
  });

  it('stops once a book is marked maxed, whatever else is true', () => {
    expect(shouldOfferMosaicUpgrade({ tiles: 20, pagesCount: 880, maxed: true })).toBe(false);
  });
});

describe('mosaicUpgradeCooledDown', () => {
  const now = Date.UTC(2026, 7, 2, 12, 0, 0);

  it('allows a book that has never been tried', () => {
    expect(mosaicUpgradeCooledDown(null, now)).toBe(true);
    expect(mosaicUpgradeCooledDown(undefined, now)).toBe(true);
  });

  it('blocks a second attempt inside the window', () => {
    // The book page is ISR-cached, so every visitor in the cache window sees the
    // same "upgradeable" flag and fires the same request. This is the only thing
    // stopping a popular book from rebuilding once per reader.
    expect(mosaicUpgradeCooledDown(new Date(now - 60_000), now)).toBe(false);
    expect(mosaicUpgradeCooledDown(new Date(now - MOSAIC_UPGRADE_COOLDOWN_MS + 1), now)).toBe(false);
  });

  it('allows again once the window has passed', () => {
    expect(mosaicUpgradeCooledDown(new Date(now - MOSAIC_UPGRADE_COOLDOWN_MS), now)).toBe(true);
  });

  it('treats an unparseable timestamp as "never tried" rather than blocking forever', () => {
    expect(mosaicUpgradeCooledDown('not a date', now)).toBe(true);
  });

  it('accepts the ISO string form Mongo round-trips through JSON', () => {
    expect(mosaicUpgradeCooledDown(new Date(now - 60_000).toISOString(), now)).toBe(false);
  });
});

describe('nextUpgradeVerdict', () => {
  it('resets and stops when the rebuild reaches a full grid', () => {
    expect(nextUpgradeVerdict(20, 40, 1)).toEqual({ maxed: false, attempts: 0 });
  });

  it('keeps trying while each rebuild does better', () => {
    // Partial progress is real: a later visit may catch a moment when more of
    // the page-image fetches succeed.
    expect(nextUpgradeVerdict(20, 30, 0)).toEqual({ maxed: false, attempts: 0 });
  });

  it('gives up after repeated rebuilds that gain nothing', () => {
    const first = nextUpgradeVerdict(30, 30, 0);
    expect(first).toEqual({ maxed: false, attempts: 1 });
    const second = nextUpgradeVerdict(30, 30, first.attempts);
    expect(second).toEqual({ maxed: true, attempts: MOSAIC_MAX_UPGRADE_ATTEMPTS });
  });

  it('gives up when a rebuild makes things worse', () => {
    const v = nextUpgradeVerdict(30, 20, MOSAIC_MAX_UPGRADE_ATTEMPTS - 1);
    expect(v.maxed).toBe(true);
  });

  it('treats an unknown prior grid as progress, so the first measure is free', () => {
    expect(nextUpgradeVerdict(null, 30, 0)).toEqual({ maxed: false, attempts: 0 });
  });

  it('converges: a book that never improves is left alone for good', () => {
    let attempts = 0;
    let maxed = false;
    for (let i = 0; i < 10; i++) ({ maxed, attempts } = nextUpgradeVerdict(20, 20, attempts));
    expect(maxed).toBe(true);
    expect(attempts).toBeLessThanOrEqual(10 + MOSAIC_MAX_UPGRADE_ATTEMPTS);
  });
});

describe('plate-tiled mosaics', () => {
  // The generator falls back to extracted illustrations only when almost no
  // PAGE image was fetchable in that moment. That state outlives its cause:
  // Pal. lat. 1370 has 322 pages, every one fetchable today, yet its hero is 30
  // cropped diagrams from 26 July. A book reads as its pages.
  it('is offered even at a full grid, which tile count alone would miss', () => {
    expect(shouldOfferMosaicUpgrade({ tiles: 40, pagesCount: 390, source: 'plates' })).toBe(true);
  });

  it('is offered when short, like Pal. lat. 1370 at 10x3', () => {
    expect(shouldOfferMosaicUpgrade({ tiles: 30, pagesCount: 390, source: 'plates' })).toBe(true);
  });

  it('still respects maxed and the page-count floor', () => {
    expect(shouldOfferMosaicUpgrade({ tiles: 30, pagesCount: 390, source: 'plates', maxed: true })).toBe(false);
    expect(shouldOfferMosaicUpgrade({ tiles: 30, pagesCount: 12, source: 'plates' })).toBe(false);
  });

  it('leaves a full page-tiled mosaic alone', () => {
    expect(shouldOfferMosaicUpgrade({ tiles: 40, pagesCount: 390, source: 'pages' })).toBe(false);
  });

  it('counts plates → pages as a win even if the grid got smaller', () => {
    // A 10x3 of real page scans beats a 10x4 of cropped diagrams.
    const v = nextUpgradeVerdict(40, 30, 1, { before: 'plates', after: 'pages' });
    expect(v).toEqual({ maxed: false, attempts: 0 });
  });

  it('burns an attempt when the rebuild is still stuck on plates', () => {
    // The page images are evidently still unfetchable; retrying on every reader
    // would be a rebuild loop on the most expensive path there is.
    const first = nextUpgradeVerdict(30, 30, 0, { before: 'plates', after: 'plates' });
    expect(first).toEqual({ maxed: false, attempts: 1 });
    const second = nextUpgradeVerdict(30, 40, first.attempts, { before: 'plates', after: 'plates' });
    expect(second.maxed).toBe(true);
  });
});
