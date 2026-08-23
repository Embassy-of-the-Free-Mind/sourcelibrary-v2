// Swirl/vortex warp of a single circular plate (the Microcosmus man).
// Inverse-mapped twist: max at center, 0 at the rim so the round frame stays
// intact. Breathes 0 -> MAX -> 0 for a seamless loop.
//
// Usage: node _tmp-warp-figure.mjs <input.png> <out.gif>
//   env: SWIRL  max twist radians at center (default 6.5)
//        FRAMES  number of frames (default 48)
//        DELAY   ms per frame (default 55)
//        DIR     swirl direction 1|-1 (default 1)
import sharp from 'sharp';

const IN = process.argv[2] || 'esoteric-geometries-out/circles-masked-combined-pngs/circle-16_plate-24.png';
const OUT = process.argv[3] || 'esoteric-geometries-out/vitruvian-warp.gif';
const SWIRL = Number(process.env.SWIRL || 6.5);
const FRAMES = Number(process.env.FRAMES || 48);
const DELAY = Number(process.env.DELAY || 55);
const DIRN = Number(process.env.DIR || 1);
const DARK = { r: 26, g: 22, b: 18 };

const { data: src, info } = await sharp(IN).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, CH = info.channels;
const cx = W / 2, cy = H / 2;

// Content radius = furthest opaque pixel from center (defines the rim).
let R = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (src[(y * W + x) * CH + 3] > 24) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > R) R = d;
    }
  }
}
R = Math.max(R, 1);

function sampleBilinear(sx, sy, out, oi) {
  if (sx < 0 || sy < 0 || sx > W - 1 || sy > H - 1) {
    out[oi] = 0; out[oi + 1] = 0; out[oi + 2] = 0; out[oi + 3] = 0;
    return;
  }
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1);
  const fx = sx - x0, fy = sy - y0;
  const i00 = (y0 * W + x0) * CH, i10 = (y0 * W + x1) * CH;
  const i01 = (y1 * W + x0) * CH, i11 = (y1 * W + x1) * CH;
  for (let c = 0; c < 4; c++) {
    const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
    const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
    out[oi + c] = Math.round(top * (1 - fy) + bot * fy);
  }
}

async function warpFrame(strength) {
  const out = Buffer.alloc(W * H * 4, 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy);
      const oi = (y * W + x) * 4;
      if (r > R) { out[oi + 3] = 0; continue; }
      // smooth falloff: max twist at center, 0 at rim
      const f = 1 - r / R;
      const twist = strength * f * f; // f^2 keeps the rim extra-stable
      const theta = Math.atan2(dy, dx) - twist * DIRN;
      const sx = cx + r * Math.cos(theta);
      const sy = cy + r * Math.sin(theta);
      sampleBilinear(sx, sy, out, oi);
    }
  }
  // composite on brand-dark -> opaque frame
  return sharp({ create: { width: W, height: H, channels: 3, background: DARK } })
    .composite([{ input: await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer() }])
    .png().toBuffer();
}

const frames = [];
for (let i = 0; i < FRAMES; i++) {
  const t = i / FRAMES;
  const s = SWIRL * (0.5 - 0.5 * Math.cos(2 * Math.PI * t)); // 0 -> MAX -> 0
  frames.push(await warpFrame(s));
  process.stdout.write(`\r  frame ${i + 1}/${FRAMES}`);
}
process.stdout.write('\n');

await sharp(frames, { join: { animated: true } })
  .gif({ loop: 0, delay: FRAMES ? new Array(FRAMES).fill(DELAY) : DELAY, effort: 8, colours: 128 })
  .toFile(OUT);
console.log('wrote', OUT);
const webp = OUT.replace(/\.gif$/, '.webp');
await sharp(frames, { join: { animated: true } })
  .webp({ loop: 0, delay: DELAY, effort: 6, quality: 90 })
  .toFile(webp);
console.log('wrote', webp);
