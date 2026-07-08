#!/usr/bin/env node
/**
 * Audit which BPH old-era crop books ACTUALLY clip text at the gutter (issue #2898).
 *
 * The zero-overlap crop is a LATENT defect across the whole ~1,230-book cohort,
 * but it only causes VISIBLE harm where content actually reaches the gutter
 * (right-margin numeral columns, catchwords, long line-ends). This audit finds
 * the subset with real clipping so the re-crop sweep (recrop-bph-gutter.mjs) can
 * target them instead of blanket-reprocessing every book.
 *
 * Method (reuses the ink-density primitive from scripts/lib/gutter-detect.mjs /
 * batch-split-bph.mjs): for each sampled half, resize the FULL spread to 1000px
 * wide (so column index == per-mille), and for each column count the fraction of
 * central-band rows (y 25%–75%, skips header/footer) where min(R,G,B) < 120 (ink,
 * incl. colored rubrication). Then measure ink in the band JUST OUTSIDE the
 * current cut — the region a widen of `--overlap` would recover:
 *   left half  (xStart 0, cut c=xEnd):   band [c, c+overlap]
 *   right half (xEnd 1000, cut c=xStart): band [c-overlap, c]
 * If that band carries ink, we're clipping text. Per-page severity = max column
 * ink density in the band; "reach" = furthest per-mille past the cut with ink.
 *
 * Read-only. Iterates the cohort PER BOOK (the global unindexed `crop` scan times
 * out). Anchor: held_by:'bph' ∩ per-book pages with crop + cropped_photo + not
 * split_from_spread.
 *
 * Run:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/audit-bph-gutter-clip.mjs --limit 50 --html /tmp/gutter-clip.html
 *   node scripts/maintenance/audit-bph-gutter-clip.mjs --out /tmp/gutter-clip.json
 *   node scripts/maintenance/audit-bph-gutter-clip.mjs --ids-file /tmp/ids.json
 *
 * Options:
 *   --ids-file PATH   Audit only these book ids (JSON array). Default: full BPH cohort.
 *   --samples N       Pages sampled per book (default 8)
 *   --overlap N       Per-mille recover band width to test (default 35, matches the fix)
 *   --ink-thresh F    Column ink-density flag threshold (default 0.04 = 4% of rows)
 *   --clip-frac F     Book flagged when this fraction of sampled pages clip (default 0.15)
 *   --limit N         Audit at most N books
 *   --out PATH        Write ranked JSON (default /tmp/gutter-clip.json)
 *   --html PATH       Also write a visual HTML gallery (optional)
 *   --concurrency N   Books processed in parallel (default 4)
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { writeFileSync, readFileSync } from 'fs';

const argVal = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const IDS_FILE = argVal('--ids-file', null);
const SAMPLES = parseInt(argVal('--samples', '8'), 10);
const OVERLAP = parseInt(argVal('--overlap', '35'), 10);
const INK_THRESH = parseFloat(argVal('--ink-thresh', '0.04'));
const CLIP_FRAC = parseFloat(argVal('--clip-frac', '0.15'));
const LIMIT = parseInt(argVal('--limit', '0'), 10);
const OUT = argVal('--out', '/tmp/gutter-clip.json');
const HTML = argVal('--html', null);
const CONCURRENCY = parseInt(argVal('--concurrency', '4'), 10);

const CROP_FILTER = {
  'crop.xStart': { $exists: true },
  cropped_photo: { $exists: true, $ne: null },
  split_from_spread: { $ne: true },
};

async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function fullSpreadSource(page) {
  const a = page.archived_photo;
  if (typeof a === 'string' && a.startsWith('http')) return a;
  const o = page.photo_original;
  if (typeof o === 'string' && o.startsWith('http')) return o;
  return null;
}

// Per-mille ink density: resize spread to width 1000 so column x === per-mille.
async function inkPerMille(buf) {
  const W = 1000;
  const meta = await sharp(buf).metadata();
  const H = Math.round((meta.height || 1) * (W / (meta.width || 1)));
  const raw = await sharp(buf).resize(W, H, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const y0 = Math.round(H * 0.25), y1 = Math.round(H * 0.75);
  const rows = y1 - y0;
  const ink = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let d = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * W + x) * 3;
      if (Math.min(raw[i], raw[i + 1], raw[i + 2]) < 120) d++;
    }
    ink[x] = d / rows;
  }
  return ink;
}

// Measure the recover-band just outside the cut. Returns severity (max col ink),
// mean ink, and reach (furthest per-mille past the cut with ink >= thresh).
function measureBand(ink, crop) {
  let lo, hi; // inclusive per-mille range of the recover band
  if (crop.xStart === 0 && crop.xEnd < 1000) { lo = crop.xEnd; hi = Math.min(999, crop.xEnd + OVERLAP); }
  else if (crop.xEnd === 1000 && crop.xStart > 0) { lo = Math.max(0, crop.xStart - OVERLAP); hi = crop.xStart; }
  else return null; // undetermined side
  const cut = crop.xStart === 0 ? crop.xEnd : crop.xStart;
  let max = 0, sum = 0, n = 0, reach = 0;
  for (let x = lo; x <= hi; x++) {
    const v = ink[x] || 0;
    max = Math.max(max, v); sum += v; n++;
    if (v >= INK_THRESH) reach = Math.max(reach, Math.abs(x - cut));
  }
  return { max, mean: n ? sum / n : 0, reach, band: [lo, hi], cut, side: crop.xStart === 0 ? 'L' : 'R' };
}

async function auditBook(db, book) {
  const pages = await db.collection('pages').find(
    { book_id: book.id, ...CROP_FILTER },
    { projection: { id: 1, page_number: 1, crop: 1, archived_photo: 1, photo_original: 1 } },
  ).sort({ page_number: 1 }).toArray();
  if (pages.length === 0) return null;

  // Evenly spaced sample across the book.
  const k = Math.min(SAMPLES, pages.length);
  const idxs = [...new Set(Array.from({ length: k }, (_, i) => Math.floor(((i + 1) / (k + 1)) * pages.length)))];

  const perPage = [];
  for (const idx of idxs) {
    const p = pages[idx];
    const src = fullSpreadSource(p);
    if (!src) continue;
    try {
      const ink = await inkPerMille(await fetchImage(src));
      const m = measureBand(ink, p.crop);
      if (m) perPage.push({ page_number: p.page_number, page_id: p.id, crop: p.crop, ...m, clipped: m.max >= INK_THRESH });
    } catch { /* skip unfetchable sample */ }
  }
  if (perPage.length === 0) return null;

  const clipped = perPage.filter(s => s.clipped);
  const clipFrac = clipped.length / perPage.length;
  // Severity: fraction clipped × mean ink of clipped pages × max reach — a book
  // that clips most pages, with dense ink, far past the cut ranks highest.
  const meanClipInk = clipped.length ? clipped.reduce((a, s) => a + s.max, 0) / clipped.length : 0;
  const maxReach = perPage.reduce((a, s) => Math.max(a, s.reach), 0);
  const severity = +(clipFrac * meanClipInk * (1 + maxReach / OVERLAP)).toFixed(4);

  return {
    book_id: book.id, slug: book.slug, title: book.title,
    totalCropPages: pages.length, sampled: perPage.length,
    clippedPages: clipped.length, clipFrac: +clipFrac.toFixed(3),
    meanClipInk: +meanClipInk.toFixed(3), maxReach, severity,
    flagged: clipFrac >= CLIP_FRAC,
    samples: perPage,
  };
}

async function parallelMap(items, fn, concurrency) {
  const out = []; let i = 0;
  const worker = async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  let books;
  if (IDS_FILE) {
    const ids = JSON.parse(readFileSync(IDS_FILE, 'utf8'));
    books = await db.collection('books').find({ id: { $in: ids } }, { projection: { id: 1, slug: 1, title: 1 } }).toArray();
  } else {
    // Full BPH cohort. Per-book crop-page check happens in auditBook (indexed by book_id).
    books = await db.collection('books').find(
      { held_by: 'bph' },
      { projection: { id: 1, slug: 1, title: 1 } },
    ).toArray();
  }
  if (LIMIT > 0) books = books.slice(0, LIMIT);
  console.error(`Auditing ${books.length} books (samples ${SAMPLES}, overlap ${OVERLAP}‰, ink-thresh ${INK_THRESH}, clip-frac ${CLIP_FRAC})`);

  let done = 0;
  const results = (await parallelMap(books, async (book) => {
    const r = await auditBook(db, book).catch(e => ({ book_id: book.id, error: e.message }));
    if (++done % 25 === 0) console.error(`  ${done}/${books.length}`);
    return r;
  }, CONCURRENCY)).filter(Boolean);

  const audited = results.filter(r => !r.error && r.sampled);
  audited.sort((a, b) => b.severity - a.severity);
  const flagged = audited.filter(r => r.flagged);

  writeFileSync(OUT, JSON.stringify({
    generated_for: 'issue-2898', overlap: OVERLAP, ink_thresh: INK_THRESH, clip_frac: CLIP_FRAC,
    booksAudited: audited.length, booksWithCropPages: audited.length, flaggedCount: flagged.length,
    flaggedBookIds: flagged.map(r => r.book_id),
    results: audited,
  }, null, 2));
  console.error(`\nAudited ${audited.length} cohort books · ${flagged.length} flagged (clipFrac ≥ ${CLIP_FRAC}) · wrote ${OUT}`);
  console.error(`Top flagged:`);
  for (const r of flagged.slice(0, 15)) {
    console.error(`  sev ${r.severity}  clip ${r.clippedPages}/${r.sampled} (${(r.clipFrac * 100).toFixed(0)}%)  reach ${r.maxReach}‰  ${r.book_id}  ${(r.title || '').slice(0, 45)}`);
  }

  if (HTML) writeFileSync(HTML, renderHtml(audited, flagged));
  await client.close();
}

function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function renderHtml(audited, flagged) {
  const row = (r) => `<tr class="${r.flagged ? 'flag' : ''}">
    <td>${r.severity}</td><td>${r.clippedPages}/${r.sampled} (${(r.clipFrac * 100).toFixed(0)}%)</td>
    <td>${r.maxReach}‰</td><td>${r.meanClipInk}</td><td>${r.totalCropPages}</td>
    <td><a href="https://sourcelibrary.org/book/${esc(r.slug || r.book_id)}" target="_blank">${esc((r.title || '').slice(0, 60))}</a></td>
    <td class="mono">${esc(r.book_id)}</td></tr>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>BPH gutter-clip audit (#2898)</title><style>
    body{font-family:system-ui;background:#1a1a1a;color:#ddd;padding:20px;max-width:1400px;margin:0 auto}
    h1{color:#e8c87a} table{border-collapse:collapse;width:100%;font-size:13px} th,td{padding:5px 9px;border-bottom:1px solid #333;text-align:left}
    th{color:#e8c87a} tr.flag{background:#2a2318} a{color:#7ab6e8} .mono{font-family:ui-monospace;color:#888;font-size:11px}
  </style></head><body>
  <h1>BPH gutter-clip audit — #2898</h1>
  <p>${audited.length} cohort books audited · <b>${flagged.length} flagged</b> (clipFrac ≥ ${CLIP_FRAC}). Severity = clipFrac × meanClipInk × (1 + reach/overlap). Higher = worse.</p>
  <table><thead><tr><th>severity</th><th>clipped</th><th>reach</th><th>meanInk</th><th>cropPages</th><th>title</th><th>book_id</th></tr></thead>
  <tbody>${audited.map(row).join('')}</tbody></table></body></html>`;
}

main().catch(e => { console.error(e); process.exit(1); });
