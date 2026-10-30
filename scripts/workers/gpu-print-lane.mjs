#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/paddle-print-lane.mjs (#6101 — plan / apply / status for a GPU print lane: hold before the
 * first write, human-edit guard in the loop, loop guard, textless reads never stored, sweep_log before and after, one
 * book_events row, recount; followed step for step). It does not fit as is: it splits spreads and crops leaves, and
 * its policy replaces lite reads of Chinese print. This lane writes only pages with NO text in 1800+ English print.
 *
 * The GPU print lane for 1800+ English print (#6871). Policy, conversion, guards and the ocr field:
 * scripts/lib/gpu-print-lane.mjs. The GPU half is scripts/gpu/gpu-print-gpu.sh (an ocr-filler / gpu-queue task on
 * gex45: LightOnOCR-3-1B on vLLM over manifest.tsv → out/<bid>/<pn>.json|.err).
 *
 *   frame    READ-ONLY. Visible English books dated 1800+ (`year`), not unsplit spreads, with pages that have no text,
 *            held under a GPU-lane hold (GPU_LANE_HOLDS of cli-ocr-lane.mjs: "published as scans, OCR waits for a
 *            decision", the holds the #7263 Latin GPU lane reads) → frame-books.json (seeded order, pages owed per
 *            book). --free adds books that are not held (plan then holds them gpu-print-6871). --max-pages caps a book.
 *   plan     per book (--books <file> | --book <id> | the first --limit frame books): a free book is HELD
 *            (gpu-print-6871) first; a book under a GPU-lane hold keeps it. Then its pages with no text and an image
 *            → plan/<bid>.json and manifest.tsv rows (<bid>\t<pn>\t<pid>\t<url>). Dry unless --apply. A book held
 *            for any other reason is skipped.
 *   apply    per book whose every planned page is back from the box: re-check each page (still no text, not
 *            human-edited, the book still held for this lane), run the loop guard and the blank floor, write through
 *            writePageText (revision row, CAS), recount, sweep_log before and after, one book_events row. The hold
 *            STAYS (#6871 brief: no release of holds). Dry unless --apply.
 *   status   counts from the files.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/workers/gpu-print-lane.mjs frame
 * Options: --dir <lane dir> (default $LANE_DIR or /root/jobs/gpu-print-6871)  --book <id>  --books <file>  --limit N
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { withMongo } from '../lib/mongo.mjs';
import { recordLoopRefusal } from '../lib/ocr-loop-guard.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { holdBook, isHeld, isUnsplitSpread } from '../lib/pipeline-hold.mjs';
import { GPU_LANE_HOLDS } from '../batch/cli-ocr-lane.mjs';
import {
  LANE, LANE_ISSUE, HOLD_REASON, HOLD_RELEASE, BOOK_EVENT, LIGHTON,
  isEnglishBook, hasNoText, pageVerdict, envelope, ocrField, writeLanePage, isHumanEdited,
} from '../lib/gpu-print-lane.mjs';

const argv = process.argv.slice(2);
const CMD = argv[0];
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const DIR = arg('--dir', process.env.LANE_DIR || '/root/jobs/gpu-print-6871');
const APPLY = flag('--apply');
const BOOK = arg('--book', null);
const LIMIT = Number(arg('--limit', 0)) || 0;

const F = {
  frame: path.join(DIR, 'frame-books.json'), planDir: path.join(DIR, 'plan'), outDir: path.join(DIR, 'out'),
  manifest: path.join(DIR, 'manifest.tsv'), log: path.join(DIR, 'lane.log'), runs: path.join(DIR, 'runs'),
  applied: path.join(DIR, 'applied.jsonl'), skipped: path.join(DIR, 'skipped.jsonl'), rejected: path.join(DIR, 'rejected.jsonl'),
  bookLog: path.join(DIR, 'applied-books.jsonl'),
};
const planFile = (bid) => path.join(F.planDir, `${bid}.json`);
const outFile = (bid, pn, ext) => path.join(F.outDir, bid, `${pn}.${ext}`);
function log(msg) {
  const line = `${new Date().toISOString()} [${CMD}] ${msg}`;
  console.log(line);
  try { fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(F.log, line + '\n'); } catch {}
}
const append = (file, row) => fs.appendFileSync(file, JSON.stringify({ ...row, at: new Date().toISOString() }) + '\n');
const readJsonl = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const readJson = (file, d) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : d;
const rank = (id) => crypto.createHash('sha256').update(`6871gpuprint:${id}`).digest('hex');
/** Holds this lane may write under: its own, and the scans-only holds that wait for a GPU read. No hold is released. */
const LANE_HOLDS = new Set([HOLD_REASON, ...GPU_LANE_HOLDS]);
const NO_TEXT = { $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': { $regex: /^\s*$/ } }] };

// ── frame (read-only) ────────────────────────────────────────────────────────────────────

async function frame() {
  fs.mkdirSync(DIR, { recursive: true });
  const maxPages = Number(arg('--max-pages', 0)) || 0;
  let out = [];
  await withMongo(async (db) => {
    const books = await db.collection('books').find(
      { visible: true, language: { $regex: '^English' }, year: { $gte: 1800, $lte: 2030 }, pages_count: { $gt: 0 } },
      { projection: { id: 1, title: 1, year: 1, language: 1, pages_count: 1, pipeline_auto: 1, needs_splitting: 1, split_completed: 1 } }).toArray();
    const rows = [];
    for (const b of books) {
      if (!isEnglishBook(b.language) || isUnsplitSpread(b)) continue;
      if (isHeld(b) ? !LANE_HOLDS.has(b.pipeline_auto.hold.reason) : !flag('--free')) continue;
      const owed = await db.collection('pages').countDocuments({ book_id: b.id, page_number: { $gt: 0 }, ...NO_TEXT, 'ocr.edited_by': { $exists: false } });
      if (!owed || (maxPages && owed > maxPages)) continue;
      rows.push({ bid: b.id, title: b.title, year: b.year, pages_count: b.pages_count, owed, hold: b.pipeline_auto?.hold?.reason ?? null });
    }
    out = rows.sort((a, b) => rank(a.bid).localeCompare(rank(b.bid)));
  }, { timeoutMs: 3 * 3600 * 1000 });
  fs.writeFileSync(F.frame, JSON.stringify({ built_at: new Date().toISOString(), rule: `visible English 1800+, held under ${[...LANE_HOLDS].join('|')}${flag('--free') ? ' or not held' : ''}, pages with no text`, books: out }, null, 1));
  log(`FRAME ${out.length} books, ${out.reduce((s, r) => s + r.owed, 0)} pages with no text → ${F.frame}`);
}

// ── plan (holds the book) ────────────────────────────────────────────────────────────────

async function plan() {
  fs.mkdirSync(F.planDir, { recursive: true });
  let ids;
  if (arg('--books', null)) ids = fs.readFileSync(arg('--books'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  else if (BOOK) ids = [BOOK];
  else ids = readJson(F.frame, { books: [] }).books.map((b) => b.bid);
  ids = ids.filter((id) => !fs.existsSync(planFile(id)));
  if (LIMIT) ids = ids.slice(0, LIMIT);
  log(`${ids.length} book(s) to plan${APPLY ? '' : '  [DRY RUN: no holds, no plan files]'}`);
  const tally = { books: 0, pages: 0, no_image: 0, skipped_books: [] };
  await withMongo(async (db) => {
    for (const bid of ids) {
      const book = await db.collection('books').findOne({ id: bid }, { projection: { id: 1, title: 1, language: 1, year: 1, pipeline_auto: 1, pages_count: 1, needs_splitting: 1, split_completed: 1 } });
      if (!book) { tally.skipped_books.push({ bid, why: 'not_found' }); continue; }
      if (!isEnglishBook(book.language) || !(book.year >= 1800)) { tally.skipped_books.push({ bid, why: 'not English 1800+' }); continue; }
      if (isUnsplitSpread(book)) { tally.skipped_books.push({ bid, why: 'needs_splitting (#7605)' }); continue; }
      if (isHeld(book) && !LANE_HOLDS.has(book.pipeline_auto.hold.reason)) { tally.skipped_books.push({ bid, why: `held: ${book.pipeline_auto.hold.reason}` }); continue; }
      const pages = await db.collection('pages').find({ book_id: book.id, page_number: { $gt: 0 }, ...NO_TEXT }, { projection: {
        id: 1, page_number: 1, ocr: 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, crop: 1,
      } }).sort({ page_number: 1 }).toArray();
      const rows = [];
      for (const p of pages) {
        if (isHumanEdited(p.ocr) || !hasNoText(p.ocr)) continue;
        const src = getPageSource(p)?.replace(/\s+/g, '') || null;
        if (!src) { tally.no_image++; continue; }
        rows.push({ pid: p.id, pn: p.page_number, src, why: p.ocr?.model || (p.ocr?.recitation_count ? 'refused' : 'never_read') });
      }
      if (!rows.length) { tally.skipped_books.push({ bid, why: 'nothing_to_read' }); continue; }
      if (!APPLY) { log(`${bid} would ${isHeld(book) ? "plan" : "hold and plan"} ${rows.length} pages | ${String(book.title).slice(0, 50)}`); tally.books++; tally.pages += rows.length; continue; }
      // the hold BEFORE anything else: no other lane reads these pages while the GPU does. A book already under a
      // GPU-lane hold keeps that hold (nothing else reads it); a free book (--free frame) is held for this lane.
      const h = isHeld(book) ? { outcome: 'already_held', from: book.pipeline_auto.hold.held_from_status ?? null }
        : await holdBook(db, book.id, { reason: HOLD_REASON, issue: LANE_ISSUE, release: HOLD_RELEASE, source: LANE, detail: { engine: LIGHTON.model, planned_pages: rows.length } });
      if (!['held', 'already_held'].includes(h.outcome)) { tally.skipped_books.push({ bid, why: `hold ${h.outcome}` }); continue; }
      fs.writeFileSync(planFile(book.id), JSON.stringify({ bid: book.id, title: book.title, language: book.language, year: book.year, hold: book.pipeline_auto?.hold?.reason ?? HOLD_REASON, held_from: h.from ?? null, planned_at: new Date().toISOString(), pages: rows }));
      fs.appendFileSync(F.manifest, rows.map((r) => `${book.id}\t${r.pn}\t${r.pid}\t${r.src}`).join('\n') + '\n');
      tally.books++; tally.pages += rows.length;
    }
  });
  log(`PLAN ${JSON.stringify({ ...tally, skipped_books: tally.skipped_books.length })}${tally.skipped_books.length ? ' skipped: ' + JSON.stringify(tally.skipped_books.slice(0, 30)) : ''}`);
}

// ── apply ────────────────────────────────────────────────────────────────────────────────

/** The GPU runs (runs/<name>.json, written by gpu-print-gpu.sh): the box, the snapshot, the vLLM version. */
function latestRun() {
  const runs = fs.existsSync(F.runs) ? fs.readdirSync(F.runs).filter((f) => f.endsWith('.json')).sort() : [];
  if (!runs.length) return { name: 'unknown-run', box: {} };
  const f = runs[runs.length - 1];
  return { name: f.slice(0, -5), box: readJson(path.join(F.runs, f), {}) };
}

async function apply() {
  const done = new Set([...readJsonl(F.applied), ...readJsonl(F.skipped), ...readJsonl(F.rejected)].map((r) => `${r.bid}/${r.pn}`));
  let books = fs.existsSync(F.planDir) ? fs.readdirSync(F.planDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  if (BOOK) books = books.filter((b) => b === BOOK);
  if (arg('--books', null)) { const want = new Set(fs.readFileSync(arg('--books'), 'utf8').split('\n').map((s) => s.trim())); books = books.filter((b) => want.has(b)); }
  const back = (bid, pn) => fs.existsSync(outFile(bid, pn, 'json')) || fs.existsSync(outFile(bid, pn, 'err'));
  const ready = [];
  for (const bid of books.sort()) {
    const pl = readJson(planFile(bid));
    const pages = pl.pages.filter((p) => !done.has(`${bid}/${p.pn}`));
    if (!pages.length || !pages.every((p) => back(bid, p.pn))) continue;
    ready.push({ bid, pl, pages });
    if (LIMIT && ready.length >= LIMIT) break;
  }
  log(`${ready.length} books ready (${ready.reduce((s, b) => s + b.pages.length, 0)} pages)${APPLY ? '' : '  [DRY RUN]'}`);
  const totals = { books: 0, written: 0, conflicts: 0, textless: 0, rejected: 0, has_text_now: 0, human_edited: 0, not_held: 0, errors: 0, why: {} };
  if (!ready.length) { log(`APPLY ${JSON.stringify(totals)}`); return totals; }
  const { name: runName, box } = latestRun();
  const runId = `${LANE}/${runName}${arg('--apply-tag', null) ? `/${arg('--apply-tag')}` : ''}`;
  await withMongo(async (db) => {
    const P = db.collection('pages'), B = db.collection('books');
    for (const { bid, pl, pages } of ready) {
      const book = await B.findOne({ id: bid }, { projection: { id: 1, title: 1, language: 1, pipeline_auto: 1 } });
      if (!book) { log(`${bid} not found — skipping`); continue; }
      if (!LANE_HOLDS.has(book.pipeline_auto?.hold?.reason)) { log(`${bid} NOT held for this lane (${[...LANE_HOLDS].join('|')}) — refusing to write`); totals.not_held++; continue; }
      const live = new Map((await P.find({ id: { $in: pages.map((p) => p.pid) } }, { projection: { id: 1, page_number: 1, book_id: 1, ocr: 1 } }).toArray()).map((p) => [p.id, p]));
      const writes = [];
      for (const pg of pages) {
        const p = live.get(pg.pid);
        if (!p || p.book_id !== bid || p.page_number !== pg.pn) { if (APPLY) append(F.skipped, { bid, pn: pg.pn, why: 'page_moved_or_gone' }); continue; }
        if (isHumanEdited(p.ocr)) { if (APPLY) append(F.skipped, { bid, pn: pg.pn, why: 'human_edited' }); totals.human_edited++; continue; }
        // unread-only: a page that got text since the plan keeps it
        if (!hasNoText(p.ocr)) { if (APPLY) append(F.skipped, { bid, pn: pg.pn, why: 'has_text_now' }); totals.has_text_now++; continue; }
        if (fs.existsSync(outFile(bid, pg.pn, 'err'))) { if (APPLY) append(F.rejected, { bid, pn: pg.pn, pid: pg.pid, reason: 'read_error', detail: fs.readFileSync(outFile(bid, pg.pn, 'err'), 'utf8').slice(0, 300) }); totals.errors++; continue; }
        const r = readJson(outFile(bid, pg.pn, 'json'));
        const v = pageVerdict(r.text, { finish: r.finish });
        if (v.verdict === 'textless') { if (APPLY) append(F.skipped, { bid, pn: pg.pn, why: 'textless', chars: (r.text || '').length }); totals.textless++; continue; }
        if (v.verdict === 'reject') {
          if (APPLY) {
            append(F.rejected, { bid, pn: pg.pn, pid: pg.pid, reason: v.reason, detail: v.detail });
            await recordLoopRefusal(db, { pageId: pg.pid, bookId: bid, pageNumber: pg.pn, text: r.text || '', model: LIGHTON.model, verdict: { share: v.detail?.share ?? 1, body: (r.text || '').length, period: v.detail?.period ?? 0, reps: v.detail?.reps ?? 0 } });
          }
          totals.rejected++; totals.why[v.reason] = (totals.why[v.reason] || 0) + 1; continue;
        }
        const text = envelope(v.body);
        const field = ocrField(text, { run: `${LANE}/${runName}`, imageUrl: pg.src, imageSha256: r.image_sha256 || null, box, why: pg.why, finish: r.finish ?? null });
        writes.push({ pg, p, text, field });
      }
      if (!writes.length) { log(`${bid} nothing to write`); continue; }
      if (!APPLY) { log(`${bid} would write ${writes.length}/${pages.length} pages | ${String(book.title || '').slice(0, 50)}`); totals.written += writes.length; continue; }
      await recordSweepAction(db, { sweep: LANE, book_id: bid, action: 'transcribe-started', detail: { issue: LANE_ISSUE, engine: LIGHTON.model, pages: writes.length, run: runId } });
      const now = new Date();
      let written = 0, conflicts = 0;
      for (const w of writes) {
        const r = await writeLanePage(db, w.p.id, { ...w.field, updated_at: now }, { run: runId });
        if (r.status === 'written') { written++; append(F.applied, { bid, pn: w.pg.pn, pid: w.p.id, why: w.pg.why, chars: w.text.length, revision: r.revision_id }); }
        else { conflicts++; append(F.skipped, { bid, pn: w.pg.pn, why: `write_${r.status}` }); }
      }
      totals.written += written; totals.conflicts += conflicts; totals.books++;
      const { after: counts } = await recountBook(db, bid, { reason: LANE, now });
      await recordSweepAction(db, { sweep: LANE, book_id: bid, action: 'transcribed', detail: { issue: LANE_ISSUE, engine: LIGHTON.model, pages_written: written, conflicts, run: runId } });
      await db.collection('book_events').updateOne(
        { book_id: bid, type: BOOK_EVENT },
        { $setOnInsert: { book_id: bid, type: BOOK_EVENT, at: now, source: LANE, 'details.issue': LANE_ISSUE, 'details.engine': LIGHTON.model, 'details.repo': LIGHTON.repo },
          $set: { 'details.last_apply_at': now, 'details.pages_ocr_after': counts?.pages_ocr ?? null, 'details.planned': pl.pages.length },
          $inc: { 'details.pages_written': written } },
        { upsert: true },
      );
      append(F.bookLog, { bid, written, conflicts, run: runId });
      log(`${bid} wrote ${written}/${writes.length} | ${String(book.title || '').slice(0, 50)}`);
    }
  }, { timeoutMs: 6 * 3600 * 1000 });
  log(`APPLY ${JSON.stringify(totals)}`);
  return totals;
}

function status() {
  const plans = fs.existsSync(F.planDir) ? fs.readdirSync(F.planDir).filter((f) => f.endsWith('.json')) : [];
  let planned = 0, back = 0;
  for (const f of plans) {
    const pl = readJson(path.join(F.planDir, f));
    planned += pl.pages.length;
    back += pl.pages.filter((p) => fs.existsSync(outFile(pl.bid, p.pn, 'json')) || fs.existsSync(outFile(pl.bid, p.pn, 'err'))).length;
  }
  const s = { books_planned: plans.length, pages_planned: planned, pages_back: back, applied: readJsonl(F.applied).length, skipped: readJsonl(F.skipped).length, rejected: readJsonl(F.rejected).length };
  console.log(JSON.stringify(s));
  return s;
}

const CMDS = { frame, plan, apply, status };
if (!CMDS[CMD]) { console.error(`usage: gpu-print-lane.mjs ${Object.keys(CMDS).join('|')} [--dir D] [--apply]`); process.exit(2); }
await CMDS[CMD]();
