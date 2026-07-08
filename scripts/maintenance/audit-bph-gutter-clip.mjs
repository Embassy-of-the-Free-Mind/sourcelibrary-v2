#!/usr/bin/env node
/**
 * GUTTER-AWARE audit of which BPH old-era crop books ACTUALLY clip text at the
 * gutter (issue #3088, follow-up to #2898).
 *
 * The zero-overlap crop is a LATENT defect across the whole ~1,200-book cohort,
 * but it only causes VISIBLE harm where left-page content actually reaches past
 * the cut toward the binding (right-margin numeral columns, catchwords, long
 * line-ends). This audit finds that subset so the re-crop sweep
 * (recrop-bph-gutter.mjs) targets confirmed clipping instead of blanket-widening
 * every book (which would pull binding shadow + the facing page into tight books).
 *
 * ── Why the old audit was untrustworthy (superseded) ──
 * v1 measured raw ink (min(R,G,B)<120) in a fixed band just past the cut and
 * flagged anything dark → over-flagged ~97% of the cohort, because raw ink can't
 * tell CLIPPED TEXT from (a) the BINDING SHADOW of a tight book (saturates ~1.0;
 * text tops out lower because line leading leaves white rows) or (b) FACING-PAGE
 * bleed past the gutter. This version is gutter-aware: it locates the true gutter
 * per page and counts only text-like ink BETWEEN the cut and the gutter. See
 * scripts/lib/gutter-clip.mjs for the geometry + tunables (shared with the recrop).
 *
 * Read-only. Iterates the cohort PER BOOK (the global unindexed `crop` scan times
 * out). Anchor: held_by:'bph' ∩ per-book pages with crop + cropped_photo + not
 * split_from_spread.
 *
 * Run:
 *   set -a; source .env.production.local; set +a   # or .env.local for a local read-only run
 *   node scripts/maintenance/audit-bph-gutter-clip.mjs --limit 50 --html /tmp/gutter-clip.html
 *   node scripts/maintenance/audit-bph-gutter-clip.mjs --out /tmp/gutter-clip.json
 *   node scripts/maintenance/audit-bph-gutter-clip.mjs --ids-file /tmp/ids.json
 *   node scripts/maintenance/audit-bph-gutter-clip.mjs --profile <bookId>   # per-page geometry dump (tuning)
 *
 * Options:
 *   --ids-file PATH   Audit only these book ids (JSON array). Default: full BPH cohort.
 *   --samples N       Pages sampled per book (default 8)
 *   --clip-frac F     Book flagged when this fraction of sampled pages clip (default 0.15)
 *   --limit N         Audit at most N books
 *   --out PATH        Write ranked JSON (default /tmp/gutter-clip.json)
 *   --html PATH       Also write a visual eye-check HTML gallery (optional)
 *   --concurrency N   Books processed in parallel (default 4)
 *   --profile BOOKID  Debug: dump per-page cut/gutter/recover profile for one book, exit
 *   --min-recover N   Override text-‰ needed before the gutter to count a page (default 3)
 *   --gutter-win N    Override ‰ each side of the cut searched for the gutter (default 60)
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync } from 'fs';
import { spreadProfile, measureClip, cropSide, DEFAULTS } from '../lib/gutter-clip.mjs';

const argVal = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const IDS_FILE = argVal('--ids-file', null);
const SAMPLES = parseInt(argVal('--samples', '8'), 10);
const CLIP_FRAC = parseFloat(argVal('--clip-frac', '0.15'));
const LIMIT = parseInt(argVal('--limit', '0'), 10);
const OUT = argVal('--out', '/tmp/gutter-clip.json');
const HTML = argVal('--html', null);
const CONCURRENCY = parseInt(argVal('--concurrency', '4'), 10);
const PROFILE = argVal('--profile', null);

const CLIP_OPTS = {
  MIN_RECOVER: parseInt(argVal('--min-recover', String(DEFAULTS.MIN_RECOVER)), 10),
  GUTTER_WIN: parseInt(argVal('--gutter-win', String(DEFAULTS.GUTTER_WIN)), 10),
};

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

// The UNCROPPED full spread — never cropped_photo/photo (those are the half).
function fullSpreadSource(page) {
  const a = page.archived_photo;
  if (typeof a === 'string' && a.startsWith('http')) return a;
  const o = page.photo_original;
  if (typeof o === 'string' && o.startsWith('http')) return o;
  return null;
}

async function samplePages(db, book) {
  const pages = await db.collection('pages').find(
    { book_id: book.id, ...CROP_FILTER },
    { projection: { id: 1, page_number: 1, crop: 1, archived_photo: 1, photo_original: 1 } },
  ).sort({ page_number: 1 }).toArray();
  return pages;
}

async function auditBook(db, book) {
  const pages = await samplePages(db, book);
  if (pages.length === 0) return null;

  // Evenly spaced sample across the book.
  const k = Math.min(SAMPLES, pages.length);
  const idxs = [...new Set(Array.from({ length: k }, (_, i) => Math.floor(((i + 1) / (k + 1)) * pages.length)))];

  const perPage = [];
  for (const idx of idxs) {
    const p = pages[idx];
    if (!cropSide(p.crop)) continue; // indeterminate side — skip
    const src = fullSpreadSource(p);
    if (!src) continue;
    try {
      const prof = await spreadProfile(await fetchImage(src));
      const m = measureClip(prof, p.crop, CLIP_OPTS);
      if (m) perPage.push({ page_number: p.page_number, page_id: p.id, crop: p.crop, spread: HTML ? src : undefined, ...m });
    } catch { /* skip unfetchable sample */ }
  }
  if (perPage.length === 0) return null;

  const clipped = perPage.filter(s => s.clipped);
  const clipFrac = clipped.length / perPage.length;
  const meanRecoverInk = clipped.length ? clipped.reduce((a, s) => a + s.recoverInkMax, 0) / clipped.length : 0;
  const maxReach = perPage.reduce((a, s) => Math.max(a, s.reach), 0);
  const shadowPages = perPage.filter(s => s.gutterKind === 'shadow').length;
  const noGutterPages = perPage.filter(s => s.gutterKind === 'none').length;
  // Severity: fraction clipped × mean recoverable ink × (1 + reach depth). A book
  // that clips most pages, with dense text, far past the cut, ranks highest.
  const severity = +(clipFrac * meanRecoverInk * (1 + maxReach / CLIP_OPTS.GUTTER_WIN)).toFixed(4);

  return {
    book_id: book.id, slug: book.slug, title: book.title,
    totalCropPages: pages.length, sampled: perPage.length,
    clippedPages: clipped.length, clipFrac: +clipFrac.toFixed(3),
    meanRecoverInk: +meanRecoverInk.toFixed(3), maxReach, severity,
    shadowFrac: +(shadowPages / perPage.length).toFixed(2),
    noGutterFrac: +(noGutterPages / perPage.length).toFixed(2),
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

// ── Debug: dump per-page geometry for one book so thresholds can be eye-tuned ──
async function profileBook(db, bookId) {
  const book = await db.collection('books').findOne(
    { $or: [{ id: bookId }, { slug: bookId }] }, { projection: { id: 1, slug: 1, title: 1 } });
  if (!book) { console.error(`book ${bookId} not found`); return; }
  const pages = await samplePages(db, book);
  console.log(`# ${book.id} "${(book.title || '').slice(0, 60)}" — ${pages.length} crop pages`);
  console.log(`# gutter-win ${CLIP_OPTS.GUTTER_WIN}‰  min-recover ${CLIP_OPTS.MIN_RECOVER}‰`);
  const k = Math.min(SAMPLES, pages.length);
  const idxs = [...new Set(Array.from({ length: k }, (_, i) => Math.floor(((i + 1) / (k + 1)) * pages.length)))];
  for (const idx of idxs) {
    const p = pages[idx];
    const sc = cropSide(p.crop);
    if (!sc) { console.log(`p${p.page_number}: crop ${JSON.stringify(p.crop)} — indeterminate side`); continue; }
    const src = fullSpreadSource(p);
    if (!src) { console.log(`p${p.page_number}: no full spread`); continue; }
    try {
      const prof = await spreadProfile(await fetchImage(src));
      const m = measureClip(prof, p.crop, CLIP_OPTS);
      // Print the ink profile in the walk window for eyeballing.
      const dir = m.side === 'L' ? 1 : -1;
      const strip = [];
      for (let s = 0; s <= Math.min(CLIP_OPTS.GUTTER_WIN, 40); s += 2) {
        const x = m.cut + dir * s;
        if (x < 0 || x >= prof.W) break;
        strip.push(prof.ink[x].toFixed(2));
      }
      console.log(
        `p${p.page_number} [${m.side}] cut ${m.cut} gutter ${m.gutter}(${m.gutterKind}) ` +
        `recover ${m.recoverWidth}‰ ink ${m.recoverInkMax} reach ${m.reach}‰ ` +
        `${m.clipped ? 'CLIP' : '·'}  ink→ ${strip.join(' ')}`);
    } catch (e) { console.log(`p${p.page_number}: err ${e.message}`); }
  }
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  if (PROFILE) { await profileBook(db, PROFILE); await client.close(); return; }

  let books;
  if (IDS_FILE) {
    const ids = JSON.parse(readFileSync(IDS_FILE, 'utf8'));
    books = await db.collection('books').find({ id: { $in: ids } }, { projection: { id: 1, slug: 1, title: 1 } }).toArray();
  } else {
    books = await db.collection('books').find(
      { held_by: 'bph' }, { projection: { id: 1, slug: 1, title: 1 } }).toArray();
  }
  if (LIMIT > 0) books = books.slice(0, LIMIT);
  console.error(`Auditing ${books.length} books (samples ${SAMPLES}, gutter-win ${CLIP_OPTS.GUTTER_WIN}‰, min-recover ${CLIP_OPTS.MIN_RECOVER}‰, clip-frac ${CLIP_FRAC})`);

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
    generated_for: 'issue-3088', method: 'gutter-aware', clip_frac: CLIP_FRAC,
    gutter_win: CLIP_OPTS.GUTTER_WIN, min_recover: CLIP_OPTS.MIN_RECOVER,
    booksAudited: audited.length, flaggedCount: flagged.length,
    flaggedBookIds: flagged.map(r => r.book_id),
    results: audited,
  }, null, 2));
  console.error(`\nAudited ${audited.length} cohort books · ${flagged.length} flagged (clipFrac ≥ ${CLIP_FRAC}) · wrote ${OUT}`);
  console.error(`Top flagged:`);
  for (const r of flagged.slice(0, 15)) {
    console.error(`  sev ${r.severity}  clip ${r.clippedPages}/${r.sampled} (${(r.clipFrac * 100).toFixed(0)}%)  reach ${r.maxReach}‰  shadow ${r.shadowFrac}  ${r.book_id}  ${(r.title || '').slice(0, 42)}`);
  }

  if (HTML) writeFileSync(HTML, renderHtml(audited, flagged));
  await client.close();
}

function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Embed the full spread with the cut (red) and detected gutter (green) drawn as
// absolutely-positioned lines at their per-mille % — a true visual eye-check with
// no server-side compositing. The recover band (cut↔gutter) is tinted so a human
// can confirm the flagged content is real page text, not shadow or the facing page.
function spreadFig(s) {
  if (!s.spread) return '';
  const cutPct = (s.cut / 10).toFixed(1);
  const gutPct = s.gutter != null ? (s.gutter / 10).toFixed(1) : null;
  const bandLeft = Math.min(s.cut, s.gutter ?? s.cut) / 10;
  const bandW = Math.abs((s.gutter ?? s.cut) - s.cut) / 10;
  const band = gutPct != null && bandW > 0
    ? `<span class="band" style="left:${bandLeft}%;width:${bandW}%"></span>` : '';
  const gut = gutPct != null ? `<span class="gut" style="left:${gutPct}%" title="gutter ${s.gutter} (${s.gutterKind})"></span>` : '';
  return `<figure class="${s.clipped ? 'clip' : ''}">
    <div class="img"><img loading="lazy" src="${esc(s.spread)}">${band}
      <span class="cut" style="left:${cutPct}%" title="cut ${s.cut}"></span>${gut}</div>
    <figcaption>p${s.page_number} <b>${s.side}</b> cut ${s.cut}→gut ${s.gutter ?? '—'}(${s.gutterKind})
      ${s.clipped ? `<b class="y">+${s.recoverWidth}‰ @${s.recoverInkMax}</b>` : `<span class="n">·</span>`}</figcaption>
  </figure>`;
}

function renderHtml(audited, flagged) {
  // For flagged books, render every sampled spread (clipped first) with overlays.
  const bookBlock = (r) => {
    const samps = [...(r.samples || [])].sort((a, b) => (b.clipped - a.clipped) || (b.recoverWidth - a.recoverWidth));
    return `<section class="book">
      <h2><a href="https://sourcelibrary.org/book/${esc(r.slug || r.book_id)}" target="_blank">${esc((r.title || '').slice(0, 70))}</a></h2>
      <div class="meta">sev ${r.severity} · clip ${r.clippedPages}/${r.sampled} (${(r.clipFrac * 100).toFixed(0)}%) · reach ${r.maxReach}‰ · recoverInk ${r.meanRecoverInk} · shadow ${r.shadowFrac} · noGut ${r.noGutterFrac} · <span class="mono">${esc(r.book_id)}</span></div>
      <div class="grid">${samps.map(spreadFig).join('')}</div>
    </section>`;
  };
  const row = (r) => `<tr class="${r.flagged ? 'flag' : ''}">
    <td>${r.severity}</td><td>${r.clippedPages}/${r.sampled} (${(r.clipFrac * 100).toFixed(0)}%)</td>
    <td>${r.maxReach}‰</td><td>${r.meanRecoverInk}</td><td>${r.shadowFrac}</td><td>${r.noGutterFrac}</td><td>${r.totalCropPages}</td>
    <td>${esc((r.title || '').slice(0, 55))}</td><td class="mono">${esc(r.book_id)}</td></tr>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>BPH gutter-clip audit (#3088)</title><style>
    body{font-family:system-ui;background:#1a1a1a;color:#ddd;padding:20px;max-width:1500px;margin:0 auto}
    h1,h2{color:#e8c87a} h2{font-size:16px;margin:0 0 3px} table{border-collapse:collapse;width:100%;font-size:13px} th,td{padding:5px 9px;border-bottom:1px solid #333;text-align:left;vertical-align:top}
    th{color:#e8c87a} tr.flag{background:#2a2318} a{color:#7ab6e8} .mono{font-family:ui-monospace;color:#888;font-size:11px}
    .book{margin:26px 0;padding-top:14px;border-top:2px solid #333} .meta{font-size:12px;color:#aaa;margin-bottom:8px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
    figure{margin:0;background:#111;border:1px solid #333;border-radius:5px;overflow:hidden} figure.clip{border-color:#7a5}
    .img{position:relative;line-height:0} .img img{width:100%;display:block}
    .cut{position:absolute;top:0;bottom:0;width:2px;background:#e44;box-shadow:0 0 3px #e44}
    .gut{position:absolute;top:0;bottom:0;width:2px;background:#4d4;box-shadow:0 0 3px #4d4}
    .band{position:absolute;top:0;bottom:0;background:rgba(230,200,60,.28)}
    figcaption{font-size:11px;padding:4px 6px;color:#ccc} .y{color:#9d6} .n{color:#666}
  </style></head><body>
  <h1>BPH gutter-clip audit — #3088 (gutter-aware)</h1>
  <p>${audited.length} cohort books audited · <b>${flagged.length} flagged</b> (clipFrac ≥ ${CLIP_FRAC}).
  Overlays: <b style="color:#e44">red</b> = current cut, <b style="color:#4d4">green</b> = detected gutter,
  <b style="color:#e6c83c">yellow band</b> = recoverable content between them. A flag is real when the band covers page text — not binding shadow or the facing page.</p>
  <h2>Flagged books — visual eye-check</h2>
  ${flagged.map(bookBlock).join('')}
  <h2 style="margin-top:40px">All audited (ranked)</h2>
  <table><thead><tr><th>severity</th><th>clipped</th><th>reach</th><th>recoverInk</th><th>shadow%</th><th>noGut%</th><th>cropPages</th><th>title</th><th>book_id</th></tr></thead>
  <tbody>${audited.map(row).join('')}</tbody></table></body></html>`;
}

main().catch(e => { console.error(e); process.exit(1); });
