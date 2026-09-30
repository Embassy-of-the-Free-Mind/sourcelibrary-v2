#!/usr/bin/env node
/**
 * stranded-text-repair-5309 — re-OCR and re-translate the pages whose text was stranded by the
 * #3368 image repair (#5309, umbrella #5376). Approved by Derek 2026-09-30: lite, Batch API,
 * books HELD throughout, hard cap $265 (joint $310 with the Tingley re-read, #5224).
 *
 * PRIOR ART: scripts/workers/syriac-kraken-lane.mjs (`reenrol` — flips books to ocr_complete,
 * which hands them to the REALTIME translate worker at ~2x the batch price; refused here);
 * scripts/maintenance/withhold-stale-translations.mjs (the withhold shape this file copies for
 * one book at a time; its lane gate is deliberately closed to lanes not in WITHHOLD_LANES, so it
 * cannot be pointed at these pages); scripts/batch/bulk-reocr-local.mjs and
 * scripts/workers/translate-batch-worker.mjs --chained (the two paid lanes this file DRIVES —
 * it never calls Gemini itself). ~/sourcelibrary-ops/handoffs/2026-09-30-syriac-reenrol-gated.md
 * is the recipe (hold → envelope → per book release → chained enrol → re-hold).
 *
 * WHY A DRIVER. The repair is four writers in sequence per book, each already existing, none of
 * which knows about the others: the batch OCR submit (pages), the batch collector (writes OCR
 * hours later), the stale-translation withhold (the chained lane only selects pages WITHOUT a
 * translation, so the wrong-leaf English must be moved out first), and the chained translation
 * lane (refuses held books — and since #5427 parks a run whose book is held at any round — so a
 * book is released for translation and stays at its prior status; Phase 4 excludes books with an
 * open chained run, #5411). This file sequences them, checkpoints every step in a state file, and keeps a running
 * sum against the cap. It is idempotent per phase: rerun any command and it continues.
 *
 * Old text is retained: OCR is snapshotted to page_revisions with keepMeta (the old
 * `ocr.source_url` names the SHIFTED image, which is the evidence) before submit; the collector
 * snapshots again on write; translations are snapshotted with reason
 * `withhold-stale-translation-4523` before they are withheld.
 *
 * English books (language 'English') are re-OCR'd and their wrong-leaf English withheld, but NOT
 * re-translated: pipeline translation of English is off since the chained selector (#5385,
 * "modernisation is reader-triggered"). Enrol them later with --english if Derek wants it.
 *
 * Usage (run ON HETZNER from /root/sourcelibrary; env from .env.production.local):
 *   node scripts/batch/stranded-text-repair-5309.mjs init --list <books.jsonl.gz> [--state F]
 *   ... hold            hold every listed book not held for another reason
 *   ... envelope        open the allow_scopes envelope (set-scope.mjs)
 *   ... ocr --book ID | --books N [--dry-run] [--ocr-rate 0.00225]
 *   ... reconcile       re-derive submit state from batch_jobs after a dropped submit
 *   ... check           collect OCR job outcomes; retry unwritten pages once
 *   ... withhold        withhold stale (wrong-leaf) translations under the new OCR
 *   ... enrol [--max-open 60] [--english] [--book ID]   release → chained enrol (book stays released)
 *   ... runs            read chained run phases
 *   ... clear           clear needs_reocr on rewritten pages
 *   ... release         release every book this lane held (after the audit passes)
 *   ... status
 *   ... run --wave 50 --max-open 60 --interval 600   loop check→withhold→enrol→runs→clear→ocr
 * Every command takes --state F (default scripts/output/stranded-text-repair-5309/state.json)
 * and --cap 265.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../lib/mongo.mjs';
import { holdBook, releaseBook, isHeld } from '../lib/pipeline-hold.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import {
  translationStaleness, withholdUpdate, translationText, WITHHOLD_REASONS, WITHHOLD_REVISION_SOURCE,
} from '../lib/stale-translation.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { getScopeSpendUsd, readScopeEnvelopes } from '../lib/spend-guard.mjs';
import { RUNS_COLLECTION } from '../lib/translate-batch-seam.mjs';
import { TERMINAL_PHASES } from '../lib/translate-batch-chained.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const cmd = args[0];
const val = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);

export const SWEEP = 'stranded-text-5309';
export const HOLD = Object.freeze({
  reason: 'stranded-text-5309',
  issue: 5309,
  release: 'released by scripts/batch/stranded-text-repair-5309.mjs once the page is re-OCR\'d against the repaired image and re-translated (#5309)',
  source: 'stranded-text-repair-5309',
});
const ENVELOPE_TAG = 'stranded-text-5309';
const OCR_CALL_SITE = 'scripts/batch/bulk-reocr-local.mjs';
const ACTIVE_JOB = ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'];
const CAP = Number(val('cap', '265'));   // joint $310 with tingley-reread-5224 ($45), Derek 2026-09-30
const OCR_RATE = Number(val('ocr-rate', '0.00225'));   // supabase-usage-logger's lite batch ceiling
const TR_RATE = 0.0012;                                 // chained estimator ≈ 2× the $0.0006 measured
const STATE = val('state', path.join(ROOT, 'scripts/output/stranded-text-repair-5309/state.json'));
const LOG_DIR = path.dirname(STATE);

// ── state ──────────────────────────────────────────────────────────────────
function loadState() {
  const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  Object.defineProperty(s, '__loaded', { value: new Map(s.books.map((b) => [b.id, JSON.stringify(b)])), enumerable: false });
  return s;
}
function writeState(s) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  s.updated_at = new Date().toISOString();
  fs.writeFileSync(STATE + '.tmp', JSON.stringify(s, null, 1));
  fs.renameSync(STATE + '.tmp', STATE);
}
/**
 * Merge-on-save: commands run concurrently (a 50-book `ocr` submit takes an hour while `check`,
 * `withhold` and `enrol` tick), so a command never writes back the whole snapshot it loaded. It
 * re-reads the file and replaces only the books it changed since its load (deep-compared against
 * the copy it started from), plus `cap_hit`.
 */
function saveState(s) {
  if (!fs.existsSync(STATE) || !s.__loaded) return writeState(s);
  const fresh = loadState();
  const byId = new Map(fresh.books.map((b, i) => [b.id, i]));
  let changed = 0;
  for (const b of s.books) {
    const before = s.__loaded.get(b.id);
    const now = JSON.stringify(b);
    if (before === now) continue;
    const i = byId.get(b.id);
    if (i == null) fresh.books.push(b); else fresh.books[i] = b;
    s.__loaded.set(b.id, now); changed++;
  }
  if (s.cap_hit) fresh.cap_hit = s.cap_hit;
  writeState(fresh);
  return changed;
}
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const ts = (d) => (d ? new Date(d) : null);

/** Which pages of a book are still to be re-read: the retry list when a first pass left some. */
const ocrTargets = (b) => b.retry_page_ids || b.page_ids;

// ── init ───────────────────────────────────────────────────────────────────
export function rowsFromList(file) {
  const raw = file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file);
  return String(raw).trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.stranded > 0);
}

async function init(db) {
  const list = val('list');
  if (!list) throw new Error('init needs --list <books.jsonl.gz>');
  const rows = rowsFromList(list);
  const ids = rows.map((r) => r.book_id);
  const books = await db.collection('books').find({ id: { $in: ids } },
    { projection: { id: 1, language: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, 'archive_metadata.jp2_offset_repaired_at': 1 } }).toArray();
  const byId = new Map(books.map((b) => [b.id, b]));
  const s = { created_at: new Date().toISOString(), cap: CAP, books: [] };
  for (const r of rows) {
    const b = byId.get(r.book_id);
    if (!b) { log(`WARN ${r.book_id} not in books — skipped`); continue; }
    const hold = b.pipeline_auto?.hold;
    s.books.push({
      id: r.book_id, title: r.title, language: b.language || r.language, live: r.live,
      repaired_at: b.archive_metadata?.jp2_offset_repaired_at || r.repaired_at,
      n: r.stranded, page_ids: r.stranded_page_ids,
      english: (b.language || r.language) === 'English',
      foreign_hold: hold && hold.reason !== HOLD.reason ? hold.reason : null,
      prior_status: b.pipeline_auto?.status || null,
      phase: 'pending', retries: 0,
    });
  }
  saveState(s);
  const fh = s.books.filter((b) => b.foreign_hold).length, en = s.books.filter((b) => b.english).length;
  log(`init: ${s.books.length} books, ${s.books.reduce((n, b) => n + b.n, 0)} pages; ${fh} held by another lane (OCR + withhold only), ${en} English (no re-translation)`);
}

// ── hold / envelope ────────────────────────────────────────────────────────
async function hold(db) {
  const s = loadState();
  let held = 0, already = 0, other = 0;
  for (const b of s.books) {
    if (b.foreign_hold) { other++; continue; }
    const r = await holdBook(db, b.id, HOLD);
    if (r.outcome === 'held') { held++; b.held_by_us = true; b.prior_status = r.from ?? b.prior_status; await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'held', detail: { from: r.from, pages: b.n } }); }
    else if (r.outcome === 'already_held') { already++; b.held_by_us = true; }
    else { log(`  ${b.id}: ${r.outcome} ${r.reason || ''}`); b.foreign_hold = r.reason || r.outcome; }
  }
  saveState(s);
  const now = await db.collection('books').countDocuments({ id: { $in: s.books.map((b) => b.id) }, 'pipeline_auto.status': 'held', 'pipeline_auto.hold.reason': HOLD.reason });
  log(`hold: ${held} held now, ${already} already, ${other} left to their own lane; Mongo says ${now} books held as ${HOLD.reason}`);
}

async function envelope(db) {
  const s = loadState();
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (readScopeEnvelopes(control).some((e) => e.tag === ENVELOPE_TAG)) { log(`envelope ${ENVELOPE_TAG} already open`); return; }
  const ids = s.books.map((b) => b.id).join(',');
  const out = execFileSync(process.execPath, ['scripts/maintenance/set-scope.mjs', '--tag', ENVELOPE_TAG, '--books', ids, '--budget', String(CAP),
    '--by', 'derek 2026-09-30 approve (#5309 stranded-text repair, est $255, cap $295)'], { cwd: ROOT, env: process.env, encoding: 'utf8' });
  console.log(out.trim().split('\n').slice(-3).join('\n'));
}

async function spend(db) {
  const s = loadState();
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  const env = readScopeEnvelopes(control).find((e) => e.tag === ENVELOPE_TAG);
  const ids = s.books.map((b) => b.id);
  const r = await getScopeSpendUsd(db, { ids, since: env?.created_at ? new Date(env.created_at) : new Date(s.created_at) });
  if (r.meterError) throw new Error(`meter unreadable: ${r.meterError}`);
  return { usd: r.usd, rows: r.rows, budget: env?.budget_usd ?? null };
}

// ── OCR ────────────────────────────────────────────────────────────────────
async function ocr(db) {
  const s = loadState();
  let picks;
  if (val('book')) picks = s.books.filter((b) => b.id === val('book') && b.phase === 'pending');
  else picks = s.books.filter((b) => b.phase === 'pending').slice(0, Number(val('books', '50')));
  if (!picks.length) { log('ocr: nothing pending'); return 0; }
  const pages = picks.reduce((n, b) => n + ocrTargets(b).length, 0);
  const sp = await spend(db);
  const inflightTr = s.books.filter((b) => b.phase === 'tr_enrolled').reduce((n, b) => n + (b.tr_est || 0), 0);
  const add = pages * OCR_RATE;
  log(`ocr: ${picks.length} books / ${pages} pages; envelope spent $${sp.usd.toFixed(2)} + open translation est $${inflightTr.toFixed(2)} + this wave at $${OCR_RATE}/pg = $${(sp.usd + inflightTr + add).toFixed(2)} vs cap $${CAP}`);
  if (sp.usd + inflightTr + add > CAP) { log('ocr: CAP — not submitting'); s.cap_hit = new Date().toISOString(); saveState(s); return 0; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(LOG_DIR, `pages-${stamp}.json`);
  const ids = picks.flatMap((b) => ocrTargets(b));
  fs.writeFileSync(file, JSON.stringify(ids));
  if (!has('dry-run')) {
    // Snapshot the old text WITH its provenance (source_url names the shifted image) before the
    // collector's own named-column snapshot replaces it.
    let saved = 0;
    for (let i = 0; i < ids.length; i += 500) saved += await saveRevisionsBeforeOverwrite(db, ids.slice(i, i + 500), 'ocr', { reason: SWEEP, keepMeta: true });
    log(`ocr: ${saved} ocr revisions snapshotted (keepMeta)`);
  }
  const t0 = new Date();
  const argv = ['scripts/batch/bulk-reocr-local.mjs', `--page-ids-file=${file}`, '--model=lite',
    `--reason=${SWEEP}: re-OCR against the repaired image; the text beside it was a neighbouring leaf (#5309)`];
  if (has('dry-run')) argv.push('--dry-run');
  const logFile = path.join(LOG_DIR, `ocr-${stamp}.log`);
  const res = spawnSync(process.execPath, argv, { cwd: ROOT, env: process.env, encoding: 'utf8', maxBuffer: 64 << 20 });
  fs.writeFileSync(logFile, (res.stdout || '') + (res.stderr || ''));
  const tail = (res.stdout || '').trim().split('\n').filter((l) => /^(Books|Pages|Estimated|NOT SUBMITTED|\(dry run)/.test(l));
  console.log(tail.map((l) => '  ' + l).join('\n'));
  if (res.status !== 0) log(`ocr: bulk-reocr-local exited ${res.status} — see ${logFile}`);
  if (has('dry-run')) return 0;

  // What the submit actually recorded, per book: child jobs (they carry job_name) and failures.
  for (const b of picks) {
    const jobs = await db.collection('batch_jobs').find({ submitted_by: OCR_CALL_SITE, type: 'ocr', book_id: b.id, created_at: { $gte: t0 } },
      { projection: { id: 1, status: 1, page_count: 1, page_ids: 1, job_name: 1, child_job_ids: 1 } }).toArray();
    const children = jobs.filter((j) => !j.child_job_ids);
    const submitted = children.filter((j) => j.status !== 'submit_failed').reduce((n, j) => n + (j.page_count || j.page_ids?.length || 0), 0);
    const failed = children.filter((j) => j.status === 'submit_failed').reduce((n, j) => n + (j.page_ids?.length || 0), 0);
    b.ocr_jobs = [...new Set([...(b.ocr_jobs || []), ...children.map((j) => j.id)])];
    b.ocr_submitted_at = b.ocr_submitted_at || t0.toISOString();
    b.ocr_submitted = (b.ocr_submitted || 0) + submitted; b.ocr_submit_failed = failed;
    b.phase = submitted > 0 ? 'ocr_submitted' : 'ocr_submit_failed';
    await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'ocr-submitted', detail: { pages: submitted, submit_failed: failed, jobs: children.length, model: 'lite', retry: b.retries } });
  }
  saveState(s);
  log(`ocr: submitted ${picks.filter((b) => b.phase === 'ocr_submitted').length} books`);
  return picks.length;
}

/**
 * Re-derive submit state from batch_jobs for books still marked pending — the bookkeeping after a
 * submit is lost when the submitting process dies (a dropped ssh, a kill). Pages of a book that no
 * job carries go on its retry list, so the next `ocr` submits only those.
 */
async function reconcile(db) {
  const s = loadState();
  let fixed = 0, partial = 0;
  for (const b of s.books.filter((x) => x.phase === 'pending')) {
    const jobs = await db.collection('batch_jobs').find({ submitted_by: OCR_CALL_SITE, type: 'ocr', book_id: b.id, created_at: { $gte: new Date(s.created_at) }, child_job_ids: { $exists: false } },
      { projection: { id: 1, status: 1, page_ids: 1, created_at: 1 } }).toArray();
    if (!jobs.length) continue;
    const covered = new Set(jobs.filter((j) => j.status !== 'submit_failed').flatMap((j) => j.page_ids || []));
    const missing = b.page_ids.filter((id) => !covered.has(id));
    b.ocr_jobs = [...new Set([...(b.ocr_jobs || []), ...jobs.map((j) => j.id)])];
    b.ocr_submitted_at = b.ocr_submitted_at || jobs.reduce((m, j) => (j.created_at < m ? j.created_at : m), jobs[0].created_at).toISOString();
    b.ocr_submitted = covered.size;
    if (missing.length) { b.retry_page_ids = missing; partial++; log(`  ${b.id}: ${covered.size} pages in ${jobs.length} jobs, ${missing.length} never submitted → retry list`); }
    else { delete b.retry_page_ids; b.phase = 'ocr_submitted'; fixed++; }
    await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'reconciled', detail: { jobs: jobs.length, covered: covered.size, missing: missing.length } });
  }
  saveState(s);
  log(`reconcile: ${fixed} books marked submitted, ${partial} partially submitted (retry lists set)`);
}

/** Collect OCR outcomes. A book is done when every child job is terminal; unwritten pages get ONE retry. */
async function check(db) {
  const s = loadState();
  let done = 0, waiting = 0, retried = 0;
  for (const b of s.books.filter((x) => x.phase === 'ocr_submitted')) {
    const jobs = await db.collection('batch_jobs').find({ id: { $in: b.ocr_jobs } }, { projection: { id: 1, status: 1 } }).toArray();
    const active = jobs.filter((j) => ACTIVE_JOB.includes(j.status));
    if (active.length) { waiting++; continue; }
    const since = new Date(b.ocr_submitted_at);
    const written = await db.collection('pages').find({ id: { $in: b.page_ids }, 'ocr.updated_at': { $gt: since } }, { projection: { id: 1 } }).toArray();
    const wset = new Set(written.map((p) => p.id));
    const unwritten = b.page_ids.filter((id) => !wset.has(id));
    b.ocr_written = written.length;
    b.ocr_job_statuses = Object.fromEntries(jobs.map((j) => [j.id, j.status]));
    if (unwritten.length && b.retries < 1) {
      b.retries++; b.retry_page_ids = unwritten; b.phase = 'pending'; retried++;
      log(`  ${b.id}: ${written.length} written, ${unwritten.length} not — queued for one retry`);
      continue;
    }
    b.ocr_unwritten = unwritten.length; delete b.retry_page_ids;
    b.phase = 'ocr_done'; done++;
    await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'ocr-collected', detail: { written: b.ocr_written, unwritten: unwritten.length, jobs: b.ocr_job_statuses } });
  }
  saveState(s);
  log(`check: ${done} books OCR done, ${retried} retrying, ${waiting} still collecting`);
}

// ── withhold the wrong-leaf translations ───────────────────────────────────
async function withholdBook(db, b) {
  const pages = await db.collection('pages').find({ id: { $in: b.page_ids } },
    { projection: { id: 1, page_number: 1, 'ocr.updated_at': 1, translation: 1 } }).toArray();
  const targets = pages.filter((p) => translationStaleness(p).stale && translationText(p.translation));
  if (!targets.length) return { withheld: 0, revisions: 0 };
  const ids = targets.map((p) => p.id);
  let saved = 0;
  for (let i = 0; i < ids.length; i += 500) saved += await saveRevisionsBeforeOverwrite(db, ids.slice(i, i + 500), 'translation', { reason: WITHHOLD_REVISION_SOURCE, keepMeta: true });
  if (saved !== targets.length) throw new Error(`revisions ${saved} != ${targets.length} — nothing withheld`);
  const now = new Date();
  const ops = targets.map((p) => ({ updateOne: {
    filter: { id: p.id, ...(typeof p.translation === 'string' ? { translation: p.translation } : { 'translation.data': p.translation.data }) },
    update: withholdUpdate(p, WITHHOLD_REASONS.STALE_AFTER_REOCR, now),
  } }));
  let modified = 0;
  for (let i = 0; i < ops.length; i += 500) modified += (await db.collection('pages').bulkWrite(ops.slice(i, i + 500), { ordered: false })).modifiedCount;
  // Counters, featured quotes, and the Supabase mirror — the same three follow-ups the sweep does.
  const [counts] = await db.collection('pages').aggregate(buildVisiblePageCountPipeline(b.id)).toArray();
  if (counts) await db.collection('books').updateOne({ id: b.id }, { $set: { pages_count: counts.total, pages_ocr: counts.with_ocr, pages_translated: counts.with_translation, pages_translatable: counts.translatable, updated_at: now } });
  const nums = new Set(targets.map((p) => p.page_number));
  const book = await db.collection('books').findOne({ id: b.id }, { projection: { 'reading_summary.quotes': 1 } });
  const quotes = book?.reading_summary?.quotes;
  let quotesWithdrawn = 0;
  if (Array.isArray(quotes) && quotes.length) {
    const drop = quotes.filter((q) => q && nums.has(q.page));
    if (drop.length) {
      await db.collection('books').updateOne({ id: b.id }, { $set: { 'reading_summary.quotes': quotes.filter((q) => !(q && nums.has(q.page))), updated_at: now }, $push: { 'reading_summary.quotes_withheld': { $each: drop } } });
      quotesWithdrawn = drop.length;
    }
  }
  let mirror = 'synced';
  try { execFileSync(process.execPath, ['scripts/workers/sync-pages-content.mjs', `--book=${b.id}`], { cwd: ROOT, env: process.env, stdio: 'pipe', timeout: 300000 }); }
  catch (e) { mirror = `FAILED ${String(e.message).slice(0, 120)}`; }
  await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'translations-withheld', detail: { withheld: modified, revisions: saved, reason: WITHHOLD_REASONS.STALE_AFTER_REOCR, quotes_withdrawn: quotesWithdrawn, mirror } });
  return { withheld: modified, revisions: saved, quotesWithdrawn, mirror };
}

async function withhold(db) {
  const s = loadState();
  let n = 0;
  for (const b of s.books.filter((x) => x.phase === 'ocr_done')) {
    try {
      const r = await withholdBook(db, b);
      b.withheld = r.withheld; b.withheld_at = new Date().toISOString();
      b.phase = (b.english || b.foreign_hold) ? 'no_translate' : 'withheld';
      n++;
      log(`  ${b.id}: ${r.withheld} translations withheld (${r.revisions} revisions${r.quotesWithdrawn ? `, ${r.quotesWithdrawn} quotes` : ''}${r.mirror !== 'synced' ? `, mirror ${r.mirror}` : ''}) → ${b.phase}`);
    } catch (e) { log(`  ${b.id}: WITHHOLD ERROR ${e.message}`); b.withhold_error = e.message; }
    saveState(s);
  }
  log(`withhold: ${n} books`);
}

// ── chained translation: release → enrol → re-hold ─────────────────────────
function loopAlive() {
  const r = spawnSync('pgrep', ['-f', 'translate-batch-worker.mjs --chained --loop'], { encoding: 'utf8' });
  return r.status === 0;
}

async function enrol(db) {
  const s = loadState();
  const maxOpen = Number(val('max-open', '60'));
  const cands = s.books.filter((b) => b.phase === 'withheld' && !b.foreign_hold && (has('english') || !b.english) && (!val('book') || b.id === val('book')));
  let open = s.books.filter((b) => b.phase === 'tr_enrolled').length;
  if (!cands.length) { log(`enrol: nothing waiting (${open} runs open)`); return; }
  if (!loopAlive()) {
    // The lane's loop dies at its --max-minutes; the box keeps a restart script for exactly this.
    const restart = '/root/sl-chained-restart-loop.sh';
    if (fs.existsSync(restart)) { spawnSync('bash', [restart], { stdio: 'inherit', timeout: 120000 }); log(`enrol: chained --loop was not running — restarted via ${restart} (alive=${loopAlive()})`); }
    else log('enrol: WARNING no chained --loop process on this box and no restart script — runs will not tick');
  }
  let enrolled = 0;
  for (const b of cands) {
    if (open >= maxOpen) break;
    const sp = await spend(db);
    const inflight = s.books.filter((x) => x.phase === 'tr_enrolled').reduce((n, x) => n + (x.tr_est || 0), 0);
    const est = b.n * TR_RATE;
    if (sp.usd + inflight + est > CAP) { log(`enrol: CAP — spent $${sp.usd.toFixed(2)} + in flight $${inflight.toFixed(2)} + $${est.toFixed(2)} > $${CAP}`); s.cap_hit = new Date().toISOString(); break; }
    const approved = Math.max(0.05, +(b.n * 0.003).toFixed(2));
    const rel = await releaseBook(db, b.id, { note: 'released for chained batch enrol (#5309)', source: HOLD.source });
    if (rel.outcome !== 'released') { log(`  ${b.id}: release ${rel.outcome} ${rel.reason || ''} — skipped`); b.phase = 'tr_refused'; b.tr_reason = `release:${rel.outcome}`; saveState(s); continue; }
    let out = '';
    try {
      out = execFileSync(process.execPath, ['scripts/workers/translate-batch-worker.mjs', '--chained', '--enrol', `--books=${b.id}`, `--approved-usd=${approved}`],
        { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 600000 });
    } catch (e) { out = `${e.stdout || ''}\n${e.stderr || ''}\nEXIT ${e.status}`; }
    // NOT re-held: since #5424/#5427 the chained lane parks any run whose book is held, at every
    // round. The book stays at its prior status while the run translates; Phase 4 (and gap-fill)
    // exclude books with an open chained run (#5411), so nothing else translates them meanwhile.
    b.held_by_us = false; b.released_for_translation_at = new Date().toISOString();
    const m = out.match(/run (\S+) est \$([\d.]+)/) || (out.match(/open-run (\S+)/) && ['', out.match(/open-run (\S+)/)[1], String(b.n * 0.0006)]);
    if (m) {
      b.run_id = m[1]; b.tr_est = Number(m[2]); b.tr_approved = approved; b.phase = 'tr_enrolled'; b.tr_enrolled_at = new Date().toISOString();
      open++; enrolled++;
      await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'chained-enrolled', detail: { run: b.run_id, estimate: b.tr_est, approved, pages: b.n } });
    } else {
      const reason = (out.match(/REFUSED[^\n]*|nothing-to-translate[^\n]*|exceeds[^\n]*|Error[^\n]*/) || [out.trim().split('\n').pop()])[0];
      b.phase = /nothing-to-translate/.test(reason) ? 'no_translate' : 'tr_refused'; b.tr_reason = String(reason).slice(0, 200);
      log(`  ${b.id}: ${b.phase} — ${b.tr_reason}`);
    }
    fs.appendFileSync(path.join(LOG_DIR, 'enrol.log'), `=== ${new Date().toISOString()} ${b.id}\n${out}\n`);
    saveState(s);
  }
  log(`enrol: ${enrolled} enrolled, ${open} open`);
}

async function runs(db) {
  const s = loadState();
  const mine = s.books.filter((b) => b.phase === 'tr_enrolled');
  if (!mine.length) return;
  const rows = await db.collection(RUNS_COLLECTION).find({ id: { $in: mine.map((b) => b.run_id) } },
    { projection: { id: 1, phase: 1, counts: 1, spent_est_usd: 1, cursor: 1, page_count: 1, parked_reason: 1 } }).toArray();
  const byRun = new Map(rows.map((r) => [r.id, r]));
  let finished = 0;
  for (const b of mine) {
    const r = byRun.get(b.run_id);
    if (!r) continue;
    b.tr_progress = `${r.cursor}/${r.page_count}`; b.tr_spent_est = r.spent_est_usd;
    if (!TERMINAL_PHASES.includes(r.phase)) continue;
    b.phase = r.phase === 'complete' ? 'tr_done' : `tr_${r.phase}`; b.tr_counts = r.counts; b.tr_parked_reason = r.parked_reason || null; b.tr_done_at = new Date().toISOString();
    finished++;
    await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: `chained-${r.phase}`, detail: { run: b.run_id, counts: r.counts, spent_est_usd: r.spent_est_usd, parked_reason: r.parked_reason || null } });
  }
  saveState(s);
  log(`runs: ${finished} finished, ${mine.length - finished} still running`);
}

// ── clear the flag, release the books ──────────────────────────────────────
const CLEARABLE = ['tr_done', 'tr_parked', 'tr_failed', 'no_translate', 'tr_refused'];
async function clear(db) {
  const s = loadState();
  let books = 0, pages = 0;
  for (const b of s.books.filter((x) => CLEARABLE.includes(x.phase))) {
    const r = await db.collection('pages').updateMany(
      { id: { $in: b.page_ids }, needs_reocr: true, 'ocr.updated_at': { $gt: new Date(b.repaired_at) } },
      { $unset: { needs_reocr: '', needs_reocr_reason: '' }, $set: { updated_at: new Date() } });
    const left = await db.collection('pages').countDocuments({ id: { $in: b.page_ids }, needs_reocr: true });
    b.cleared = r.modifiedCount; b.flag_left = left; b.pre_clear_phase = b.phase; b.phase = 'cleared';
    books++; pages += r.modifiedCount;
    await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'needs-reocr-cleared', detail: { cleared: r.modifiedCount, still_flagged: left, after: b.pre_clear_phase } });
    saveState(s);
  }
  log(`clear: ${books} books, ${pages} pages unflagged`);
}

async function release(db) {
  const s = loadState();
  let n = 0;
  for (const b of s.books.filter((x) => x.held_by_us && !x.released_at && !x.released_for_translation_at)) {
    const book = await db.collection('books').findOne({ id: b.id }, { projection: { pipeline_auto: 1 } });
    if (!isHeld(book) || book.pipeline_auto.hold.reason !== HOLD.reason) { log(`  ${b.id}: not held as ${HOLD.reason} (${book?.pipeline_auto?.hold?.reason || book?.pipeline_auto?.status}) — skipped`); continue; }
    const r = await releaseBook(db, b.id, { note: 'stranded-text repair finished (#5309)', source: HOLD.source });
    if (r.outcome === 'released') { n++; b.released_at = new Date().toISOString(); b.released_to = r.to; await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'released', detail: { to: r.to } }); }
    else log(`  ${b.id}: ${r.outcome}`);
  }
  saveState(s);
  log(`release: ${n} books released to their prior status. Remove the envelope: set-scope.mjs --tag ${ENVELOPE_TAG} --remove --by done`);
}

// ── status / run ───────────────────────────────────────────────────────────
async function status(db) {
  const s = loadState();
  const byPhase = {};
  for (const b of s.books) { const k = b.phase; byPhase[k] = byPhase[k] || { books: 0, pages: 0 }; byPhase[k].books++; byPhase[k].pages += b.n; }
  const sp = await spend(db).catch((e) => ({ usd: NaN, rows: 0, budget: null, err: e.message }));
  const written = s.books.reduce((n, b) => n + (b.ocr_written || 0), 0);
  const trDone = s.books.filter((b) => b.phase === 'tr_done' || (b.phase === 'cleared' && b.pre_clear_phase === 'tr_done')).reduce((n, b) => n + b.n, 0);
  const remainingOcr = s.books.filter((b) => b.phase === 'pending').reduce((n, b) => n + ocrTargets(b).length, 0);
  const remainingTr = s.books.filter((b) => ['pending', 'ocr_submitted', 'ocr_done', 'withheld'].includes(b.phase) && !b.english && !b.foreign_hold).reduce((n, b) => n + b.n, 0);
  const ocrRate = written ? null : null; // metered per-page comes from the ledger step, not here
  console.log(JSON.stringify({ phases: byPhase, ocr_pages_written: written, translated_pages: trDone,
    envelope: { spent_usd: +sp.usd.toFixed(2), rows: sp.rows, budget: sp.budget, cap: CAP, err: sp.err },
    projection_usd: +(sp.usd + remainingOcr * OCR_RATE + remainingTr * TR_RATE).toFixed(2),
    remaining: { ocr_pages: remainingOcr, translate_pages: remainingTr }, cap_hit: s.cap_hit || null, updated_at: s.updated_at }, null, 1));
  void ocrRate;
}

async function run(db) {
  const wave = Number(val('wave', '50')), interval = Number(val('interval', '600')) * 1000;
  for (;;) {
    await check(db); await withhold(db); await enrol(db); await runs(db); await clear(db);
    const s = loadState();
    const inflightOcr = s.books.filter((b) => b.phase === 'ocr_submitted').reduce((n, b) => n + b.n, 0);
    if (s.books.some((b) => b.phase === 'pending') && inflightOcr < wave * 300 && !s.cap_hit) {
      args.push('--books', String(wave));
      await ocr(db);
      args.splice(args.length - 2, 2);
    }
    await status(db);
    const live = loadState().books.filter((b) => !['cleared', 'ocr_submit_failed'].includes(b.phase));
    if (!live.length) { log('run: every book is cleared — run the audit, check the controls by eye, then `release`'); return; }
    if (loadState().cap_hit) { log('run: CAP HIT — stopping the loop; report to Derek'); return; }
    await new Promise((r) => setTimeout(r, interval));
  }
}

const COMMANDS = { init, hold, envelope, ocr, reconcile, check, withhold, enrol, runs, clear, release, status, run };
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!COMMANDS[cmd]) { console.error(`usage: ${Object.keys(COMMANDS).join('|')} (see header)`); process.exit(2); }
  await withMongo(async (db) => { await COMMANDS[cmd](db); });
}
