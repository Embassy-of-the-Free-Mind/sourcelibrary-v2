#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/paddle-zh-lane.mjs (#5600 — plan / apply / status for the Paddle SKQS lane: hold before
 * the first write, human-edit guard in the loop, loop guards, textless reads never stored, staleness stamp, recount,
 * sweep_log + one book_events row; followed step for step) and scripts/eval/paddle-split-6101.mjs (#7184 — the crop
 * and split, run here per page in `prep`). Neither fits as is: #5600 takes a fixed SKQS cohort and reads whole
 * pages; #7184 is an eval over 198 local JPEGs. Writes go through writePageText (#7058), which #5600 predates.
 *
 * The Paddle split-leaf PRINT lane (#6101). Policy, guards, conversions and the ocr field: scripts/lib/paddle-print-lane.mjs.
 * The GPU half is scripts/gpu/paddle-print-gpu.sh (a gpu-queue task on gex45 running scripts/gpu/paddle-zh-run.py).
 *
 *   census   READ-ONLY. Every Chinese / Japanese book with pages; excludes the Siku Quanshu manuscript cohort (title
 *            四庫, the #5600 / #6388 / #5660 holds, or ≥ 30 % of stored pages carrying 四庫全書), books held for any
 *            other reason, the cursive Japanese books (NDL lane, cursive census), Meiji typeset and manuscripts where
 *            a class is known; per page the stored reading → read / keep (storedPolicy), spread or single leaf.
 *            Writes census.json + frame-books.json (books with pages to read, and whether their class is known).
 *   plan     per frame book (--books <file of ids> or frame-books.json `ok` books): HOLD it (paddle-print-6101), then
 *            list the pages to read → plan/<bid>.json. Dry unless --apply. A book held for another reason is skipped.
 *   prep     per planned book: fetch each page image, crop NDL's ruler + label strip (NDL books only), split a spread
 *            at the gutter, measure each leaf's ink; blank leaves are recorded and not sent. Writes prep/<bid>.json
 *            and appends the leaves to manifest.tsv (<bid>\t<pn>-<side>\t<url>\t<x0,y0,x1,y1>). No Mongo writes.
 *   recheck  list the read leaves with < 60 Han + kana (SHORT_LEAF) → recheck/manifest.tsv; the GPU task reads them
 *            again at a 1,200 px long side (ROOT=$J/recheck MAX_SIDE=1200) and apply writes a page only if they agree.
 *   apply    per book whose every non-blank leaf is back from the box (out/<bid>/<pn>-<side>.txt|.err): assemble each
 *            page (leaf guards), re-check the stored reading and the hold, write through writePageText (revision row
 *            with the whole prior field, CAS, human-edit guard), mark English stale, recount, sweep_log before and
 *            after, one book_events row. Dry unless --apply.
 *   status   counts from the files.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/workers/paddle-print-lane.mjs census
 * Options: --dir <lane dir> (default $LANE_DIR or /root/jobs/paddle-print-6101)  --book <id>  --limit N
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../lib/mongo.mjs';
import { recordLoopRefusal } from '../lib/ocr-loop-guard.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { holdBook, isHeld } from '../lib/pipeline-hold.mjs';
import { recordFailedReads, fromErrFile, fromTextless } from '../lib/ocr-failed-read.mjs';
import {
  LANE, LANE_ISSUE, HOLD_REASON, HOLD_RELEASE, BOOK_EVENT, PADDLE, INK_BLANK, OVERLAP,
  storedPolicy, isSpread, innerInk, assemblePage, envelope, ocrField, writeLanePage, laneLanguage, isHumanEdited, markTranslationsStale, coversLite, leafChars, SHORT_LEAF, kanaShare, MAX_KANA_SHARE, bookMedians, dittoDropped,
} from '../lib/paddle-print-lane.mjs';
import { workTitleOf } from '../lib/paddle-zh-lane.mjs';

const argv = process.argv.slice(2);
const CMD = argv[0];
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const DIR = arg('--dir', process.env.LANE_DIR || '/root/jobs/paddle-print-6101');
const APPLY = flag('--apply');
const BOOK = arg('--book', null);
const LIMIT = Number(arg('--limit', 0)) || 0;

const ZH_LANGS = new Set(['Chinese', 'Classical Chinese', 'Chinese; Chinese (script)', 'Chinese (script); Chinese']);
const JA_LANGS = new Set(['Japanese', 'Classical Chinese / Japanese', 'Japanese; Chinese']);
/** Holds that mark the Siku Quanshu manuscript cohorts (#5600, #6388, the #5660 residue). */
const SIKU_HOLDS = /^(paddle-zh-5600-ocr-only|paddle-zh-6388-ocr-only|paddle-zh-6388-excluded|gpu-backlog-5660)$/;
const SIKU_COHORT = '/root/preview-stubs-4719/ids-chinese-held-5481.txt';
const CURSIVE_CENSUS = new URL('../eval/results/cursive-census/summary.json', import.meta.url);
const NDL_PROVIDERS = /^(ndl|ndl_japan)$/;

const F = {
  census: path.join(DIR, 'census.json'), frame: path.join(DIR, 'frame-books.json'),
  planDir: path.join(DIR, 'plan'), prepDir: path.join(DIR, 'prep'), outDir: path.join(DIR, 'out'),
  manifest: path.join(DIR, 'manifest.tsv'), log: path.join(DIR, 'lane.log'),
  recheckDir: path.join(DIR, 'recheck'), recheckManifest: path.join(DIR, 'recheck', 'manifest.tsv'),
  applied: path.join(DIR, 'applied.jsonl'), skipped: path.join(DIR, 'skipped.jsonl'), rejected: path.join(DIR, 'rejected.jsonl'),
  bookLog: path.join(DIR, 'applied-books.jsonl'), runs: path.join(DIR, 'runs'),
};
const planFile = (bid) => path.join(F.planDir, `${bid}.json`);
const prepFile = (bid) => path.join(F.prepDir, `${bid}.json`);
const leafOut = (bid, pn, side, ext) => path.join(F.outDir, bid, `${pn}-${side}.${ext}`);
const FAILED_READ_ENGINE = 'scripts/workers/paddle-print-lane.mjs';
/** Newest mtime of a page's read leaf files of this extension (when its read came back), or null. */
const leafTime = (bid, pg, ext) => {
  const t = Math.max(0, ...pg.leaves.filter((lf) => !lf.blank).map((lf) => { try { return fs.statSync(leafOut(bid, pg.pn, lf.side, ext)).mtimeMs; } catch { return 0; } }));
  return t ? new Date(t) : null;
};
const recheckOut = (bid, pn, side, ext) => path.join(F.recheckDir, 'out', bid, `${pn}-${side}.${ext}`);
function log(msg) {
  const line = `${new Date().toISOString()} [${CMD}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(F.log, line + '\n'); } catch {}
}
const append = (file, row) => fs.appendFileSync(file, JSON.stringify({ ...row, at: new Date().toISOString() }) + '\n');
const readJsonl = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const readJson = (file, d) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : d;

// ── census ─────────────────────────────────────────────────────────────────────────────

/** Japanese classes known from the cursive census (#4925 / #5100): 3 interior pages per book, by model. */
function cursiveClasses() {
  const m = new Map();
  try {
    for (const b of JSON.parse(fs.readFileSync(CURSIVE_CENSUS, 'utf8')).books) {
      const c = b.classes || [];
      const count = (re) => c.filter((x) => re.test(x)).length;
      let klass = 'unknown';
      if (b.verdict === 'cursive') klass = 'cursive';
      else if (b.medium === 'manuscript' || count(/^manuscript/) >= 2) klass = 'manuscript';
      else if (count(/^typeset$/) >= 2) klass = 'typeset';
      else if (count(/^woodblock-regular$/) >= 2) klass = 'woodblock';
      m.set(b.book_id, { klass, verdict: b.verdict, classes: c });
    }
  } catch {}
  return m;
}

async function census() {
  fs.mkdirSync(DIR, { recursive: true });
  const cohort = fs.existsSync(SIKU_COHORT) ? new Set(fs.readFileSync(SIKU_COHORT, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)) : new Set();
  const cursive = cursiveClasses();
  const out = { generated_at: new Date().toISOString(), issue: LANE_ISSUE, rule: {}, books: {}, excluded: {}, pages: {}, frame: {} };
  const frame = [];
  await withMongo(async (db) => {
    const B = db.collection('books'), P = db.collection('pages');
    const books = await B.find({ language: { $in: [...ZH_LANGS, ...JA_LANGS] }, pages_count: { $gt: 0 } }, { projection: {
      id: 1, title: 1, language: 1, pages_count: 1, year: 1, visible: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold.reason': 1,
      'image_source.provider': 1, 'image_source.contributing_library': 1, contributing_library: 1,
    } }).toArray();
    log(`${books.length} Chinese/Japanese books with pages`);
    const excl = (why, b) => { (out.excluded[why] ||= { books: 0, pages: 0 }); out.excluded[why].books++; out.excluded[why].pages += b.pages_count || 0; };
    const cand = [];
    for (const b of books) {
      const hr = b.pipeline_auto?.hold?.reason || null;
      if (/四庫/.test(b.title || '') || cohort.has(b.id) || (hr && SIKU_HOLDS.test(hr))) { excl('siku_cohort', b); continue; }
      if (hr) { excl(`held:${hr}`, b); continue; }
      const ja = JA_LANGS.has(b.language);
      const k = cursive.get(b.id)?.klass;
      if (ja && k === 'cursive') { excl('ja_cursive', b); continue; }
      if (k === 'typeset' && ja) { excl('ja_typeset_meiji', b); continue; }
      if (k === 'manuscript') { excl('manuscript_known', b); continue; }
      cand.push({ ...b, ja, klass: k || 'unknown' });
    }
    log(`${cand.length} candidate books after the book-level exclusions`);
    // per page: projection only, no text leaves the server but its emptiness and a 四庫全書 hit
    for (let i = 0; i < cand.length; i += 100) {
      const chunk = cand.slice(i, i + 100);
      const rows = await P.aggregate([
        { $match: { book_id: { $in: chunk.map((b) => b.id) }, page_number: { $gt: 0 } } },
        { $project: {
          _id: 0, book_id: 1, w: '$image_width', h: '$image_height',
          src: '$ocr.source', model: '$ocr.model', pipeline: '$ocr.pipeline', edited_by: '$ocr.edited_by', edited_at: '$ocr.edited_at',
          len: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: { $trim: { input: '$ocr.data' } } }, 0] },
          marker: { $eq: ['$ocr.data', '[RECITATION_BLOCKED]'] },
          siku: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $gte: [{ $indexOfCP: ['$ocr.data', '四庫全書'] }, 0] }, false] },
        } },
      ], { maxTimeMS: 300000, allowDiskUse: true }).toArray();
      const by = new Map(chunk.map((b) => [b.id, []]));
      for (const r of rows) by.get(r.book_id)?.push(r);
      for (const b of chunk) {
        const ps = by.get(b.id) || [];
        const withText = ps.filter((p) => p.len > 0 && !p.marker);
        if (withText.length >= 5 && withText.filter((p) => p.siku).length >= 0.3 * withText.length) { excl('siku_text', b); continue; }
        const tally = {}; let read = 0, leaves = 0, spreads = 0, noDims = 0;
        for (const p of ps) {
          const ocr = { data: p.len > 0 ? (p.marker ? '[RECITATION_BLOCKED]' : 'x') : '', source: p.src, model: p.model, pipeline: p.pipeline, edited_by: p.edited_by, edited_at: p.edited_at };
          const spread = isSpread(p.w, p.h);
          const pol = storedPolicy(ocr, { spread });
          const key = `${pol.action}:${pol.why.startsWith('other:') ? 'other' : pol.why}`;
          tally[key] = (tally[key] || 0) + 1;
          if (pol.why.startsWith('other:')) tally[pol.why] = (tally[pol.why] || 0) + 1;
          if (pol.action !== 'read') continue;
          read++;
          if (!(p.w && p.h)) noDims++;
          if (spread) spreads++;
          leaves += spread ? 2 : 1;
        }
        const lib = b.contributing_library || b.image_source?.contributing_library || b.image_source?.provider || 'unknown';
        const cls = b.ja ? 'japanese' : 'chinese';
        const row = { id: b.id, title: b.title, language: b.language, year: b.year ?? null, visible: !!b.visible, provider: b.image_source?.provider || null, library: lib, klass: b.klass, pages: ps.length, read, leaves_est: leaves, spreads, no_dims: noDims, tally };
        for (const [k, v] of Object.entries(tally)) if (!k.startsWith('other:')) { const t = (out.pages[`${cls}|${k}`] ||= 0); out.pages[`${cls}|${k}`] = t + v; }
        if (!read) { excl('nothing_to_read', b); continue; }
        frame.push(row);
      }
      if ((i / 100) % 5 === 0) log(`paged ${Math.min(i + 100, cand.length)}/${cand.length}`);
    }
  });
  const sum = (rs, k) => rs.reduce((s, r) => s + (r[k] || 0), 0);
  const group = (keyf) => { const g = {}; for (const r of frame) { const k = keyf(r); g[k] ||= { books: 0, pages_read: 0, leaves_est: 0 }; g[k].books++; g[k].pages_read += r.read; g[k].leaves_est += r.leaves_est; } return Object.fromEntries(Object.entries(g).sort((a, b) => b[1].pages_read - a[1].pages_read)); };
  out.frame = {
    books: frame.length, pages_read: sum(frame, 'read'), leaves_est: sum(frame, 'leaves_est'), spreads: sum(frame, 'spreads'), pages_without_dims: sum(frame, 'no_dims'),
    by_language: group((r) => (JA_LANGS.has(r.language) ? 'japanese' : 'chinese')),
    by_class: group((r) => r.klass),
    by_library: group((r) => r.library),
    by_why: frame.reduce((m, r) => { for (const [k, v] of Object.entries(r.tally)) if (k.startsWith('read:')) m[k] = (m[k] || 0) + v; return m; }, {}),
  };
  out.rule = {
    languages: { zh: [...ZH_LANGS], ja: [...JA_LANGS] },
    siku: 'title 四庫, or held paddle-zh-5600 / paddle-zh-6388 / gpu-backlog-5660, or in the #5481 cohort, or >= 30 % of pages with stored text carrying 四庫全書',
    read: 'no text; flash-lite; Paddle on a whole spread. Keep everything else (storedPolicy)',
    spread: 'image_width / image_height >= 1.0',
    class: 'Japanese from the cursive census (2 of 3 pages); everything else unknown until the 1-leaf check',
  };
  fs.writeFileSync(F.census, JSON.stringify(out, null, 1));
  fs.writeFileSync(F.frame, JSON.stringify(frame, null, 1));
  log(`CENSUS frame ${JSON.stringify({ books: out.frame.books, pages_read: out.frame.pages_read, leaves_est: out.frame.leaves_est })}`);
  console.log(JSON.stringify({ excluded: out.excluded, frame: { ...out.frame, by_library: Object.fromEntries(Object.entries(out.frame.by_library).slice(0, 15)) } }, null, 1));
}

// ── plan ───────────────────────────────────────────────────────────────────────────────

async function plan() {
  fs.mkdirSync(F.planDir, { recursive: true });
  let ids;
  if (arg('--books', null)) ids = fs.readFileSync(arg('--books'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  else if (BOOK) ids = [BOOK];
  else throw new Error('pass --books <file of ids> (the frame after the class check) or --book <id>');
  ids = ids.filter((id) => !fs.existsSync(planFile(id)) || flag('--refresh'));
  if (LIMIT) ids = ids.slice(0, LIMIT);
  log(`${ids.length} book(s) to plan${APPLY ? '' : '  [DRY RUN: no holds, no plan files]'}`);
  const tally = { books: 0, pages: 0, keep: {}, no_image: 0, skipped_books: [] };
  await withMongo(async (db) => {
    for (const bid of ids) {
      const book = await db.collection('books').findOne({ id: bid }, { projection: { id: 1, title: 1, language: 1, pipeline_auto: 1, pages_count: 1, 'image_source.provider': 1 } });
      if (!book) { tally.skipped_books.push({ bid, why: 'not_found' }); continue; }
      if (isHeld(book) && book.pipeline_auto.hold.reason !== HOLD_REASON) { tally.skipped_books.push({ bid, why: `held: ${book.pipeline_auto.hold.reason}` }); continue; }
      // canary by eye 2026-10-23: on kanji-katakana print Paddle reads katakana as look-alike kanji (ヲ→之, ス→入)
      // and invented a garbled near-repeat line; #7184 measured Chinese only. Japanese stays out of this lane.
      if (laneLanguage(book.language) === 'Japanese') { tally.skipped_books.push({ bid, why: 'japanese' }); continue; }
      const pages = await db.collection('pages').find({ book_id: book.id, page_number: { $gt: 0 } }, { projection: {
        id: 1, page_number: 1, image_width: 1, image_height: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.edited_by': 1, 'ocr.edited_at': 1,
        photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1,
      } }).sort({ page_number: 1 }).toArray();
      const rows = [];
      for (const p of pages) {
        const pol = storedPolicy(p.ocr, { spread: isSpread(p.image_width, p.image_height) });
        if (pol.action !== 'read') { tally.keep[pol.why] = (tally.keep[pol.why] || 0) + 1; continue; }
        // a stored URL can carry whitespace (4 frame pages had a newline inside it): it would split the manifest row
        const src = getPageSource(p)?.replace(/\s+/g, '') || null;
        if (!src) { tally.no_image++; continue; }
        rows.push({ pid: p.id, pn: p.page_number, src, why: pol.why });
      }
      if (!rows.length) { tally.skipped_books.push({ bid, why: 'nothing_to_read' }); continue; }
      if (!APPLY) { log(`${bid} would hold and plan ${rows.length}/${pages.length} pages | ${String(book.title).slice(0, 50)}`); tally.books++; tally.pages += rows.length; continue; }
      // the hold BEFORE anything else: an OCR write on a released book otherwise queues paid gap-fill translation
      const h = await holdBook(db, book.id, { reason: HOLD_REASON, issue: LANE_ISSUE, release: HOLD_RELEASE, source: LANE, detail: { engine: PADDLE.model, planned_pages: rows.length } });
      if (!['held', 'already_held'].includes(h.outcome)) { tally.skipped_books.push({ bid, why: `hold ${h.outcome}` }); log(`${bid} hold: ${h.outcome} — not planned`); continue; }
      fs.writeFileSync(planFile(book.id), JSON.stringify({
        bid: book.id, title: book.title, language: book.language, provider: book.image_source?.provider || null,
        pages_count: book.pages_count || pages.length, listed: pages.length, held_from: h.from ?? null, planned_at: new Date().toISOString(), pages: rows,
      }));
      tally.books++; tally.pages += rows.length;
    }
  });
  log(`PLAN ${JSON.stringify({ ...tally, skipped_books: tally.skipped_books.length })}${tally.skipped_books.length ? ' skipped: ' + JSON.stringify(tally.skipped_books.slice(0, 30)) : ''}`);
}

// ── prep (CPU: fetch, crop, split, ink) ─────────────────────────────────────────────────

let sharpMod = null, gutterMod = null;
async function fetchBuf(url) {
  let last;
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'sourcelibrary-paddle-print-lane/6101 (+https://sourcelibrary.org)' }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 2000 * (t + 1))); }
  }
  throw last;
}

/** The NDL ruler band's top row (scripts/eval/paddle-split-6101.mjs `rulerTop`, unchanged): null when not found. */
async function rulerTop(buf) {
  const { data, info } = await sharpMod(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info; const e = Math.max(4, Math.round(w * 0.03));
  const y0 = Math.round(h * 0.55), y1 = Math.round(h * 0.70);
  const edge = []; for (let y = y0; y < y1; y++) for (const x0 of [0, w - e]) for (let x = x0; x < x0 + e; x++) edge.push(data[y * w + x]);
  edge.sort((a, b) => a - b); const bg = edge[edge.length >> 1];
  const frac = (y) => { let k = 0; for (const x0 of [0, w - e]) for (let x = x0; x < x0 + e; x++) if (data[y * w + x] >= bg + 20) k++; return k / (2 * e); };
  const Fr = []; for (let y = 0; y < h; y++) Fr.push(y < y0 ? 0 : frac(y));
  for (let y = y0; y < h - 16; y++) {
    if (Fr[y] < 0.6) continue;
    let k = 0; for (let j = 0; j < 16; j++) if (Fr[y + j] >= 0.6) k++;
    if (k < 10) continue;
    let top = y; while (top > y0 && Fr[top - 1] >= 0.3) top--;
    return top;
  }
  return null;
}

async function leafInk(buf, [x0, y0, x1, y1]) {
  const { data, info } = await sharpMod(buf, { failOn: 'none' }).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .greyscale().resize(400, null, { fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  const v = innerInk(data, info.width, info.height);
  return v == null ? null : +v.toFixed(4);
}

/** One page → its geometry and leaves. Throws on a fetch / decode failure (recorded by the caller). */
export async function prepPage(buf, { ndl }) {
  const meta = await sharpMod(buf).metadata();
  const w = meta.width, h = meta.height;
  const ruler = ndl ? await rulerTop(buf) : null;
  const cropH = ruler != null ? Math.max(1, ruler - 4) : h;
  const spread = isSpread(w, h);
  const leaves = [];
  let gutter = null, how = null;
  if (spread) {
    const body = await sharpMod(buf).extract({ left: 0, top: 0, width: w, height: cropH }).jpeg({ quality: 92 }).toBuffer();
    const g = await gutterMod.detectGutterPixel(body);
    gutter = g.column; how = `pixel-${g.confidence}`;
    if (gutter == null || g.confidence !== 'high') {
      // a gap centre outside the central 35–65 % is a blank facing page's margin, not the gutter (#7184: 9e6d1d-p55)
      const gc = g.gap ? (g.gap.start + g.gap.end) / 2000 : null;
      if (gc != null && gc >= 0.35 && gc <= 0.65) { gutter = Math.round(gc * w); how = 'gap-centre'; }
      else { gutter = Math.round(w / 2); how = 'image-centre'; }
    }
    const f = gutter / w;
    const leftEnd = Math.round(Math.min(1, f + OVERLAP) * w), rightStart = Math.round(Math.max(0, f - OVERLAP) * w);
    leaves.push({ side: 'R', box: [rightStart, 0, w, cropH] }, { side: 'L', box: [0, 0, leftEnd, cropH] });
  } else leaves.push({ side: 'S', box: [0, 0, w, cropH] });
  for (const lf of leaves) { lf.ink = await leafInk(buf, lf.box); lf.blank = lf.ink != null && lf.ink < INK_BLANK; }
  return { w, h, spread, ruler_row: ruler, crop_h: cropH, gutter, gutter_how: how, leaves };
}

async function prep() {
  sharpMod = (await import('sharp')).default;
  gutterMod = await import('../lib/gutter-detect.mjs');
  fs.mkdirSync(F.prepDir, { recursive: true });
  const conc = Number(arg('--concurrency', 8));
  let books = fs.existsSync(F.planDir) ? fs.readdirSync(F.planDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  if (BOOK) books = books.filter((b) => b === BOOK);
  if (arg('--books', null)) { const want = new Set(fs.readFileSync(arg('--books'), 'utf8').split('\n').map((s) => s.trim())); books = books.filter((b) => want.has(b)); }
  // --retry-failed: re-fetch only the pages an earlier prep could not fetch, in books already prepped
  const RETRY = flag('--retry-failed');
  books = books.filter((b) => (RETRY ? fs.existsSync(prepFile(b)) && readJson(prepFile(b)).pages.some((p) => p.error) : !fs.existsSync(prepFile(b)))).sort();
  // --shard i/n: run n prep processes side by side, each on every n-th book
  const [si, sn] = String(arg('--shard', '0/1')).split('/').map(Number);
  books = books.filter((_, i) => i % sn === si);
  if (LIMIT) books = books.slice(0, LIMIT);
  log(`${books.length} book(s) to ${RETRY ? 're-fetch failed pages of' : 'prep'}, ${conc} at a time${sn > 1 ? `, shard ${si}/${sn}` : ''}`);
  const t = { books: 0, pages: 0, leaves: 0, blank: 0, failed: 0, spreads: 0, ruler: 0, centre: 0 };
  for (const bid of books) {
    const pl = readJson(planFile(bid));
    const ndl = NDL_PROVIDERS.test(pl.provider || '');
    const prior = RETRY ? readJson(prepFile(bid)).pages : null;
    const todo = RETRY ? prior.filter((p) => p.error) : pl.pages;
    const res = new Array(todo.length);
    let next = 0;
    await Promise.all(Array.from({ length: conc }, async () => {
      while (next < todo.length) {
        const i = next++; const p = todo[i];
        try { res[i] = { pn: p.pn, pid: p.pid, src: p.src, ...(await prepPage(await fetchBuf(p.src), { ndl })) }; }
        catch (e) { res[i] = { pn: p.pn, pid: p.pid, src: p.src, error: String(e.message || e).slice(0, 160) }; }
      }
    }));
    const man = [];
    for (const r of res) {
      t.pages++;
      if (r.error) { t.failed++; continue; }
      if (r.spread) t.spreads++;
      if (r.ruler_row != null) t.ruler++;
      if (r.gutter_how === 'image-centre') t.centre++;
      for (const lf of r.leaves) { t.leaves++; if (lf.blank) { t.blank++; continue; } man.push(`${bid}\t${r.pn}-${lf.side}\t${String(r.src).replace(/\s+/g, '')}\t${lf.box.join(',')}`); }
    }
    // the prep file is the book's checkpoint: written after the manifest lines, so a crash re-preps the whole book
    // and the runner skips leaves already read (its output file is its checkpoint)
    if (man.length) fs.appendFileSync(F.manifest, man.join('\n') + '\n');
    const pages = RETRY ? prior.map((p) => (p.error ? res.find((r) => r.pn === p.pn) : p)) : res;
    fs.writeFileSync(prepFile(bid), JSON.stringify({ bid, ndl, prepped_at: new Date().toISOString(), pages }));
    t.books++;
    if (t.books % 10 === 0 || t.books === books.length) log(`prepped ${t.books}/${books.length} books: ${JSON.stringify(t)}`);
  }
  log(`PREP ${JSON.stringify(t)}`);
}

// ── recheck: list the short leaves for a second read at a smaller scale ─────────────────

function recheck() {
  fs.mkdirSync(F.recheckDir, { recursive: true });
  const listed = new Set(fs.existsSync(F.recheckManifest) ? fs.readFileSync(F.recheckManifest, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t').slice(0, 2).join('/')) : []);
  const preps = fs.existsSync(F.prepDir) ? fs.readdirSync(F.prepDir).filter((f) => f.endsWith('.json')) : [];
  const man = []; let short = 0, leaves = 0;
  for (const f of preps) {
    const pr = readJson(path.join(F.prepDir, f));
    for (const p of pr.pages) {
      if (p.error) continue;
      for (const lf of p.leaves) {
        if (lf.blank) continue;
        const t = leafOut(pr.bid, p.pn, lf.side, 'txt');
        if (!fs.existsSync(t)) continue;
        leaves++;
        const n = leafChars(fs.readFileSync(t, 'utf8'));
        if (!(n > 0 && n < SHORT_LEAF)) continue;
        short++;
        if (listed.has(`${pr.bid}/${p.pn}-${lf.side}`)) continue;
        man.push(`${pr.bid}\t${p.pn}-${lf.side}\t${String(p.src).replace(/\s+/g, '')}\t${lf.box.join(',')}`);
      }
    }
  }
  if (man.length) fs.appendFileSync(F.recheckManifest, man.join('\n') + '\n');
  log(`RECHECK read leaves ${leaves}, short (< ${SHORT_LEAF}) ${short}, newly listed ${man.length} → ${F.recheckManifest}`);
}

// ── apply ──────────────────────────────────────────────────────────────────────────────

/** Every READ run (not a recheck), oldest first: `{ name, box, t }` with `t` = its start in ms. */
function readRuns() {
  if (!fs.existsSync(F.runs)) return [];
  return fs.readdirSync(F.runs).filter((x) => x.endsWith('.json')).map((x) => ({ name: x.slice(0, -5), box: readJson(path.join(F.runs, x), {}) }))
    .filter((r) => !r.box.max_side).map((r) => ({ ...r, t: Date.parse(r.box.started_at) || 0 })).sort((a, b) => a.t - b.t);
}
/** The run that read a page: the last read run started before its newest leaf output was written. */
function runOfPage(runs, bid, pg) {
  const m = Math.max(0, ...pg.leaves.filter((lf) => !lf.blank).map((lf) => { try { return fs.statSync(leafOut(bid, pg.pn, lf.side, 'txt')).mtimeMs; } catch { return 0; } }));
  let r = null; for (const x of runs) if (x.t <= m) r = x;
  return r || runs.at(-1) || { name: 'unknown-run', box: {} };
}

/** The newest run.json a GPU task left (engine versions, weights hash, serving). */
function latestRun() {
  if (!fs.existsSync(F.runs)) return { name: 'unknown-run', box: {} };
  // the newest READ run (a recheck run reads short leaves again at a smaller scale; it is not the text's run)
  const runs = fs.readdirSync(F.runs).filter((x) => x.endsWith('.json')).map((x) => ({ name: x.slice(0, -5), box: readJson(path.join(F.runs, x), {}) }))
    .filter((r) => !r.box.max_side).sort((a, b) => String(a.box.started_at).localeCompare(String(b.box.started_at)));
  return runs.at(-1) || { name: 'unknown-run', box: {} };
}

async function apply() {
  const done = new Set([...readJsonl(F.applied), ...readJsonl(F.skipped), ...readJsonl(F.rejected)].map((r) => `${r.bid}/${r.pn}`));
  let books = fs.existsSync(F.prepDir) ? fs.readdirSync(F.prepDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  if (BOOK) books = books.filter((b) => b === BOOK);
  if (arg('--books', null)) { const want = new Set(fs.readFileSync(arg('--books'), 'utf8').split('\n').map((s) => s.trim())); books = books.filter((b) => want.has(b)); }
  const isShort = (bid, pn, lf) => { const f = leafOut(bid, pn, lf.side, 'txt'); if (!fs.existsSync(f)) return false; const n = leafChars(fs.readFileSync(f, 'utf8')); return n > 0 && n < SHORT_LEAF; };
  const rechecked = (bid, pn, lf) => fs.existsSync(recheckOut(bid, pn, lf.side, 'txt')) || fs.existsSync(recheckOut(bid, pn, lf.side, 'err'));
  // a page is ready when every leaf is back, and every SHORT leaf is back from its recheck too
  const back = (bid, pn, lf) => lf.blank || fs.existsSync(leafOut(bid, pn, lf.side, 'err')) || (fs.existsSync(leafOut(bid, pn, lf.side, 'txt')) && (!isShort(bid, pn, lf) || rechecked(bid, pn, lf)));
  const ready = [];
  for (const bid of books.sort()) {
    const pr = readJson(prepFile(bid));
    const pages = pr.pages.filter((p) => !p.error && !done.has(`${bid}/${p.pn}`));
    if (!pages.length || !pages.every((p) => p.leaves.every((lf) => back(bid, p.pn, lf)))) continue;
    ready.push({ bid, pages });
    if (LIMIT && ready.length >= LIMIT) break;
  }
  log(`${ready.length} books ready (${ready.reduce((s, b) => s + b.pages.length, 0)} pages)${APPLY ? '' : '  [DRY RUN]'}`);
  const totals = { books: 0, written: 0, conflicts: 0, textless: 0, rejected: 0, kept_now: 0, human_edited: 0, not_held: 0, stale_marked: 0, why: {} };
  if (!ready.length) { log(`APPLY ${JSON.stringify(totals)}`); return totals; }
  const { name: runName } = latestRun();
  const runs = readRuns();
  // --apply-tag names one apply pass inside a GPU run, so revert-run can undo that pass alone
  const runId = `${LANE}/${runName}${arg('--apply-tag', null) ? `/${arg('--apply-tag')}` : ''}`;
  await withMongo(async (db) => {
    const P = db.collection('pages'), B = db.collection('books');
    for (const { bid, pages: prepped } of ready) {
      const pl = readJson(planFile(bid));
      const book = await B.findOne({ id: bid }, { projection: { id: 1, title: 1, language: 1, pipeline_auto: 1 } });
      if (!book) { log(`${bid} not found — skipping`); continue; }
      // the hold is the lane's guarantee that no paid re-translation follows the write
      if (book.pipeline_auto?.hold?.reason !== HOLD_REASON) { log(`${bid} NOT held for ${HOLD_REASON} — refusing to write`); totals.not_held++; continue; }
      const language = laneLanguage(book.language);
      if (language === 'Japanese') { log(`${bid} is Japanese — out of this lane (canary 2026-10-23), not written`); continue; }
      const workTitle = workTitleOf(book.title);
      const live = new Map((await P.find({ id: { $in: prepped.map((p) => p.pid) } }, { projection: { id: 1, page_number: 1, book_id: 1, ocr: 1, image_width: 1, image_height: 1 } }).toArray()).map((p) => [p.id, p]));
      const writes = [];
      const med = bookMedians(prepped.flatMap((pg) => pg.leaves.filter((lf) => !lf.blank && fs.existsSync(leafOut(bid, pg.pn, lf.side, 'txt'))).map((lf) => ({ ink: lf.ink, raw: fs.readFileSync(leafOut(bid, pg.pn, lf.side, 'txt'), 'utf8') }))));
      for (const pg of prepped) {
        const p = live.get(pg.pid);
        if (!p || p.book_id !== bid || p.page_number !== pg.pn) { if (APPLY) append(F.skipped, { bid, pn: pg.pn, why: 'page_moved_or_gone' }); continue; }
        if (isHumanEdited(p.ocr)) { if (APPLY) append(F.skipped, { bid, pn: pg.pn, why: 'human_edited' }); totals.human_edited++; continue; }
        // the stored reading may have changed since the plan (a Flash read landed): the policy decides again
        const pol = storedPolicy(p.ocr, { spread: pg.spread });
        if (pol.action !== 'read') { if (APPLY) append(F.skipped, { bid, pn: pg.pn, why: `now_keep:${pol.why}` }); totals.kept_now++; continue; }
        const leaves = pg.leaves.map((lf) => ({
          side: lf.side, blank: lf.blank, ink: lf.ink,
          raw: lf.blank ? null : (fs.existsSync(leafOut(bid, pg.pn, lf.side, 'txt')) ? fs.readFileSync(leafOut(bid, pg.pn, lf.side, 'txt'), 'utf8') : null),
          err: lf.blank ? null : (fs.existsSync(leafOut(bid, pg.pn, lf.side, 'err')) ? fs.readFileSync(leafOut(bid, pg.pn, lf.side, 'err'), 'utf8') : null),
          recheck: !lf.blank && fs.existsSync(recheckOut(bid, pg.pn, lf.side, 'txt')) ? fs.readFileSync(recheckOut(bid, pg.pn, lf.side, 'txt'), 'utf8') : null,
        }));
        const a = assemblePage(leaves, { workTitle, med });
        if (a.verdict === 'textless') {
          // never store an empty reading: a stored reading is kept, a page with none stays unread
          if (APPLY) {
            append(F.skipped, { bid, pn: pg.pn, why: 'paddle_textless_kept', chars: a.han, blank_leaves: pg.leaves.filter((l) => l.blank).length });
            // Paddle returned no text: a failed read (#7378), unless every leaf was blank and none was sent
            if (pg.leaves.some((l) => !l.blank)) await recordFailedReads(db, [fromTextless({ pageId: pg.pid, model: PADDLE.model, engine: FAILED_READ_ENGINE, chars: a.han, at: leafTime(bid, pg, 'txt') })]);
          }
          totals.textless++; continue;
        }
        if (a.verdict === 'reject') {
          if (APPLY) {
            append(F.rejected, { bid, pn: pg.pn, pid: pg.pid, reason: a.reason, side: a.side, detail: a });
            // a leaf the box failed (.err) is a failed read (#7378); the other rejects are this lane's own guards
            if (a.reason === 'leaf_error') await recordFailedReads(db, [fromErrFile({ pageId: pg.pid, text: a.err, mtime: leafTime(bid, pg, 'err'), model: PADDLE.model, engine: FAILED_READ_ENGINE })]);
            if (a.reason.startsWith('leaf_loop')) {
              const raw = leaves.find((l) => l.side === a.side)?.raw || '';
              await recordLoopRefusal(db, { pageId: pg.pid, bookId: bid, pageNumber: pg.pn, text: raw, model: PADDLE.model, verdict: { share: a.share ?? 1, body: raw.length, period: a.period ?? 0, reps: a.reps ?? a.run ?? 0 } });
            }
          }
          totals.rejected++; totals.why[a.reason] = (totals.why[a.reason] || 0) + 1; continue;
        }
        if (pol.why === 'flash_lite') {
          const c = coversLite(a.han, p.ocr.data, a.body);
          if (!c.ok) { if (APPLY) append(F.skipped, { bid, pn: pg.pn, why: c.why, paddle: c.paddle, lite: c.lite, margin_recall: c.margin_recall }); totals[c.why] = (totals[c.why] || 0) + 1; continue; }
        }
        const text = envelope(a.body, language);
        // the engine block names the GPU run that read this page's leaves; run_id (the revision) names this apply pass
        const pr = runOfPage(runs, bid, pg);
        const field = ocrField(text, {
          language, run: `${LANE}/${pr.name}`, imageUrl: pg.src, box: pr.box, stats: a.stats, spread: pg.spread, why: pol.why,
          leaves: pg.leaves.map((lf) => ({ side: lf.side, box: lf.box, ink: lf.ink, blank: lf.blank })),
        });
        writes.push({ pg, p, text, field, why: pol.why, han: a.han });
      }
      if (!writes.length) { log(`${bid} nothing to write`); continue; }
      // a 韻府 / 類書-type book whose pages carry 丨 marks: a page where Paddle dropped them all is not written (#6056 r3)
      const dd = dittoDropped(writes.map((w) => w.text));
      if (dd.dropped.length) {
        const drop = new Set(dd.dropped);
        for (const i of dd.dropped) if (APPLY) append(F.rejected, { bid, pn: writes[i].pg.pn, pid: writes[i].pg.pid, reason: 'ditto_marks_missing', detail: { book_median_per_1k: dd.median } });
        totals.rejected += drop.size; totals.why.ditto_marks_missing = (totals.why.ditto_marks_missing || 0) + drop.size;
        log(`${bid} ditto marks: book median ${dd.median}/1k Han, ${drop.size} page(s) with none rejected`);
        for (let i = writes.length - 1; i >= 0; i--) if (drop.has(i)) writes.splice(i, 1);
        if (!writes.length) continue;
      }
      const ks = kanaShare(writes.map((w) => w.text));
      if (ks >= MAX_KANA_SHARE) {
        log(`${bid} is ${(ks * 100).toFixed(0)} % kana — a Japanese edition, out of this lane; nothing written | ${String(book.title || '').slice(0, 40)}`);
        if (APPLY) append(F.skipped, { bid, pn: null, why: 'japanese_content', kana_share: +ks.toFixed(3), pages: writes.length });
        totals.japanese_content = (totals.japanese_content || 0) + 1; continue;
      }
      if (!APPLY) { log(`${bid} would write ${writes.length}/${prepped.length} pages (${Object.entries(writes.reduce((m, w) => ({ ...m, [w.why]: (m[w.why] || 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', ')}) | ${String(book.title || '').slice(0, 40)}`); totals.written += writes.length; continue; }
      // a sweep logs before it writes: if the run dies mid-book, sweep_log says what it set out to do
      await recordSweepAction(db, { sweep: LANE, book_id: bid, action: 'retranscribe-started', detail: { issue: LANE_ISSUE, engine: PADDLE.model, pages: writes.length, run: runId } });
      const now = new Date();
      let written = 0, conflicts = 0;
      for (const w of writes) {
        const r = await writeLanePage(db, w.p.id, { ...w.field, updated_at: now }, { run: runId });
        if (r.status === 'written') { written++; append(F.applied, { bid, pn: w.pg.pn, pid: w.p.id, why: w.why, chars: w.han, revision: r.revision_id }); }
        else { conflicts++; append(F.skipped, { bid, pn: w.pg.pn, why: `write_${r.status}` }); }
      }
      totals.written += written; totals.conflicts += conflicts; totals.books++;
      // the English on a rewritten page was made from text that is gone: say so ON THE PAGE, never hide it
      const stale = await markTranslationsStale(db, writes.map((w) => ({ id: w.p.id, text: w.text })), now, LANE);
      totals.stale_marked += stale;
      const { after: counts } = await recountBook(db, bid, { reason: LANE, now });
      const byWhy = writes.reduce((m, w) => ({ ...m, [w.why]: (m[w.why] || 0) + 1 }), {});
      await recordSweepAction(db, { sweep: LANE, book_id: bid, action: 'retranscribed', detail: { issue: LANE_ISSUE, engine: PADDLE.model, pages_written: written, conflicts, replaced: byWhy, run: runId, translations_marked_stale: stale } });
      await db.collection('book_events').updateOne(
        { book_id: bid, type: BOOK_EVENT },
        { $setOnInsert: { book_id: bid, type: BOOK_EVENT, at: now, source: LANE, 'details.issue': LANE_ISSUE, 'details.engine': PADDLE.model, 'details.repo': PADDLE.repo },
          $set: { 'details.last_apply_at': now, 'details.pages_ocr_after': counts?.pages_ocr ?? null, 'details.planned': pl?.pages?.length ?? null },
          $inc: { 'details.pages_written': written, 'details.translations_marked_stale': stale } },
        { upsert: true },
      );
      append(F.bookLog, { bid, written, conflicts, replaced: byWhy, stale, run: runId });
      log(`${bid} wrote ${written}/${writes.length} (${Object.entries(byWhy).map(([k, v]) => `${k} ${v}`).join(', ')}; stale ${stale}) | ${String(book.title || '').slice(0, 40)}`);
    }
  }, { timeoutMs: 6 * 3600 * 1000 });
  log(`APPLY ${JSON.stringify(totals)}`);
  return totals;
}

// ── status ─────────────────────────────────────────────────────────────────────────────

function status() {
  const plans = fs.existsSync(F.planDir) ? fs.readdirSync(F.planDir).filter((x) => x.endsWith('.json')) : [];
  const preps = fs.existsSync(F.prepDir) ? fs.readdirSync(F.prepDir).filter((x) => x.endsWith('.json')) : [];
  let pages = 0, leaves = 0, blank = 0, failed = 0, txt = 0, err = 0, booksBack = 0;
  for (const f of preps) {
    const pr = readJson(path.join(F.prepDir, f)); let all = true;
    for (const p of pr.pages) {
      pages++; if (p.error) { failed++; continue; }
      for (const lf of p.leaves) {
        leaves++; if (lf.blank) { blank++; continue; }
        if (fs.existsSync(leafOut(pr.bid, p.pn, lf.side, 'txt'))) txt++; else if (fs.existsSync(leafOut(pr.bid, p.pn, lf.side, 'err'))) err++; else all = false;
      }
    }
    if (all) booksBack++;
  }
  const applied = readJsonl(F.applied), skipped = readJsonl(F.skipped), rejected = readJsonl(F.rejected);
  console.log(JSON.stringify({
    dir: DIR, books_planned: plans.length, books_prepped: preps.length, books_back: booksBack, books_applied: new Set(readJsonl(F.bookLog).map((b) => b.bid)).size,
    pages_prepped: pages, prep_failed: failed, leaves, blank_leaves: blank, leaves_read: txt, leaves_err: err,
    pages_written: applied.length, pages_skipped: skipped.length, pages_rejected: rejected.length,
    skipped_by_reason: skipped.reduce((m, s) => ({ ...m, [s.why]: (m[s.why] || 0) + 1 }), {}),
    rejected_by_reason: rejected.reduce((m, s) => ({ ...m, [s.reason]: (m[s.reason] || 0) + 1 }), {}),
  }, null, 1));
}

const CMDS = { census, plan, prep, recheck, apply, status };
const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  if (!CMDS[CMD]) { console.error(`usage: paddle-print-lane.mjs ${Object.keys(CMDS).join('|')} [options]`); process.exit(1); }
  fs.mkdirSync(DIR, { recursive: true });
  await CMDS[CMD]();
}
