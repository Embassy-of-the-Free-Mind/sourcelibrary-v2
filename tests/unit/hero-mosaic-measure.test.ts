/**
 * measureGrid reads a mosaic's shape back out of its pixels. It is what decides
 * whether each of the ~12,660 mosaics cached before the generator recorded its
 * grid needs rebuilding — so a wrong answer either leaves a short hero short
 * forever, or rebuilds an image that was already fine.
 *
 * These build mosaics with the SAME geometry the route uses and check the shape
 * comes back out, including through AVIF encoding (the stored format, and lossy
 * enough that the gap bands are not exactly the background colour any more).
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { measureGrid, TILE_W, GAP } from '@/lib/hero-mosaic-measure';

const BG = { r: 20, g: 16, b: 12 };

/** Compose a cols×rows grid exactly as the hero-mosaic route does: tiles at a
 *  fixed column width, GAP everywhere including the outer edge. */
async function buildGrid(cols: number, rows: number, tileH: number, tint = 235): Promise<Buffer> {
  const width = cols * TILE_W + (cols + 1) * GAP;
  const height = GAP + rows * (tileH + GAP);
  const tile = await sharp({
    create: { width: TILE_W, height: tileH, channels: 3, background: { r: tint, g: tint - 10, b: tint - 25 } },
  }).png().toBuffer();

  const placements = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      placements.push({
        input: tile,
        left: GAP + c * (TILE_W + GAP),
        top: GAP + r * (tileH + GAP),
      });
    }
  }
  return sharp({ create: { width, height, channels: 3, background: BG } })
    .composite(placements)
    .png()
    .toBuffer();
}

describe('measureGrid', () => {
  it('reads back every grid shape the compositor can produce', async () => {
    for (const [cols, rows] of [[10, 4], [10, 3], [10, 2], [10, 1], [7, 4], [5, 2], [4, 1]] as const) {
      const buf = await buildGrid(cols, rows, 276);
      expect(await measureGrid(buf)).toEqual({ cols, rows, tiles: cols * rows });
    }
  });

  it('survives AVIF encoding, which is how mosaics are actually stored', async () => {
    // The gap bands are no longer exactly (20,16,12) after a lossy round trip —
    // this is the case the production measurement actually runs on.
    const png = await buildGrid(10, 2, 276);
    const avif = await sharp(png).avif({ quality: 38, effort: 5 }).toBuffer();
    expect(await measureGrid(avif)).toEqual({ cols: 10, rows: 2, tiles: 20 });
  });

  it('is not fooled by a very dark page scan', async () => {
    // A dark manuscript tile is near the background colour. If the threshold
    // read those rows as gaps, a full 10×4 would measure as many thin rows and
    // the book would be judged "already full" at the wrong shape.
    const buf = await buildGrid(10, 4, 276, 75);
    const grid = await measureGrid(buf);
    expect(grid).toEqual({ cols: 10, rows: 4, tiles: 40 });
  });

  it('distinguishes short from full at the threshold that drives repairs', async () => {
    const short = await measureGrid(await buildGrid(10, 2, 276));
    const full = await measureGrid(await buildGrid(10, 4, 276));
    expect(short!.tiles).toBeLessThan(40);
    expect(full!.tiles).toBe(40);
  });

  it('returns null rather than guessing when the buffer is not an image', async () => {
    expect(await measureGrid(Buffer.from('not an image'))).toBeNull();
  });
});
