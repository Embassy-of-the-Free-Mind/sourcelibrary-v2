#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/paddle-zh-lane.mjs `apply` (#5600: the same engine onto held SKQS volumes. It is
 * followed step for step here: hold required, revisions first and counted, human-edit guard in the loop AND in
 * the write filter, textless reads never stored, loop + char-run guards, $literal pipeline write, staleness stamp,
 * recount, sweep_log + one book_events row). It cannot be reused as is: it reads the #5600 fleet's plan/out layout,
 * has no guard verdict and no second engine. scripts/batch/cli-ocr.mjs `apply` is the Flash half's model
 * (geminiEngine, api 'cli', the prompt sent hashed, the image's sha256). Conversions, envelope and the Paddle
 * engine block come from scripts/lib/paddle-zh-lane.mjs unchanged.
 *
 * The guarded-Paddle Chinese lane (#6871 row 3): first reads for the held Chinese table + mixed residue of
 * gpu-backlog-5660, as recommended by zh-confirm-6871 (PR #6910). Guarded Paddle passed the preregistered bar
 * against agy Flash on 25 + 25 fresh pages. The work set is 27,048 pages, excluding 清文鑑, 欽定西域同文志 and
 * 琴譜合璧, which stay held.
 *
 * INPUTS (files only; this script never runs an engine):
 *   --books DIR   the GPU task's per-book JSONLs (gex45 /root/jobs/gpu-queue/50-zh-guarded-read/books/)
 *   --run FILE    that task's run.json (engine, weights sha256, stack, serving, the guard's code hashes)
 *   --flash FILE  flash.py's flash.jsonl (agy Flash on the pages the guard sent to FLASH, reply guarded)
 * Each page is written from exactly one route:
 *   PADDLE  the guard passed Paddle's read  → convertPaddle + envelope, `ocr.source: 'paddle'`, Paddle engine block
 *   FLASH   the guard rejected Paddle's read, and Flash's reply passed the reply guard (round 1 or the one retry)
 *           → envelope, `ocr.source: 'ai'`, gemini-engine/1 block (api 'cli', agy + version, the prompt sent)
 *   anything else (HOLD, UNREAD, Flash failed twice or not run) → not written; the page stays unread.
 * `ocr.verdict` carries the guard's verdict on the page (route, flags, features, guard code hashes, judged engine).
 *
 * GUARDS, per page: the page still belongs to the book; the image read is the page's image (URL equal to
 * `photo_original` or getPageSource, and for FLASH the same sha256 the GPU read); never a human-edited page; FIRST
 * READS ONLY (a page that gained `ocr.data` since the read is skipped, and the write filter requires it absent);
 * at least MIN_HAN Han characters outside margin marks; ocr-loop-guard + the single-character run guard; and on the
 * PADDLE route the #6388 table/diagram detector (paddle-table-detect.mjs, the #6516 rule production withholds
 * 4,379 served pages by): a page it flags is not written here either, and stays unread. Per book:
 * held for gpu-backlog-5660 (kept), and not an excluded work.
 *
 * DOWNSTREAM (the gotcha, pipeline-status-truth.md #4523: an OCR apply can quietly queue PAID re-translation
 * through gap-fill). Measured 2026-10-18 on the 240 class books: all `held` (hold gpu-backlog-5660, from
 * needs_attention 143 / archive_complete 97), 0 pages with a translation. So:
 *   - at write time: NOTHING downstream fires. A held book is selected by no phase (Phase 4 fresh dispatch,
 *     gap-fill `partialBooks`, translate-batch-worker --enrol-auto and realtime-translate --stale all filter on
 *     status / NOT_HELD). markTranslationsStale finds no translation to mark. The 07:30 mark-stale cron selects
 *     these pages by `ocr.updated_at` and finds no translation. The text is visible to readers at once (the books
 *     are visible: true).
 *   - at RELEASE of the gpu-backlog-5660 hold (`--to ocr_complete`, as its release line says): Phase 4 fresh
 *     dispatch, and the hourly chained enrol-auto (AUTO_STATUSES includes ocr_complete), translate every page
 *     written here on the translation router's model (translate-core.mjs), which is FULL FLASH for Chinese (#5695). That spend is
 *     paid and is not decided by this writer. The release stays a separate, priced decision; this writer adds no bypass.
 *
 *   node --env-file=.env.production.local scripts/workers/paddle-zh-guarded-lane.mjs \
 *     --books DIR --run run.json --flash flash.jsonl [--book <id>] [--limit-pages N] [--limit-books N]
 *     [--checkpoint FILE] [--report FILE] [--apply]
 * Dry run unless --apply. The dry run reads Mongo and prints what it would write; it writes nothing anywhere
 * except the --report file.
 *
 * APPLY, per book (#6871 row 3, Derek yes 2026-10-23): a book with no hold is held (APPLY_HOLD, zh-guarded-6871)
 * BEFORE its first page write; a sweep_log `first_ocr_start` row; then each page through writePageText (one
 * page_revisions row per page, source REVISION_SOURCE, one run_id per invocation so scripts/maintenance/revert-run.mjs
 * can undo a batch); then recount, sweep_log `first_ocr`, book_events. --checkpoint lists finished books, so a batch
 * resumes where the last stopped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../lib/mongo.mjs';
import { loopVerdict, recordLoopRefusal } from '../lib/ocr-loop-guard.mjs';
import { writePageText, newRunId } from '../lib/page-text-writer.mjs';
import { holdBook } from '../lib/pipeline-hold.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { paddleTableRisk, T as TABLE_RULE } from '../lib/paddle-table-detect.mjs';
import { geminiEngine, imageInput, ocrProvenance, notRecorded, codeVersion, host } from '../lib/write-provenance.mjs';
import {
  PADDLE, MIN_HAN, MAX_CHAR_RUN, convertPaddle, envelope, bodyHanCount, longestCharRun, workTitleOf,
  ocrSetFields, isHumanEdited, STALE_OCR_FIELDS, markTranslationsStale,
} from '../lib/paddle-zh-lane.mjs';

export const LANE = 'paddle-zh-guarded-2026-10';
export const LANE_ISSUE = 6871;
export const HOLD_REASON = 'gpu-backlog-5660';
/** The apply's own hold (#6871, Derek yes 2026-10-23): put on any frame book that carries no hold before its first
 * page write, so no gap-fill re-translation is queued. A book already held keeps its hold (holdBook records one). */
export const APPLY_HOLD = {
  reason: 'zh-guarded-6871', issue: LANE_ISSUE, source: 'scripts/workers/paddle-zh-guarded-lane.mjs',
  release: 'translation of the guarded-Paddle Chinese table + mixed pages is approved as its own priced decision (#6871 row 3 is OCR only); release with --to ocr_complete',
};
export const HOLD_REASONS = [HOLD_REASON, APPLY_HOLD.reason];
export const REVISION_REASON = 'ocr_paddle_zh_guarded_6871';
/** page_revisions.source on every row this lane writes: one label per lane, so the rows segment cleanly. */
export const REVISION_SOURCE = 'paddle-zh-guarded-6871';
export const BOOK_EVENT = 'paddle_zh_guarded_ocr';
const CALL_SITE = 'scripts/workers/paddle-zh-guarded-lane.mjs';
/** Works no engine reads (#6910, zh-residue-refs-6871): never written, whatever a file says. */
export const EXCLUDED_WORKS = /清文鑑|西域同文志|琴譜合璧/;
export const DOWNSTREAM_NOTE = 'Writes first OCR onto books held for gpu-backlog-5660. At write: no translation lane selects a held book, and no page in scope has a translation, so nothing paid is queued; the text is visible to readers at once. At RELEASE of that hold (--to ocr_complete): Phase 4 fresh dispatch and the hourly chained enrol-auto translate every page written here on full Flash (Chinese, #5695): paid, a separate decision.';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const APPLY = argv.includes('--apply');
const BOOKS = arg('--books'), RUNF = arg('--run'), FLASHF = arg('--flash');
const ONLY = arg('--book', null), LIMIT = Number(arg('--limit-pages', 0)) || 0;
const LIMIT_BOOKS = Number(arg('--limit-books', 0)) || 0;
const REPORT = arg('--report', null);
const CHECKPOINT = arg('--checkpoint', null);

/**
 * Which route writes this page, or why none does. Pure: the GPU record, the page as stored now, and Flash's row.
 * The ROUTING ROW for these held classes (ocr-routing-table.json `chinese-held-tables-mixed`):
 *   Paddle's read passed guard.py + ink.py           → PADDLE
 *   the guard rejected it, Flash's reply passed its own reply guard, on the same image bytes → FLASH
 *   near-blank (guard HOLD), Flash failed twice or not run, anything unexpected → not written (page stays unread)
 * @returns {{ route: 'PADDLE'|'FLASH', flash?: object } | { skip: string }}
 */
export function routePage(rec, page, flashRec, { getSource = getPageSource } = {}) {
  if (!page) return { skip: 'page_gone' };
  if (page.book_id !== rec.book_id) return { skip: 'wrong_book' };
  if (!rec.image?.url || (rec.image.url !== page.photo_original && rec.image.url !== getSource(page))) return { skip: 'image_not_the_pages' };
  if (isHumanEdited(page.ocr)) return { skip: 'human_edited' };
  if (page.ocr?.data) return { skip: 'already_read' };
  if (rec.route === 'PADDLE') return { route: 'PADDLE' };
  if (rec.route !== 'FLASH') return { skip: `route_${String(rec.route).toLowerCase()}` };
  if (!flashRec) return { skip: 'flash_not_run' };
  if (flashRec.route !== 'FLASH') return { skip: `flash_${String(flashRec.route).toLowerCase()}` };
  if (!rec.image.sha256 || flashRec.image?.sha256 !== rec.image.sha256) return { skip: 'flash_read_another_image' };
  return { route: 'FLASH', flash: flashRec };
}

/** The whole `ocr` object written: the page's prior non-stale keys (none carry text: first reads only), then the lane's. */
export function nextOcr(priorOcr, set) {
  const stale = new Set(STALE_OCR_FIELDS.map((k) => k.replace(/^ocr\./, '')));
  const kept = priorOcr && typeof priorOcr === 'object' ? Object.fromEntries(Object.entries(priorOcr).filter(([k]) => !stale.has(k) && k !== 'data')) : {};
  const mine = Object.fromEntries(Object.entries(set).filter(([k]) => k.startsWith('ocr.')).map(([k, v]) => [k.slice(4), v]));
  return { ...kept, ...mine };
}

/** The guard's verdict on the page, as `ocr.verdict` (the shape apply-reocr-verdicts.mjs writes). */
export function verdictBlock(rec, route, run, flash, now) {
  const g = rec.guard || {};
  return {
    verdict: 'SERVE', rule: route === 'PADDLE' ? 'guard_pass' : 'guard_reject_flash_pass', route,
    paddle_flags: g.flags || [], reply_flags: route === 'FLASH' ? (flash?.reply_flags || []) : null, flash_attempt: route === 'FLASH' ? flash?.attempt ?? null : null,
    features: { n: g.n ?? null, zlib: g.zlib ?? null, rep6: g.rep6 ?? null, num: g.num ?? null, ink: g.ink ?? null, blobs: g.blobs ?? null },
    guard: { name: 'zh-guarded-paddle', code: run.guard_code, frozen_in: run.guard_frozen_in, constants: run.guard_constants,
      measured: '#6910 fresh draw: 8/8 Paddle collapses and loops caught, 34/35 good pages passed; paired delta vs agy Flash 0.0 on table and mixed' },
    judged_engine: route === 'PADDLE' ? PADDLE.model : flash?.model, run: run.run, issue: LANE_ISSUE, at: now,
  };
}

/** The box record ocrSetFields expects, from the GPU task's run.json. */
export function boxFromRun(run) {
  const e = run.engine || {};
  return {
    paddleocr_version: e.stack?.paddleocr, paddlex_version: e.stack?.paddlex, paddle_version: e.stack?.['paddlepaddle-gpu'],
    weights_sha256: String(e.revision || '').replace(/^sha256:/, '') || null, host: run.host, gpu: run.gpu,
    backend: e.serving?.backend, workers: e.serving?.runners, vllm_version: e.vllm, max_side: 0, layout: e.serving?.layout,
  };
}

/** The `$set` for one page, by route. Pure: no Mongo. */
export function pageSet(rec, route, { run, flash, now, codeVer, workTitle }) {
  const verdict = verdictBlock(rec, route, run, flash, now);
  const input = { ...imageInput({ url: rec.image.url, mime: 'image/jpeg', bytes: rec.image.bytes }), image_sha256: rec.image.sha256,
    fed_px: rec.image.fed_w ? [rec.image.fed_w, rec.image.fed_h] : null };
  if (route === 'PADDLE') {
    const { body, stats } = convertPaddle(rec.text, { workTitle });
    const text = envelope(body);
    const set = ocrSetFields(text, { run: run.run, now, imageUrl: rec.image.url, box: boxFromRun(run), stats });
    set['ocr.pipeline'] = LANE;
    set['ocr.engine'] = { ...set['ocr.engine'], issue: LANE_ISSUE, input, serving: { ...set['ocr.engine'].serving, input_long_side_cap: run.engine?.serving?.input_long_side_cap ?? null } };
    set['ocr.verdict'] = verdict;
    return { text, body, set };
  }
  const body = String(flash.text || '').normalize('NFC').split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).join('\n').trim();
  const text = envelope(body);
  const engine = geminiEngine({
    call_site: CALL_SITE, api: 'cli', cli: flash.cli, model: flash.model,
    prompt: { id: 'zh-residue-bakeoff-6871/read.py:PROMPT', name: 'zh bake-off plain transcription prompt + #6523 markers', version: '2026-10-18', text: flash.prompt_sent },
    generationConfig: notRecorded('agy -p exposes no temperature, output cap or thinking setting; the model id names the tier'),
    run: { job_id: run.run.replace(/^zh-guarded-read-6871/, 'zh-guarded-read-6871/flash'), code_version: codeVer, host: host(), read_at: flash.date ? new Date(flash.date) : null, reason: 'guard rejected Paddle (#6871)' },
    input,
  });
  return { text, body, set: {
    'ocr.data': text, 'ocr.language': 'Chinese', 'ocr.model': flash.model, 'ocr.source': 'ai', 'ocr.pipeline': LANE, 'ocr.updated_at': now,
    ...Object.fromEntries(Object.entries(ocrProvenance(text, engine)).map(([k, v]) => [`ocr.${k}`, v])),
    'ocr.verdict': verdict, updated_at: now,
  } };
}

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function main() {
  if (!BOOKS || !RUNF || !FLASHF) { console.error('usage: paddle-zh-guarded-lane.mjs --books DIR --run run.json --flash flash.jsonl [--book id] [--limit-pages N] [--report F] [--apply]'); process.exit(1); }
  const run = JSON.parse(fs.readFileSync(RUNF, 'utf8'));
  if (!run.engine?.revision || !run.guard_code) throw new Error('run.json has no engine revision or guard code hashes: refusing (provenance)');
  const flash = new Map(fs.existsSync(FLASHF) ? readJsonl(FLASHF).map((r) => [r.page_id, r]) : []);
  const files = fs.readdirSync(BOOKS).filter((f) => f.endsWith('.jsonl')).sort().filter((f) => !ONLY || f === `${ONLY}.jsonl`);
  const codeVer = await codeVersion();
  const runId = newRunId('paddle-zh-guarded-lane');
  // resumable: a book is listed in the checkpoint once its writes are done; a re-run skips it (and the write filter
  // skips any page already read, so a crash mid-book is safe too)
  const done = new Set(CHECKPOINT && fs.existsSync(CHECKPOINT) ? readJsonl(CHECKPOINT).map((r) => r.book_id) : []);
  const T = { books: 0, books_refused: 0, books_checkpointed: 0, books_held_now: 0, would_hold: 0, written: 0, would_write: 0, by_route: {}, skipped: {}, refused_loop: 0, conflicts: 0, stale_marked: 0 };
  const report = [], skipped = [];
  // every page not written is listed with its reason (--report <f> → <f>.skipped.jsonl): the held tail a later lane picks up
  const skip = (why, rec) => { T.skipped[why] = (T.skipped[why] || 0) + 1; if (rec) skipped.push({ book_id: rec.book_id, page_id: rec.page_id, page_number: rec.page_number, route: rec.route, skipped: why }); };
  let budget = LIMIT || Infinity, booksLeft = LIMIT_BOOKS || Infinity;
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} ${LANE} (#${LANE_ISSUE}) run ${run.run}, write run ${runId}, ${files.length} book files, ${flash.size} Flash rows, ${done.size} books checkpointed`);
  console.log(`DOWNSTREAM: ${DOWNSTREAM_NOTE}`);
  await withMongo(async (db) => {
    const P = db.collection('pages'), B = db.collection('books');
    for (const f of files) {
      if (budget <= 0 || booksLeft <= 0) break;
      const recs = readJsonl(path.join(BOOKS, f));
      const bid = recs[0]?.book_id;
      if (done.has(bid)) { T.books_checkpointed++; continue; }
      let book = await B.findOne({ id: bid }, { projection: { id: 1, title: 1, visible: 1, pipeline_auto: 1 } });
      if (!book) { console.log(`${bid} not found: skipped`); T.books_refused++; continue; }
      if (EXCLUDED_WORKS.test(book.title || '')) { console.log(`${bid} is an excluded work: refusing | ${book.title}`); T.books_refused++; continue; }
      // HOLD BEFORE WRITE: the hold is what keeps paid re-translation from following the write; it stays on
      if (!book.pipeline_auto?.hold) {
        if (!APPLY) { T.would_hold++; console.log(`${bid} carries no hold: --apply holds it (${APPLY_HOLD.reason}) before writing`); }
        else {
          const h = await holdBook(db, bid, APPLY_HOLD);
          book = await B.findOne({ id: bid }, { projection: { id: 1, title: 1, visible: 1, pipeline_auto: 1 } });
          if (h.outcome === 'held') T.books_held_now++;
          if (!HOLD_REASONS.includes(book.pipeline_auto?.hold?.reason)) { console.log(`${bid} hold failed (${h.outcome}): refusing`); T.books_refused++; continue; }
        }
      } else if (!HOLD_REASONS.includes(book.pipeline_auto.hold.reason)) { console.log(`${bid} held for ${book.pipeline_auto.hold.reason}, not ${HOLD_REASONS.join(' / ')}: refusing`); T.books_refused++; continue; }
      const pages = await P.find({ id: { $in: recs.map((r) => r.page_id) } }, { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, translation: 1 } }).toArray();
      const byId = new Map(pages.map((p) => [p.id, p]));
      const workTitle = workTitleOf(book.title);
      const now = new Date();
      const writes = [];
      let truncated = false, pending = false;
      for (const rec of recs) {
        if (budget <= 0) { truncated = true; break; }
        const p = byId.get(rec.page_id);
        if (rec.book_id !== bid) { skip('wrong_book', rec); continue; }
        const r = routePage(rec, p, flash.get(rec.page_id));
        if (r.skip === 'flash_not_run') pending = true;
        if (r.skip) { skip(r.skip, rec); continue; }
        const route = r.route;
        const { text, body, set } = pageSet(rec, route, { run, flash: r.flash, now, codeVer, workTitle });
        if (bodyHanCount(body) < MIN_HAN) { skip(`${route.toLowerCase()}_textless`, rec); continue; }
        if (route === 'PADDLE') {
          const risk = paddleTableRisk(text, { title: book.title }, TABLE_RULE);
          if (risk.flag) { skip('table_detector_6388', rec); continue; }
          set['ocr.verdict'].table_detector = { rule: 'paddle-table-detect #6516 (T)', flag: false, reasons: risk.reasons };
        }
        const v = loopVerdict(text);
        const runLen = longestCharRun(body);
        if (!v.refuse && runLen > MAX_CHAR_RUN) Object.assign(v, { refuse: true, reason: 'char_run', share: 1, period: 1, reps: runLen, chars: runLen, body: body.length });
        if (v.refuse) {
          T.refused_loop++; skipped.push({ book_id: bid, page_id: rec.page_id, page_number: rec.page_number, route, skipped: `loop_refused:${v.reason}` });
          if (APPLY) await recordLoopRefusal(db, { pageId: p.id, bookId: bid, pageNumber: p.page_number, text, model: set['ocr.model'], verdict: v });
          continue;
        }
        writes.push({ p, rec, route, text, set });
        budget--;
      }
      T.books++; booksLeft--;
      for (const w of writes) {
        T.by_route[w.route] = (T.by_route[w.route] || 0) + 1;
        report.push({ book_id: bid, title: book.title, page_id: w.p.id, page_number: w.p.page_number, route: w.route, before: w.p.ocr ?? null,
          after: Object.fromEntries(Object.entries(w.set).map(([k, val]) => [k, val])) });
      }
      const nP = writes.filter((w) => w.route === 'PADDLE').length, nF = writes.length - nP;
      if (!APPLY) { T.would_write += writes.length; console.log(`${bid} would write ${writes.length}/${recs.length} (${nP} Paddle, ${nF} Flash) | ${String(book.title).slice(0, 40)}`); continue; }
      if (writes.length) {
        // sweep-log BEFORE the write: a crash mid-book still leaves the intent on record
        await recordSweepAction(db, { sweep: LANE, book_id: bid, action: 'first_ocr_start', detail: { issue: LANE_ISSUE, run: run.run, write_run: runId, planned: writes.length, paddle: nP, flash: nF } });
        // one page_revisions row per page (writePageText: prior state 'absent', source REVISION_SOURCE, run_id for
        // revert-run.mjs), compare-and-set on the empty prior, and the human-edit guard in the update filter
        let modified = 0;
        const landed = [];
        for (const w of writes) {
          const res = await writePageText(db, w.p.id, 'ocr', nextOcr(w.p.ocr, w.set), { by: CALL_SITE, reason: REVISION_REASON, run_id: runId, revision_source: REVISION_SOURCE, now });
          if (res.status === 'written') { modified++; landed.push(w); } else { T.conflicts++; skip(`write_${res.status}`, w.rec); }
        }
        // a blocked-translation flag set by an earlier failure does not apply to the new text
        await P.updateMany({ id: { $in: landed.map((w) => w.p.id) }, 'translation.health_blocked': { $exists: true } }, { $unset: { 'translation.health_blocked': '', 'translation.health_blocked_at': '' } });
        T.written += modified;
        const stale = await markTranslationsStale(db, landed.map((w) => ({ id: w.p.id, text: w.text })), now, LANE);
        T.stale_marked += stale;
        const { after: counts } = await recountBook(db, bid, { reason: LANE, now });
        await recordSweepAction(db, { sweep: LANE, book_id: bid, action: 'first_ocr', detail: { issue: LANE_ISSUE, run: run.run, write_run: runId, engine: PADDLE.model, revision: run.engine.revision, pages_written: modified, paddle: nP, flash: nF, translations_marked_stale: stale, downstream: DOWNSTREAM_NOTE } });
        await db.collection('book_events').updateOne(
          { book_id: bid, type: BOOK_EVENT },
          { $setOnInsert: { book_id: bid, type: BOOK_EVENT, at: now, source: LANE, 'details.issue': LANE_ISSUE, 'details.engine': PADDLE.model, 'details.repo': PADDLE.repo },
            $set: { 'details.last_apply_at': now, 'details.run': run.run, 'details.write_run': runId, 'details.pages_ocr_after': counts?.pages_ocr ?? null, 'details.downstream': DOWNSTREAM_NOTE },
            $inc: { 'details.pages_written': modified, 'details.paddle': nP, 'details.flash': nF } },
          { upsert: true },
        );
        console.log(`${bid} wrote ${modified}/${writes.length} (${nP} Paddle, ${nF} Flash; stale ${stale}) | ${String(book.title).slice(0, 40)}`);
      }
      // a book cut short by --limit-pages, or with Flash pages not yet read, is not done: a later run picks them up
      if (CHECKPOINT && !truncated && !pending) fs.appendFileSync(CHECKPOINT, JSON.stringify({ book_id: bid, write_run: runId, written: writes.length, at: new Date().toISOString() }) + '\n');
    }
  }, { timeoutMs: 4 * 3600 * 1000 });
  if (REPORT) {
    fs.writeFileSync(REPORT, report.map((r) => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(`${REPORT}.skipped.jsonl`, skipped.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} ${JSON.stringify(T)}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) await main();
