// The house ornaments (ornaments.json): real woodcuts from the library's books, printed as ink on a transparent
// ground so they sit on any page. Initials are cut to their square block and inked in rust, as early printers
// rubricated capitals; headpiece and tailpiece in ink. STYLE=bw inks everything black.
import sharp from 'sharp';
import { adaptiveBinary } from './pictures';

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

type Comp = { n: number; x0: number; y0: number; x1: number; y1: number };
/** Connected runs of ink, largest first. */
function components(bin: Uint8Array, W: number, H: number): Comp[] {
  const seen = new Uint8Array(W * H), out: Comp[] = [];
  for (let s = 0; s < W * H; s++) {
    if (bin[s] || seen[s]) continue;
    const st = [s]; seen[s] = 1;
    const c = { n: 0, x0: W, y0: H, x1: 0, y1: 0 };
    while (st.length) {
      const i = st.pop()!, x = i % W, y = (i - x) / W;
      c.n++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && !bin[j] && !seen[j]) { seen[j] = 1; st.push(j); }
      }
    }
    out.push(c);
  }
  return out.sort((a, b) => b.n - a.n);
}

/** Ink on transparent, at most `size` px on the long edge. `block` crops to the main inked component. */
export async function inkOrnament(src: Buffer, colour: string, opts: { block?: boolean; size?: number } = {}): Promise<Buffer> {
  const base = sharp(src).flatten({ background: '#ffffff' }).grayscale().resize(opts.size ?? 900, opts.size ?? 900, { fit: 'inside', withoutEnlargement: true });
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const gray = new Uint8Array(data.buffer, data.byteOffset, data.length);
  // A woodcut is ink or paper: a global cut after stretching contrast, with the adaptive cut for uneven paper.
  const bin = adaptiveBinary(gray, W, H);
  const comps = components(bin, W, H);
  let x0: number, y0: number, x1: number, y1: number;
  if (opts.block && comps.length) {
    // The block initial is the largest run of ink (its border ties it together). Where a neighbouring line of
    // text touched it, the box comes out wider than tall: keep the square window with the most ink.
    ({ x0, y0, x1, y1 } = comps[0]);
    const h = y1 - y0 + 1;
    if (x1 - x0 + 1 > h * 1.08) {
      const col = new Float64Array(W);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!bin[y * W + x]) col[x]++;
      let best = x0, sum = 0, top = -1;
      for (let x = x0; x <= x1; x++) {
        sum += col[x] - (x - h >= x0 ? col[x - h] : 0);
        if (x - x0 + 1 >= h && sum > top) { top = sum; best = x - h + 1; }
      }
      x0 = best; x1 = best + h - 1;
    }
  } else {
    // The ornament without the dust: the box of every run at least 2% the size of the largest.
    const big = comps.filter((c) => c.n >= (comps[0]?.n ?? 0) * 0.02);
    x0 = Math.min(...big.map((c) => c.x0)); y0 = Math.min(...big.map((c) => c.y0));
    x1 = Math.max(...big.map((c) => c.x1)); y1 = Math.max(...big.map((c) => c.y1));
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, [r, g, b] = hex(colour);
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y * w + x) * 4, ink = !bin[(y0 + y) * W + x0 + x];
    rgba[k] = r; rgba[k + 1] = g; rgba[k + 2] = b; rgba[k + 3] = ink ? 255 : 0;
  }
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}
