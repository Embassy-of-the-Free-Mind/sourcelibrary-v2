// Build the Leadbeater chakra reel: pull every circular chakra plate from
// "The Chakras. A monograph" (1927), center+mask each to a disc (same pipeline
// as the circles reel), montage all candidates, then assemble an animated GIF
// ascending the spine: Root -> Spleen -> Navel -> Heart -> Throat -> Brow ->
// Crown (held). Env PICKS overrides the auto choice per chakra:
//   PICKS=root=69c...-0,heart=69f...-0
import sharp from 'sharp';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://sourcelibrary.org';
const BOOK_ID = '69c86f6c6c6f3cc53c8570c0';
const OUT = '/tmp/geo-out/chakras';
const SIZE = 600;
const PAD = 1.14;
const DARK = { r: 26, g: 22, b: 18 };
const BG = { r: 20, g: 16, b: 25 };

const ORDER = ['root', 'spleen', 'navel', 'heart', 'throat', 'brow', 'crown'];
const CHAKRA_RE = {
  root: /root chakra|muladhara/i,
  spleen: /spleen chakra/i,
  navel: /navel chakra|manipura/i,
  heart: /heart chakra|anahata/i,
  throat: /throat chakra|vishuddha/i,
  brow: /brow chakra|ajna/i,
  crown: /crown chakra|sahasrara/i,
};
// Only circular plate renditions (skip body diagrams, buddha heads, atoms).
const CIRCULAR_RE = /circular|circle|petal|lotus|segments/i;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'discs'), { recursive: true });

// ---- fetch book plates ----
const u = new URL('/api/gallery', BASE);
u.searchParams.set('bookId', BOOK_ID); u.searchParams.set('limit', '60');
const items = ((await (await fetch(u)).json()).items || []);
console.log(`Book plates: ${items.length}`);

const candidates = [];
for (const it of items) {
  const d = it.description || '';
  if (!CIRCULAR_RE.test(d)) continue;
  const chakra = ORDER.find(k => CHAKRA_RE[k].test(d));
  if (!chakra) continue;
  candidates.push({ it, chakra });
}
console.log(`Circular chakra candidates: ${candidates.length}`);

// ---- circle detection (single best, from the reel pipeline) ----
async function detectCircle(buf) {
  const DW = 240;
  const meta = await sharp(buf).metadata();
  const scale = DW / Math.max(meta.width, meta.height);
  const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale);
  const { data, info } = await sharp(buf).grayscale().resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const g = i => data[i * ch];
  const mag = new Float32Array(w * h), dx = new Float32Array(w * h), dy = new Float32Array(w * h);
  let sum = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i00 = (y - 1) * w + x, i10 = y * w + x, i20 = (y + 1) * w + x;
    const sx = -g(i00 - 1) + g(i00 + 1) - 2 * g(i10 - 1) + 2 * g(i10 + 1) - g(i20 - 1) + g(i20 + 1);
    const sy = -g(i00 - 1) - 2 * g(i00) - g(i00 + 1) + g(i20 - 1) + 2 * g(i20) + g(i20 + 1);
    const m = Math.hypot(sx, sy); const idx = y * w + x;
    mag[idx] = m; dx[idx] = sx; dy[idx] = sy; sum += m;
  }
  const cnt = (w - 2) * (h - 2), mean = sum / cnt;
  let s2 = 0; for (let i = 0; i < mag.length; i++) { const d = mag[i] - mean; s2 += d * d; }
  const thr = mean + Math.sqrt(s2 / cnt);
  const minDim = Math.min(w, h);
  // Chakra plates are near-full-bleed discs: search up to 78% of the short side.
  const RSTEP = 2, rmin = Math.round(minDim * 0.20), rmax = Math.round(minDim * 0.78);
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
  // Best candidate PER radius, then prefer the LARGEST radius whose score is
  // close to the global best — the plate's outer rim, not an inner ring.
  const perR = [];
  let globalBest = -1;
  for (let ri = 0; ri < nr; ri++) {
    const r = rmin + ri * RSTEP, base = ri * w * h, norm = 2 * Math.PI * r;
    let best = -1, bx = 0, by = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += acc[base + (y + j) * w + (x + i)];
      const sc = s / norm;
      if (sc > best) { best = sc; bx = x; by = y; }
    }
    perR.push({ r, cx: bx, cy: by, conf: best });
    if (best > globalBest) globalBest = best;
  }
  let pick = null;
  for (let ri = nr - 1; ri >= 0; ri--) {
    if (perR[ri].conf >= Math.max(0.10, 0.55 * globalBest)) { pick = perR[ri]; break; }
  }
  if (!pick) pick = perR.reduce((a, b) => (b.conf > a.conf ? b : a));
  return { cx: pick.cx / scale, cy: pick.cy / scale, r: pick.r / scale, conf: pick.conf };
}

// ---- download, center, mask every candidate ----
const discs = [];
for (const { it, chakra } of candidates) {
  const src = it.extractedUrl || it.imageUrl;
  const id = `${it.pageId}-${it.detectionIndex}`;
  try {
    const r = await fetch(src); if (!r.ok) continue;
    const raw = Buffer.from(await r.arrayBuffer());
    let det = await detectCircle(raw);
    // Soft scalloped rims and black plate borders defeat the Hough vote; these
    // plates are all centered full-bleed discs, so fall back to that geometry.
    if (det.conf < 0.12) {
      const m = await sharp(raw).metadata();
      det = { cx: m.width / 2, cy: m.height / 2, r: 0.44 * Math.min(m.width, m.height), conf: det.conf };
    }
    const side = Math.max(2, Math.round(2 * det.r * PAD));
    const pad = side;
    const extended = await sharp(raw).extend({ top: pad, bottom: pad, left: pad, right: pad, background: BG }).toBuffer();
    const maskR = Math.min(SIZE / 2 - 1, Math.round((SIZE / 2) * (1.03 / PAD)));
    const mask = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${maskR}" fill="#fff"/></svg>`);
    const disc = await sharp(extended)
      .extract({ left: Math.round(det.cx - side / 2) + pad, top: Math.round(det.cy - side / 2) + pad, width: side, height: side })
      .resize(SIZE, SIZE, { fit: 'fill' })
      .ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    const meta = await sharp(raw).metadata();
    discs.push({ id, chakra, disc, conf: det.conf, srcMin: Math.min(meta.width, meta.height), desc: (it.description || '').slice(0, 70) });
    writeFileSync(join(OUT, 'discs', `${chakra}_${id}.png`), disc);
    console.log(`  ${chakra.padEnd(6)} ${id}  conf=${det.conf.toFixed(2)} src=${Math.min(meta.width, meta.height)}px`);
  } catch (e) { console.log(`  ! ${id} ${e.message}`); }
}

// ---- candidates montage grouped by chakra ----
const TILE = 190, COLS = 6;
const byChakra = ORDER.map(k => discs.filter(d => d.chakra === k));
const tiles = [];
for (const group of byChakra) for (const d of group) tiles.push(d);
const rows = Math.ceil(tiles.length / COLS);
const composed = await Promise.all(tiles.map(async (t) => {
  const lbl = Buffer.from(`<svg width="${TILE}" height="18"><rect width="100%" height="100%" fill="black" fill-opacity="0.7"/><text x="4" y="14" font-family="sans-serif" font-size="11" fill="#fff">${t.chakra} c=${t.conf.toFixed(2)} ${t.srcMin}px</text></svg>`);
  return sharp(t.disc).resize(TILE, TILE).composite([{ input: lbl, top: TILE - 18, left: 0 }]).png().toBuffer();
}));
const comps = composed.map((input, i) => ({ input, left: (i % COLS) * TILE, top: Math.floor(i / COLS) * TILE }));
await sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 3, background: { r: 30, g: 26, b: 34 } } })
  .composite(comps).png().toFile(join(OUT, 'chakra-candidates-montage.png'));

// ---- pick best per chakra (largest source, then confidence), build the reel ----
const PICKS = Object.fromEntries((process.env.PICKS || '').split(',').filter(Boolean).map(s => s.split('=')));
const chosen = [];
for (const k of ORDER) {
  const group = discs.filter(d => d.chakra === k);
  if (!group.length) { console.log(`  !! no plate for ${k}`); continue; }
  const pick = PICKS[k] ? group.find(d => d.id === PICKS[k]) || group[0]
    : group.sort((a, b) => (b.conf - a.conf) || (b.srcMin - a.srcMin))[0];
  chosen.push(pick);
  console.log(`  pick ${k.padEnd(6)} ${pick.id} (conf=${pick.conf.toFixed(2)}, ${pick.srcMin}px)`);
}

const darkBase = await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: DARK } }).png().toBuffer();
const frames = [];
for (const c of chosen) frames.push(await sharp(darkBase).composite([{ input: c.disc }]).png().toBuffer());

// Ascend the spine; hold the crown, then loop.
const delays = chosen.map((c, i) => (i === chosen.length - 1 ? 2000 : 650));
await sharp(frames, { join: { animated: true } })
  .gif({ loop: 0, delay: delays, effort: 8, colours: 256 })
  .toFile(join(OUT, 'chakras-ascending.gif'));
await sharp(frames, { join: { animated: true } })
  .webp({ loop: 0, delay: delays, effort: 6, quality: 90 })
  .toFile(join(OUT, 'chakras-ascending.webp'));
console.log(`wrote ${join(OUT, 'chakras-ascending.gif')} (${frames.length} chakras) + webp + candidates montage`);
