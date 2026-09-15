/**
 * Behavioural tests for the pixel gutter detector (#4796).
 *
 * These generate real images and run the real detector. Fixture geometry is
 * taken from measured spreads (2026-09-13 audit, 33 real spreads): inter-text
 * gaps of 10–210‰ of the width, binding shadows ~10px wide at 800px, frame
 * rules 1–3px, curvature shading next to the binding, tan (yellowed) paper.
 * Each positive claim has an inverted case so a detector that always answers
 * the same way fails here.
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
// @ts-expect-error — plain ESM script module without types
import { detectGutterPixel } from '../../scripts/lib/gutter-detect.mjs';

const W = 1600, H = 1100;
type RGB = [number, number, number];
const PAPER: RGB = [245, 245, 245];
const TAN: RGB = [205, 180, 120]; // min channel 120 — the old absolute threshold read this as ink

function canvas(paper: RGB = PAPER): Buffer {
  const px = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { px[i * 3] = paper[0]; px[i * 3 + 1] = paper[1]; px[i * 3 + 2] = paper[2]; }
  return px;
}
/** Lines of type: 7 rows of ink, 7 rows of paper, with gaps between "characters". */
function text(px: Buffer, x0: number, x1: number, y0 = 80, y1 = H - 80) {
  for (let y = y0; y < y1; y++) {
    if (y % 14 > 6) continue;
    for (let x = x0; x < x1; x++) {
      if (x % 7 === 6) continue;
      const i = (y * W + x) * 3; px[i] = px[i + 1] = px[i + 2] = 30;
    }
  }
}
function band(px: Buffer, x0: number, x1: number, v: number) {
  for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 3; px[i] = px[i + 1] = px[i + 2] = v; }
}
/** Darken a region multiplicatively — the curvature shadow next to a tight binding. */
function shade(px: Buffer, x0: number, x1: number, factor: number) {
  for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 3; px[i] *= factor; px[i + 1] *= factor; px[i + 2] *= factor; }
}
const toJpeg = (px: Buffer) => sharp(px, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();

describe('detectGutterPixel', () => {
  it('cuts at the binding shadow inside the inter-text gap', async () => {
    const px = canvas();
    text(px, 120, 700); text(px, 900, 1480);
    band(px, 794, 806, 60);
    const r = await detectGutterPixel(await toJpeg(px));
    expect(r.confidence).toBe('high');
    expect(r.reason).toMatch(/^gap\+shadow/);
    expect(Math.abs(r.column - 800)).toBeLessThanOrEqual(12);
  });

  it('cuts at the gap centre when there is no shadow', async () => {
    const px = canvas();
    text(px, 120, 700); text(px, 900, 1480);
    const r = await detectGutterPixel(await toJpeg(px));
    expect(r.confidence).toBe('high');
    expect(r.reason).toMatch(/^gap-centre/);
    expect(Math.abs(r.column - 800)).toBeLessThanOrEqual(12);
  });

  it('follows an off-centre gutter instead of assuming 50%', async () => {
    const px = canvas();
    text(px, 100, 560); text(px, 640, 1500);
    band(px, 596, 604, 60);
    const r = await detectGutterPixel(await toJpeg(px));
    expect(r.confidence).toBe('high');
    expect(Math.abs(r.column - 600)).toBeLessThanOrEqual(12);
  });

  it('does not cut inside a wide blank inner margin (the Japanese-book failure)', async () => {
    // left page text ends at 520, a 280px blank margin, binding at 800, right text from 900
    const px = canvas();
    text(px, 120, 520); text(px, 900, 1480);
    band(px, 794, 806, 60);
    const r = await detectGutterPixel(await toJpeg(px));
    expect(r.confidence).toBe('high');
    expect(Math.abs(r.column - 800)).toBeLessThanOrEqual(12);
  });

  it('is not fooled by frame rules on tan paper (the Chinese-woodblock failure)', async () => {
    const px = canvas(TAN);
    text(px, 120, 620); text(px, 980, 1480);
    band(px, 628, 631, 20); band(px, 969, 972, 20); // 3px frame rules, no binding shadow
    const r = await detectGutterPixel(await toJpeg(px));
    expect(r.confidence).toBe('high');
    expect(Math.abs(r.column - 800)).toBeLessThanOrEqual(20);
    expect(Math.abs(r.column - 630)).toBeGreaterThan(60);
    expect(Math.abs(r.column - 970)).toBeGreaterThan(60);
  });

  it('still sees type inside the curvature shadow and keeps 3% clear of it', async () => {
    const px = canvas();
    text(px, 120, 720); text(px, 850, 1480);
    shade(px, 780, 1000, 0.5); // the right page darkens toward the binding
    band(px, 796, 804, 40);
    const r = await detectGutterPixel(await toJpeg(px));
    expect(r.confidence).toBe('high');
    expect(r.column).toBeLessThanOrEqual(850 - 0.03 * W);
    expect(r.column).toBeGreaterThanOrEqual(720 + 0.03 * W);
  });

  it('accepts a blank facing page only via the binding shadow', async () => {
    const px = canvas();
    text(px, 900, 1480);
    const noShadow = await detectGutterPixel(await toJpeg(px));
    expect(noShadow.confidence).toBe('low');
    band(px, 794, 806, 60);
    const r = await detectGutterPixel(await toJpeg(px));
    expect(r.confidence).toBe('high');
    expect(r.reason).toMatch(/^blank-left\+shadow/);
    expect(Math.abs(r.column - 800)).toBeLessThanOrEqual(12);
  });

  it('refuses a single wide page with no gap (negative control)', async () => {
    const px = canvas();
    text(px, 150, 1450);
    const r = await detectGutterPixel(await toJpeg(px));
    expect(r.confidence).toBe('low');
    expect(r.column).toBeNull();
  });

  it('refuses a blank page (negative control)', async () => {
    const r = await detectGutterPixel(await toJpeg(canvas()));
    expect(r.confidence).toBe('low');
    expect(r.column).toBeNull();
  });
});
