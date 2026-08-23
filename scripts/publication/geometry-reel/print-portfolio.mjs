// Print portfolio: "The Source Library Guide to Esoteric Geometries" as a
// letter-size PDF where EVERY page stands alone — one plate per page with its
// full citation and a sourcelibrary.org pointer, so individual pages can be
// torn out and given away. Order follows the reel: geometry plates, Buddhist
// mandalas, the Fludd man, the seven Leadbeater chakras ascending, the
// observable universe, the Boehme eye.
//
// Sources: esoteric-geometries-out/citations.json (reel provenance) + chakra
// picks + the Budassi universe map. Full-res images come from
// /api/gallery/image/[id] (highResUrl -> imageUrl fallback), cached in
// esoteric-geometries-out/print-src/. Each plate gets the disc treatment
// (detect circle, center, mask) at 2000px.
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import { mkdirSync, existsSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/jdietz/Documents/GitHub/dev/sourcelibrary-v2';
const OUTDIR = join(ROOT, 'esoteric-geometries-out');
const SRC = join(OUTDIR, 'print-src');
const DISCS = join(OUTDIR, 'print-discs');
mkdirSync(SRC, { recursive: true });
mkdirSync(DISCS, { recursive: true });

const BASE = 'https://sourcelibrary.org';
const SIZE = 2000, PAD = 1.12;
const BG = { r: 20, g: 16, b: 25 };
const CREAM = '#f6f1e7';
const DARK = '#1a1612';
const INK = '#2b241c';
const FADED = '#7a7062';

// ---- build the plate list ----
const citations = JSON.parse(readFileSync(join(OUTDIR, 'citations.json'), 'utf8'));
const gid = (u) => u.split('/gallery/image/')[1];
const plates = citations.map((c) => ({
  key: c.file, id: gid(c.url), book: c.book, author: c.author, year: c.year,
  description: c.description, url: c.url,
}));
// Insert the chakras + universe before the eye finale.
const eye = plates.pop();
const CHAKRAS = [
  ['root', 'Muladhara — the Root Chakra', '69c86fb06c6f3cc53c85712e-0'],
  ['spleen', 'The Spleen Chakra', '69c86fb06c6f3cc53c85712d-0'],
  ['navel', 'Manipura — the Navel Chakra', '69c86f976c6f3cc53c857101-0'],
  ['heart', 'Anahata — the Heart Chakra', '69f658c3750fcb7f4a9f9128-0'],
  ['throat', 'Vishuddha — the Throat Chakra', '69c8705d6c6f3cc53c857283-0'],
  ['brow', 'Ajna — the Brow Chakra', '69c870626c6f3cc53c857297-0'],
  ['crown', 'Sahasrara — the Crown Chakra', '69c86fb06c6f3cc53c85712f-0'],
];
for (const [key, label, id] of CHAKRAS) {
  plates.push({
    key: `chakra-${key}`, id, book: 'The Chakras. A Monograph', author: 'C. W. Leadbeater',
    year: 1927, description: label + ', as seen clairvoyantly — from the first color atlas of the chakra system.',
    url: `${BASE}/gallery/image/${id}`,
  });
}
plates.push({
  key: 'universe', id: 'artwork-69e5379f5917566bf878f297-0',
  book: 'Logarithmic Map of the Observable Universe', author: 'Pablo Carlos Budassi', year: 2012,
  description: 'The entire observable universe in a single disc: the Solar System at the center, then the Kuiper Belt, the Milky Way, neighboring galaxies, the cosmic web, and the cosmic microwave background at the rim, on a logarithmic scale.',
  url: `${BASE}/gallery/image/artwork-69e5379f5917566bf878f297-0`,
});
plates.push(eye && { ...eye, id: gid(eye.url) });
console.log(`Plates: ${plates.length}`);

// ---- fetch full-res sources (cached) ----
// These plates come out wrong from the full-page highRes re-crop (off-center
// subject or surrounding dark page) — use the tight extraction crop instead.
const TIGHT = new Set(['plate-50', 'eye-11', 'chakra-heart']);
async function fetchPlate(p) {
  const cache = join(SRC, `${p.key}.jpg`);
  if (existsSync(cache)) return cache;
  const meta = await (await fetch(`${BASE}/api/gallery/image/${p.id}`)).json();
  const hi = meta.highResUrl && (meta.highResUrl.startsWith('http') ? meta.highResUrl : BASE + meta.highResUrl);
  const tries = TIGHT.has(p.key) ? [meta.imageUrl] : [hi, meta.imageUrl].filter(Boolean);
  for (const u of tries) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 20000) continue; // reject error stubs
      writeFileSync(cache, buf);
      return cache;
    } catch { /* try next */ }
  }
  throw new Error(`no image for ${p.key}`);
}

// ---- circle detection: outer-rim biased Hough + centered fallback ----
async function detectCircle(path) {
  const DW = 240;
  const meta = await sharp(path).metadata();
  const scale = DW / Math.max(meta.width, meta.height);
  const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale);
  const { data, info } = await sharp(path).grayscale().resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
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
  const RSTEP = 2, rmin = Math.round(minDim * 0.18), rmax = Math.round(minDim * 0.78);
  const nr = Math.floor((rmax - rmin) / RSTEP) + 1;
  const acc = new Float32Array(nr * w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const idx = y * w + x, m = mag[idx]; if (m < thr) continue;
    const nx = dx[idx] / m, ny = dy[idx] / m;
    for (let ri = 0; ri < nr; ri++) {
      const r = rmin + ri * RSTEP, base = ri * w * h;
      let px = Math.round(x - nx * r), py = Math.round(y - ny * r);
      if (px >= 0 && px < w && py >= 0 && py < h) acc[base + py * w + px] += 1;
      px = Math.round(x + nx * r); py = Math.round(y + ny * r);
      if (px >= 0 && px < w && py >= 0 && py < h) acc[base + py * w + px] += 1;
    }
  }
  const perR = []; let globalBest = -1;
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
  for (let ri = nr - 1; ri >= 0; ri--) if (perR[ri].conf >= Math.max(0.10, 0.55 * globalBest)) { pick = perR[ri]; break; }
  if (!pick) pick = perR.reduce((a, b) => (b.conf > a.conf ? b : a));
  const res = { cx: pick.cx / scale, cy: pick.cy / scale, r: pick.r / scale, conf: pick.conf };
  if (res.conf < 0.12) {
    return { cx: meta.width / 2, cy: meta.height / 2, r: 0.44 * Math.min(meta.width, meta.height), conf: res.conf };
  }
  return res;
}

async function makeDisc(srcPath, outPath) {
  if (existsSync(outPath)) return outPath;
  const det = await detectCircle(srcPath);
  const side = Math.max(2, Math.round(2 * det.r * PAD));
  const pad = side;
  const extended = await sharp(srcPath).extend({ top: pad, bottom: pad, left: pad, right: pad, background: BG }).toBuffer();
  const maskR = Math.min(SIZE / 2 - 1, Math.round((SIZE / 2) * (1.03 / PAD)));
  const mask = Buffer.from(`<svg width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${maskR}" fill="#fff"/></svg>`);
  await sharp(extended)
    .extract({ left: Math.round(det.cx - side / 2) + pad, top: Math.round(det.cy - side / 2) + pad, width: side, height: side })
    .resize(SIZE, SIZE, { fit: 'fill' })
    .ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toFile(outPath);
  return { out: outPath, conf: det.conf };
}

// ---- gather all discs ----
for (const p of plates) {
  const src = await fetchPlate(p);
  const disc = join(DISCS, `${p.key}.png`);
  const r = await makeDisc(src, disc);
  p.disc = disc;
  const m = await sharp(src).metadata();
  console.log(`  ${p.key.padEnd(14)} src=${m.width}x${m.height}${typeof r === 'object' ? ` conf=${r.conf.toFixed(2)}` : ' (cached)'}`);
}

// ---- contact sheet for review ----
{
  const TILE = 220, COLS = 7;
  const tiles = await Promise.all(plates.map(async (p, i) => {
    const lbl = Buffer.from(`<svg width="${TILE}" height="16"><rect width="100%" height="100%" fill="black" fill-opacity="0.7"/><text x="3" y="12" font-family="sans-serif" font-size="10" fill="#fff">${i + 1} ${p.key}</text></svg>`);
    return sharp(p.disc).resize(TILE, TILE).composite([{ input: lbl, top: TILE - 16, left: 0 }]).png().toBuffer();
  }));
  const rows = Math.ceil(tiles.length / COLS);
  await sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 3, background: { r: 30, g: 26, b: 34 } } })
    .composite(tiles.map((input, i) => ({ input, left: (i % COLS) * TILE, top: Math.floor(i / COLS) * TILE })))
    .png().toFile(join(OUTDIR, 'portfolio-contact-sheet.png'));
}

// ---- flatten discs for the PDF (cream page bg; cover disc on dark) ----
async function flatten(discPath, hex) {
  const rgb = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  return sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: rgb } })
    .composite([{ input: discPath }]).jpeg({ quality: 92 }).toBuffer();
}

// ---- compose the PDF ----
const PAGE_W = 612, PAGE_H = 792; // US Letter, points
const pdfPath = join(OUTDIR, 'esoteric-geometries-portfolio.pdf');
const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false, info: {
  Title: 'The Source Library Guide to Esoteric Geometries — Print Portfolio',
  Author: 'Source Library', Subject: 'Plates from seven centuries of sacred and scientific geometry',
} });
doc.pipe(createWriteStream(pdfPath));

const clamp = (s, n) => {
  if (!s || s.length <= n) return s || '';
  const cut = s.slice(0, n);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return stop > n * 0.5 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '…';
};

// Cover: dark, universe disc, title.
{
  doc.addPage();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(DARK);
  const uni = plates.find(p => p.key === 'universe');
  const coverDisc = await flatten(uni.disc, DARK);
  const dw = 380;
  doc.image(coverDisc, (PAGE_W - dw) / 2, 120, { width: dw });
  doc.font('Helvetica').fontSize(10).fillColor('#b9ad98')
    .text('S O U R C E   L I B R A R Y', 0, 60, { width: PAGE_W, align: 'center', characterSpacing: 2 });
  doc.font('Times-Roman').fontSize(30).fillColor('#f0e9da')
    .text('The Guide to Esoteric Geometries', 60, 540, { width: PAGE_W - 120, align: 'center' });
  doc.font('Times-Italic').fontSize(13).fillColor('#b9ad98')
    .text(`${plates.length} plates from seven centuries · a portfolio of circles`, 60, 590, { width: PAGE_W - 120, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#8a7f6c')
    .text('sourcelibrary.org', 0, PAGE_H - 50, { width: PAGE_W, align: 'center' });
}

// Colophon / how-to-distribute page.
{
  doc.addPage();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(CREAM);
  doc.font('Times-Roman').fontSize(13).fillColor(INK)
    .text('Every page in this portfolio stands alone.', 90, 140, { width: PAGE_W - 180 });
  doc.moveDown(0.6);
  doc.fontSize(11).text(
    'Each plate carries its own citation — the book it came from, its author and year, and a link back to the source. ' +
    'Tear out a page, give it away, pin it to a wall: it remains a complete object. ' +
    'The originals are historical primary sources — alchemical cosmograms, astronomical volvelles, Tibetan mandalas, ' +
    'Theosophical chakra plates — digitized, restored, and made readable at Source Library, a digital library of ' +
    'esoteric and early-scientific books. Every image here links to a page where you can read the full original.',
    90, undefined, { width: PAGE_W - 180, lineGap: 3 });
  doc.moveDown(1.2);
  doc.font('Times-Italic').text('The reel of these circles, animated: sourcelibrary.org/gallery', 90, undefined, { width: PAGE_W - 180 });
  doc.font('Helvetica').fontSize(8).fillColor(FADED)
    .text('Assembled ' + new Date().toISOString().slice(0, 10) + ' · images public domain or CC · sourcelibrary.org', 90, PAGE_H - 60, { width: PAGE_W - 180 });
}

// Plate pages.
let n = 0;
for (const p of plates) {
  n++;
  doc.addPage();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(CREAM);
  doc.font('Helvetica').fontSize(8).fillColor(FADED)
    .text(`SOURCE LIBRARY · ESOTERIC GEOMETRIES · PLATE ${n} OF ${plates.length}`, 0, 42, { width: PAGE_W, align: 'center', characterSpacing: 1.5 });
  const flat = await flatten(p.disc, CREAM);
  const dw = 460;
  doc.image(flat, (PAGE_W - dw) / 2, 78, { width: dw });
  let y = 78 + dw + 26;
  doc.font('Times-Bold').fontSize(15).fillColor(INK)
    .text(clamp(p.book, 90), 76, y, { width: PAGE_W - 152, align: 'center' });
  y = doc.y + 4;
  doc.font('Times-Italic').fontSize(11).fillColor(INK)
    .text(`${p.author}${p.year ? ` · ${p.year}` : ''}`, 76, y, { width: PAGE_W - 152, align: 'center' });
  y = doc.y + 10;
  doc.font('Times-Roman').fontSize(9.5).fillColor('#4a4238')
    .text(clamp(p.description, 260), 96, y, { width: PAGE_W - 192, align: 'center', lineGap: 2 });
  doc.font('Helvetica').fontSize(7.5).fillColor(FADED)
    .text(p.url.replace('https://', ''), 0, PAGE_H - 46, { width: PAGE_W, align: 'center' });
}

doc.end();
await new Promise(res => doc.on('end', res));
// pdfkit's stream 'end' fires on the doc; give the file stream a beat.
await new Promise(res => setTimeout(res, 500));
console.log('wrote', pdfPath, `(cover + colophon + ${n} plates)`);
