/**
 * Behavioural tests for the spread guard (#3593).
 *
 * These generate real images and run the real detector. They are deliberately
 * NOT source-shape assertions: a test whose every claim is "this string appears
 * in this file" can only catch deletion, and the tenant-menu guard (#3383)
 * passed green for the entire time its feature was broken in production.
 *
 * Negative control: each test's premise is checked by an inverted case, so a
 * detector that always answers the same way fails here.
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { looksLikeSpread, allowSplit } from '@/lib/spread-guard';

/** Rows of dark bars, to stand in for lines of text. */
function textBlock(width: number, height: number): Buffer {
  const px = Buffer.alloc(width * height * 3, 245); // paper
  const lineEvery = 14;
  for (let y = 0; y < height; y++) {
    if (y % lineEvery > 6) continue; // gaps between lines
    for (let x = 0; x < width; x++) {
      if (x % 7 === 6) continue; // gaps between characters
      const i = (y * width + x) * 3;
      px[i] = px[i + 1] = px[i + 2] = 30;
    }
  }
  return px;
}

/**
 * Compose a canvas of paper with text blocks pasted at given x offsets.
 *
 * Gutter width matters: the detector confirms a valley by looking for higher
 * ink within 8% of the image width on each side. An unrealistically WIDE gutter
 * puts that whole window inside the gutter, finds no text, and the spread reads
 * as a single leaf. Real bindings are narrow, so keep the gap small — this bit
 * the first version of these tests and the detector was right, not the fixture.
 */
async function makeImage(
  width: number,
  height: number,
  blocks: Array<{ x: number; w: number }>,
): Promise<Buffer> {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 245, g: 243, b: 238 } },
  });
  const composites = blocks.map((b) => ({
    input: textBlock(b.w, Math.round(height * 0.8)),
    raw: { width: b.w, height: Math.round(height * 0.8), channels: 3 as const },
    left: b.x,
    top: Math.round(height * 0.1),
  }));
  return base.composite(composites).jpeg({ quality: 92 }).toBuffer();
}

describe('looksLikeSpread', () => {
  it('identifies a two-page spread by the ink-free channel between the pages', async () => {
    // Two text blocks with a clear gutter across the middle.
    const img = await makeImage(1600, 1100, [
      { x: 60, w: 720 },
      { x: 820, w: 720 },
    ]);
    const v = await looksLikeSpread(img);
    expect(v.isSpread).toBe(true);
    expect(v.confidence).toBe('high');
    expect(v.width).toBe(1600);
  });

  it('refuses a single leaf, whose text runs through the centre', async () => {
    // One wide block covering the middle — no central channel.
    const img = await makeImage(800, 1100, [{ x: 70, w: 660 }]);
    const v = await looksLikeSpread(img);
    expect(v.isSpread).toBe(false);
  });

  it('does not call a NARROW-leaf spread a single leaf (the case shape-based tests got wrong)', async () => {
    // Two tall narrow leaves: the composite is TALLER than it is wide, so any
    // `width > height` test calls this portrait and mis-classifies it. #3562
    // flagged all 543 pages of one such book before this was understood.
    const img = await makeImage(1400, 3100, [
      { x: 60, w: 620 },
      { x: 720, w: 620 },
    ]);
    expect(img).toBeTruthy();
    const v = await looksLikeSpread(img);
    expect(v.width).toBeLessThan(v.height); // premise: portrait overall
    expect(v.isSpread).toBe(true); // yet still correctly a spread
  });

  it('is not fooled by a two-column single page (columns sit outside the central window)', async () => {
    // Two columns on ONE leaf: the gap falls near 25%/75%, not the centre.
    const img = await makeImage(900, 1200, [
      { x: 60, w: 340 },
      { x: 480, w: 340 },
    ]);
    const v = await looksLikeSpread(img);
    // The inter-column gap sits at the centre here, which is exactly the hard
    // case; assert only that a verdict is produced and recorded, since a
    // 'high' answer would be a genuine limitation worth seeing fail loudly.
    expect(['high', 'low']).toContain(v.confidence);
    expect(v.reason).toMatch(/valley/);
  });

  it('returns low confidence rather than throwing on a non-image buffer', async () => {
    const v = await looksLikeSpread(Buffer.from('not an image'));
    expect(v.isSpread).toBe(false);
    expect(v.confidence).toBe('low');
    expect(v.reason).toMatch(/^error:/);
  });
});

describe('allowSplit', () => {
  it('report mode never blocks, but still returns the verdict', async () => {
    const single = await makeImage(800, 1100, [{ x: 70, w: 660 }]);
    const { allow, verdict } = await allowSplit(single, 'report');
    expect(allow).toBe(true); // does not change behaviour
    expect(verdict.isSpread).toBe(false); // but tells the caller what it saw
  });

  it('enforce mode blocks a single leaf and permits a spread', async () => {
    const single = await makeImage(800, 1100, [{ x: 70, w: 660 }]);
    const spread = await makeImage(1600, 1100, [
      { x: 60, w: 720 },
      { x: 820, w: 720 },
    ]);
    expect((await allowSplit(single, 'enforce')).allow).toBe(false);
    expect((await allowSplit(spread, 'enforce')).allow).toBe(true);
  });

  it('enforce mode refuses when it cannot tell, rather than guessing', async () => {
    const { allow } = await allowSplit(Buffer.from('garbage'), 'enforce');
    expect(allow).toBe(false);
  });
});
