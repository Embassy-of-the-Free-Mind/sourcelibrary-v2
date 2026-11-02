#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate-lane.mjs — the cron driver this copies (UNTRANSLATED pages, the reader/apply
// pair, a ledger of pages not to retry, exit-3 stop, per-day output folder). It drains books held FOR a CLI lane
// (CLI_TRANSLATE_HOLD) and releases them when done; the Siku cohort is held for OTHER reasons (paddle-zh-5600-ocr-only,
// gpu-backlog-5660) and must STAY held, and its quota gate (lane-quota.mjs) reads only agy's locks, not the weekly
// fraction `agy -p /quota` reports. scripts/batch/refused-pages.mjs — weekly-limit guard pattern. scripts/eval/
// siku-pilot-7503/draw.mjs — the cohort filters (OCR >= 80%, other jobs' lane_job_books, sibling English).
// scripts/batch/ocr-convergence/judge-6694.mjs — the sealed `claude -p` Opus call over page images, copied for the
// spot check. None reads per-pool weekly quota or keeps a book held while translating it.
/**
 * siku-translate-lane — translate the held Siku Quanshu cohort (#5600) on agy 3.8 Flash, in waves, on spare quota.
 *
 * WHO RUNS IT: cron on main every 15 min (flock'd; a wave reads for --max-minutes), and a session by hand. No paid API: reads go through `agy -p`
 * (cli-translate.mjs read, 1 page per call, reads ON) and are written by `cli-translate.mjs apply --apply`, which
 * recounts each book. Derek, 2026-10-27: "yes" to translating the held Siku books, "lower the bar, keep them as drafts".
 *
 *   node --env-file=.env.production.local scripts/batch/siku-translate-lane.mjs pools
 *   node --env-file=.env.production.local scripts/batch/siku-translate-lane.mjs count
 *   node --env-file=.env.production.local scripts/batch/siku-translate-lane.mjs run [--apply] [--max-pages=1500]
 *        [--parallel=3] [--per-call=1] [--state=DIR]
 *   node --env-file=.env.production.local scripts/batch/siku-translate-lane.mjs spot-check [--force] [--n=10]
 *
 * POOL GATE. Every agy pool on the box is read with `agy -p /quota --output-format json` (0 tokens): the default HOME,
 * and each AGY_HOME in POOL_HOMES that exists. A non-default pool that another process is using (AGY_HOME in its
 * environment, e.g. a measurement job) is skipped; a lane marked AGY_POOL_SHARED=1 (cli-ocr-lane correct) only shares
 * it (scripts/lib/agy-pools.mjs). The pool with the most Gemini weekly remaining is used, and only if weekly
 * remaining is above the other lanes' weekly reserve (agy-pools.mjs weeklyReserve; 0 in the last 36 h before the
 * reset, when it must still be above AGY_GEMINI_EMPTY), drain by reset (#7911; was 0.35, 0.05 in the last 24 h).
 * The pool is re-read before each book; the wave stops the moment it falls below the floor. A reading
 * that fails twice in a row stops the wave and pings ntfy.
 *
 * BOOKS. Held `paddle-zh-5600-ocr-only` or `gpu-backlog-5660`, rung `transcribed` or `translating`, OCR on >= 80% of
 * pages (#6871 release rule), not a #6871 residue book (zh-residue-refs-6871 classes: table, mixed, seal and its title
 * pattern), not a #7090 book, not on another live job's lane_job_books list (3 days), no dupe (a work_id sibling
 * that is NOT a different volume of the same Siku set and carries English, or is an English book). Volumes of one
 * set share a work_id (kr:KR…), so a translated sibling VOLUME is not a dupe. Visible first, then fewest pages.
 *
 * PAGES. Untranslated translatable pages (cli-translate-lane UNTRANSLATED), minus the ledger, minus a page whose OCR
 * holds a chat-model reply (#5600 2026-10-27: 詩總聞 p.118 ended in "作为一个人工智能语言模型…"; ledgered as
 * `ocr-chat-reply`, never sent). A page read or applied and not written is ledgered and never retried in-lane.
 *
 * BOOKS STAY HELD: nothing here releases a hold (no paid lane may touch them). The hold is re-read before each book's
 * read and again before its apply (#6874); a book whose hold moved is skipped.
 *
 * SPOT CHECK. After every 5,000 pages written (state.json), 10 pages drawn at random across the books written since
 * the last check are judged by Opus through `claude -p` against the page image (sealed folder, Read/Write only, the
 * subscription login). Skipped while this box's Claude account is >= 90% weekly; the next run does it. A check
 * deferred for 6 h pages ntfy once, so a box whose account is spent does not leave the lane unchecked silently (it was
 * deferred 19 h on 2026-10-29); run `spot-check --force` on a box whose account has room, with --state pointing at a copy. The tally is
 * posted on #5600 against the bar: 0 wrong-leaf, 0 invented, sense errors on <= 1 page in 3. An invented or wrong-leaf
 * page is CONTAINED (containment-on-finding.md: the book is already held; withhold-stale-translations --by-eye-pages
 * --apply) and the lane PAUSES: the stop file is written and ntfy is pinged.
 *
 * WAVE LENGTH. --max-pages caps a wave's pages; --max-minutes=M (#5600, 2026-10-29) instead stops TAKING new books M
 * minutes after the wave starts, so the parallel readers stay full until then and only the last books drain. With the
 * cron firing every 15 min under flock, the next wave starts within 15 min of the last one ending. (A 4,000-page cap
 * left 6 slots draining for the last ~20 min of each ~3 h wave and the hourly cron idle up to 60 min after it.)
 *
 * BOOKS THE READER REFUSES. A read that exits 2 (cli-translate's own refusal, e.g. "30% of these pages rest on a
 * flash-lite transcription ... open 3 pages against their images first") is recorded in <state>/book-skips.jsonl with
 * the reader's reason, and the book is not offered again: it needs an OCR check or re-OCR, not another wave.
 *
 * PAUSE / RESUME: `touch <state>/STOP` pauses (checked before each wave and each book); `rm <state>/STOP` resumes.
 *
 * --per-call=N (N > 1) reads N pages per call through claude-translate.mjs --cli=agy. OFF by default: on only once
 * block-drift covers caseless (Han) scripts for that reader in production (#7503).
 *
 * LEAF LINES (#5600): the 1/call reader gets LEAF_LINES on every page (--instructions-file, written per book): leave the
 * margin furniture out of the English; stop where the leaf stops. Measured in scripts/eval/siku-percall-5600 (arm C).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { UNTRANSLATED } from './cli-translate-lane.mjs';
import { claudeUsage } from '../lib/model-limits.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { ntfyPost } from '../lib/ntfy-send.mjs';
import { POOL_HOMES, parseQuota, choosePool as choosePoolBy, readPool as readPoolBy, readPools as readPoolsBy, poolName, weeklyReserve } from '../lib/agy-pools.mjs';
import { AGY_GEMINI_EMPTY } from '../lib/agy-cli.mjs';

export { POOL_HOMES, parseQuota, poolName };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
export const ISSUE = 5600;
export const JOB = 'siku-lane-5600';
// zh-histories-7546: the Four Histories (Shiji, Hanshu, Hou Hanshu, Sanguozhi), Siku copies OCR'd by the Paddle lane on
// 2026-10-28 (#7546). Derek 2026-10-29: "get more chinese translated". They go first, his 10-27 priority volumes first.
export const HOLD_REASONS = Object.freeze(['paddle-zh-5600-ocr-only', 'gpu-backlog-5660', 'zh-histories-7546']);
export const FIRST_HOLD = 'zh-histories-7546';
// Derek's 10-27 translation priority list (#7546 comment, section 3): the 21 volumes holding those chapters.
export const PRIORITY_IDS = Object.freeze(new Set(['6ae0bab64adf2ffb52f71058', '6ae0baf94adf2ffb52f7121a', '6ae0bb854adf2ffb52f7166f', '6ae0bb894adf2ffb52f7170c', '6ae0bbc74adf2ffb52f7176e', '6ae0bd3d4adf2ffb52f72384', '6ae0bdca4adf2ffb52f72677', '6ae0bdce4adf2ffb52f72711', '6ae0beb34adf2ffb52f72f36', '6ae0bef64adf2ffb52f7304b', '6ae0befa4adf2ffb52f730c0', '6ae0befe4adf2ffb52f7311a', '6ae0bf3b4adf2ffb52f731bb', '6ae0bf3f4adf2ffb52f7321e', '6ae0bf424adf2ffb52f732bf', '6ae0bf884adf2ffb52f73494', '6ae0bf9a4adf2ffb52f73668', '6ae0bfa24adf2ffb52f736b3', '6ae0c5d74adf2ffb52f75eba', '6ae0c5db4adf2ffb52f75f31', '6ae0c61d4adf2ffb52f76087']));
export const RUNGS = Object.freeze(['transcribed', 'translating']);
export const MIN_OCR_SHARE = 0.8;
export const SPOT_EVERY = 5000;
export const SPOT_N = 10;
export const MODEL = 'gemini-3.8-flash-low';
export const REASON = 'Siku lane #5600, Derek 2026-10-27';
/** #7090: reader requests, translated by their own job. */
export const ISSUE_7090_BOOKS = Object.freeze(['6a3cbe33ec254ff6cadfe195', '6a3cbd2eec254ff6cadf6bf3']);
/** #5600 (scripts/eval/siku-percall-5600): appended to every page's prompt by the 1/call reader (cli-translate
 *  --instructions-file, lane-local, never the shared prompt). Margin furniture rendered as English fell from 12 to 7
 *  of 120 pages, acceptance unchanged (79 vs 78 of 120). */
export const LEAF_LINES = [
  'The leaf\'s margin text (欽定四庫全書, the juan number, the folio number) is not part of the text: leave it out of the English.',
  'Translate only what is on this leaf. If the last sentence breaks off, stop where the leaf stops; do not complete it.',
].join('\n');
export const leafInstructions = (pageIds) => Object.fromEntries(pageIds.map((id) => [id, LEAF_LINES]));
/** A chat model's reply inside stored OCR (not leaf text). */
export const CHAT_REPLY_RE = /作为一个人工智能|人工智能语言模型|我还没学习如何回答|作為一個人工智能|As an AI(?: language)? model|I(?:'m| am) (?:sorry|unable)[^.\n]{0,40}(?:assist|help|transcribe)/i;

// ── pool gate (pure) ──

/** May a pool spend now? reading = parseQuota(). The 5-hour bucket is not gated: agy's own reply stops the reader. */
export function poolGate(reading, { now = Date.now() } = {}) {
  if (!reading) return { open: false, why: 'no reading' };
  const h = reading.weeklyReset ? (Date.parse(reading.weeklyReset) - now) / 3600e3 : Infinity;
  // a spent pool keeps a residue and never reads exactly 0 (agy-cli.mjs AGY_GEMINI_EMPTY)
  const floor = Math.max(weeklyReserve({ resetTime: reading.weeklyReset, now, lane: 'siku' }), AGY_GEMINI_EMPTY);
  const w = reading.weekly;
  const why = `weekly ${w.toFixed(3)} remaining, floor ${floor} (reset in ${Number.isFinite(h) ? h.toFixed(1) : '?'} h)`;
  return { open: w > floor, floor, why };
}

/** The pool to use: the open pool with most weekly remaining. pools = [{ home, reading, busy }]. */
export function choosePool(pools, opts) {
  return choosePoolBy(pools, (r) => poolGate(r, opts));
}

// ── book picker (pure) ──

/** A dupe: a sibling (same work_id) that carries English and is not another volume of the same Siku set, or is English. */
export function isDupeSibling(book, sib) {
  if (/^english$/i.test(sib.language || '')) return true;
  const translated = (sib.translation_state?.translated ?? sib.pages_translated ?? 0) > 0;
  if (!translated) return false;
  const sameSet = HOLD_REASONS.includes(sib.pipeline_auto?.hold?.reason) || /\(vol \d+\)\s*$/.test(sib.title || '');
  if (!sameSet) return true;                       // another edition with English
  return sib.title === book.title;                 // the same volume twice
}

/** Book-level filter and order. books: candidate rows; ctx: { exclude: Set, sealRe: RegExp|null }. */
export function rankBooks(books, { exclude = new Set(), sealRe = null } = {}) {
  return books.filter((b) => {
    if (!b.id || exclude.has(b.id)) return false;
    if (!HOLD_REASONS.includes(b.pipeline_auto?.hold?.reason) || b.pipeline_auto?.status !== 'held') return false;
    const ts = b.translation_state || {};
    if (!RUNGS.includes(ts.rung)) return false;
    if (!(ts.whole > 0) || (ts.ocr ?? 0) / ts.whole < MIN_OCR_SHARE) return false;
    if (sealRe && sealRe.test(b.title || '')) return false;
    return true;
  }).sort((a, b) => rankKey(b) - rankKey(a) || (b.visible ? 1 : 0) - (a.visible ? 1 : 0) || (a.pages_count ?? 0) - (b.pages_count ?? 0) || (a.id < b.id ? -1 : 1));
}
/** 2 = a priority Four Histories volume, 1 = another Four Histories volume, 0 = the Siku cohort. */
function rankKey(b) {
  if (b.pipeline_auto?.hold?.reason !== FIRST_HOLD) return 0;
  return PRIORITY_IDS.has(b.id) ? 2 : 1;
}

// ── state, ledger, log ──

const arg = (n, d = null) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const STATE_DIR = path.resolve(arg('state', '/mnt/HC_Volume_105839809/siku-lane-5600'));
const P = { stop: path.join(STATE_DIR, 'STOP'), state: path.join(STATE_DIR, 'state.json'), ledger: path.join(STATE_DIR, 'ledger.jsonl'), readings: path.join(STATE_DIR, 'pool-readings.jsonl'), written: path.join(STATE_DIR, 'written.jsonl'), skips: path.join(STATE_DIR, 'book-skips.jsonl') };
const log = (...a) => console.log(new Date().toISOString().slice(0, 19) + 'Z', ...a);
const readState = () => { try { return JSON.parse(fs.readFileSync(P.state, 'utf8')); } catch { return { written_total: 0, spot_at: 0, last_comment_day: null, waves: [] }; } };
const saveState = (s) => fs.writeFileSync(P.state, JSON.stringify(s, null, 1));
const readLedger = () => new Set(fs.existsSync(P.ledger) ? fs.readFileSync(P.ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id) : []);
const readSkips = () => new Set(fs.existsSync(P.skips) ? fs.readFileSync(P.skips, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).book_id) : []);
const ledger = (row) => fs.appendFileSync(P.ledger, JSON.stringify({ ...row, at: new Date().toISOString() }) + '\n');

async function ntfy(title, msg) {
  try { await ntfyPost('https://ntfy.sh/sourcelibrary-uptime', { method: 'POST', headers: { Title: title, Priority: 'high', Tags: 'warning' }, body: msg }); } catch { /* best effort */ }
}
function comment(body) {
  const r = spawnSync('gh', ['issue', 'comment', String(ISSUE), '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--body-file', '-'], { input: body, encoding: 'utf8' });
  log(r.status === 0 ? `commented on #${ISSUE}: ${r.stdout.trim()}` : `comment on #${ISSUE} FAILED: ${r.stderr?.slice(0, 200)}`);
}

// ── pools (live) ──

// The reader and the busy check live in scripts/lib/agy-pools.mjs (shared with cli-ocr-lane.mjs correct, #7263).
const readPool = (home) => readPoolBy(home, { model: MODEL, env: { SIKU_LANE_CHILD: '1' } });
export function readPools() {
  const pools = readPoolsBy({ model: MODEL, env: { SIKU_LANE_CHILD: '1' } });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  for (const p of pools) fs.appendFileSync(P.readings, JSON.stringify({ at: new Date().toISOString(), home: p.home ?? 'default', busy_pid: p.busy, ...p.reading }) + '\n');
  return pools;
}

// ── the plan (live) ──

async function exclusions(db) {
  const ex = new Set(ISSUE_7090_BOOKS);
  const classes = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/zh-residue-refs-6871/classes.json'), 'utf8'));
  for (const k of ['table', 'mixed', 'seal']) for (const id of classes[k]?.bids || []) ex.add(id);
  const sealRe = classes.seal?.pattern ? new RegExp(classes.seal.pattern) : null;
  const since = new Date(Date.now() - 3 * 86400e3);
  for (const j of await db.collection('lane_job_books').find({ $or: [{ lands: { $in: [6871, 7090] } }, { last_at: { $gte: since } }] }, { projection: { job: 1, lands: 1, book_ids: 1 } }).toArray()) {
    if (j.job === JOB || String(j.job).startsWith(`${JOB}`)) continue;
    for (const id of j.book_ids || []) ex.add(id);
  }
  return { exclude: ex, sealRe };
}

const BOOK_PROJ = { id: 1, title: 1, language: 1, visible: 1, pages_count: 1, work_id: 1, translation_state: 1, pipeline_auto: 1 };
async function candidates(db) {
  const rows = await db.collection('books').find(
    { 'pipeline_auto.status': 'held', 'pipeline_auto.hold.reason': { $in: [...HOLD_REASONS] }, 'translation_state.rung': { $in: [...RUNGS] }, pages_count: { $gt: 0 } },
    { projection: BOOK_PROJ },
  ).toArray();
  return rankBooks(rows, await exclusions(db));
}

async function hasDupe(db, book) {
  if (!book.work_id) return false;
  const sibs = await db.collection('books').find({ work_id: book.work_id, id: { $ne: book.id } }, { projection: { id: 1, title: 1, language: 1, pages_translated: 1, translation_state: 1, 'pipeline_auto.hold.reason': 1 } }).toArray();
  return sibs.some((s) => isDupeSibling(book, s));
}

/** The pages to read for one book, after ledgering any whose OCR is a chat reply. */
async function bookPages(db, book, done) {
  const pages = await db.collection('pages').find({ book_id: book.id, ...UNTRANSLATED }, { projection: { id: 1, page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  const out = [];
  for (const p of pages) {
    if (done.has(p.id)) continue;
    if (CHAT_REPLY_RE.test(p.ocr?.data || '')) { ledger({ page_id: p.id, book_id: book.id, page_number: p.page_number, error_class: 'ocr-chat-reply' }); done.add(p.id); continue; }
    out.push({ id: p.id, page_number: p.page_number });
  }
  return out;
}

const stillHeld = async (db, id) => {
  const b = await db.collection('books').findOne({ id }, { projection: { 'pipeline_auto.status': 1, 'pipeline_auto.hold.reason': 1 } });
  return b?.pipeline_auto?.status === 'held' && HOLD_REASONS.includes(b.pipeline_auto?.hold?.reason);
};

function runNode(args, env, logFile) {
  return new Promise((resolve) => {
    const fd = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, ['--no-warnings', ...args], { stdio: ['ignore', fd, fd], env, cwd: ROOT });
    child.on('close', (code) => { fs.closeSync(fd); resolve(code); });
  });
}

// ── run ──

async function runWave(db) {
  const APPLY = process.argv.includes('--apply');
  const MAX = Number(arg('max-pages', 1500));
  const PAR = Math.max(1, Number(arg('parallel', 3)));
  const PER_CALL = Number(arg('per-call', 1));
  const MAX_MIN = Number(arg('max-minutes', 0));
  const T0 = Date.now();
  if (fs.existsSync(P.stop)) { log(`paused: ${P.stop} exists (${fs.readFileSync(P.stop, 'utf8').trim().slice(0, 200)}); rm it to resume`); return; }
  const pools = readPools();
  for (const p of pools) log(`pool ${poolName(p)}: ${p.reading ? `weekly ${p.reading.weekly.toFixed(3)} (reset ${p.reading.weeklyReset}), 5h ${p.reading.fiveHour?.toFixed(3) ?? '-'}` : 'NO READING'}${p.busy ? `, busy (pid ${p.busy})` : ''}${p.reading ? `; ${poolGate(p.reading).why}` : ''}`);
  const st = readState();
  if (pools.every((p) => !p.reading)) {
    st.failed_readings = (st.failed_readings || 0) + 1; saveState(st);
    log(`no pool could be read (${st.failed_readings} run(s) in a row)`);
    if (st.failed_readings === 2) await ntfy('Siku lane: agy quota unreadable', `siku-translate-lane: agy -p /quota failed on every pool, ${st.failed_readings} runs in a row (#5600)`);
    return;
  }
  st.failed_readings = 0; saveState(st);
  const pool = choosePool(pools);
  if (!pool) { log('idle: no pool above its floor'); return; }
  log(`using pool ${poolName(pool)} (${pool.gate.why})`);

  const done = readLedger();
  const skipped = readSkips();
  const books = (await candidates(db)).filter((b) => !skipped.has(b.id));
  log(`cohort: ${books.length} books eligible before the per-book checks (${skipped.size} refused by the reader earlier, left out)`);
  const env = { ...process.env, CLI_JOB_NAME: JOB, JOB_NAME: process.env.JOB_NAME || JOB, JOB_LANDS: `#${ISSUE}`, SIKU_LANE_CHILD: '1' };
  if (pool.home) env.AGY_HOME = pool.home; else delete env.AGY_HOME;
  const day = new Date().toISOString().slice(0, 10);
  const waveId = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
  const OUT = path.join(STATE_DIR, 'waves', day, waveId);
  fs.mkdirSync(OUT, { recursive: true });
  const wave = { id: waveId, pool: poolName(pool), start: pool.reading, books: 0, read: 0, written: 0, ledgered: 0, stopped: null, book_ids: [] };
  let budget = MAX, cursor = 0, stop = null, lastCheck = 0;

  const gateOk = async () => {
    if (stop) return false;
    if (fs.existsSync(P.stop)) { stop = 'stop file'; return false; }
    if (Date.now() - lastCheck < 60e3) return true;
    lastCheck = Date.now();
    let r = readPool(pool.home);
    if (!r) r = readPool(pool.home);
    if (!r) { stop = 'quota reading failed twice'; await ntfy('Siku lane stopped', `siku-translate-lane wave ${waveId}: agy /quota on pool ${poolName(pool)} failed twice (#5600)`); return false; }
    wave.end = r;
    const g = poolGate(r);
    if (!g.open) { stop = `pool below floor: ${g.why}`; return false; }
    return true;
  };

  const next = async () => {
    if (MAX_MIN > 0 && Date.now() - T0 > MAX_MIN * 60e3) { stop = stop || `time: ${MAX_MIN} min`; return null; }
    while (cursor < books.length && budget > 0) {
      const b = books[cursor++];
      if (await hasDupe(db, b)) { log(`  ${b.id} skipped: a work_id sibling is another edition with English`); continue; }
      const pages = await bookPages(db, b, done);
      if (!pages.length) continue;
      budget -= pages.length;
      return { book: b, pages };
    }
    return null;
  };

  const worker = async () => {
    for (;;) {
      if (!(await gateOk())) return;
      const job = await next();
      if (!job) return;
      const { book, pages } = job;
      const label = `${book.id} ${String(book.title || '').slice(0, 30)}`;
      if (!(await stillHeld(db, book.id))) { log(`  ${label}: hold moved; skipped`); continue; }
      const dir = path.join(OUT, book.id);
      fs.mkdirSync(dir, { recursive: true });
      const ids = path.join(dir, 'page-ids.json');
      fs.writeFileSync(ids, JSON.stringify(pages.map((p) => p.id)));
      log(`  ${label}: reading ${pages.length} pages (${PER_CALL > 1 ? `${PER_CALL}/call, claude-translate --cli=agy` : '1/call'})`);
      // #7503: the 4/call reader stays OFF until block-drift covers caseless scripts in production.
      // #5600: the two leaf lines go to the 1/call reader only (tested there); the block reader was not tested with them.
      const instr = path.join(dir, 'instructions.json');
      if (!(PER_CALL > 1)) fs.writeFileSync(instr, JSON.stringify(leafInstructions(pages.map((p) => p.id))));
      const readArgs = PER_CALL > 1
        ? [path.join(HERE, 'claude-translate.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${dir}`, '--cli=agy', `--model=${MODEL}`, `--per-call=${PER_CALL}`, `--job=${JOB}`]
        : [path.join(HERE, 'cli-translate.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${MODEL}`, `--instructions-file=${instr}`];
      const t0 = Date.now();
      const rc = await runNode(readArgs, env, path.join(dir, 'read.log'));
      const metas = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')).length;
      wave.read += metas;
      log(`  ${label}: read exit ${rc}, ${metas} reads in ${Math.round((Date.now() - t0) / 60e3)} min`);
      if (rc === 3) stop = stop || `quota reply from agy (pool ${poolName(pool)})`;
      else if (rc === 2) {
        // The reader's own refusal (not a crash): record why and do not offer the book again.
        const rl = fs.readFileSync(path.join(dir, 'read.log'), 'utf8').trim().split('\n');
        const why = (rl.find((l) => /translat|re-OCR|refus/i.test(l) && !/page ids found/.test(l)) || rl.at(-1) || '').slice(0, 300);
        fs.appendFileSync(P.skips, JSON.stringify({ book_id: book.id, title: book.title, wave: waveId, rc, why, at: new Date().toISOString() }) + '\n');
        log(`  ${label}: reader refused (exit 2); recorded in book-skips.jsonl, not offered again: ${why.slice(0, 120)}`);
        continue;
      }
      else if (rc !== 0) { log(`  ${label}: reader failed (exit ${rc}); book left for the next wave`); continue; }
      if (!metas) continue;
      if (!(await stillHeld(db, book.id))) { log(`  ${label}: hold moved during the read; not applied`); continue; }
      const arc = await runNode([path.join(HERE, 'cli-translate.mjs'), 'apply', `--out=${dir}`, `--reason=${REASON}`, ...(APPLY ? ['--apply'] : [])], env, path.join(dir, 'apply.log'));
      if (!APPLY) { log(`  ${label}: dry-run apply exit ${arc}`); continue; }
      if (arc !== 0) { log(`  ${label}: apply exit ${arc}; nothing ledgered`); continue; }
      const left = new Set((await db.collection('pages').find({ id: { $in: pages.map((p) => p.id) }, ...UNTRANSLATED }, { projection: { id: 1 } }).toArray()).map((p) => p.id));
      const readIds = new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')).map((f) => f.replace('.meta.json', '')));
      // The writer's own reason per refused page (`skip p.N: why` in its log), so the ledger says why, not just "not written".
      const why = new Map([...fs.readFileSync(path.join(dir, 'apply.log'), 'utf8').matchAll(/^\s*skip p\.(\d+): (.+)$/gm)].map((m) => [Number(m[1]), m[2].trim()]));
      let led = 0;
      for (const p of pages) {
        if (!left.has(p.id) || !readIds.has(p.id)) continue;   // written, or not reached (a stopped read): not ledgered
        let meta = null;
        try { meta = JSON.parse(fs.readFileSync(path.join(dir, `${p.id}.meta.json`), 'utf8')); } catch { /* none */ }
        ledger({ page_id: p.id, book_id: book.id, page_number: p.page_number, exit: meta?.exit ?? null, error_class: meta?.error_class ?? meta?.wrapper ?? why.get(p.page_number) ?? 'not_written', wave: waveId });
        done.add(p.id); led++;
      }
      const written = pages.filter((p) => !left.has(p.id)).length;
      wave.written += written; wave.ledgered += led; wave.books++; wave.book_ids.push(book.id);
      fs.appendFileSync(P.written, JSON.stringify({ wave: waveId, book_id: book.id, page_ids: pages.filter((p) => !left.has(p.id)).map((p) => p.id), at: new Date().toISOString() }) + '\n');
      const b2 = await db.collection('books').findOne({ id: book.id }, { projection: { 'translation_state.rung': 1, 'pipeline_auto.hold.reason': 1 } });
      log(`  ${label}: ${written} written, ${led} ledgered; rung now ${b2?.translation_state?.rung}, hold ${b2?.pipeline_auto?.hold?.reason}`);
    }
  };
  await Promise.all(Array.from({ length: PAR }, worker));
  wave.stopped = stop;
  wave.finished_at = new Date().toISOString();
  const s = readState();
  if (APPLY) { s.written_total = (s.written_total || 0) + wave.written; s.waves = [...(s.waves || []).slice(-50), { ...wave, book_ids: undefined }]; saveState(s); }
  fs.writeFileSync(path.join(OUT, 'wave.json'), JSON.stringify(wave, null, 1));
  const used = wave.start && wave.end ? (wave.start.weekly - wave.end.weekly).toFixed(3) : '?';
  log(`wave ${waveId}: ${wave.books} books, ${wave.read} reads, ${wave.written} written, ${wave.ledgered} ledgered; pool ${wave.pool} weekly ${wave.start?.weekly?.toFixed(3)} → ${wave.end?.weekly?.toFixed(3) ?? '?'} (${used} used, all traffic on the pool)${stop ? `; stopped: ${stop}` : ''}`);
  if (APPLY && s.written_total - (s.spot_at || 0) >= SPOT_EVERY) await spotCheck(db, {});
  if (APPLY) dailyReport();
}

function dailyReport() {
  const s = readState();
  const today = new Date().toISOString().slice(0, 10);
  if (s.last_comment_day === today) return;
  const waves = (s.waves || []).filter((w) => w.finished_at && Date.now() - Date.parse(w.finished_at) < 86400e3);
  if (!waves.some((w) => w.written > 0)) return;
  const sum = (k) => waves.reduce((a, w) => a + (w[k] || 0), 0);
  const lines = waves.map((w) => `| ${w.id} | ${w.pool} | ${w.books} | ${w.written} | ${w.ledgered} | ${w.start?.weekly?.toFixed(3) ?? '?'} → ${w.end?.weekly?.toFixed(3) ?? '?'} | ${w.stopped ?? 'cap / cohort'} |`);
  comment([`**Siku lane daily (siku-translate-lane, last 24 h):** ${sum('books')} books, ${sum('written')} pages written, ${sum('ledgered')} ledgered. Lane total ${s.written_total} pages; next spot check at ${(s.spot_at || 0) + SPOT_EVERY}.`, '',
    '| wave | pool | books | written | ledgered | weekly remaining | stopped by |', '|---|---|---|---|---|---|---|', ...lines, '',
    `Pause: \`touch ${P.stop}\`. Log: /var/log/sourcelibrary/siku-lane.log.`].join('\n'));
  s.last_comment_day = today; saveState(s);
}

// ── spot check ──

const JUDGE = `# Spot check: a machine draft of a classical Chinese page, against the page image

You are checking English machine drafts of Siku Quanshu manuscript pages. Each item in ITEMS_FILE has an image file
(the page), the stored OCR transcription, and the English. Open EVERY image with the Read tool before you judge it;
read the leaf column by column (right to left) against the OCR and the English.

For each item decide:
- wrong_leaf: true if the OCR/English is the text of a different page than the image (not merely misread characters).
- invented: true if the English contains a passage (a sentence or more) that is not on this leaf at all and is not
  marked as a note or editorial gloss. Quote it in invented_quote.
- sense_errors: the number of clauses whose meaning changes (who did what, what a term or dose is). Nuance, a clumsy
  phrase or a romanisation slip is "minor", not a sense error. Say if a sense error comes from the OCR.
- verdict: one of fine | minor | sense-error | omission | invented | wrong-leaf.
- note: one line of evidence.

Write OUTPUT_FILE as a JSON array, one object per item: {"page_id", "wrong_leaf", "invented", "invented_quote",
"sense_errors", "from_ocr", "verdict", "note"}. No prose outside the file.`;

function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
/** The judge's claude binary: /usr/bin/claude first (an older ~/.local/bin/claude lacks --restricted), else the first
 *  one on this box that has it. l7a has no /usr/bin/claude (2026-10-29: the spot check died with ENOENT there). */
function claudeBin() {
  for (const c of ['/usr/bin/claude', path.join(process.env.HOME || '/root', '.local/bin/claude')]) {
    if (!fs.existsSync(c)) continue;
    const h = spawnSync(c, ['--help'], { encoding: 'utf8', timeout: 30e3 });
    if (/--restricted/.test(h.stdout || '')) return c;
  }
  return '/usr/bin/claude';
}
function judgeSealed(dir, items) {
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'JUDGE.md'), JUDGE);
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify(items.map(({ image_buf, ...i }) => i), null, 1));
  for (const it of items) fs.writeFileSync(path.join(dir, it.image_file), it.image_buf);
  const prompt = 'Your instructions are the full text of `JUDGE.md` in this folder; follow them exactly. Work only inside this folder.\nITEMS_FILE: `items.json`\nOUTPUT_FILE: `review.json`';
  return new Promise((resolve) => {
    const out = fs.openSync(path.join(dir, 'transcript.jsonl'), 'w');
    const child = spawn(claudeBin(), ['-p', prompt, '--model', 'opus', '--restricted', '--tools', 'Read', 'Write', '--allowedTools', 'Read', 'Write', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json', '--verbose'], { cwd: dir, stdio: ['ignore', out, out], env: claudeEnv() });
    const timer = setTimeout(() => child.kill('SIGKILL'), 45 * 60e3);
    child.on('close', () => {
      clearTimeout(timer); fs.closeSync(out);
      let v = null;
      try { v = JSON.parse(fs.readFileSync(path.join(dir, 'review.json'), 'utf8')); } catch { /* missing */ }
      const tr = fs.readFileSync(path.join(dir, 'transcript.jsonl'), 'utf8');
      // A verdict counts only if the transcript shows its image was opened.
      resolve(Array.isArray(v) ? v.filter((x) => new RegExp(`"name":"Read","input":\\{"file_path":"[^"]*images/${x.page_id}\\.jpg`).test(tr)) : null);
    });
  });
}

/** Tally against the draft bar. verdicts: [{ wrong_leaf, invented, sense_errors }]. */
export function tallyBar(verdicts) {
  const n = verdicts.length;
  const wrongLeaf = verdicts.filter((v) => v.wrong_leaf).length;
  const invented = verdicts.filter((v) => v.invented).length;
  const sense = verdicts.filter((v) => (v.sense_errors || 0) > 0).length;
  return { n, wrongLeaf, invented, sense, pass: n > 0 && wrongLeaf === 0 && invented === 0 && sense * 3 <= n };
}

async function spotCheck(db, { force = false, n = SPOT_N } = {}) {
  const s = readState();
  const u = claudeUsage();
  if (u?.weekly != null && u.weekly >= 90 && !force) {
    log(`spot check deferred: this box's Claude account is at ${u.weekly}% weekly`);
    s.spot_deferred_since = s.spot_deferred_since || new Date().toISOString();
    if (!s.spot_deferred_paged && Date.now() - Date.parse(s.spot_deferred_since) > 6 * 3600e3) {
      await ntfy('Siku lane: spot check deferred 6 h', `siku-translate-lane: the Opus spot check has been deferred since ${s.spot_deferred_since} (this box's Claude account at ${u.weekly}% weekly); ${s.written_total - (s.spot_at || 0)} pages written unchecked. Run spot-check --force on a box with room (#${ISSUE})`);
      s.spot_deferred_paged = true;
    }
    saveState(s); return;
  }
  const rows = fs.existsSync(P.written) ? fs.readFileSync(P.written, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const since = s.spot_written_rows || 0;
  const pool = rows.slice(since).flatMap((r) => r.page_ids.map((id) => ({ id, book_id: r.book_id })));
  if (!pool.length) { log('spot check: nothing written since the last one'); return; }
  // Random across books: shuffle the books, then take one random page each, round-robin.
  const byBook = new Map();
  for (const p of pool) (byBook.get(p.book_id) ?? byBook.set(p.book_id, []).get(p.book_id)).push(p.id);
  const bookIds = [...byBook.keys()].sort(() => Math.random() - 0.5);
  const pick = [];
  for (let round = 0; pick.length < n && round < 50; round++) for (const b of bookIds) { const l = byBook.get(b); if (l.length && pick.length < n) pick.push(l.splice(Math.floor(Math.random() * l.length), 1)[0]); }
  const pages = await db.collection('pages').find({ id: { $in: pick } }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 } }).toArray();
  const items = [];
  for (const p of pages) {
    const src = getPageSource(p);
    if (!src) continue;
    const r = await fetch(src).catch(() => null);
    if (!r?.ok) continue;
    items.push({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, image_file: `images/${p.id}.jpg`, ocr: p.ocr?.data ?? '', english: p.translation?.data ?? '', image_buf: Buffer.from(await r.arrayBuffer()) });
  }
  const dir = path.join(STATE_DIR, 'spot', new Date().toISOString().replace(/[-:]/g, '').slice(0, 13));
  const verdicts = [];
  for (let i = 0; i < items.length; i += 5) {
    const v = await judgeSealed(path.join(dir, `c${i / 5}`), items.slice(i, i + 5));
    if (v) verdicts.push(...v.filter((x) => items.some((i) => i.page_id === x.page_id)));
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'verdicts.json'), JSON.stringify(verdicts, null, 1));
  if (!verdicts.length) { log(`spot check: no usable verdicts (${dir}); the next run tries again`); return; }
  const t = tallyBar(verdicts);
  const books = new Map((await db.collection('books').find({ id: { $in: items.map((i) => i.book_id) } }, { projection: { id: 1, title: 1 } }).toArray()).map((b) => [b.id, b.title]));
  const table = verdicts.map((v) => { const it = items.find((i) => i.page_id === v.page_id); return `| [${books.get(it?.book_id) ?? it?.book_id} p.${it?.page_number}](https://sourcelibrary.org/book/${it?.book_id}?page=${it?.page_number}) | ${v.verdict} | ${String(v.note || '').replace(/\|/g, '/').slice(0, 160)} |`; });
  const bad = verdicts.filter((v) => v.invented || v.wrong_leaf);
  let contained = '';
  if (bad.length) {
    fs.writeFileSync(P.stop, `paused by spot check ${path.basename(dir)}: ${bad.length} invented/wrong-leaf page(s); see #${ISSUE}\n`);
    const byB = new Map();
    for (const v of bad) { const it = items.find((i) => i.page_id === v.page_id); (byB.get(it.book_id) ?? byB.set(it.book_id, []).get(it.book_id)).push(it.page_number); }
    for (const [bid, nums] of byB) {
      const ev = bad.filter((v) => items.find((i) => i.page_id === v.page_id)?.book_id === bid).map((v) => `p.${items.find((i) => i.page_id === v.page_id).page_number}: ${v.verdict}: ${v.invented_quote || v.note}`).join('; ').slice(0, 900);
      const r = spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'scripts/maintenance/withhold-stale-translations.mjs'), `--book=${bid}`, `--by-eye-pages=${nums.join(',')}`, `--evidence=Siku lane spot check (Opus against the image): ${ev}`, `--issue=${ISSUE}`, '--apply'], { encoding: 'utf8', env: process.env, cwd: ROOT });
      contained += `\n- ${bid} pages ${nums.join(', ')}: withhold exit ${r.status}`;
    }
    await ntfy('Siku lane PAUSED: invented/wrong-leaf page', `siku-translate-lane spot check found ${bad.length} invented or wrong-leaf page(s); pages withheld, lane paused (${P.stop}). #${ISSUE}`);
  }
  comment([`**Siku lane spot check** (${t.n} pages judged by Opus against the page image, drawn at random from ${byBook.size} books written since the last check; lane total ${s.written_total} pages).`, '',
    `Bar (draft, Derek 2026-10-27): 0 wrong-leaf, 0 invented, sense errors on <= 1 page in 3. **Result: ${t.wrongLeaf} wrong-leaf, ${t.invented} invented, sense errors on ${t.sense}/${t.n} → ${t.pass ? 'PASS' : 'FAIL'}.**`, '',
    '| page | verdict | note |', '|---|---|---|', ...table,
    ...(bad.length ? ['', `**Contained** (containment-on-finding.md; the books are held): ${contained}`, `The lane is paused: \`${P.stop}\` exists. Resume with \`rm ${P.stop}\` after a look.`] : []),
    ...(!t.pass && !bad.length ? ['', 'The sense-error rate is over the bar; the lane keeps running (the bar\'s stop is invented or wrong-leaf text). Raising it here for a look.'] : []),
  ].join('\n'));
  delete s.spot_deferred_since; delete s.spot_deferred_paged;
  s.spot_at = s.written_total; s.spot_written_rows = rows.length; s.spots = [...(s.spots || []), { at: new Date().toISOString(), dir, ...t }]; saveState(s);
}

// ── count ──

async function count(db) {
  const books = await candidates(db);
  const done = readLedger();
  let pages = 0, dupes = 0;
  for (const b of books) { if (await hasDupe(db, b)) { dupes++; continue; } pages += (b.translation_state?.translatable ?? b.pages_count) - (b.translation_state?.translated ?? 0); }
  log(`eligible books ${books.length - dupes} (${dupes} with a dupe sibling left out), ~${pages} untranslated pages; ledger ${done.size} pages; state ${JSON.stringify(readState()).slice(0, 300)}`);
}

async function main() {
  const mode = process.argv[2];
  if (!['pools', 'count', 'run', 'spot-check'].includes(mode)) { console.error('usage: siku-translate-lane.mjs pools | count | run [--apply] [--max-pages=1500] [--parallel=3] [--per-call=1] | spot-check [--force]'); process.exit(2); }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (mode === 'pools') { for (const p of readPools()) console.log(JSON.stringify({ pool: poolName(p), busy: p.busy, ...p.reading, gate: p.reading ? poolGate(p.reading) : null })); return; }
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  try {
    if (mode === 'count') await count(db);
    else if (mode === 'run') await runWave(db);
    else await spotCheck(db, { force: process.argv.includes('--force'), n: Number(arg('n', SPOT_N)) });
  } finally { await client.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
