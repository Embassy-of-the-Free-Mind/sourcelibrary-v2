/**
 * Reads the grid shape back OUT of an already-composited hero mosaic.
 *
 * The generator only started recording cols/rows on 2026-08-02, so for the
 * ~12,660 mosaics cached before that the shape exists nowhere but the pixels.
 * Measuring is what keeps the self-repair cheap: one fetch + decode tells us
 * whether a book needs anything, and ~70% of them don't, so they're recorded as
 * full and never rebuilt.
 *
 * Imports `sharp`, so it must never be pulled into a page bundle — only the
 * mosaic route and its tests use it. The page-side predicate lives in the
 * sharp-free hero-mosaic-upgrade.ts.
 */
import sharp from 'sharp';

/** Must match the compositor in the hero-mosaic route. */
export const TILE_W = 168;
export const GAP = 6;

export interface MosaicGrid {
  cols: number;
  rows: number;
  tiles: number;
}

/**
 * Grid shape of a composited mosaic buffer.
 *
 * Columns come from the width formula the compositor used
 * (`cols * TILE_W + (cols + 1) * GAP`). Rows are counted from the full-width
 * background bands it leaves between them: one above the first row and one
 * below the last, so `rows = bands - 1`.
 *
 * Verified against three production mosaics of independently known shape —
 * Alciato's Emblemata (10×2), Corpus Inscriptionum Latinarum (10×3), and
 * Illustrations of British Mycology (10×4) — and against constructed grids in
 * tests/unit/hero-mosaic-measure.test.ts.
 *
 * Returns null when the buffer can't be decoded, so callers treat the shape as
 * still-unknown rather than assuming the worst and rebuilding needlessly.
 */
export async function measureGrid(buf: Buffer): Promise<MosaicGrid | null> {
  try {
    const meta = await sharp(buf).metadata();
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    if (!width || !height) return null;

    // A gap band is uniform background, so sampling every 4th pixel is enough
    // and keeps the scan linear in height rather than in area. The thresholds
    // sit well above the BG colour (20,16,12) to absorb AVIF ringing.
    const isBgRow = (y: number) => {
      for (let x = 0; x < width; x += 4) {
        const i = (y * width + x) * channels;
        if (data[i] > 60 || data[i + 1] > 55 || data[i + 2] > 50) return false;
      }
      return true;
    };

    let bands = 0;
    let run = 0;
    for (let y = 0; y < height; y++) {
      if (isBgRow(y)) { run++; continue; }
      // Require 2px: a single dark scanline inside a very dark page scan should
      // not read as a row boundary.
      if (run >= 2) bands++;
      run = 0;
    }
    if (run >= 2) bands++;

    const rows = Math.max(1, bands - 1);
    const cols = Math.round(((meta.width ?? width) - GAP) / (TILE_W + GAP));
    if (cols < 1) return null;
    return { cols, rows, tiles: cols * rows };
  } catch {
    return null;
  }
}

/** Fetch a stored mosaic and measure it. Null on any network or decode failure. */
export async function measureStoredGrid(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const grid = await measureGrid(Buffer.from(await res.arrayBuffer()));
    return grid ? grid.tiles : null;
  } catch {
    return null;
  }
}
