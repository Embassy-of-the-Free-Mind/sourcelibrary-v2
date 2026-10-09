#!/usr/bin/env node
/**
 * Reviewed folds for a spread book: contact sheets to place the fold, a pixel snap to
 * the crease, and verify sheets — the positions file that split-book.mjs --positions-file
 * applies. (#6114; pilot #6099, 956 spreads, 2 cuts corrected by eye.)
 *
 * PRIOR ART: split-book.mjs's own gutter detector (pixel + model split_position) — it
 *   parks woodblock books, reading inter-column gaps as gutters (MAD 124/1000 on #6099).
 *   This replaces only the PLACING of the fold; split-book.mjs still does the cutting.
 *   Folded from the Hetzner scratch scripts _tmp-fold-sheets.mjs and _tmp-fold-refine.mjs.
 *
 * WORKFLOW (all read-only against Mongo; nothing here writes to the book)
 *   1. place   — sheets of the middle band (38–62% of width, ruler every 0.5%), 10 spreads a
 *                sheet. A reviewer (Sonnet on the pilot, ~70 s per 160 pages) reads each sheet
 *                and writes positions.json: { "<page_number>": <fold % of width> | null }.
 *                null = keep whole (covers, boards, plates).
 *   2. refine  — snaps each placed fold to the darkest full-height band within ±1%, keeping
 *                the placed value when the window has no clear crease (< 15 grey levels).
 *   3. verify  — sheets of a narrower band (44–56%) with the fold drawn red (optional second
 *                set dashed blue), 20 a sheet. A person or Opus checks EVERY cut.
 *   4. node scripts/split-book.mjs <book_id> --gutter-only --positions-file=<refined.json> --overlap=0.005 --by=<reviewer>
 *      split-book refuses any page with no entry, so refine never invents one: a page missing from
 *      positions.json stays missing (it is reported), and only an explicit null means "keep whole".
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/batch/spread-folds.mjs place  <book_id> <outdir>
 *   node --env-file=.env.production.local scripts/batch/spread-folds.mjs refine <book_id> <positions.json> <out.json>
 *   node --env-file=.env.production.local scripts/batch/spread-folds.mjs verify <book_id> <outdir> <positions.json> [second.json] [only-pages.json]
 * Sheet geometry env overrides: FS_L, FS_R (band %, verify), FS_TW, FS_TH, FS_PER, FS_COLS.
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { pageImageUrl } from '../eval/spot-check/lib.mjs';

const [mode, bookId, ...rest] = process.argv.slice(2);
if (!['place', 'refine', 'verify'].includes(mode) || !bookId) {
  console.error('usage: spread-folds.mjs <place|refine|verify> <book_id> ...  (see header)');
  process.exit(1);
}
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const E = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
const fetchImage = async (p) => {
  const url = pageImageUrl(p);
  if (!url) throw new Error(`p${p.page_number}: no usable image url`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`p${p.page_number}: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
// Live spreads only: archived spreads carry negative page numbers and page_type 'archived-spread'.
const allPages = await db.collection('pages')
  .find({ book_id: bookId, page_number: { $gt: 0 }, page_type: { $ne: 'archived-spread' } })
  .sort({ page_number: 1 }).toArray();
if (!allPages.length) { console.error(`no live pages for ${bookId}`); process.exit(1); }
if (allPages.some((p) => p.split_from_spread || p.split_from)) {
  console.error(`${bookId} is already split (split_from_spread / split_from on its pages) — refusing`);
  process.exit(1);
}

if (mode === 'refine') await refine(...rest);
else await sheets(...rest);
await client.close();

async function sheets(OUT, posFile, pos2File, onlyFile) {
  if (!OUT) throw new Error('outdir required');
  if (mode === 'verify' && !posFile) throw new Error('verify needs positions.json');
  mkdirSync(OUT, { recursive: true });
  const POS = posFile ? readJson(posFile) : {};
  const POS2 = pos2File ? readJson(pos2File) : null;
  const ONLY = onlyFile ? new Set(readJson(onlyFile).map(String)) : null;
  const pages = allPages.filter((p) => !ONLY || ONLY.has(String(p.page_number)));
  const [L, R] = mode === 'place' ? [38, 62] : [E('FS_L', 44), E('FS_R', 56)];
  const TW = E('FS_TW', 1000), TH = E('FS_TH', mode === 'place' ? 240 : 200);
  const PER = E('FS_PER', mode === 'place' ? 10 : 20), COLS = E('FS_COLS', mode === 'place' ? 1 : 2);
  const px = (pct) => Math.round((pct - L) / (R - L) * TW);

  const tile = async (p) => {
    const buf = await fetchImage(p);
    const { width: w, height: h } = await sharp(buf).metadata();
    const band = await sharp(buf)
      .extract({ left: Math.round(w * L / 100), top: Math.round(h * 0.25), width: Math.round(w * (R - L) / 100), height: Math.round(h * 0.5) })
      .resize({ width: TW, height: TH, fit: 'fill' }).toBuffer();
    let svg = `<rect x="0" y="0" width="120" height="30" fill="white"/><text x="4" y="24" font-size="24" font-weight="bold" fill="black">p${p.page_number}</text>`;
    if (mode === 'place') {
      for (let t = L * 2; t <= R * 2; t++) {
        const pct = t / 2, x = px(pct), whole = t % 2 === 0;
        svg += `<line x1="${x}" y1="${TH - (whole ? 34 : 16)}" x2="${x}" y2="${TH}" stroke="${pct === 50 ? 'red' : 'blue'}" stroke-width="${whole ? 2 : 1}"/>`;
        if (whole) svg += `<rect x="${x - 13}" y="${TH - 58}" width="26" height="22" fill="white"/><text x="${x - 12}" y="${TH - 40}" font-size="18" fill="blue">${pct}</text>`;
      }
    } else {
      const f2 = POS2?.[p.page_number];
      if (f2 != null) svg += `<line x1="${px(f2)}" y1="0" x2="${px(f2)}" y2="${TH}" stroke="blue" stroke-width="2" stroke-dasharray="8,6"/>`;
      const f = POS[p.page_number];
      if (f != null) svg += `<line x1="${px(f)}" y1="0" x2="${px(f)}" y2="${TH}" stroke="red" stroke-width="2"/><rect x="${TW - 110}" y="0" width="110" height="28" fill="white"/><text x="${TW - 106}" y="22" font-size="20" fill="red">${f}</text>`;
      else svg += `<rect x="${TW - 150}" y="0" width="150" height="28" fill="yellow"/><text x="${TW - 146}" y="22" font-size="20">NO SPLIT</text>`;
    }
    return sharp(band).composite([{ input: Buffer.from(`<svg width="${TW}" height="${TH}">${svg}</svg>`), top: 0, left: 0 }]).png().toBuffer();
  };

  const index = [];
  for (let s = 0; s * PER < pages.length; s++) {
    const chunk = pages.slice(s * PER, (s + 1) * PER);
    const tiles = [];
    for (let i = 0; i < chunk.length; i += 5) tiles.push(...await Promise.all(chunk.slice(i, i + 5).map(tile)));
    const rows = Math.ceil(tiles.length / COLS);
    const name = `sheet-${String(s + 1).padStart(3, '0')}.jpg`;
    await sharp({ create: { width: TW * COLS + (COLS - 1) * 10, height: rows * (TH + 8), channels: 3, background: 'white' } })
      .composite(tiles.map((t, i) => ({ input: t, left: (i % COLS) * (TW + 10), top: Math.floor(i / COLS) * (TH + 8) })))
      .jpeg({ quality: 82 }).toFile(`${OUT}/${name}`);
    index.push({ sheet: name, pages: chunk.map((p) => p.page_number) });
    process.stdout.write(`${name} `);
  }
  writeFileSync(`${OUT}/index.json`, JSON.stringify(index));
  console.log(`\n${index.length} sheets -> ${OUT} (index.json maps sheet -> page numbers)`);
}

// Column mean luminance over the middle 80% of the height, smoothed over ~0.3% of the width;
// the darkest point within ±1% of the placed fold wins if it is ≥ 15 levels below the window median.
async function refine(inF, outF) {
  if (!inF || !outF) throw new Error('refine needs <positions.json> <out.json>');
  const POS = readJson(inF);
  const out = {}, log = [];
  const one = async (p) => {
    const key = String(p.page_number);
    if (!(key in POS)) return; // unreviewed: leave it absent so split-book stops on it
    const placed = POS[key];
    if (placed == null) { out[key] = null; return; }
    const { data, info } = await sharp(await fetchImage(p)).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const x0 = Math.max(0, Math.round((placed - 1) / 100 * w)), x1 = Math.min(w - 1, Math.round((placed + 1) / 100 * w));
    const y0 = Math.round(h * 0.1), y1 = Math.round(h * 0.9);
    const col = [];
    for (let x = x0; x <= x1; x++) { let s = 0; for (let y = y0; y < y1; y += 2) s += data[y * w + x]; col.push(s / Math.ceil((y1 - y0) / 2)); }
    const k = Math.max(2, Math.round(w * 0.0015));
    const sm = col.map((_, i) => { let s = 0, n = 0; for (let j = i - k; j <= i + k; j++) if (j >= 0 && j < col.length) { s += col[j]; n++; } return s / n; });
    let mi = 0; for (let i = 1; i < sm.length; i++) if (sm[i] < sm[mi]) mi = i;
    const med = [...sm].sort((a, b) => a - b)[Math.floor(sm.length / 2)];
    const snapped = med - sm[mi] >= 15 ? +(((x0 + mi) / w) * 100).toFixed(2) : placed;
    out[key] = snapped;
    log.push({ page: p.page_number, placed, snapped, contrast: Math.round(med - sm[mi]) });
  };
  for (let i = 0; i < allPages.length; i += 6) await Promise.all(allPages.slice(i, i + 6).map(one));
  const missing = allPages.filter((p) => !(String(p.page_number) in POS)).length;
  writeFileSync(outF, JSON.stringify(out));
  writeFileSync(outF.replace(/\.json$/, '') + '-log.json', JSON.stringify(log));
  const d = log.filter((r) => r.snapped !== r.placed).map((r) => r.snapped - r.placed);
  console.log(`refined ${log.length}; moved ${d.length}; mean shift ${(d.reduce((a, b) => a + b, 0) / (d.length || 1)).toFixed(2)}; |shift|>0.6: ${d.filter((x) => Math.abs(x) > 0.6).length}; kept (low contrast) ${log.length - d.length}; pages with no placed entry: ${missing}`);
}
