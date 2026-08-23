// Build a nested-circles dataset from Buddhist mandala plates.
//
// 1. Gather a wide pool of Buddhist/mandala imagery from the public gallery
//    API (with full provenance: gallery id, book, author, year, URL).
// 2. Run a MULTI-circle Hough detector (gradient voting + non-max suppression)
//    on each plate to find nested rings and offset sub-circles.
// 3. Classify pairwise relations (concentric / contained / separate), keep
//    plates with genuine nested structure, and emit:
//      images/       source jpgs
//      overlays/     detections drawn on the plate
//      crops/        square crop per detected circle
//      annotations.json  circles + relations + provenance per image
//      overlay montage for quick QA
//
// Usage: node _tmp-mandala-dataset.mjs [outDir] [maxImages]
import sharp from 'sharp';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://sourcelibrary.org';
const OUT = process.argv[2] || 'esoteric-geometries-out/mandala-circles-dataset';
const MAX_IMAGES = Number(process.argv[3] || 60);
const MAX_CIRCLES = 8;      // per image
const CONF_MIN = 0.20;      // min ring completeness for a kept circle
const DW = 280;             // detection working width
// Restrict to Buddhist/Tibetan sources (the semantic queries also surface
// western esoterica — tarot, alchemy — which don't belong in this dataset).
const BUDDHIST_RE = /tibet|buddhis|thangka|vajra|lama|bardo|stupa|dharma|bhavacakra|khor|sgrub|dgongs|gonpa|monaster|rlung|gter|gshin|phur|thor bu|sa skya|avalokite|yamantaka|kalachakra|meru/i;

const QUERIES = [
  'buddhist mandala cosmology tibetan',
  'mandala vajrayana deity circle diagram',
  'thangka tibetan wheel of life bhavacakra',
  'tantric yantra meditation circle',
  'chakra lotus wheel dharma',
  'kalachakra mandala palace',
  'tibetan cosmological diagram mount meru',
  'mandala concentric deity palace ritual',
  'stupa mandala offering diagram tibetan',
  'srid pa khor lo wheel existence',
  // Tibetan-native terms (the collections are catalogued with these)
  'dkyil khor mandala diagram',
  'srung khor protective circle amulet',
  'rlung khor wind wheel diagram',
  'khor lo wheel ritual diagram tibetan',
  'tsakli initiation card tibetan',
  'astrological diagram tibetan divination sipaho',
  'hevajra cakrasamvara guhyasamaja mandala',
  'lotus petals deity circle tibetan ritual',
  'seed syllable mantra circle tibetan',
  'torma offering diagram circle',
];
const PER_QUERY = 240; // paginate each query this deep (offset supported)

// ---------- gather ----------------------------------------------------------
function key(it) { return `${it.pageId}-${it.detectionIndex}`; }
const pool = new Map();
for (const q of QUERIES) {
  for (let offset = 0; offset < PER_QUERY; offset += 60) {
    const u = new URL('/api/gallery', BASE);
    u.searchParams.set('limit', '60'); u.searchParams.set('maxPerBook', '12');
    u.searchParams.set('q', q);
    if (offset) u.searchParams.set('offset', String(offset));
    try {
      const r = await fetch(u); if (!r.ok) break;
      const items = (await r.json()).items || [];
      for (const it of items) {
        if (!it.extractedUrl && !it.imageUrl) continue;
        if (!pool.has(key(it))) pool.set(key(it), it);
      }
      if (items.length < 60) break; // exhausted
    } catch { break; }
  }
}
// Rank: mandala-ish text first, then quality.
const MANDALA_RE = /\b(mandala|bhavacakra|wheel|yantra|chakra|cosmogram|concentric|circular|roundel|kalachakra|khor lo)\b/i;
const ranked = [...pool.values()]
  .filter(it => BUDDHIST_RE.test(`${it.bookTitle || ''} ${it.author || ''} ${it.description || ''}`))
  .map(it => ({ it, hint: MANDALA_RE.test(`${it.bookTitle || ''} ${it.description || ''}`) ? 1 : 0 }))
  .sort((a, b) => (b.hint - a.hint) || ((b.it.galleryQuality ?? 0) - (a.it.galleryQuality ?? 0)));
console.log(`Gallery pool: ${ranked.length} unique candidates`);

// ---------- multi-circle detector -------------------------------------------
async function detectCircles(buf) {
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
  const RSTEP = 2;
  const rmin = Math.max(6, Math.round(minDim * 0.06)), rmax = Math.round(minDim * 0.62);
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
  // Smoothed, circumference-normalized score volume.
  const score = new Float32Array(nr * w * h);
  for (let ri = 0; ri < nr; ri++) {
    const r = rmin + ri * RSTEP, base = ri * w * h, norm = 2 * Math.PI * r;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += acc[base + (y + j) * w + (x + i)];
      score[base + y * w + x] = s / norm;
    }
  }
  // Iterative peak extraction with suppression in (cx, cy, r).
  const found = [];
  for (let k = 0; k < MAX_CIRCLES; k++) {
    let best = -1, bx = 0, by = 0, bri = 0;
    for (let ri = 0; ri < nr; ri++) {
      const base = ri * w * h;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const v = score[base + y * w + x];
        if (v > best) { best = v; bx = x; by = y; bri = ri; }
      }
    }
    if (best < CONF_MIN) break;
    const br = rmin + bri * RSTEP;
    found.push({ cx: bx / scale, cy: by / scale, r: br / scale, conf: best });
    // Suppress: same center within 0.35*r AND radius within 25% -> duplicate ring.
    for (let ri = 0; ri < nr; ri++) {
      const r = rmin + ri * RSTEP;
      if (Math.abs(r - br) > 0.25 * br + RSTEP) continue;
      const base = ri * w * h, supp = Math.max(6, 0.35 * br);
      const y0 = Math.max(0, Math.round(by - supp)), y1 = Math.min(h - 1, Math.round(by + supp));
      const x0 = Math.max(0, Math.round(bx - supp)), x1 = Math.min(w - 1, Math.round(bx + supp));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (Math.hypot(x - bx, y - by) <= supp) score[base + y * w + x] = 0;
      }
    }
  }
  return { circles: found, width: meta.width, height: meta.height };
}

// ---------- relations --------------------------------------------------------
function classify(circles) {
  const rels = [];
  for (let i = 0; i < circles.length; i++) for (let j = 0; j < circles.length; j++) {
    if (i === j) continue;
    const A = circles[i], B = circles[j];
    if (B.r >= A.r) continue; // only smaller-inside-bigger
    const d = Math.hypot(A.cx - B.cx, A.cy - B.cy);
    if (d + B.r <= A.r * 1.05) {
      const kind = d < 0.15 * A.r ? 'concentric' : 'contained';
      rels.push({ outer: i, inner: j, kind, centerDist: Math.round(d) });
    }
  }
  return rels;
}

// ---------- main loop --------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
for (const d of ['images', 'overlays', 'crops']) mkdirSync(join(OUT, d), { recursive: true });

const annotations = [];
const overlayTiles = [];
let n = 0, kept = 0;
for (const { it } of ranked) {
  if (n >= MAX_IMAGES) break;
  const src = it.extractedUrl || it.imageUrl;
  let raw;
  try {
    const r = await fetch(src); if (!r.ok) continue;
    raw = await sharp(Buffer.from(await r.arrayBuffer()))
      .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  } catch { continue; }
  n++;
  const id = `mandala-${String(n).padStart(3, '0')}`;
  let det;
  try { det = await detectCircles(raw); } catch { continue; }
  const rels = classify(det.circles);
  const nested = rels.length > 0 && det.circles.length >= 2;
  console.log(`  ${id}  circles=${det.circles.length} rels=${rels.length} ${nested ? 'KEEP' : 'skip'}  ${(it.bookTitle || '').slice(0, 45)}`);
  if (!nested) continue;
  kept++;

  writeFileSync(join(OUT, 'images', `${id}.jpg`), raw);

  // Overlay: outermost/global circles green, inner ones orange, centers dotted.
  const svgCircles = det.circles.map((c, i) => {
    const isInner = rels.some(r => r.inner === i);
    const col = isInner ? '#ff9a3c' : '#3cff7a';
    return `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="none" stroke="${col}" stroke-width="5" opacity="0.9"/>` +
      `<circle cx="${c.cx}" cy="${c.cy}" r="6" fill="${col}"/>` +
      `<text x="${c.cx + 10}" y="${c.cy - 10}" font-family="sans-serif" font-size="34" fill="${col}">${i}</text>`;
  }).join('');
  const overlay = await sharp(raw).composite([{
    input: Buffer.from(`<svg width="${det.width}" height="${det.height}">${svgCircles}</svg>`), top: 0, left: 0,
  }]).jpeg({ quality: 88 }).toBuffer();
  writeFileSync(join(OUT, 'overlays', `${id}.jpg`), overlay);
  overlayTiles.push({ buf: overlay, label: `${id} c${det.circles.length} r${rels.length}` });

  // Crops: square crop around each circle (1.15x padding), clamped to image.
  for (let i = 0; i < det.circles.length; i++) {
    const c = det.circles[i];
    const side = Math.round(2 * c.r * 1.15);
    const left = Math.round(c.cx - side / 2), top = Math.round(c.cy - side / 2);
    const l = Math.max(0, left), t = Math.max(0, top);
    const wCrop = Math.min(det.width - l, side), hCrop = Math.min(det.height - t, side);
    if (wCrop < 40 || hCrop < 40) continue;
    try {
      const crop = await sharp(raw).extract({ left: l, top: t, width: wCrop, height: hCrop })
        .resize(512, 512, { fit: 'fill' }).jpeg({ quality: 88 }).toBuffer();
      writeFileSync(join(OUT, 'crops', `${id}_c${i}.jpg`), crop);
    } catch { /* skip bad crop */ }
  }

  annotations.push({
    id,
    source: {
      galleryId: key(it),
      galleryUrl: `${BASE}/gallery/image/${key(it)}`,
      book: it.bookTitle || null, author: it.author || null, year: it.year || null,
      description: it.description || null, imageUrl: src,
    },
    width: det.width, height: det.height,
    circles: det.circles.map(c => ({ cx: Math.round(c.cx), cy: Math.round(c.cy), r: Math.round(c.r), conf: Number(c.conf.toFixed(3)) })),
    relations: rels,
  });
}

writeFileSync(join(OUT, 'annotations.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  detector: { workingWidth: DW, confMin: CONF_MIN, maxCircles: MAX_CIRCLES },
  count: annotations.length,
  items: annotations,
}, null, 2));

// QA montage of overlays.
const TILE = 240, COLS = 6;
const rows = Math.ceil(overlayTiles.length / COLS);
if (overlayTiles.length) {
  const composed = await Promise.all(overlayTiles.map(async (t) => {
    const lbl = Buffer.from(`<svg width="${TILE}" height="20"><rect width="100%" height="100%" fill="black" fill-opacity="0.65"/><text x="4" y="15" font-family="sans-serif" font-size="12" fill="#fff">${t.label}</text></svg>`);
    return sharp(t.buf).resize(TILE, TILE, { fit: 'cover' }).composite([{ input: lbl, top: TILE - 20, left: 0 }]).png().toBuffer();
  }));
  const comps = composed.map((input, i) => ({ input, left: (i % COLS) * TILE, top: Math.floor(i / COLS) * TILE }));
  await sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 3, background: { r: 26, g: 22, b: 18 } } })
    .composite(comps).png().toFile(join(OUT, 'overlays-montage.png'));
}
console.log(`\nDataset: ${kept}/${n} plates kept (nested circles) -> ${OUT}`);
