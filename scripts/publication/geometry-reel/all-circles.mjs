// Mask a circle out of EVERY keyword-"circular" plate (the original ~31), not
// just the ones that passed the confidence gate. Labels each with its detected
// confidence and whether the reel USED the detection or fell back to center,
// so we can evaluate which dropped plates are worth recovering.
import sharp from 'sharp';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '/tmp/geo-out/frames/OEBPS/images';
const MANIFEST = '/tmp/geo-out/manifest.json';
const OUTDIR = 'esoteric-geometries-out/all-circles-pngs';
const MONTAGE = 'esoteric-geometries-out/all-circles-montage.png';
const SIZE = 400;
const PAD = 1.18;
const CONF = 0.08; // same gate the reel used
const BG = { r: 20, g: 16, b: 25 };

const CIRCLE_RE = /\b(circle|circular|concentric|wheel|volvelle|sphere|spherical|armillar|orb|annular|rota|rose window|mandala|roundel|rotating|radial|zodiac|globe|disc|disk)\b/i;
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const order = manifest.chapters.flatMap(c => c.plates);
const files = [];
order.forEach((p, i) => {
  if (CIRCLE_RE.test(`${p.description || ''} ${p.type || ''}`)) {
    files.push({ file: `plate-${i + 1}.jpg`, desc: (p.description || '').slice(0, 70) });
  }
});
console.log(`Keyword-circular plates: ${files.length}`);

async function detectCircle(path) {
  const DW = 240;
  const meta = await sharp(path).metadata();
  const scale = DW / Math.max(meta.width, meta.height);
  const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale);
  const { data, info } = await sharp(path).grayscale().resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const g = i => data[i * ch];
  const gxK = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gyK = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const mag = new Float32Array(w * h), dx = new Float32Array(w * h), dy = new Float32Array(w * h);
  let sum = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let sx = 0, sy = 0, k = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const v = g((y + j) * w + (x + i)); sx += v * gxK[k]; sy += v * gyK[k]; k++; }
    const m = Math.hypot(sx, sy); const idx = y * w + x; mag[idx] = m; dx[idx] = sx; dy[idx] = sy; sum += m;
  }
  const cnt = (w - 2) * (h - 2), mean = sum / cnt;
  let s2 = 0; for (let i = 0; i < mag.length; i++) { const d = mag[i] - mean; s2 += d * d; }
  const std = Math.sqrt(s2 / cnt);
  const thr = mean + 1.0 * std;
  const minDim = Math.min(w, h);
  const RSTEP = 2;
  const rmin = Math.round(minDim * 0.15), rmax = Math.round(minDim * 0.62);
  const nr = Math.floor((rmax - rmin) / RSTEP) + 1;
  const acc = new Float32Array(nr * w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const idx = y * w + x, m = mag[idx]; if (m < thr) continue;
    const nx = dx[idx] / m, ny = dy[idx] / m;
    for (let ri = 0; ri < nr; ri++) {
      const r = rmin + ri * RSTEP, base = ri * w * h;
      let cx = Math.round(x - nx * r), cy = Math.round(y - ny * r);
      if (cx >= 0 && cx < w && cy >= 0 && cy < h) acc[base + cy * w + cx] += 1;
      cx = Math.round(x + nx * r); cy = Math.round(y + ny * r);
      if (cx >= 0 && cx < w && cy >= 0 && cy < h) acc[base + cy * w + cx] += 1;
    }
  }
  let best = -1, bx = w / 2, by = h / 2, bri = Math.round(nr / 2);
  for (let ri = 0; ri < nr; ri++) {
    const r = rmin + ri * RSTEP, base = ri * w * h, norm = 2 * Math.PI * r;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += acc[base + (y + j) * w + (x + i)];
      const score = s / norm;
      if (score > best) { best = score; bx = x; by = y; bri = ri; }
    }
  }
  const br = rmin + bri * RSTEP;
  return { cx: bx / scale, cy: by / scale, r: br / scale, conf: best };
}

rmSync(OUTDIR, { recursive: true, force: true });
mkdirSync(OUTDIR, { recursive: true });

const tiles = [];
let usedCount = 0;
for (let n = 0; n < files.length; n++) {
  const { file: f } = files[n];
  const path = join(DIR, f);
  const meta = await sharp(path).metadata();
  const minOrig = Math.min(meta.width, meta.height);
  let cx = meta.width / 2, cy = meta.height / 2, r = minOrig * 0.45, use = false, conf = 0;
  try {
    const det = await detectCircle(path);
    conf = det.conf;
    const rOk = det.r >= minOrig * 0.10 && det.r <= minOrig * 0.70;
    use = (det.conf >= CONF && rOk) || det.conf >= 0.6;
    if (use) { cx = det.cx; cy = det.cy; r = det.r; usedCount++; }
  } catch (e) { /* center fallback */ }

  const side = Math.max(2, Math.round(2 * r * PAD));
  const pad = side;
  const left = Math.round(cx - side / 2) + pad;
  const top = Math.round(cy - side / 2) + pad;
  const extended = await sharp(path).extend({ top: pad, bottom: pad, left: pad, right: pad, background: BG }).toBuffer();
  const maskR = Math.min(SIZE / 2 - 1, Math.round((SIZE / 2) * (1.03 / PAD)));
  const mask = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${maskR}" fill="#fff"/></svg>`);
  const buf = await sharp(extended)
    .extract({ left, top, width: side, height: side })
    .resize(SIZE, SIZE, { fit: 'fill' })
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png().toBuffer();

  const stem = f.replace(/\.jpg$/, '');
  const tag = use ? 'USE' : 'FALL';
  writeFileSync(join(OUTDIR, `${String(n + 1).padStart(2, '0')}_${stem}_c${conf.toFixed(2)}_${tag}.png`), buf);
  tiles.push({ buf, label: `${n + 1} ${stem} c=${conf.toFixed(2)} ${tag}`, use });
  console.log(`  ${String(n + 1).padStart(2)} ${stem}  conf=${conf.toFixed(3)}  ${use ? 'USE' : 'fallback'}`);
}
console.log(`\nDetected & used: ${usedCount}/${files.length}  (rest are center-fallback crops)`);

// Labeled montage. USE tiles get a green label bar, fallbacks red, so the
// dropped ones are obvious at a glance.
const TILE = 200, COLS = 6;
const rows = Math.ceil(tiles.length / COLS);
const composed = await Promise.all(tiles.map(async (t) => {
  const barColor = t.use ? '#1f7a3f' : '#8a2222';
  const lbl = Buffer.from(`<svg width="${TILE}" height="20"><rect width="100%" height="100%" fill="${barColor}"/><text x="4" y="15" font-family="sans-serif" font-size="12" fill="#fff">${t.label}</text></svg>`);
  return sharp(t.buf).resize(TILE, TILE).composite([{ input: lbl, top: TILE - 20, left: 0 }]).png().toBuffer();
}));
const comps = composed.map((input, i) => ({ input, left: (i % COLS) * TILE, top: Math.floor(i / COLS) * TILE }));
await sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 3, background: { r: 30, g: 26, b: 34 } } })
  .composite(comps).png().toFile(MONTAGE);
console.log('wrote montage', MONTAGE);
console.log('wrote', tiles.length, 'masked PNGs to', OUTDIR);
