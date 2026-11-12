// Pictures for the EPUB, cropped and (for STYLE=bw) made for e-ink. Reviewed by eye on Hyperborea's 89
// pictures (2026-11-11): a single global threshold turned scanner background, gutter shadow and yellowed
// paper into black slabs on a quarter of the pages, so:
//   - every picture is cropped to its printed area first (dark scanner background and blank margins off);
//   - a page scan (text) becomes 1-bit black and white by an ADAPTIVE threshold: a pixel is ink when it
//     is darker than its neighbourhood, so uneven light and paper tone drop out and the type stays crisp;
//   - a figure (engraving, map, photograph) becomes grayscale with its contrast stretched: an e-ink screen
//     shows 16 greys, and thresholding a photograph or a fine engraving loses what it shows.
import sharp from 'sharp';

type Box = { left: number; top: number; width: number; height: number };

/** The printed area: rows/columns that carry some ink, are not solid (a page edge), and are not dark
 *  background (scanner bed, cover board). Falls back to the whole picture when the guess is implausible. */
function contentBox(gray: Uint8Array, bin: Uint8Array, W: number, H: number): Box {
  const colInk = new Float64Array(W), rowInk = new Float64Array(H), colSum = new Float64Array(W), rowSum = new Float64Array(H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!bin[i]) { colInk[x]++; rowInk[y]++; }
    colSum[x] += gray[i]; rowSum[y] += gray[i];
  }
  const span = (ink: Float64Array, sum: Float64Array, len: number, across: number): [number, number] => {
    const ok = (i: number) => ink[i] / across > 0.004 && ink[i] / across < 0.5 && sum[i] / across > 110;
    const edge = (start: number, step: number) => {
      for (let i = start, run = 0; i >= 0 && i < len; i += step) {
        if (!ok(i)) { run = 0; continue; }
        if (++run >= 3) return i - step * 2;
      }
      return start;
    };
    return [edge(0, 1), edge(len - 1, -1)];
  };
  let [x0, x1] = span(colInk, colSum, W, H), [y0, y1] = span(rowInk, rowSum, H, W);
  const pad = Math.round(0.015 * Math.max(W, H));
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  if (x1 - x0 < W * 0.3 || y1 - y0 < H * 0.3) return { left: 0, top: 0, width: W, height: H };
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Ink where a pixel is darker than K × the mean of its window (~1/20 of the long edge), via an integral image. */
export function adaptiveBinary(gray: Uint8Array, W: number, H: number): Uint8Array {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += gray[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; }
  }
  const r = Math.round(Math.max(W, H) / 40), K = 0.85;
  const bin = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(W, x + r + 1);
      const mean = (I[yb * (W + 1) + xb] - I[ya * (W + 1) + xb] - I[yb * (W + 1) + xa] + I[ya * (W + 1) + xa]) / ((yb - ya) * (xb - xa));
      const v = gray[y * W + x];
      bin[y * W + x] = v < mean * K && v < 200 ? 0 : 255;
    }
  }
  return bin;
}

/** Ink connected to the picture's border is the page edge, the gutter or the scanner bed, never type (the
 *  crop leaves a margin round the text): flood-fill it white. */
function clearBorderInk(bin: Uint8Array, W: number, H: number): void {
  const stack: number[] = [];
  const push = (i: number) => { if (!bin[i]) { bin[i] = 255; stack.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop()!, x = i % W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (i >= W) push(i - W);
    if (i < (H - 1) * W) push(i + W);
  }
}

/** A picture (already within 800×1200) cropped, and for bw made for e-ink. Returns the bytes and extension. */
export async function preparePicture(buf: Buffer, kind: 'scan' | 'figure', bw: boolean): Promise<{ data: Buffer; ext: 'jpg' | 'png' }> {
  const { data, info } = await sharp(buf).flatten({ background: '#ffffff' }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const gray = new Uint8Array(data.buffer, data.byteOffset, data.length);
  const W = info.width, H = info.height;
  const bin = adaptiveBinary(gray, W, H);
  const box = contentBox(gray, bin, W, H);
  if (!bw) return { data: await sharp(buf).extract(box).jpeg({ quality: 75, mozjpeg: true }).toBuffer(), ext: 'jpg' };
  if (kind === 'figure') {
    return { data: await sharp(buf).extract(box).grayscale().normalize().jpeg({ quality: 72, mozjpeg: true }).toBuffer(), ext: 'jpg' };
  }
  const cropped = new Uint8Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) cropped.set(bin.subarray((box.top + y) * W + box.left, (box.top + y) * W + box.left + box.width), y * box.width);
  clearBorderInk(cropped, box.width, box.height);
  const png = await sharp(Buffer.from(cropped), { raw: { width: box.width, height: box.height, channels: 1 } })
    .png({ palette: true, colours: 2, compressionLevel: 9 }).toBuffer();
  return { data: png, ext: 'png' };
}
