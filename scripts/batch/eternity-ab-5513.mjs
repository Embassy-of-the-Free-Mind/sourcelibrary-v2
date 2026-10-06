#!/usr/bin/env node
/**
 * eternity-ab-5513 — OCR then translate tranches A+B of the Eternity canon work (#5513).
 * Approved by Derek 2026-10-01 ("do it"): ~43.6K pages without OCR on 278 books, Batch API,
 * books HELD throughout, HARD CAP $230 (envelope `eternity-ab-2026-10`).
 *
 * PRIOR ART: scripts/batch/stranded-text-repair-5309.mjs (#5408) — the driver this file follows
 * (hold → envelope → per-book sliced Batch OCR → chained enrol → release). It does not fit as-is:
 * it re-OCRs a fixed page list and withholds the old English, where this job OCRs pages that have
 * NO text (`--new-only` semantics, list re-derived at each pick) and translates with page-level
 * targeting that skips withheld pages (`--pages-file`, #5516). It also enrols one run per book,
 * and a run holds at most 300 pages (MAX_PAGES_PER_RUN), so books here re-enrol until their
 * queue is empty.
 *
 * It never calls Gemini itself. It drives:
 *   - scripts/batch/bulk-reocr-local.mjs (Batch OCR, model = the OCR router's choice, NOT forced)
 *   - scripts/workers/translate-batch-worker.mjs --chained --enrol --pages-file (chained Batch lane)
 *
 * The same driver runs other approved OCR→translate envelopes (#6109): `--tag T --issue N` name the
 * sweep, the hold reason and the scope envelope; without them every value is the Eternity run's.
 * A tag other than the default must also pass `--cap` (and `--by` to `envelope`): no other job
 * inherits Eternity's $230.
 *
 * Usage (on Hetzner, from a checkout that carries #5516; env via --env-file):
 *   init --perbook F --skip F   build the state from a measured per-book file
 *   init --select tradition-shelves [--languages Latin,Greek]   build it from #6109's selection rule
 *   shelves                     readable-in-English per tradition shelf, now vs at init (#6109)
 *   hold | envelope | dryrun | ocr [--books N] | reconcile | check | enrol | runs | release | status
 *   run --interval 180 --wave 10 [--shard k/n] [--ocr-only]   loop check → runs → enrol → ocr until done or cap
 * Every command takes --state F and --cap 230 (and --tag/--issue when not the Eternity run).
 * --ocr-cap N stops NEW OCR submissions at $N of envelope spend, leaving the rest of --cap for translation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../lib/mongo.mjs';
import { holdBook, releaseBook, isHeld } from '../lib/pipeline-hold.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { getScopeSpendUsd, readScopeEnvelopes } from '../lib/spend-guard.mjs';
import { RUNS_COLLECTION, MAX_PAGES_PER_RUN } from '../lib/translate-batch-seam.mjs';
import { TERMINAL_PHASES } from '../lib/translate-batch-chained.mjs';
import { translatablePageFilter } from '../lib/translate-core.mjs';
import { READABLE_IN_ENGLISH_EXPR } from '../lib/page-counts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const cmd = args[0];
const val = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);

// --tag / --issue name the job; the defaults ARE the Eternity run (#5513), so it runs unchanged.
const DEFAULT_TAG = 'eternity-ab-2026-10';
const TAG = val('tag', DEFAULT_TAG);
const ISSUE = Number(val('issue', '5513'));
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(TAG)) throw new Error(`--tag must be kebab-case (it is the hold reason and the envelope key), got ${TAG}`);
if (!Number.isInteger(ISSUE) || ISSUE <= 0) throw new Error('--issue must be an issue number');
const IS_ETERNITY = TAG === DEFAULT_TAG && ISSUE === 5513;
const STEM = TAG.replace(/-\d{4}-\d{2}$/, '');   // eternity-ab-2026-10 → eternity-ab
export const SWEEP = TAG;
export const HOLD = Object.freeze({
  reason: TAG,
  issue: ISSUE,
  release: `released by scripts/batch/eternity-ab-5513.mjs${IS_ETERNITY ? '' : ` --tag ${TAG}`} when the book is enrolled in the chained translation lane, or at the end of the OCR→translate pass (#${ISSUE})`,
  source: val('source', `${STEM}-${ISSUE}`),
});
const ENVELOPE_TAG = TAG;
const JOB_LABEL = IS_ETERNITY ? 'Eternity A+B' : TAG;
const OCR_CALL_SITE = 'scripts/batch/bulk-reocr-local.mjs';
const ACTIVE_JOB = ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'];
const CAP = Number(val('cap', IS_ETERNITY ? '230' : 'NaN'));
if (!(CAP > 0)) throw new Error(`--cap is required with --tag ${TAG}: the $230 default belongs to the Eternity run only`);
const OCR_CAP = Math.min(CAP, Number(val('ocr-cap', String(CAP))));   // new OCR stops here; the rest of CAP is translation's
const OCR_RATE = Number(val('ocr-rate', '0.00225'));   // supabase-usage-logger's lite batch ceiling
const TR_RATE = 0.0012;                                  // chained AUTO_APPROVAL_USD_PER_PAGE (2× measured)
const STATE = val('state', `/root/claude-jobs/${STEM}-work/state.json`);
const LOG_DIR = path.dirname(STATE);
const MAX_RUNS_PER_BOOK = 12;

const TOP_KEYS = ['cap_hit', 'ocr_cap_hit', 'quota_backoff_until', 'quota_hits'];
// ── state (merge-on-save, as in the #5309 driver: commands may run concurrently) ──
function loadState() {
  const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  Object.defineProperty(s, '__loaded', { value: new Map(s.books.map((b) => [b.id, JSON.stringify(b)])), enumerable: false });
  Object.defineProperty(s, '__top', { value: JSON.stringify(TOP_KEYS.map((k) => s[k])), enumerable: false });
  return s;
}
function writeState(s) {
  s.updated_at = new Date().toISOString();
  fs.writeFileSync(STATE + '.tmp', JSON.stringify(s));
  fs.renameSync(STATE + '.tmp', STATE);
}
function saveState(s) {
  if (!fs.existsSync(STATE) || !s.__loaded) return writeState(s);
  const fresh = loadState();
  const byId = new Map(fresh.books.map((b, i) => [b.id, i]));
  for (const b of s.books) {
    const now = JSON.stringify(b);
    if (s.__loaded.get(b.id) === now) continue;
    const i = byId.get(b.id);
    if (i == null) fresh.books.push(b); else fresh.books[i] = b;
    s.__loaded.set(b.id, now);
  }
  // Top-level keys: write only the ones THIS process changed, or a stale snapshot undoes another's reset.
  const top0 = JSON.parse(s.__top);
  TOP_KEYS.forEach((k, i) => { if (JSON.stringify(s[k]) !== JSON.stringify(top0[i])) fresh[k] = s[k]; });
  writeState(fresh);
}
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

// ── init / hold / envelope ─────────────────────────────────────────────────
async function init(db) {
  if (fs.existsSync(STATE) && !has('force')) throw new Error(`${STATE} exists — refusing to re-init`);
  const select = val('select');
  if (select && !SELECTIONS[select]) throw new Error(`--select: unknown selection ${select} (have: ${Object.keys(SELECTIONS).join(', ')})`);
  const s = { created_at: new Date().toISOString(), tag: TAG, issue: ISSUE, cap: CAP, skipped: [], books: [] };
  const per = select ? await SELECTIONS[select](db, s) : JSON.parse(fs.readFileSync(val('perbook'), 'utf8'));
  const skip = new Map(val('skip') ? JSON.parse(fs.readFileSync(val('skip'), 'utf8')).map((x) => [x.id, x.why]) : []);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  for (const x of per) {
    if (skip.has(x.id)) { s.skipped.push({ id: x.id, title: x.title, language: x.language, pages: x.target_ids.length, why: skip.get(x.id) }); continue; }
    s.books.push({ id: x.id, title: x.title, language: x.language, visible: x.visible === true, n: x.target_ids.length,
      page_ids: x.target_ids, prior_status: x.status, phase: x.target_ids.length ? 'pending' : 'ocr_done', retries: 0, runs: [],
      ...(x.measured ? { measured: x.measured } : {}) });
  }
  saveState(s);
  log(`init: ${s.books.length} books, ${s.books.reduce((n, b) => n + b.n, 0)} pages to OCR; ${s.skipped.length} skipped`);
  if (select) for (const [l, r] of Object.entries(byLanguage(s.books))) log(`  ${l}: ${r.books} books, ${r.pages} pages, ${r.no_ocr} without OCR, ${r.ocr_no_english} with OCR but no English`);
}

const byLanguage = (books) => books.reduce((m, b) => {
  const r = (m[b.language] = m[b.language] || { books: 0, pages: 0, no_ocr: 0, ocr_no_english: 0 });
  r.books++; r.pages += b.measured?.pages || 0; r.no_ocr += b.n; r.ocr_no_english += b.measured?.ocr_no_english || 0;
  return m;
}, {});

// ── selections (init --select NAME) ────────────────────────────────────────
/**
 * #6109's shelves: the collection slugs of the TRADITIONS map in src/lib/search/tradition-search.ts
 * (PR #6086), copied here because that module is TypeScript on an unmerged branch. Change one,
 * change both. The map's `alchemical` (alchemy, spiritual-alchemy) and `rosicrucian`
 * (rosicrucian-alchemy) entries are NOT in the selection: #6109's measured and approved 185 books
 * is the map without them (188 on 2026-10-06; with them the same rule returns 444 books and ~176K
 * pages, three times the approved $120). A book on one of those shelves AND one below is selected.
 */
export const TRADITION_SHELVES = Object.freeze({
  sufi: ['sufism', 'sufism-islamic-mysticism', 'sufi-eastern-mysticism'],
  islamic: ['islamic-philosophy', 'islam', 'quran-islamic-theology', 'judeo-islamic-philosophy'],
  kabbalistic: ['kabbalah', 'jewish-kabbalistic-mysticism'],
  chan: ['zen-chan'],
  buddhist: ['buddhism', 'chinese-buddhist-texts', 'indian-buddhist-jain', 'tibetan-canon', 'zen-chan'],
  daoist: ['daoist-classics', 'daoist-alchemy', 'chinese-daoist-magic', 'daoism'],
  vedantic: ['vedanta-darshana', 'hinduism', 'yoga-tantra-mysticism'],
  hermetic: ['corpus-hermeticum', 'hermetica', 'hermetic-revival'],
  neoplatonic: ['neoplatonism', 'florentine-neoplatonism'],
  'christian-mystical': ['christian-mysticism-sub', 'german-speculative-mysticism', 'rhineland-mystics', 'beguine-mystics'],
  gnostic: ['gnostic-texts'],
});
/** Also the order books are worked in: when the cap binds, the languages at the end are what is left. */
export const TRADITION_LANGUAGES = Object.freeze(['Latin', 'Greek', 'German', 'French', 'Italian']);
const NO_TEXT = { $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] };

const liveOnShelves = (slugs) => ({ visible: true, pages_count: { $gt: 0 }, collections: { $in: slugs } });

/** Books on each tradition's shelves and how many are readable in English (the named view, not a re-typed rule). */
async function shelfReadable(db) {
  const out = {};
  for (const [k, slugs] of Object.entries(TRADITION_SHELVES)) {
    const [r] = await db.collection('books').aggregate([{ $match: liveOnShelves(slugs) },
      { $group: { _id: null, books: { $sum: 1 }, readable: { $sum: { $cond: [READABLE_IN_ENGLISH_EXPR, 1, 0] } } } }]).toArray();
    out[k] = { books: r?.books || 0, readable: r?.readable || 0 };
  }
  return out;
}

/**
 * #6109's rule, exactly: visible, pages_count > 0, on a tradition shelf, no pipeline hold, NOT
 * readable in English, language one of five. Per book: the pages (page_number > 0) with no OCR text
 * are the OCR targets. Read-only. Ordered by language, then least work first, so a cap that binds
 * has finished the most books it could.
 */
async function selectTraditionShelves(db, s) {
  const languages = val('languages') ? val('languages').split(',').map((x) => x.trim()) : [...TRADITION_LANGUAGES];
  const bad = languages.filter((l) => !TRADITION_LANGUAGES.includes(l));
  if (bad.length) throw new Error(`--languages: ${bad.join(', ')} not in #6109's selection (${TRADITION_LANGUAGES.join(', ')})`);
  const slugs = [...new Set(Object.values(TRADITION_SHELVES).flat())];
  const books = await db.collection('books').find({ ...liveOnShelves(slugs), 'pipeline_auto.hold': { $exists: false },
    $expr: { $not: [READABLE_IN_ENGLISH_EXPR] }, language: { $in: languages } },
  { projection: { _id: 0, id: 1, title: 1, language: 1, visible: 1, collections: 1, 'pipeline_auto.status': 1 } }).toArray();
  const per = [];
  for (const b of books) {
    const pages = await db.collection('pages').find({ book_id: b.id, page_number: { $gt: 0 } },
      { projection: { _id: 0, id: 1, page_number: 1, hasOcr: { $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] }, hasEn: { $gt: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 0] } } }).sort({ page_number: 1 }).toArray();
    per.push({ id: b.id, title: b.title, language: b.language, visible: b.visible, status: b.pipeline_auto?.status ?? null,
      target_ids: pages.filter((p) => !p.hasOcr).map((p) => p.id),
      measured: { pages: pages.length, ocr_no_english: pages.filter((p) => p.hasOcr && !p.hasEn).length,
        traditions: Object.keys(TRADITION_SHELVES).filter((k) => TRADITION_SHELVES[k].some((c) => (b.collections || []).includes(c))) } });
  }
  const work = (x) => x.target_ids.length * 2 + x.measured.ocr_no_english;
  per.sort((a, b) => languages.indexOf(a.language) - languages.indexOf(b.language) || work(a) - work(b) || a.id.localeCompare(b.id));
  s.selection = { name: 'tradition-shelves', languages, collections: slugs, readable_before: await shelfReadable(db) };
  return per;
}
const SELECTIONS = { 'tradition-shelves': selectTraditionShelves };

async function shelves(db) {
  const s = loadState();
  const now = await shelfReadable(db);
  const before = s.selection?.readable_before || {};
  const mine = (k) => s.books.filter((b) => b.measured?.traditions?.includes(k)).length;
  console.log(JSON.stringify(Object.fromEntries(Object.keys(now).map((k) => [k, { books: now[k].books, selected: mine(k), readable_before: before[k]?.readable ?? null, readable_now: now[k].readable }])), null, 1));
}

async function hold(db) {
  const s = loadState();
  let held = 0, already = 0;
  for (const b of s.books) {
    if (b.foreign_hold || b.released_at || b.released_for_translation_at) continue;
    const r = await holdBook(db, b.id, HOLD);
    if (r.outcome === 'held') { held++; b.held_by_us = true; b.prior_status = r.from ?? b.prior_status; await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'held', detail: { from: r.from, pages: b.n } }); }
    else if (r.outcome === 'already_held') { already++; b.held_by_us = true; }
    else { log(`  ${b.id}: ${r.outcome} — another lane holds it, skipped`); b.foreign_hold = r.outcome; b.phase = 'skipped'; }
  }
  saveState(s);
  const now = await db.collection('books').countDocuments({ id: { $in: s.books.map((b) => b.id) }, 'pipeline_auto.hold.reason': HOLD.reason });
  log(`hold: ${held} held now, ${already} already; Mongo says ${now} books held as ${HOLD.reason}`);
}

async function envelope(db) {
  const s = loadState();
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (readScopeEnvelopes(control).some((e) => e.tag === ENVELOPE_TAG)) { log(`envelope ${ENVELOPE_TAG} already open`); return; }
  const ids = s.books.filter((b) => !b.foreign_hold).map((b) => b.id).join(',');
  const by = val('by', IS_ETERNITY ? 'derek 2026-10-01 "do it" (#5513 Eternity tranches A+B OCR→translate, hard cap $230); chained lane only, OCR is hand-run Batch metered against this envelope by the driver' : null);
  if (!by) throw new Error(`envelope: --by "who approved, when, in what words" is required with --tag ${TAG}`);
  const out = execFileSync(process.execPath, ['scripts/maintenance/set-scope.mjs', '--tag', ENVELOPE_TAG, '--books', ids, '--budget', String(CAP),
    '--lanes', 'translate-batch-chained',
    '--by', by],
  { cwd: ROOT, env: process.env, encoding: 'utf8' });
  console.log(out.trim().split('\n').slice(-3).join('\n'));
}

async function spend(db, s = loadState()) {
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  const env = readScopeEnvelopes(control).find((e) => e.tag === ENVELOPE_TAG);
  const since = env?.created_at ? new Date(env.created_at) : new Date(s.created_at);
  const r = await getScopeSpendUsd(db, { ids: s.books.map((b) => b.id), since });
  if (r.meterError) throw new Error(`meter unreadable: ${r.meterError}`);
  return { usd: r.usd, rows: r.rows, budget: env?.budget_usd ?? null, since };
}

/** Translation committed but not yet metered: each open run's estimate less what it has spent. */
async function openTranslationUsd(db, s) {
  const runIds = s.books.flatMap((b) => (b.phase === 'tr_enrolled' && b.run_id ? [b.run_id] : []));
  if (!runIds.length) return 0;
  const rows = await db.collection(RUNS_COLLECTION).find({ id: { $in: runIds } }, { projection: { estimate: 1, spent_est_usd: 1 } }).toArray();
  return rows.reduce((n, r) => n + Math.max(0, (r.estimate || 0) - (r.spent_est_usd || 0)), 0);
}

// ── OCR ────────────────────────────────────────────────────────────────────
/** The book's pages still without text, minus any page a live OCR job (any submitter) carries. */
async function ocrTargets(db, b) {
  const still = await db.collection('pages').find({ id: { $in: b.page_ids }, $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] }, { projection: { _id: 0, id: 1 } }).toArray();
  const live = await db.collection('batch_jobs').find({ book_id: b.id, type: 'ocr', status: { $in: ACTIVE_JOB } }, { projection: { _id: 0, page_ids: 1 } }).toArray();
  const inFlight = new Set(live.flatMap((j) => j.page_ids || []));
  return still.map((p) => p.id).filter((id) => !inFlight.has(id));
}

async function dryrun(db) {
  const s = loadState();
  const ids = s.books.filter((b) => b.phase === 'pending').flatMap((b) => b.page_ids);
  const file = path.join(LOG_DIR, 'dryrun-pages.json');
  fs.writeFileSync(file, JSON.stringify(ids));
  const res = spawnSync(process.execPath, ['scripts/batch/bulk-reocr-local.mjs', `--page-ids-file=${file}`, '--dry-run', `--reason=${SWEEP}: dry-run (#${ISSUE})`],
    { cwd: ROOT, env: process.env, encoding: 'utf8', maxBuffer: 256 << 20 });
  fs.writeFileSync(path.join(LOG_DIR, 'dryrun-ocr.log'), (res.stdout || '') + (res.stderr || ''));
  console.log((res.stdout || '').split('\n').filter((l) => /^(=== Summary|Books|Pages|Estimated|  \d+ |  Prompt)/.test(l)).join('\n'));
  // Translation: what is translatable today, plus the pages about to get text (an upper bound: blanks and plates drop out).
  const per = {};
  for (const b of s.books.filter((x) => !['skipped'].includes(x.phase))) {
    const r = (per[b.language] = per[b.language] || { books: 0, ocr_pages: 0, translatable_now: 0 });
    r.books++; r.ocr_pages += b.phase === 'pending' ? b.n : 0; r.translatable_now += (await translateTargets(db, b.id)).length;
  }
  let tot = 0;
  for (const [l, r] of Object.entries(per)) {
    const n = r.translatable_now + r.ocr_pages; tot += n;
    console.log(`${l}: ${r.books} books, ${r.ocr_pages} pages to OCR (≤ $${(r.ocr_pages * OCR_RATE).toFixed(2)} at the $${OCR_RATE} ceiling), ${r.translatable_now} translatable now, ≤ ${n} to translate (≤ $${(n * TR_RATE).toFixed(2)} at the lane's $${TR_RATE} approval rate, ~$${(n * TR_RATE / 2).toFixed(2)} measured)`);
  }
  console.log(`Translation, all languages: ≤ ${tot} pages, ≤ $${(tot * TR_RATE).toFixed(2)} (~$${(tot * TR_RATE / 2).toFixed(2)} measured). Cap $${CAP}${OCR_CAP < CAP ? `, new OCR stops at $${OCR_CAP}` : ''}.`);
}

async function ocr(db) {
  const s = loadState();
  await reconcile(db, s);
  if (s.quota_backoff_until && new Date(s.quota_backoff_until) > new Date()) { log(`ocr: File API backoff until ${s.quota_backoff_until}`); return 0; }
  // --shard k/n: parallel submitters split the books by their index in the state file.
  const [sk, sn] = (val('shard', '0/1')).split('/').map(Number);
  let picks = s.books.filter((b, i) => b.phase === 'pending' && i % sn === sk);
  if (!picks.length && has('fallback')) picks = s.books.filter((b) => b.phase === 'pending');   // retries, or a finished shard
  picks = picks.slice(0, Number(val('books', '10')));
  if (!picks.length) { log('ocr: nothing pending'); return 0; }
  // The 20 GB File-API quota is per project and shared with every lane: count every open file-based job.
  const openJobs = await db.collection('batch_jobs').countDocuments({ type: { $in: ['ocr', 'translation', 'translate'] }, status: { $in: ACTIVE_JOB }, submission_method: 'file', created_at: { $gte: new Date(Date.now() - 72 * 3600e3) } });
  if (openJobs > Number(val('max-jobs', '260'))) { log(`ocr: ${openJobs} file-based jobs open project-wide — waiting for the collector`); return 0; }
  const SLICE = Number(val('slice', '120'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(LOG_DIR, `ocr-${stamp}.log`);
  let quota = false, submittedBooks = 0;
  for (const b of picks) {
    const ids = await ocrTargets(db, b);
    const sp = await spend(db, s);
    const openTr = await openTranslationUsd(db, s);
    const add = ids.length * OCR_RATE;
    if (sp.usd + openTr + add > OCR_CAP) { log(`ocr: CAP — spent $${sp.usd.toFixed(2)} + open translation $${openTr.toFixed(2)} + $${add.toFixed(2)} > $${OCR_CAP}`); s[OCR_CAP < CAP ? 'ocr_cap_hit' : 'cap_hit'] = new Date().toISOString(); break; }
    if (!ids.length) { b.phase = 'ocr_submitted'; b.ocr_submitted_at = b.ocr_submitted_at || new Date().toISOString(); saveState(s); continue; }
    const t0 = new Date();
    for (let i = 0; i < ids.length; i += SLICE) {
      const file = path.join(LOG_DIR, `pages-${stamp}-${b.id}-${i}.json`);
      fs.writeFileSync(file, JSON.stringify(ids.slice(i, i + SLICE)));
      const res = spawnSync(process.execPath, ['scripts/batch/bulk-reocr-local.mjs', `--page-ids-file=${file}`,
        `--reason=${SWEEP}: first OCR of pages with no text${IS_ETERNITY ? `, Eternity tranche ${b.visible ? 'A' : 'B'}` : ''} (#${ISSUE})`],
      { cwd: ROOT, env: process.env, encoding: 'utf8', maxBuffer: 64 << 20 });
      const out = (res.stdout || '') + (res.stderr || '');
      fs.appendFileSync(logFile, `=== ${b.id} slice ${i}\n${out}`);
      fs.unlinkSync(file);
      const tail = (res.stdout || '').trim().split('\n').filter((l) => /^(Pages|Estimated|NOT SUBMITTED)/.test(l));
      log(`  ${b.id} slice ${i}: ${res.status !== 0 ? `exit ${res.status} ` : ''}${tail.join('; ')}`);
      // Match the error line only: a bare /429/ also matches book ids (6a09ff0429ab…), which paused every shard once.
      if (/exceeded your current quota|FileStorageBytesPerProject|ERROR submitting batch:.*(\b429\b|RESOURCE_EXHAUSTED)|Batch API quota exhausted/.test(out)) {
        quota = true; s.quota_hits = (s.quota_hits || 0) + 1;
        s.quota_backoff_until = new Date(Date.now() + 30 * 60e3).toISOString();
        log(`ocr: quota hit — backing off until ${s.quota_backoff_until}`);
        break;
      }
    }
    const jobs = await db.collection('batch_jobs').find({ submitted_by: OCR_CALL_SITE, type: 'ocr', book_id: b.id, created_at: { $gte: t0 }, child_job_ids: { $exists: false } },
      { projection: { id: 1, status: 1, page_ids: 1, model: 1 } }).toArray();
    const ok = jobs.filter((j) => j.status !== 'submit_failed');
    b.ocr_jobs = [...new Set([...(b.ocr_jobs || []), ...ok.map((j) => j.id)])];
    b.ocr_models = [...new Set([...(b.ocr_models || []), ...ok.map((j) => j.model)])];
    b.ocr_submitted = (b.ocr_submitted || 0) + ok.reduce((n, j) => n + (j.page_ids?.length || 0), 0);
    b.ocr_submitted_at = b.ocr_submitted_at || t0.toISOString();
    const left = (await ocrTargets(db, b)).length;
    if (left === 0) { b.phase = 'ocr_submitted'; submittedBooks++; }
    else if (!quota) { b.submit_attempts = (b.submit_attempts || 0) + 1; if (b.submit_attempts >= 3 && ok.length === 0) b.phase = 'ocr_submit_failed'; }
    await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'ocr-submitted', detail: { pages: ok.reduce((n, j) => n + (j.page_ids?.length || 0), 0), jobs: ok.length, left, models: b.ocr_models } });
    saveState(s);
    if (quota) break;
  }
  saveState(s);
  log(`ocr: ${submittedBooks} books fully submitted this wave`);
  return submittedBooks;
}

/** A book left `pending` whose pages all sit in live jobs (a dropped submit's bookkeeping) is submitted. */
async function reconcile(db, s = loadState()) {
  let fixed = 0;
  for (const b of s.books.filter((x) => x.phase === 'pending' && (x.ocr_submitted || x.submit_attempts))) {
    if ((await ocrTargets(db, b)).length) continue;
    const jobs = await db.collection('batch_jobs').find({ book_id: b.id, type: 'ocr', submitted_by: OCR_CALL_SITE, created_at: { $gte: new Date(s.created_at) }, child_job_ids: { $exists: false }, status: { $ne: 'submit_failed' } }, { projection: { id: 1 } }).toArray();
    b.ocr_jobs = [...new Set([...(b.ocr_jobs || []), ...jobs.map((j) => j.id)])];
    b.phase = 'ocr_submitted'; b.ocr_submitted_at = b.ocr_submitted_at || new Date().toISOString(); fixed++;
  }
  saveState(s);
  if (fixed) log(`reconcile: ${fixed} books marked submitted`);
}

/** Collect: a book is OCR-done when none of its jobs is live; pages still without text get ONE retry. */
async function check(db) {
  const s = loadState();
  let done = 0, waiting = 0, retried = 0;
  for (const b of s.books.filter((x) => x.phase === 'ocr_submitted')) {
    const live = await db.collection('batch_jobs').countDocuments({ book_id: b.id, type: 'ocr', status: { $in: ACTIVE_JOB } });
    if (live) { waiting++; continue; }
    const left = await ocrTargets(db, b);
    b.ocr_written = b.n - left.length;
    if (left.length && b.retries < 1) { b.retries++; b.phase = 'pending'; retried++; log(`  ${b.id}: ${b.ocr_written} written, ${left.length} not — one retry`); saveState(s); continue; }
    b.ocr_unwritten = left.length; b.phase = 'ocr_done'; b.ocr_done_at = new Date().toISOString(); done++;
    await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'ocr-collected', detail: { written: b.ocr_written, unwritten: left.length } });
    saveState(s);
  }
  log(`check: ${done} books OCR done, ${retried} retrying, ${waiting} still collecting`);
}


// ── File-API storage (20 GB per project, shared) ───────────────────────────
/**
 * Delete the uploaded JSONL inputs of THIS lane's OCR jobs once they are collected (`saved`/`failed`).
 * A finished Batch job no longer reads its input; the cron collector (collect-batch-results.mjs)
 * does not delete inputs, so they sat until the 48 h TTL and this lane alone filled the quota
 * (849 jobs × ~25 MB, 2026-10-01 16:15). Only files whose display name maps to a batch_jobs row of
 * this sweep, in a terminal status, are touched: other lanes' files and pending inputs are left alone.
 */
async function files(db) {
  const keys = [...new Set([process.env.GEMINI_API_KEY_TIER3, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY].filter(Boolean))];
  let deleted = 0, bytes = 0, seen = 0;
  for (const key of keys) {
    let token = null;
    const cands = [];
    do {
      // usage-ok: File API list/delete only (frees the 20 GB upload quota) — no generation call, nothing billed. OCR/translation spend is metered by the scripts this driver shells out to.
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/files?key=${key}&pageSize=100${token ? `&pageToken=${token}` : ''}`);
      if (!res.ok) { log(`files: list ${res.status}`); break; }
      const data = await res.json();
      for (const f of data.files || []) { seen++; const m = /^reocr-[0-9a-f]{24}-(.+)$/.exec(f.displayName || ''); if (m) cands.push({ name: f.name, job: m[1], size: Number(f.sizeBytes || 0) }); }
      token = data.nextPageToken || null;
    } while (token);
    for (let i = 0; i < cands.length; i += 500) {
      const slice = cands.slice(i, i + 500);
      const done = new Set((await db.collection('batch_jobs').find({ id: { $in: slice.map((c) => c.job) }, initiated_reason: { $regex: `^${SWEEP}` }, status: { $in: ['saved', 'failed'] } }, { projection: { id: 1 } }).toArray()).map((j) => j.id));
      for (const c of slice.filter((x) => done.has(x.job))) {
        const del = await fetch(`https://generativelanguage.googleapis.com/v1beta/${c.name}?key=${key}`, { method: 'DELETE' });
        if (del.ok) { deleted++; bytes += c.size; }
      }
    }
  }
  log(`files: ${seen} files listed, deleted ${deleted} inputs of collected ${SWEEP} jobs (${(bytes / 1e9).toFixed(2)} GB)`);
  return deleted;
}

// ── translation: release → chained enrol with a page list ──────────────────
/** Pages the brief allows: text, no translation, not withheld, not blank/illustration (the lane re-checks). */
async function translateTargets(db, bookId) {
  const ps = await db.collection('pages').find({
    book_id: bookId, ...translatablePageFilter({ extraSkipTypes: ['illustration'] }),
    translation_withheld: { $exists: false },
    'translation.health_blocked': { $exists: false },
    $or: [{ 'translation.data': { $exists: false } }, { 'translation.data': null }, { 'translation.data': '' }],
  }, { projection: { _id: 0, id: 1 } }).toArray();
  return ps.map((p) => p.id);
}

function loopAlive() { return spawnSync('pgrep', ['-f', 'translate-batch-worker.mjs --chained --loop'], { encoding: 'utf8' }).status === 0; }

async function enrol(db) {
  const s = loadState();
  const maxOpen = Number(val('max-open', '60'));
  let open = s.books.filter((b) => b.phase === 'tr_enrolled').length;
  const cands = s.books.filter((b) => ['ocr_done', 'tr_next'].includes(b.phase));
  if (!cands.length) return;
  if (!loopAlive()) log('enrol: WARNING no chained --loop on this box; the */5 --tick cron still advances runs');
  let enrolled = 0;
  for (const b of cands) {
    if (open >= maxOpen) break;
    const ids = await translateTargets(db, b.id);
    if (!ids.length || (b.runs?.length || 0) >= MAX_RUNS_PER_BOOK) {
      b.phase = 'tr_done'; b.tr_left = ids.length; saveState(s);
      continue;
    }
    const sp = await spend(db, s);
    const openTr = await openTranslationUsd(db, s);
    const n = Math.min(ids.length, MAX_PAGES_PER_RUN);
    const est = n * TR_RATE;
    if (sp.usd + openTr + est > CAP) { log(`enrol: CAP — spent $${sp.usd.toFixed(2)} + open $${openTr.toFixed(2)} + $${est.toFixed(2)} > $${CAP}`); s.cap_hit = new Date().toISOString(); break; }
    const book = await db.collection('books').findOne({ id: b.id }, { projection: { pipeline_auto: 1 } });
    if (isHeld(book)) {
      if (book.pipeline_auto.hold.reason !== HOLD.reason) { log(`  ${b.id}: held by ${book.pipeline_auto.hold.reason} — skipped`); b.phase = 'skipped'; b.foreign_hold = book.pipeline_auto.hold.reason; saveState(s); continue; }
      const rel = await releaseBook(db, b.id, { note: `released for chained batch enrol (#${ISSUE})`, source: HOLD.source });
      if (rel.outcome !== 'released') { log(`  ${b.id}: release ${rel.outcome}`); continue; }
      b.held_by_us = false; b.released_for_translation_at = new Date().toISOString(); b.released_to = rel.to;
    }
    const pf = path.join(LOG_DIR, `tr-pages-${b.id}.json`);
    fs.writeFileSync(pf, JSON.stringify({ [b.id]: ids }));
    const approved = Math.max(0.05, +(n * 0.003).toFixed(2));
    let out = '';
    try {
      out = execFileSync(process.execPath, ['scripts/workers/translate-batch-worker.mjs', '--chained', '--enrol', `--pages-file=${pf}`, `--approved-usd=${approved}`],
        { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 600000 });
    } catch (e) { out = `${e.stdout || ''}\n${e.stderr || ''}\nEXIT ${e.status}`; }
    fs.appendFileSync(path.join(LOG_DIR, 'enrol.log'), `=== ${new Date().toISOString()} ${b.id}\n${out}\n`);
    // An open run on the book (an enrol whose bookkeeping a restart lost) is adopted, not refused.
    const m = out.match(/run (\S+) est \$([\d.]+)/) || ((x) => x && ['', x[1], String(n * 0.0006)])(out.match(/open-run (\S+)/));
    if (m) {
      b.run_id = m[1]; b.runs = [...(b.runs || []), m[1]]; b.tr_est = Number(m[2]); b.phase = 'tr_enrolled'; open++; enrolled++;
      await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'chained-enrolled', detail: { run: b.run_id, estimate: b.tr_est, approved, pages: n, queue: ids.length } });
    } else {
      const reason = (out.match(/REFUSED[^\n]*|exceeds[^\n]*|Error[^\n]*/) || [out.trim().split('\n').pop()])[0];
      b.tr_reason = String(reason).slice(0, 200);
      b.phase = /nothing-to-translate/.test(reason) ? 'tr_done' : 'tr_refused';
      log(`  ${b.id}: ${b.phase} — ${b.tr_reason}`);
    }
    saveState(s);
  }
  log(`enrol: ${enrolled} enrolled, ${open} open`);
}

async function runs(db) {
  const s = loadState();
  const mine = s.books.filter((b) => b.phase === 'tr_enrolled');
  if (!mine.length) return;
  const rows = await db.collection(RUNS_COLLECTION).find({ id: { $in: mine.map((b) => b.run_id) } }, { projection: { id: 1, phase: 1, counts: 1, spent_est_usd: 1, cursor: 1, page_count: 1, parked_reason: 1 } }).toArray();
  const byRun = new Map(rows.map((r) => [r.id, r]));
  let finished = 0;
  for (const b of mine) {
    const r = byRun.get(b.run_id);
    if (!r) continue;
    b.tr_progress = `${r.cursor}/${r.page_count}`;
    if (!TERMINAL_PHASES.includes(r.phase)) continue;
    b.tr_written = (b.tr_written || 0) + (r.counts?.written || 0);
    b.last_run_phase = r.phase; b.last_parked_reason = r.parked_reason || null;
    // complete → enrol the next 300 in the same tick (enrol runs after this); parked/failed → stop.
    b.phase = r.phase === 'complete' ? 'tr_next' : `tr_${r.phase}`;
    finished++;
    await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: `chained-${r.phase}`, detail: { run: b.run_id, counts: r.counts, spent_est_usd: r.spent_est_usd, parked_reason: r.parked_reason || null } });
  }
  saveState(s);
  log(`runs: ${finished} finished, ${mine.length - finished} running`);
}

async function release(db) {
  const s = loadState();
  let n = 0;
  for (const b of s.books) {
    const book = await db.collection('books').findOne({ id: b.id }, { projection: { pipeline_auto: 1 } });
    if (!isHeld(book) || book.pipeline_auto.hold.reason !== HOLD.reason) continue;
    if (!has('all') && !['tr_done', 'tr_refused', 'tr_parked', 'tr_failed', 'ocr_submit_failed'].includes(b.phase)) continue;
    const r = await releaseBook(db, b.id, { note: `${JOB_LABEL} OCR→translate pass finished (#${ISSUE})`, source: HOLD.source });
    if (r.outcome === 'released') { n++; b.held_by_us = false; b.released_at = new Date().toISOString(); b.released_to = r.to; await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'released', detail: { to: r.to } }); }
  }
  saveState(s);
  log(`release: ${n} books released to their prior status`);
}

async function status(db) {
  const s = loadState();
  const byPhase = {};
  for (const b of s.books) { const k = b.phase; byPhase[k] = byPhase[k] || { books: 0, pages: 0 }; byPhase[k].books++; byPhase[k].pages += b.n; }
  const sp = await spend(db, s).catch((e) => ({ usd: NaN, rows: 0, err: e.message }));
  const openTr = await openTranslationUsd(db, s);
  const ids = s.books.map((b) => b.id);
  const lang = Object.fromEntries(s.books.map((b) => [b.id, b.language]));
  // Written, measured from Mongo: pages of OUR list that now have text; translations written since init.
  const since = new Date(s.created_at);
  const ocrW = await db.collection('pages').aggregate([{ $match: { id: { $in: s.books.flatMap((b) => b.page_ids) }, 'ocr.data': { $exists: true, $nin: [null, ''] } } }, { $group: { _id: '$book_id', n: { $sum: 1 } } }]).toArray();
  const trW = await db.collection('pages').aggregate([{ $match: { book_id: { $in: ids }, 'translation.updated_at': { $gte: since }, 'translation.data': { $exists: true, $nin: [null, ''] } } }, { $group: { _id: '$book_id', n: { $sum: 1 } } }]).toArray();
  const per = {};
  for (const r of ocrW) { const l = lang[r._id]; per[l] = per[l] || { ocr: 0, translated: 0 }; per[l].ocr += r.n; }
  for (const r of trW) { const l = lang[r._id]; per[l] = per[l] || { ocr: 0, translated: 0 }; per[l].translated += r.n; }
  const held = await db.collection('books').countDocuments({ id: { $in: ids }, 'pipeline_auto.hold.reason': HOLD.reason });
  console.log(JSON.stringify({ phases: byPhase, written_by_language: per, held_now: held,
    envelope: { spent_usd: +(sp.usd || 0).toFixed(2), rows: sp.rows, open_translation_est: +openTr.toFixed(2), cap: CAP, err: sp.err },
    cap_hit: s.cap_hit || null, ocr_cap_hit: s.ocr_cap_hit || null, quota_backoff_until: s.quota_backoff_until || null, updated_at: s.updated_at }, null, 1));
}

async function run(db) {
  const interval = Number(val('interval', '180')) * 1000;
  for (;;) {
    if (!has('ocr-only')) { await check(db); await runs(db); await enrol(db); }
    const s = loadState();
    if (has('ocr-only') && !s.books.some((b) => b.phase === 'pending')) { log('run: --ocr-only and nothing pending — done'); return; }
    if (s.quota_backoff_until && new Date(s.quota_backoff_until) > new Date() && !has('ocr-only')) {
      if (await files(db)) { s.quota_backoff_until = new Date().toISOString(); saveState(s); }
    }
    if (s.books.some((b) => b.phase === 'pending') && !s.cap_hit && !s.ocr_cap_hit) {
      const inflightBooks = s.books.filter((b) => b.phase === 'ocr_submitted').length;
      if (inflightBooks < Number(val('max-inflight-books', '80'))) {
        if (!args.includes('--books')) args.push('--books', val('wave', '10'));
        await ocr(db);
      } else log(`run: ${inflightBooks} books collecting — no new OCR wave`);
    }
    const st = loadState();
    const live = st.books.filter((b) => !['tr_done', 'tr_refused', 'tr_parked', 'tr_failed', 'skipped', 'ocr_submit_failed'].includes(b.phase));
    log(`run: ${live.length} books still moving; ${JSON.stringify(Object.fromEntries(Object.entries(st.books.reduce((m, b) => { m[b.phase] = (m[b.phase] || 0) + 1; return m; }, {}))))}`);
    if (!live.length) { await release(db); log('run: every book finished — released'); return; }
    if (st.cap_hit && !st.books.some((b) => ['tr_enrolled', 'ocr_submitted'].includes(b.phase))) { log('run: CAP HIT and nothing in flight — stopping'); return; }
    if (st.ocr_cap_hit && live.every((b) => b.phase === 'pending')) { log(`run: OCR cap $${OCR_CAP} hit, every other book finished — stopping (${live.length} books never submitted)`); return; }
    await new Promise((r) => setTimeout(r, interval));
  }
}

const COMMANDS = { init, hold, envelope, dryrun, files, ocr, reconcile, check, enrol, runs, release, status, shelves, run };
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!COMMANDS[cmd]) { console.error(`usage: ${Object.keys(COMMANDS).join('|')} (see header)`); process.exit(2); }
  await withMongo(async (db) => { await COMMANDS[cmd](db); }, { noTimeout: true });
}
