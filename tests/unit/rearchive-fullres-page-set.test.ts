import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { upgradedPageSet } from '../../scripts/lib/rearchive-page-set.mjs';
import { sameLeaf, LEAF_MIN_CORR } from '../../scripts/lib/page-alignment.mjs';

/**
 * #3186. rearchive-iiif-fullres.mjs replaced a Siku page's 766×1044 archive with the 2298×3132
 * master and wrote the new size only under image_metadata. The top-level image_width stayed 766:
 * the IIIF manifest drew a 766 px canvas over the master, and --max-held-width 800 selected the
 * page again on every run.
 *
 * Negative control run when written: dropping `...dimensionFields(dims, null)` from
 * upgradedPageSet turns the first case red.
 */
describe('upgradedPageSet', () => {
  it('writes the stored size to the top-level pair as well as image_metadata', () => {
    const set = upgradedPageSet({
      newUrl: 'https://images.sourcelibrary.org/archived/6a3c74e301fe4f593c1f3538/44.jpg',
      dims: { width: 2298, height: 3132 },
      masterWidth: 2298,
    });
    expect(set.image_width).toBe(2298);
    expect(set.image_height).toBe(3132);
    expect(set['image_metadata.width']).toBe(set.image_width);
    expect(set['image_metadata.height']).toBe(set.image_height);
  });

  it('writes no size it does not know, rather than a zero or undefined', () => {
    const set = upgradedPageSet({ newUrl: 'u', dims: null, masterWidth: 2000 });
    expect('image_width' in set).toBe(false);
    expect('image_height' in set).toBe(false);
  });

  it('keeps the source of record only when asked', () => {
    const src = 'https://archive.org/download/06047210.cn/page/n43/full/full/0/default.jpg';
    expect(upgradedPageSet({ newUrl: 'u', dims: { width: 1, height: 1 }, masterWidth: 1, keepSource: src }).photo_original).toBe(src);
    expect('photo_original' in upgradedPageSet({ newUrl: 'u', dims: { width: 1, height: 1 }, masterWidth: 1 })).toBe(false);
  });
});

/**
 * The per-page guard (--page-guard). Two leaves of one ruled layout: same frame and column rules,
 * different characters. The held copy is a small 3-channel JPEG, the master a large 1-bit scan, as
 * on the Archive's Siku items. The leaf must match itself across that change and refuse its neighbour.
 */
async function leaf(seed: number, width: number, { bilevel = false } = {}) {
  const h = Math.round(width * 1.36);
  let rects = `<rect x="${width * 0.05}" y="${h * 0.05}" width="${width * 0.9}" height="${h * 0.9}" fill="none" stroke="black" stroke-width="${width / 150}"/>`;
  let x = seed * 9301 + 49297;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  for (let c = 0; c < 8; c++) {
    const cx = width * (0.08 + c * 0.105);
    rects += `<line x1="${cx + width * 0.1}" y1="${h * 0.05}" x2="${cx + width * 0.1}" y2="${h * 0.95}" stroke="black" stroke-width="${width / 400}"/>`;
    for (let r = 0; r < 20; r++) {
      if (rnd() < 0.3) continue;
      const s = width * 0.06;
      rects += `<rect x="${cx + width * 0.015}" y="${h * 0.07 + r * h * 0.043}" width="${s * (0.4 + rnd() * 0.6)}" height="${s * (0.4 + rnd() * 0.6)}" fill="black"/>`;
    }
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}"><rect width="100%" height="100%" fill="white"/>${rects}</svg>`);
  let img = sharp(svg).greyscale();
  if (bilevel) img = img.threshold(128);
  return img.jpeg({ quality: bilevel ? 90 : 75 }).toBuffer();
}

describe('sameLeaf', () => {
  it('matches a leaf to its own master and refuses the next leaf of the same layout', async () => {
    const held = await leaf(1, 760);
    const own = await sameLeaf(held, await leaf(1, 2280, { bilevel: true }));
    const next = await sameLeaf(held, await leaf(2, 2280, { bilevel: true }));
    expect(own.same).toBe(true);
    expect(next.same).toBe(false);
    expect(next.r).toBeLessThan(LEAF_MIN_CORR);
  });

  it('refuses a blank page as evidence', async () => {
    const blank = await sharp({ create: { width: 200, height: 272, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    expect((await sameLeaf(blank, blank)).same).toBe(false);
  });
});
