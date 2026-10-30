import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { fitLongEdge } from '../../scripts/lib/image-long-edge.mjs';

const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 190, b: 170 } } }).jpeg().toBuffer();

describe('fitLongEdge (#6740 image-size factor)', () => {
  it('fits the long edge and keeps the aspect ratio', async () => {
    const r = await fitLongEdge(await jpeg(1800, 3000), 1600);
    expect(r.resized).toBe(true);
    expect(r.native).toEqual({ w: 1800, h: 3000 });
    expect(r.sent.h).toBe(1600);
    expect(r.sent.w).toBe(960);
  });
  it('never enlarges: an image already within the edge is sent byte for byte', async () => {
    const buf = await jpeg(1200, 1500);
    const r = await fitLongEdge(buf, 2400);
    expect(r.resized).toBe(false);
    expect(r.buf.equals(buf)).toBe(true);
  });
});
