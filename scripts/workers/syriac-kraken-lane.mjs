#!/usr/bin/env node
/**
 * PRIOR ART: /root/tibetan-reocr/relaunch.sh + reocr_worker.py (#4523 — the same lane
 * shape: a todo file, one output file per page, cron relaunch, apply as a separate step;
 * it runs a GPU model on rented boxes and is not in this repo); scripts/maintenance/
 * apply-reocr-verdicts.mjs (its apply half — consumes a verdict file, writes revisions
 * first, no routing, no counters, no re-enrolment); scripts/import/ia-ocr-ingest.mjs (an
 * OCR writer with full provenance and counters, but only for EMPTY pages and only from a
 * file the Archive already made). Policy, routing and provenance live in
 * scripts/lib/syriac-kraken-lane.mjs; this file is the machinery.
 *
 * The Syriac Kraken lane (#4883): re-transcribe every Syriac page with the open Kraken
 * models on Hetzner CPU, looped pages first, and hand the result to the pipeline.
 *
 *   plan     read the corpus once, decide per book (route) and per page (policy), write
 *            plan.jsonl ordered phase 1 (loops — the certain damage) then phase 2 (the rest)
 *   work     one shard: fetch page images, run Kraken in batches, one .txt per page —
 *            the output file IS the checkpoint; a restart re-scans and never redoes a page
 *   apply    per book: revisions first, loop-guard the new text, write with provenance,
 *            resync counters, sweep_log + book_events, and stamp `translation_stale` on
 *            every rewritten page that still carries a real translation (#4927's fact)
 *   stale    re-run that stamp over everything applied (idempotent)
 *   reenrol  (paid, separate, dry by default) send re-transcribed books back to
 *            `ocr_complete` so translate-worker re-translates the pages whose OCR is now
 *            newer than their English; prints the page count and a price first
 *   release  lift the `syriac-ocr-lane-trial` hold on a held book whose pages are all done
 *   status   what the files say (planned / read / applied / failed / refused, loop rate)
 *
 * Nothing here hides a page or a book, at any level (Derek, 2026-09-18). No Gemini call is
 * made anywhere in this file. Every Mongo walk `.toArray()`s its id list before slow work
 * (`lesson_corpus_walks_need_a_checkpoint_first`); the only cursor held open is over a
 * single book's pages.
 *
 * Run on Hetzner (models + venv already there):
 *   cd /root/sourcelibrary && node --env-file=.env.production.local scripts/workers/syriac-kraken-lane.mjs plan
 *   node --env-file=.env.production.local scripts/workers/syriac-kraken-lane.mjs work --shard 0 --shards 2
 *   node --env-file=.env.production.local scripts/workers/syriac-kraken-lane.mjs apply --apply [--book <id>] [--limit N]
 *   node --env-file=.env.production.local scripts/workers/syriac-kraken-lane.mjs release --apply
 *   node --env-file=.env.production.local scripts/workers/syriac-kraken-lane.mjs status
 * Options: --dir /root/syriac-kraken (lane directory)  --book <id>  --limit N (pages for work, books
 *          for apply)  --phase 1|2  --batch 12  --retry-failed  --models <dir>  --kraken <bin>
 * `scripts/workers/syriac-kraken-relaunch.sh` keeps the shards alive from cron.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { withMongo } from '../lib/mongo.mjs';
import { loopVerdict, recordLoopRefusal } from '../lib/ocr-loop-guard.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { NOT_HELD, releaseBook, isHeld } from '../lib/pipeline-hold.mjs';
import {
  LANE, LANE_ISSUE, REVISION_REASON, BOOK_EVENT, ENGINES, KRAKEN,
  routeBook, scriptTagCounts, pagePolicy, envelope, letterCount, ocrSetFields,
  STALE_OCR_FIELDS, reenrolDecision, isHumanEdited, hasRealTranslation, markTranslationsStale,
} from '../lib/syriac-kraken-lane.mjs';

const argv = process.argv.slice(2);
const CMD = argv[0];
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const DIR = arg('--dir', '/root/syriac-kraken');
const APPLY = flag('--apply');
const BOOK = arg('--book', null);
const LIMIT = Number(arg('--limit', 0)) || 0;
const PHASE = Number(arg('--phase', 0)) || 0;
const SHARD = Number(arg('--shard', 0)) || 0;
const SHARDS = Number(arg('--shards', 1)) || 1;
const BATCH = Number(arg('--batch', 12)) || 12;
const RETRY_FAILED = flag('--retry-failed');
const MODELS = arg('--models', '/root/ocr-bench/syriac-retest/models');
const KRAKEN_BIN = arg('--kraken', '/root/bench2-kraken/venv/bin/kraken');
const RUN = arg('--run', `${LANE}/${new Date().toISOString().slice(0, 10)}`);
/** Below this many letters a Kraken read is "textless": it replaces a loop, never a reading. */
const MIN_LETTERS = 12;
const HELD_REASON = 'syriac-ocr-lane-trial';

const F = {
  books: path.join(DIR, 'books.json'),
  plan: path.join(DIR, 'plan.jsonl'),
  runs: path.join(DIR, 'runs.jsonl'),
  fail: path.join(DIR, 'fail.jsonl'),
  applied: path.join(DIR, 'applied.jsonl'),
  refused: path.join(DIR, 'refused.jsonl'),
  skipped: path.join(DIR, 'skipped.jsonl'),
  log: path.join(DIR, 'lane.log'),
};
const outDir = (bid) => path.join(DIR, 'out', bid);
const outTxt = (bid, pn) => path.join(outDir(bid), `${pn}.txt`);
const outSkip = (bid, pn) => path.join(outDir(bid), `${pn}.skip`);
const imgDir = (bid) => path.join(DIR, 'img', bid);

function log(msg) {
  const line = `${new Date().toISOString()} [${CMD}${SHARDS > 1 ? ` ${SHARD}/${SHARDS}` : ''}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(F.log, line + '\n'); } catch {}
}
const append = (file, row) => fs.appendFileSync(file, JSON.stringify({ ...row, at: new Date().toISOString() }) + '\n');
const readJsonl = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const key = (r) => `${r.bid}/${r.pn}`;
const bookId = (b) => b.id || String(b._id);

// ── plan ───────────────────────────────────────────────────────────────────────────────

async function plan() {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(F.plan) && !flag('--refresh') && !BOOK) {
    log(`plan exists (${readJsonl(F.plan).length} rows) — pass --refresh to rebuild; --book <id> adds one book`);
    return;
  }
  await withMongo(async (db) => {
    const q = BOOK ? { $or: [{ id: BOOK }, { _id: BOOK }] } : { language: 'Syriac' };
    const books = await db.collection('books').find(q, { projection: {
      id: 1, title: 1, published: 1, visible: 1, hidden_reason: 1, pages_count: 1, pages_ocr: 1,
      'image_source.provider': 1, 'image_source.identifier': 1, ia_identifier: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1,
    } }).toArray();
    log(`${books.length} book(s) with language: Syriac`);
    // books.json carries two hand-kept maps that survive a --refresh: `__overrides`
    // (book id → route) and `__exclude` (book id → why this book is not Syriac at all,
    // e.g. a Mandaic or Hebrew text mislabelled `language: Syriac` — report it, don't read it)
    const prior = fs.existsSync(F.books) ? JSON.parse(fs.readFileSync(F.books, 'utf8')) : {};
    const overrides = prior.__overrides || {};
    const exclude = prior.__exclude || {};
    const bookOut = BOOK ? prior : { __overrides: overrides, __exclude: exclude };
    const rows = [];
    const tally = { books: 0, skipped_books: [], pages: 0, loop: 0, syriac: 0, first_write: 0, short: 0, keep: {} };
    for (const b of books) {
      const bid = bookId(b);
      const hr = String(b.hidden_reason || '');
      if (hr && !/^(unprocessed|launch_curation)$/.test(hr)) { tally.skipped_books.push({ bid, why: `hidden_reason: ${hr.slice(0, 60)}` }); continue; }
      if (exclude[bid]) { tally.skipped_books.push({ bid, why: `excluded: ${exclude[bid]}` }); continue; }
      const pages = await db.collection('pages').find({ book_id: bid, page_number: { $gt: 0 } }, { projection: {
        id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.edited_by': 1, 'ocr.edited_at': 1, 'ocr.pipeline': 1,
        photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1,
      } }).sort({ page_number: 1 }).toArray();
      const tags = scriptTagCounts(pages.map((p) => p.ocr?.data));
      const route = routeBook(b, tags, overrides);
      const rec = { bid, title: b.title, published: b.published, provider: b.image_source?.provider || null, visible: b.visible === true, hidden_reason: b.hidden_reason || null,
        status: b.pipeline_auto?.status || null, hold: b.pipeline_auto?.hold?.reason || null, pages: pages.length, ...route, scriptTags: tags, planned: 0, keep: {} };
      for (const p of pages) {
        if (p.ocr?.pipeline === LANE) continue; // already this lane's reading
        const lv = p.ocr?.data ? loopVerdict(p.ocr.data) : { refuse: false };
        const pol = pagePolicy(p, { loopRefused: lv.refuse });
        if (pol.action === 'keep') { rec.keep[pol.why] = (rec.keep[pol.why] || 0) + 1; tally.keep[pol.why] = (tally.keep[pol.why] || 0) + 1; continue; }
        const src = getPageSource(p);
        if (!src) { rec.keep.no_image = (rec.keep.no_image || 0) + 1; tally.keep.no_image = (tally.keep.no_image || 0) + 1; continue; }
        rows.push({ bid, pid: p.id, pn: p.page_number, engine: route.engine, route: route.route, why: pol.why, phase: pol.why === 'loop' ? 1 : 2, src, old_model: p.ocr?.model || null });
        rec.planned++; tally[pol.why]++;
      }
      tally.books++; tally.pages += rec.planned;
      bookOut[bid] = rec;
      log(`${bid} ${route.route.padEnd(10)} ${route.engine.padEnd(13)} planned ${String(rec.planned).padStart(4)}/${String(pages.length).padStart(4)} keep ${JSON.stringify(rec.keep)} ${route.why} | ${String(b.title || '').slice(0, 48)}`);
    }
    rows.sort((a, b) => a.phase - b.phase || a.bid.localeCompare(b.bid) || a.pn - b.pn);
    if (BOOK) { // add to an existing plan (dedup by page)
      const have = new Set(readJsonl(F.plan).map(key));
      const add = rows.filter((r) => !have.has(key(r)));
      fs.appendFileSync(F.plan, add.map((r) => JSON.stringify(r) + '\n').join(''));
      log(`appended ${add.length} rows for ${BOOK}`);
    } else {
      fs.writeFileSync(F.plan, rows.map((r) => JSON.stringify(r) + '\n').join(''));
    }
    fs.writeFileSync(F.books, JSON.stringify(bookOut, null, 1));
    log(`PLAN ${JSON.stringify(tally)}`);
  }, { timeoutMs: 4 * 3600 * 1000 });
}

// ── work ───────────────────────────────────────────────────────────────────────────────

async function fetchImage(url, dest) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { 'User-Agent': 'sourcelibrary-syriac-kraken-lane/1 (derek@sourcelibrary.org)' } });
      if (res.status === 429 || res.status === 503) { await new Promise((r) => setTimeout(r, 15_000 * attempt)); continue; }
      if (!res.ok) return `HTTP ${res.status}`;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2000) return `tiny ${buf.length}B`;
      fs.writeFileSync(dest, buf);
      return null;
    } catch (e) {
      if (attempt === 3) return `fetch: ${e?.message || e}`.slice(0, 120);
      await new Promise((r) => setTimeout(r, 5_000 * attempt));
    }
  }
  return 'fetch: gave up';
}

/**
 * Tesseract's orientation-and-script pass, print only. Measured 2026-09-18 on Hetzner:
 * printed Syriac → "Arabic" (88.9); printed Latin → Latin/Fraktur (0.2–6.7). Manuscript
 * pages are NOT reliable (a Syriac MS page came back "Latin 8.33", another "Devanagari"),
 * so it is asked only on first-write pages of printed books, where the bilingual editions
 * put English or French leaves a Syriac model would turn into junk. Latin/Fraktur → leave
 * the page for the ordinary lane; anything else → Kraken.
 */
function osdScript(img) {
  const r = spawnSync('tesseract', [img, '-', '--psm', '0'], { encoding: 'utf8', timeout: 60_000 });
  const m = /^Script:\s*(\S+)/m.exec((r.stdout || '') + (r.stderr || ''));
  return m ? m[1] : null;
}

function runKraken(engineKey, pairs, timeoutMs) {
  const e = ENGINES[engineKey];
  const args = [];
  for (const [img, out] of pairs) args.push('-i', img, out);
  args.push('segment', '-bl', '-d', KRAKEN.direction, 'ocr', '-m', path.join(MODELS, e.file), '--base-dir', KRAKEN.base_dir);
  const t0 = Date.now();
  const r = spawnSync('nice', ['-n', '10', KRAKEN_BIN, ...args], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || '2' } });
  return { rc: r.status, signal: r.signal, secs: Math.round((Date.now() - t0) / 1000), err: (r.stderr || '').slice(-2000) };
}

async function work() {
  fs.mkdirSync(DIR, { recursive: true });
  const all = readJsonl(F.plan);
  const failed = new Set(readJsonl(F.fail).map(key));
  let todo = all.filter((r, i) => i % SHARDS === SHARD && (!PHASE || r.phase === PHASE) && (!BOOK || r.bid === BOOK)
    && !fs.existsSync(outTxt(r.bid, r.pn)) && !fs.existsSync(outSkip(r.bid, r.pn)) && (RETRY_FAILED || !failed.has(key(r))));
  if (LIMIT) todo = todo.slice(0, LIMIT);
  log(`plan ${all.length} rows; this shard has ${todo.length} to read`);
  let done = 0, skipped = 0, fails = 0;
  while (todo.length) {
    // one Kraken process per batch of pages sharing an engine (model load amortised)
    const engine = todo[0].engine;
    const batch = []; const rest = [];
    for (const r of todo) (batch.length < BATCH && r.engine === engine ? batch : rest).push(r);
    todo = rest;
    const pairs = [];
    for (const r of batch) {
      fs.mkdirSync(imgDir(r.bid), { recursive: true }); fs.mkdirSync(outDir(r.bid), { recursive: true });
      const img = path.join(imgDir(r.bid), `${r.pn}.jpg`);
      const err = await fetchImage(r.src, img);
      if (err) { append(F.fail, { bid: r.bid, pn: r.pn, stage: 'fetch', reason: err, src: r.src }); fails++; continue; }
      if (r.why === 'first_write' && r.route === 'print') {
        const script = osdScript(img);
        if (script === 'Latin' || script === 'Fraktur') {
          fs.writeFileSync(outSkip(r.bid, r.pn), JSON.stringify({ why: 'osd_latin', script }));
          append(F.skipped, { bid: r.bid, pn: r.pn, why: 'osd_latin', script });
          fs.rmSync(img, { force: true }); skipped++; continue;
        }
      }
      pairs.push([img, outTxt(r.bid, r.pn), r]);
    }
    if (!pairs.length) continue;
    const res = runKraken(engine, pairs.map(([i, o]) => [i, o]), 240_000 * pairs.length);
    // pages the batch did not produce are retried alone, so one bad image cannot take
    // the batch down with it (the retest driver's rule: a failed page is a row, never a wait)
    const missing = pairs.filter(([, o]) => !fs.existsSync(o));
    for (const [img, out, r] of missing) {
      const one = runKraken(engine, [[img, out]], 600_000);
      if (!fs.existsSync(out)) { append(F.fail, { bid: r.bid, pn: r.pn, stage: 'kraken', rc: one.rc, signal: one.signal, secs: one.secs, err: one.err.slice(-300) }); fails++; }
      else append(F.runs, { bid: r.bid, pn: r.pn, engine, secs: one.secs, rc: one.rc, chars: fs.statSync(out).size, retry: true });
    }
    for (const [img, out, r] of pairs) {
      if (fs.existsSync(out) && !missing.some(([, o]) => o === out)) append(F.runs, { bid: r.bid, pn: r.pn, engine, secs: +(res.secs / pairs.length).toFixed(1), rc: res.rc, chars: fs.statSync(out).size });
      if (fs.existsSync(out)) done++;
      fs.rmSync(img, { force: true });
    }
    log(`batch ${engine} ${pairs.length} pages in ${res.secs}s (rc ${res.rc}${missing.length ? `, ${missing.length} retried alone` : ''}) — read ${done}, skipped ${skipped}, failed ${fails}, left ${todo.length}`);
  }
  log(`shard done: read ${done}, skipped ${skipped}, failed ${fails}`);
}

// ── apply ──────────────────────────────────────────────────────────────────────────────

async function apply() {
  const books = JSON.parse(fs.readFileSync(F.books, 'utf8'));
  const applied = new Set(readJsonl(F.applied).map(key));
  const refused = new Set(readJsonl(F.refused).map(key));
  const skippedApply = new Set(readJsonl(F.skipped).filter((r) => r.stage === 'apply').map(key));
  const plan = readJsonl(F.plan);
  const pending = plan.filter((r) => (!BOOK || r.bid === BOOK) && !applied.has(key(r)) && !refused.has(key(r)) && !skippedApply.has(key(r)) && fs.existsSync(outTxt(r.bid, r.pn)));
  const byBook = new Map();
  for (const r of pending) { if (!byBook.has(r.bid)) byBook.set(r.bid, []); byBook.get(r.bid).push(r); }
  let bids = [...byBook.keys()];
  if (LIMIT) bids = bids.slice(0, LIMIT);
  log(`${pending.length} read pages pending apply across ${byBook.size} books${APPLY ? '' : '  [DRY RUN]'}`);
  const totals = { books: 0, written: 0, stale_marked: 0, textless_kept: 0, refused: 0, human_edited: 0, unchanged: 0 };
  await withMongo(async (db) => {
    const P = db.collection('pages'), B = db.collection('books');
    for (const bid of bids) {
      const rows = byBook.get(bid);
      const book = await B.findOne({ $or: [{ id: bid }, { _id: bid }] }, { projection: { id: 1, title: 1, hidden_reason: 1, pipeline_auto: 1, pages_count: 1 } });
      if (!book) { log(`${bid} not found — skipping`); continue; }
      const pages = await P.find({ id: { $in: rows.map((r) => r.pid) } }, { projection: { id: 1, page_number: 1, book_id: 1, ocr: 1, 'translation.health_blocked': 1 } }).toArray();
      const byId = new Map(pages.map((p) => [p.id, p]));
      const writes = [];
      for (const r of rows) {
        const p = byId.get(r.pid);
        if (!p) { append(F.skipped, { stage: 'apply', bid, pn: r.pn, why: 'page_gone' }); continue; }
        if (isHumanEdited(p.ocr)) { append(F.skipped, { stage: 'apply', bid, pn: r.pn, why: 'human_edited' }); totals.human_edited++; continue; }
        if (p.ocr?.pipeline === LANE) { append(F.applied, { bid, pn: r.pn, pid: r.pid, why: r.why, note: 'already_this_lane' }); totals.unchanged++; continue; }
        const raw = fs.readFileSync(outTxt(bid, r.pn), 'utf8');
        const letters = letterCount(raw);
        const oldLoop = p.ocr?.data ? loopVerdict(p.ocr.data).refuse : false;
        if (letters < MIN_LETTERS && p.ocr?.data && !oldLoop) {
          // Kraken read nothing on a page the model read something on: keep the reading
          // and say so — a blank Kraken file replacing prose would be withholding by accident.
          append(F.skipped, { stage: 'apply', bid, pn: r.pn, why: 'kraken_textless_kept', letters, old_letters: letterCount(p.ocr.data) });
          totals.textless_kept++; continue;
        }
        const text = envelope(raw, r.route);
        const v = loopVerdict(text);
        if (v.refuse) {
          if (APPLY) await recordLoopRefusal(db, { pageId: p.id, bookId: bid, pageNumber: p.page_number, text, model: `kraken/${r.engine}`, verdict: v });
          append(F.refused, { bid, pn: r.pn, pid: r.pid, share: v.share, period: v.period });
          totals.refused++; continue;
        }
        writes.push({ r, p, text, letters, oldLoop, oldLetters: letterCount(p.ocr?.data) });
      }
      const rec = books[bid] || { title: book.title };
      const secsBy = new Map(readJsonl(F.runs).filter((x) => x.bid === bid).map((x) => [x.pn, x.secs]));
      if (!APPLY) { log(`${bid} would write ${writes.length} of ${rows.length} read pages | ${String(book.title || '').slice(0, 50)}`); totals.written += writes.length; continue; }
      if (!writes.length) { log(`${bid} nothing to write`); continue; }
      const pids = writes.map((w) => w.p.id);
      // saveRevisions stores nothing for an empty page or a bare marker — expect exactly the rest
      const withText = writes.filter((w) => w.p.ocr?.data && w.p.ocr.data !== '[RECITATION_BLOCKED]').length;
      const nRev = await saveRevisionsBeforeOverwrite(db, pids, 'ocr', { reason: REVISION_REASON });
      if (nRev !== withText) { log(`ABORT ${bid}: saved ${nRev} revisions for ${withText} pages with text — not overwriting`); continue; }
      const now = new Date();
      let modified = 0;
      const unset = Object.fromEntries([...STALE_OCR_FIELDS, 'translation.health_blocked', 'translation.health_blocked_at'].map((k) => [k, '']));
      for (const w of writes) {
        const set = ocrSetFields(w.text, w.r.engine, w.r.route, { run: RUN, now, secs: secsBy.get(w.r.pn) ?? null });
        // Pipeline update because `ocr` is literally null on never-read pages and a dotted
        // $set cannot create fields inside null (the error that crashed the first IA apply,
        // 2026-09-12). Every value is $literal: in a pipeline a string beginning with `$`
        // is a field path, and a transcription is arbitrary text.
        const literal = Object.fromEntries(Object.entries(set).map(([k, v]) => [k, { $literal: v }]));
        // the filter re-checks the human-edit guard at write time, not just at plan time
        const res = await P.updateOne({ id: w.p.id, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' } }, [
          { $set: { ocr: { $cond: { if: { $eq: [{ $type: '$ocr' }, 'object'] }, then: '$ocr', else: {} } } } },
          { $set: literal },
          { $unset: Object.keys(unset) },
        ]);
        modified += res.modifiedCount;
        append(F.applied, { bid, pn: w.r.pn, pid: w.p.id, why: w.r.why, engine: w.r.engine, letters: w.letters, old_letters: w.oldLetters, old_loop: w.oldLoop, modified: res.modifiedCount });
      }
      totals.written += modified; totals.books++;
      // Every rewritten page that still carries a real translation now serves English made
      // from text that is gone. Say so ON THE PAGE (#4927's `translation_stale`), so the
      // re-translate consumer finds it — never hide the English (Derek, 2026-09-18).
      const stale = await markTranslationsStale(db, writes.map((w) => ({ id: w.p.id, text: w.text })), now);
      totals.stale_marked += stale;
      const [counts] = await P.aggregate(buildVisiblePageCountPipeline(bid)).toArray();
      await B.updateOne({ _id: book._id }, { $set: { pages_ocr: counts?.with_ocr ?? 0, pages_translated: counts?.with_translation ?? 0, updated_at: now } });
      const loopsFixed = writes.filter((w) => w.oldLoop).length;
      await recordSweepAction(db, { sweep: LANE, book_id: bid, action: 'retranscribed', detail: { issue: LANE_ISSUE, engine: writes[0].r.engine, route: writes[0].r.route, pages_written: modified, loops_replaced: loopsFixed, first_writes: writes.filter((w) => !w.p.ocr?.data).length, run: RUN, pages_ocr_after: counts?.with_ocr ?? null } });
      // one book_events row per book, advanced in place as the lane works through it
      // (every operator addresses a LEAF under `details` — a `$setOnInsert` of the whole
      // `details` object beside a `$set` of `details.x` is a path conflict, Mongo error 40)
      await db.collection('book_events').updateOne(
        { book_id: bid, type: BOOK_EVENT },
        { $setOnInsert: { book_id: bid, type: BOOK_EVENT, at: now, source: 'syriac-kraken-lane', 'details.issue': LANE_ISSUE, 'details.engine': writes[0].r.engine, 'details.route': writes[0].r.route, 'details.model_doi': ENGINES[writes[0].r.engine].model_doi },
          $set: { 'details.last_apply_at': now, 'details.pages_ocr_after': counts?.with_ocr ?? null, 'details.planned': rec.planned ?? null },
          $inc: { 'details.pages_written': modified, 'details.loops_replaced': loopsFixed } },
        { upsert: true },
      );
      log(`${bid} wrote ${modified}/${writes.length} (loops replaced ${loopsFixed}, revisions ${nRev}, translations marked stale ${stale}) → pages_ocr ${counts?.with_ocr}/${counts?.total} | ${String(book.title || '').slice(0, 50)}`);
    }
  }, { timeoutMs: 4 * 3600 * 1000 });
  log(`APPLY ${JSON.stringify(totals)}`);
}

// ── stale ──────────────────────────────────────────────────────────────────────────────

/** Re-run the staleness stamp over every page this lane has applied (idempotent) — for
 *  pages applied before the marker existed, or after a consumer cleared it and the OCR
 *  changed again. Reads the stored text back so the hash guard is exact. */
async function stale() {
  const applied = readJsonl(F.applied).filter((r) => r.modified === 1 && (!BOOK || r.bid === BOOK));
  let marked = 0;
  await withMongo(async (db) => {
    for (let i = 0; i < applied.length; i += 200) {
      const chunk = applied.slice(i, i + 200);
      const pages = await db.collection('pages').find({ id: { $in: chunk.map((r) => r.pid) }, 'ocr.pipeline': LANE }, { projection: { id: 1, 'ocr.data': 1 } }).toArray();
      if (APPLY) marked += await markTranslationsStale(db, pages.map((p) => ({ id: p.id, text: p.ocr?.data })));
      else marked += await db.collection('pages').countDocuments({ id: { $in: pages.map((p) => p.id) }, 'translation.data': { $type: 'string', $nin: ['', null] }, translation_stale: { $exists: false } });
    }
  }, { timeoutMs: 3600 * 1000 });
  log(`STALE ${APPLY ? 'marked' : 'would mark'} ${marked} of ${applied.length} applied pages${APPLY ? '' : '  [DRY RUN]'}`);
}

// ── reenrol ────────────────────────────────────────────────────────────────────────────

/**
 * Hand re-transcribed books back to the pipeline for RE-TRANSLATION. Every page this lane
 * rewrote carries `ocr.updated_at` newer than its `translation.updated_at`; translate-worker
 * already re-selects exactly those pages — but only for books at `ocr_complete`, so the
 * book's status has to go back there. That is a paid step (every re-translated page is a
 * Gemini call at the dial's pace), so it is separate from `apply`, dry by default, and
 * prints the page count and a price first (`feedback_ask_before_spending`). Between apply
 * and this step the page serves its old English — found by the timestamp comparison, and
 * by `ocr.pipeline`, which the stale-translation rule keys on (#4927 generalises this).
 */
async function reenrol() {
  const applied = readJsonl(F.applied).filter((r) => r.modified === 1);
  const byBook = new Map();
  for (const r of applied) byBook.set(r.bid, (byBook.get(r.bid) || 0) + 1);
  const PRICE_PER_PAGE = 0.001; // flash-lite, ~2.5K in + 1.5K out per page — an estimate, say so
  const totals = { books: 0, pages_stale: 0, pages_untranslated: 0, reenrolled: 0, skipped: {} };
  await withMongo(async (db) => {
    const P = db.collection('pages'), B = db.collection('books');
    for (const [bid, n] of byBook) {
      if (BOOK && bid !== BOOK) continue;
      const book = await B.findOne({ id: bid }, { projection: { id: 1, title: 1, hidden_reason: 1, pipeline_auto: 1 } });
      if (!book) continue;
      const [counts] = await P.aggregate(buildVisiblePageCountPipeline(bid)).toArray();
      const dec = reenrolDecision(book, counts);
      const stale = await P.countDocuments({ book_id: bid, 'ocr.pipeline': LANE, 'translation.data': { $exists: true, $nin: [null, ''] }, $expr: { $lt: ['$translation.updated_at', '$ocr.updated_at'] } });
      const untranslated = await P.countDocuments({ book_id: bid, 'ocr.pipeline': LANE, $or: [{ 'translation.data': { $exists: false } }, { 'translation.data': null }, { 'translation.data': '' }] });
      const status = book.pipeline_auto?.status || null;
      if (!dec.ok) { totals.skipped[dec.why] = (totals.skipped[dec.why] || 0) + 1; log(`${bid} skip (${dec.why}) — ${stale} stale + ${untranslated} untranslated lane pages | ${String(book.title || '').slice(0, 50)}`); continue; }
      totals.books++; totals.pages_stale += stale; totals.pages_untranslated += untranslated;
      log(`${bid} ${status} → ocr_complete: ${stale} stale + ${untranslated} untranslated of ${n} lane pages${APPLY ? '' : '  [DRY RUN]'} | ${String(book.title || '').slice(0, 50)}`);
      if (!APPLY || status === 'ocr_complete') continue;
      const now = new Date();
      const r = await B.updateOne({ _id: book._id, 'pipeline_auto.status': status, ...NOT_HELD }, { $set: { 'pipeline_auto.status': 'ocr_complete', 'pipeline_auto.last_updated': now, updated_at: now } });
      if (r.modifiedCount === 1) {
        totals.reenrolled++;
        await db.collection('audit_log').insertOne({ action: 'pipeline_status_changed', book_id: bid, book_title: book.title, metadata: { from: status, to: 'ocr_complete', source: 'syriac-kraken-lane', reason: `re-transcribed ${n} pages (#${LANE_ISSUE}); re-enrolled so translate-worker re-translates ${stale} stale + ${untranslated} untranslated pages` }, timestamp: now }).catch(() => {});
        await recordSweepAction(db, { sweep: LANE, book_id: bid, action: 'reenrolled-for-translation', detail: { from: status, stale, untranslated } });
      }
    }
  }, { timeoutMs: 3600 * 1000 });
  const pages = totals.pages_stale + totals.pages_untranslated;
  log(`REENROL ${JSON.stringify(totals)} — ${pages} pages to translate ≈ $${(pages * PRICE_PER_PAGE).toFixed(2)} at flash-lite rates (estimate)${APPLY ? '' : '  [DRY RUN — nothing changed]'}`);
}

// ── release ────────────────────────────────────────────────────────────────────────────

/** Held imports (`syriac-ocr-lane-trial`) whose planned pages are all read and applied go
 *  to `queued`: the ordinary lane then archives nothing new, OCRs only the pages this lane
 *  left empty (the Latin/English leaves, `ocr.data` absent) and translates. */
async function release() {
  const books = JSON.parse(fs.readFileSync(F.books, 'utf8'));
  const plan = readJsonl(F.plan);
  const done = new Set([...readJsonl(F.applied), ...readJsonl(F.refused), ...readJsonl(F.skipped)].map(key));
  await withMongo(async (db) => {
    for (const [bid, rec] of Object.entries(books)) {
      if (bid.startsWith('__') || rec.hold !== HELD_REASON) continue;
      if (BOOK && bid !== BOOK) continue;
      const rows = plan.filter((r) => r.bid === bid);
      const left = rows.filter((r) => !done.has(key(r)));
      if (left.length) { log(`${bid} still ${left.length}/${rows.length} pages to go — keeping the hold`); continue; }
      const book = await db.collection('books').findOne({ id: bid }, { projection: { id: 1, pipeline_auto: 1 } });
      if (!isHeld(book)) { log(`${bid} not held any more`); continue; }
      const r = await releaseBook(db, bid, { to: 'queued', note: `Syriac Kraken lane finished ${rows.length} pages (#${LANE_ISSUE}); Latin-script leaves left for the ordinary lane`, source: 'syriac-kraken-lane' }, { dryRun: !APPLY });
      log(`${bid} ${JSON.stringify(r)}${APPLY ? '' : '  [DRY RUN]'}`);
    }
  });
}

// ── status ─────────────────────────────────────────────────────────────────────────────

function status() {
  const plan = readJsonl(F.plan);
  const applied = readJsonl(F.applied), fail = readJsonl(F.fail), refused = readJsonl(F.refused), skipped = readJsonl(F.skipped), runs = readJsonl(F.runs);
  const read = plan.filter((r) => fs.existsSync(outTxt(r.bid, r.pn))).length;
  const by = (rows, f) => rows.reduce((a, r) => { const k = f(r); a[k] = (a[k] || 0) + 1; return a; }, {});
  const secs = runs.map((r) => r.secs).filter((x) => x > 0).sort((a, b) => a - b);
  const written = applied.filter((r) => r.modified === 1);
  const out = {
    planned: plan.length, by_phase: by(plan, (r) => r.phase), by_engine: by(plan, (r) => r.engine), by_why: by(plan, (r) => r.why),
    read, applied: written.length, applied_by_why: by(written, (r) => r.why), loops_replaced: written.filter((r) => r.old_loop).length,
    refused_new_loops: refused.length, failed: fail.length, failed_by: by(fail, (r) => `${r.stage}:${String(r.reason || r.rc).slice(0, 30)}`), skipped: by(skipped, (r) => r.why),
    median_secs_per_page: secs.length ? secs[Math.floor(secs.length / 2)] : null, pages_read_last_hour: runs.filter((r) => Date.now() - Date.parse(r.at) < 3600e3).length,
    loop_rate_before_over_applied: written.length ? +(written.filter((r) => r.old_loop).length / written.length).toFixed(3) : null,
    loop_rate_after_over_applied: written.length + refused.length ? +(refused.length / (written.length + refused.length)).toFixed(4) : null,
  };
  console.log(JSON.stringify(out, null, 1));
}

const cmds = { plan, work, apply, stale, reenrol, release, status };
if (!cmds[CMD]) { console.error(`usage: syriac-kraken-lane.mjs <${Object.keys(cmds).join('|')}> [options]`); process.exit(2); }
cmds[CMD]().then(() => process.exit(0)).catch((e) => { log(`FATAL ${e?.stack || e}`); process.exit(1); });
