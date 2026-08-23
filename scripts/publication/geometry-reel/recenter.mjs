// Re-center a plate's disc via rim-alignment refinement: fine grid search of
// (cx, cy, r), scoring by Sobel edge magnitude sampled along the candidate rim.
// Fixes the disc everywhere it ships: print-discs/ (portfolio), stickers/, buttons/.
//
//   node _tmp-recenter.mjs <plate-key> [sticker-name]
//   e.g. node _tmp-recenter.mjs plate-89 rosicrucian-seal-1785
//
// Optional env: SEED_CX, SEED_CY, SEED_R as fractions of image dims (defaults
// centered, r=0.40*min); SEARCH as +/- fraction (default 0.12).
import sharp from 'sharp';
import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const key = process.argv[2];
const stickerName = process.argv[3] || '';
if (!key) { console.error('usage: node _tmp-recenter.mjs <plate-key> [sticker-name]'); process.exit(1); }

const OUTDIR = 'esoteric-geometries-out';
const SRC = join(OUTDIR, 'print-src', `${key}.jpg`);
if (!existsSync(SRC)) { console.error(`missing ${SRC}`); process.exit(1); }

const meta = await sharp(SRC).metadata();
const DW = 480, scale = DW / Math.max(meta.width, meta.height);
const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale);
const { data, info } = await sharp(SRC).grayscale().resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
const ch = info.channels, g = i => data[i * ch];
const mag = new Float32Array(w * h);
for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
  const i00 = (y - 1) * w + x, i10 = y * w + x, i20 = (y + 1) * w + x;
  const sx = -g(i00 - 1) + g(i00 + 1) - 2 * g(i10 - 1) + 2 * g(i10 + 1) - g(i20 - 1) + g(i20 + 1);
  const sy = -g(i00 - 1) - 2 * g(i00) - g(i00 + 1) + g(i20 - 1) + 2 * g(i20) + g(i20 + 1);
  mag[y * w + x] = Math.hypot(sx, sy);
}

const seed = {
  cx: (Number(process.env.SEED_CX) || 0.5) * w,
  cy: (Number(process.env.SEED_CY) || 0.5) * h,
  r: (Number(process.env.SEED_R) || 0.40) * Math.min(w, h),
};
const SEARCH = Number(process.env.SEARCH || 0.12);
let best = { score: -1 };
const ANG = 180;
for (let cy = seed.cy - h * SEARCH; cy <= seed.cy + h * SEARCH; cy += 2)
for (let cx = seed.cx - w * SEARCH; cx <= seed.cx + w * SEARCH; cx += 2)
for (let r = seed.r * 0.8; r <= seed.r * 1.35; r += 2) {
  if (cx - r < 0 || cx + r >= w || cy - r < 0 || cy + r >= h) continue;
  let s = 0;
  for (let a = 0; a < ANG; a++) {
    const t = 2 * Math.PI * a / ANG;
    s += mag[Math.round(cy + r * Math.sin(t)) * w + Math.round(cx + r * Math.cos(t))];
  }
  if (s > best.score) best = { score: s, cx, cy, r };
}
const cx = best.cx / scale, cy = best.cy / scale, r = best.r / scale;
console.log(`refined: cx=${cx.toFixed(0)} cy=${cy.toFixed(0)} r=${r.toFixed(0)} (rim score ${(best.score / ANG).toFixed(1)})`);

const SIZE = 2000, PAD = 1.12, BGC = { r: 20, g: 16, b: 25 };
const side = Math.round(2 * r * PAD), pad = side;
const ext = await sharp(SRC).extend({ top: pad, bottom: pad, left: pad, right: pad, background: BGC }).toBuffer();
const maskR = Math.min(SIZE / 2 - 1, Math.round((SIZE / 2) * (1.03 / PAD)));
const mask = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${maskR}" fill="#fff"/></svg>`);
const discPath = join(OUTDIR, 'print-discs', `${key}.png`);
await sharp(ext)
  .extract({ left: Math.round(cx - side / 2) + pad, top: Math.round(cy - side / 2) + pad, width: side, height: side })
  .resize(SIZE, SIZE, { fit: 'fill' })
  .ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png()
  .toFile(discPath);
console.log('updated', discPath);

if (stickerName) {
  const stickerPath = join(OUTDIR, 'playa-gifts/stickers', `${stickerName}.png`);
  copyFileSync(discPath, stickerPath);
  const S = 2400, D = Math.round(S * 0.78);
  const disc = await sharp(discPath).resize(D, D).png().toBuffer();
  await sharp({ create: { width: S, height: S, channels: 3, background: { r: 26, g: 22, b: 18 } } })
    .composite([{ input: disc, left: (S - D) / 2, top: (S - D) / 2 }]).jpeg({ quality: 95 })
    .toFile(join(OUTDIR, 'playa-gifts/buttons', `${stickerName}.jpg`));
  console.log('updated sticker + button:', stickerName);
}
