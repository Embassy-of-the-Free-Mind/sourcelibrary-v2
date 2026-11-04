/**
 * markImage takes the weakest nudge that reads back (#4406). A fixed nudge showed as a checker on
 * grainy paper. The hard case the other way is few textured blocks with wildly different means.
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { markImage, detectWatermark } from '../../scripts/lib/provenance-mark.mjs';

const ID = '6aeb10c5d845fdef8a7e14ba';
const key = 'test-key';

function noiseScan(width: number, height: number, amplitude: number) {
  const raw = Buffer.alloc(width * height * 3);
  // A fixed LCG, so the page is the same in every run.
  let s = 12345;
  for (let i = 0; i < raw.length; i += 3) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    raw.fill(128 + ((s >> 16) % (2 * amplitude)) - amplitude, i, i + 3);
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

/** Random high-contrast 6px tiles over the top 15% of the page, flat paper below. */
function thinDensePage(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3, 235);
  let s = 777;
  for (let ty = 0; ty < Math.floor(height * 0.15); ty += 6) {
    for (let tx = 0; tx < width; tx += 6) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const v = 28 + ((s >> 16) % 200);
      for (let y = ty; y < ty + 6; y++) raw.fill(v, (y * width + tx) * 3, (y * width + Math.min(tx + 6, width)) * 3);
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

describe('markImage read-back', () => {
  it('a page that proves easily gets the weakest nudge, not the old fixed one', async () => {
    const page = await noiseScan(1200, 1600, 20);
    const marked = await markImage(page, { editionId: ID, pageNumber: 2, key });
    const weakest = await markImage(page, { editionId: ID, pageNumber: 2, key, delta: 2 });
    const d = await detectWatermark(marked, { editionId: ID, key });
    expect(d.z).toBeGreaterThanOrEqual(10);
    expect(marked.equals(weakest)).toBe(true);
  });

  it('strengthens a dense page the weakest nudge cannot prove', async () => {
    const page = await thinDensePage(790, 1050);
    const weakest = await markImage(page, { editionId: ID, pageNumber: 2, key, delta: 5 });
    expect((await detectWatermark(weakest, { editionId: ID, key })).present).toBe(false);
    const marked = await markImage(page, { editionId: ID, pageNumber: 2, key });
    expect((await detectWatermark(marked, { editionId: ID, key })).present).toBe(true);
  });

  it('a blank page gets the weakest render and no error, and detects as nothing', async () => {
    const blank = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 240, g: 235, b: 220 } } }).jpeg().toBuffer();
    const marked = await markImage(blank, { editionId: ID, pageNumber: 2, key });
    const d = await detectWatermark(marked, { editionId: ID, key });
    expect(d.present).toBe(false);
    expect(d.pairs ?? 0).toBeLessThan(16);
    expect((await sharp(marked).metadata()).exif).toBeTruthy();
  });

  it('the wrong key reads nothing on a marked page, on either read', async () => {
    const page = await noiseScan(1200, 1600, 20);
    const marked = await markImage(page, { editionId: ID, pageNumber: 2, key });
    const d = await detectWatermark(marked, { editionId: ID, key: 'other-key' });
    expect(d.present).toBe(false);
    expect(Math.max(d.raw_z, d.hp_z)).toBeLessThan(5);
  });
});
