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
 *            for any other reason is skipped. The plan file records `placed_hold` (true only when this run held it).
 *            --limit counts books planned. A book with nothing the lane can ever plan (not found, not English 1800+, every
 *            page has text) goes to plan-skipped.jsonl and leaves frame-books.json.
 *   apply    per book whose every planned page is back from the box: re-check each page (still no text, not
 *            human-edited, the book still held for this lane), run the loop guard and the blank floor, write through
 *            writePageText (revision row, CAS), recount, sweep_log before and after, one book_events row. Then the
 *            release sweep below. A scans-only (or any other) hold STAYS. Dry unless --apply.
 *   release  every planned book whose `gpu-print-6871` hold the lane placed and whose planned pages are all applied,
 *            skipped or rejected: releaseBook with reason gpu-print-6871 (restores the status it was held from), one
 *            sweep_log row a release (#6871, Derek 2026-10-31). --abandon with --book/--books releases a book with pages
 *            outstanding (dropped from the lane). Never lifts a hold the lane did not place. Dry unless --apply.
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
import { recountBook, VISIBLE_PAGE_MATCH } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { holdBook, releaseBook, isHeld, isUnsplitSpread } from '../lib/pipeline-hold.mjs';
import { GPU_LANE_HOLDS } from '../batch/cli-ocr-lane.mjs';
import {
  LANE, LANE_ISSUE, HOLD_REASON, HOLD_RELEASE, BOOK_EVENT, LIGHTON,
  laneReleaseVerdict, isEnglishBook, hasNoText, pageVerdict, envelope, ocrField, writeLanePage, isHumanEdited,
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
  bookLog: path.join(DIR, 'applied-books.jsonl'), released: path.join(DIR, 'released.jsonl'), planSkipped: path.join(DIR, 'plan-skipped.jsonl'),
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
/** Holds this lane may write under: its own, and the scans-only holds that wait for a GPU read. Only its own is ever released. */
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
      const owed = await db.collection('pages').countDocuments({ book_id: b.id, ...VISIBLE_PAGE_MATCH, ...NO_TEXT, 'ocr.edited_by': { $exists: false } });
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
  const gone = new Set(readJsonl(F.planSkipped).map((r) => r.bid));
  ids = ids.filter((id) => !fs.existsSync(planFile(id)) && !gone.has(id));
  // --limit counts books PLANNED, not books looked at: sliced before the skips, a head of books with nothing to read
  // (38 of 40 on 2026-10-31) left each chunk planning two books and the frame's tail unreachable.
  log(`${ids.length} book(s) not yet planned${LIMIT ? `, planning up to ${LIMIT}` : ''}${APPLY ? '' : '  [DRY RUN: no holds, no plan files]'}`);
  const tally = { books: 0, pages: 0, no_image: 0, skipped_books: [] };
  // A book with nothing this lane can ever plan leaves the frame (and the filler's pages-left count) for good.
  const final = [];
  const finalSkip = (bid, why) => { tally.skipped_books.push({ bid, why }); if (APPLY) final.push({ bid, why }); };
  await withMongo(async (db) => {
    for (const bid of ids) {
      if (LIMIT && tally.books >= LIMIT) break;
      const book = await db.collection('books').findOne({ id: bid }, { projection: { id: 1, title: 1, language: 1, year: 1, pipeline_auto: 1, pages_count: 1, needs_splitting: 1, split_completed: 1 } });
      if (!book) { finalSkip(bid, 'not_found'); continue; }
      if (!isEnglishBook(book.language) || !(book.year >= 1800)) { finalSkip(bid, 'not English 1800+'); continue; }
      if (isUnsplitSpread(book)) { tally.skipped_books.push({ bid, why: 'needs_splitting (#7605)' }); continue; }
      if (isHeld(book) && !LANE_HOLDS.has(book.pipeline_auto.hold.reason)) { tally.skipped_books.push({ bid, why: `held: ${book.pipeline_auto.hold.reason}` }); continue; }
      const pages = await db.collection('pages').find({ book_id: book.id, ...VISIBLE_PAGE_MATCH, ...NO_TEXT }, { projection: {
        id: 1, page_number: 1, ocr: 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, crop: 1,
      } }).sort({ page_number: 1 }).toArray();
      const rows = [];
      let noImage = 0;
      for (const p of pages) {
        if (isHumanEdited(p.ocr) || !hasNoText(p.ocr)) continue;
        const src = getPageSource(p)?.replace(/\s+/g, '') || null;
        if (!src) { tally.no_image++; noImage++; continue; }
        rows.push({ pid: p.id, pn: p.page_number, src, why: p.ocr?.model || (p.ocr?.recitation_count ? 'refused' : 'never_read') });
      }
      // every page has text or a human edit: final. Pages still waiting for an image may be archived later: retried.
      if (!rows.length) { if (noImage) tally.skipped_books.push({ bid, why: 'no_image' }); else finalSkip(bid, 'nothing_to_read'); continue; }
      if (!APPLY) { log(`${bid} would ${isHeld(book) ? "plan" : "hold and plan"} ${rows.length} pages | ${String(book.title).slice(0, 50)}`); tally.books++; tally.pages += rows.length; continue; }
      // the hold BEFORE anything else: no other lane reads these pages while the GPU does. A book already under a
      // GPU-lane hold keeps that hold (nothing else reads it); a free book (--free frame) is held for this lane.
      const h = isHeld(book) ? { outcome: 'already_held', from: book.pipeline_auto.hold.held_from_status ?? null }
        : await holdBook(db, book.id, { reason: HOLD_REASON, issue: LANE_ISSUE, release: HOLD_RELEASE, source: LANE, detail: { engine: LIGHTON.model, planned_pages: rows.length } });
      if (!['held', 'already_held'].includes(h.outcome)) { tally.skipped_books.push({ bid, why: `hold ${h.outcome}` }); continue; }
      fs.writeFileSync(planFile(book.id), JSON.stringify({ bid: book.id, title: book.title, language: book.language, year: book.year, hold: book.pipeline_auto?.hold?.reason ?? HOLD_REASON, placed_hold: h.outcome === 'held', held_from: h.from ?? null, planned_at: new Date().toISOString(), pages: rows }));
      fs.appendFileSync(F.manifest, rows.map((r) => `${book.id}\t${r.pn}\t${r.pid}\t${r.src}`).join('\n') + '\n');
      tally.books++; tally.pages += rows.length;
    }
  });
  if (final.length) {
    for (const r of final) append(F.planSkipped, r);
    const fr = readJson(F.frame, null);
    if (fr) {
      const out = new Set(final.map((r) => r.bid));
      fs.writeFileSync(`${F.frame}.tmp`, JSON.stringify({ ...fr, books: fr.books.filter((b) => !out.has(b.bid)) }, null, 1));
      fs.renameSync(`${F.frame}.tmp`, F.frame);
    }
  }
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
  if (!ready.length) {
    if (APPLY) await withMongo(async (db) => { totals.released = (await releaseSweep(db)).released; }, { timeoutMs: 3600 * 1000 });
    log(`APPLY ${JSON.stringify(totals)}`); return totals;
  }
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
    if (APPLY) totals.released = (await releaseSweep(db)).released;
  }, { timeoutMs: 6 * 3600 * 1000 });
  log(`APPLY ${JSON.stringify(totals)}`);
  return totals;
}

// ── release (only the holds this lane placed) ───────────────────────────────────────────

/**
 * Release the `gpu-print-6871` hold of every planned book the lane held itself and has finished (laneReleaseVerdict).
 * The reason goes to releaseBook as well, so the write itself cannot lift another hold. Called by `release` and at the
 * end of `apply --apply`.
 */
async function releaseSweep(db, { abandon = false } = {}) {
  const done = new Set([...readJsonl(F.applied), ...readJsonl(F.skipped), ...readJsonl(F.rejected)].map((r) => `${r.bid}/${r.pn}`));
  let books = fs.existsSync(F.planDir) ? fs.readdirSync(F.planDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  if (BOOK) books = books.filter((b) => b === BOOK);
  if (arg('--books', null)) { const want = new Set(fs.readFileSync(arg('--books'), 'utf8').split('\n').map((s) => s.trim())); books = books.filter((b) => want.has(b)); }
  const gone = new Set(readJsonl(F.released).map((r) => r.bid));
  const tally = { released: 0, candidates: 0, why: {} };
  for (const bid of books.sort()) {
    if (gone.has(bid)) continue;
    const pl = readJson(planFile(bid));
    if (pl.placed_hold !== true) continue; // the common case: the book came in under a scans-only hold, which stays
    tally.candidates++;
    const book = await db.collection('books').findOne({ id: bid }, { projection: { id: 1, title: 1, pipeline_auto: 1 } });
    const v = laneReleaseVerdict(pl, book?.pipeline_auto?.hold, (pn) => done.has(`${bid}/${pn}`), { abandon });
    if (!v.release) { tally.why[v.why] = (tally.why[v.why] || 0) + 1; continue; }
    if (!APPLY) { log(`${bid} would release ${HOLD_REASON} (${v.why}) → ${book.pipeline_auto.hold.held_from_status ?? 'default'} | ${String(book.title || '').slice(0, 50)}`); tally.released++; continue; }
    const r = await releaseBook(db, bid, { reason: HOLD_REASON, source: LANE, note: `gpu-print-lane.mjs release: ${v.why}${v.outstanding ? `, ${v.outstanding} planned pages outstanding` : ''} (#${LANE_ISSUE})` });
    if (r.outcome !== 'released') { tally.why[`release_${r.outcome}`] = (tally.why[`release_${r.outcome}`] || 0) + 1; log(`${bid} release ${r.outcome}`); continue; }
    // an abandoned book's outstanding pages are ledgered, so a read that comes back later is not applied to a free book
    for (const p of pl.pages) if (!done.has(`${bid}/${p.pn}`)) append(F.skipped, { bid, pn: p.pn, why: 'abandoned_released' });
    await recordSweepAction(db, { sweep: LANE, book_id: bid, action: 'hold-released', detail: { issue: LANE_ISSUE, reason: HOLD_REASON, why: v.why, outstanding: v.outstanding ?? 0, planned: pl.pages.length, to_status: r.to } });
    append(F.released, { bid, why: v.why, to: r.to, outstanding: v.outstanding ?? 0 });
    tally.released++;
    log(`${bid} released ${HOLD_REASON} → ${r.to} (${v.why}) | ${String(book.title || '').slice(0, 50)}`);
  }
  log(`RELEASE ${JSON.stringify(tally)}${APPLY ? '' : '  [DRY RUN]'}`);
  return tally;
}

async function release() {
  if (flag('--abandon') && !BOOK && !arg('--books', null)) { console.error('--abandon needs --book or --books'); process.exit(2); }
  let t;
  await withMongo(async (db) => { t = await releaseSweep(db, { abandon: flag('--abandon') }); }, { timeoutMs: 3600 * 1000 });
  return t;
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

const CMDS = { frame, plan, apply, release, status };
if (!CMDS[CMD]) { console.error(`usage: gpu-print-lane.mjs ${Object.keys(CMDS).join('|')} [--dir D] [--apply]`); process.exit(2); }
await CMDS[CMD]();
