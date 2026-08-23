// Center-crop every dataset plate on its BIGGEST detected circle: square crop
// of 2*r*PAD, circle center at the image center, edge-padded where the crop
// exceeds the source. Writes centered/ + a QA montage.
import sharp from 'sharp';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'esoteric-geometries-out/mandala-circles-dataset';
const PAD = 1.18;
const BG = { r: 20, g: 16, b: 25 };
const SIZE = 800;

const ann = JSON.parse(readFileSync(join(DIR, 'annotations.json'), 'utf8'));
const OUTDIR = join(DIR, 'centered');
rmSync(OUTDIR, { recursive: true, force: true });
mkdirSync(OUTDIR, { recursive: true });

const tiles = [];
for (const item of ann.items) {
  const big = item.circles.reduce((a, b) => (b.r > a.r ? b : a));
  const srcPath = join(DIR, 'images', `${item.id}.jpg`);
  const side = Math.max(2, Math.round(2 * big.r * PAD));
  const pad = side;
  const extended = await sharp(srcPath).extend({ top: pad, bottom: pad, left: pad, right: pad, background: BG }).toBuffer();
  const buf = await sharp(extended)
    .extract({ left: Math.round(big.cx - side / 2) + pad, top: Math.round(big.cy - side / 2) + pad, width: side, height: side })
    .resize(SIZE, SIZE, { fit: 'fill' })
    .jpeg({ quality: 90 }).toBuffer();
  writeFileSync(join(OUTDIR, `${item.id}.jpg`), buf);
  tiles.push({ buf, label: `${item.id} r=${big.r} c=${big.conf}` });
  console.log(`  ${item.id}  biggest r=${big.r} conf=${big.conf} @ (${big.cx},${big.cy})`);
}

const TILE = 220, COLS = 6;
const rows = Math.ceil(tiles.length / COLS);
const composed = await Promise.all(tiles.map(async (t) => {
  const lbl = Buffer.from(`<svg width="${TILE}" height="18"><rect width="100%" height="100%" fill="black" fill-opacity="0.65"/><text x="4" y="14" font-family="sans-serif" font-size="11" fill="#fff">${t.label}</text></svg>`);
  return sharp(t.buf).resize(TILE, TILE).composite([{ input: lbl, top: TILE - 18, left: 0 }]).png().toBuffer();
}));
const comps = composed.map((input, i) => ({ input, left: (i % COLS) * TILE, top: Math.floor(i / COLS) * TILE }));
await sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 3, background: { r: 26, g: 22, b: 18 } } })
  .composite(comps).png().toFile(join(DIR, 'centered-montage.png'));
console.log(`Wrote ${tiles.length} centered crops to ${OUTDIR} + centered-montage.png`);
