#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate-lane.mjs — the translation twin of this runner (#7442): same shape (count/run,
// per-day output folder, a ledger of pages not to retry, release when nothing is left), for CLI_TRANSLATE_HOLD.
// scripts/batch/cli-ocr.mjs (read + apply) — the reader and writer this drives, unchanged but for --stop-on-quota.
// Nothing drained CLI_FLASH_OCR_HOLD (ocr-flash-cli-7075) before this: the orchestrator has held books there since
// #7087 (2026-10-21) and only hand-run jobs read them (#7089).
/**
 * cli-ocr-lane — OCR the books the pipeline held for the agy CLI Flash lane (#7075, #7089).
 *
 * WHO RUNS IT: cron on a Hetzner box whose `agy` is signed in, or a session by hand. No paid API: every read goes
 * through `agy -p` on the subscription (cli-ocr.mjs read --stop-on-quota), and cli-ocr.mjs apply writes it with its
 * usual guards and provenance. It never falls back to the API (2026-10-08 rule): out of quota, the book waits.
 *
 *   node --env-file=.env.production.local scripts/batch/cli-ocr-lane.mjs count
 *   node --env-file=.env.production.local scripts/batch/cli-ocr-lane.mjs run --out=DIR [--max-pages=120] [--book=ID] [--apply]
 *        [--per-call=N] [--per-call-arabic=N] [--prompt-variant=V] [--concurrency=N] [--deadline-min=M]
 *
 * PACE (#7558). `--per-call=N` (1-4, default 1) reads N consecutive pages a call (cli-ocr.mjs --per-call, #7522:
 * 4/call held quality on German and Latin print); an Arabic-script book uses `--per-call-arabic` (default 1: not in
 * the #7522 test), and a book in any other script reads 1 a call. `--prompt-variant` is passed to the reader.
 * `--concurrency=N` (1-4, default 1) reads N BOOKS at once, each its own reader, sharing the page budget (a held book averages ~5 unread pages, so parallel calls inside
 * one book do little at 4 a call). `--deadline-min=M` starts no new book after M minutes, so a cron run inside
 * `timeout 110m` finishes the books it started instead of being killed mid-apply.
 *
 * WHICH BOOKS. Those held with reason CLI_FLASH_OCR_HOLD.reason, highest processing_priority first, then visible
 * books, then the oldest hold. The lane is recomputed from ocrLaneForBook: a book now routed to the API channel
 * (flash-lite) is released at once, back to the Batch lanes.
 *
 * WHICH MODEL. The router names `gemini-3-flash-preview`, which agy does not offer (its Gemini models are 3.8 Flash
 * and 4 Argon, checked 2026-10-26 on the laptop and on hetzner). CLI_MODEL_FOR maps the routed model to the CLI model
 * that reads in its place; a book routed to a model with no entry stays held and `count` names it. The mapping is a
 * routing choice, recorded in every write's --reason: on Arabic print, 3.8 Flash low read 23/25 Kraus pages usable
 * against Flash-Lite's 20/25 and does not clear the router's CER bar, where only Opus does
 * (scripts/eval/experiments/2026-10-26-kraus-print-route-7341.md).
 *
 * WHICH PAGES. The orchestrator's Phase 2 selection: page_number > 0, no OCR text, not recitation-blocked, with an
 * image. Re-reading a page that has text is not this lane's work.
 *
 * SPREADS. cli-ocr.mjs sends the plain page prompt, so a book whose frames are two-leaf spreads is not read here: a book
 * with `needs_splitting` (Phase 2 reads those with its spread prompt and its post-OCR split) and, as Phase 2 does
 * (#523), a book whose unread pages all lack crop data and that Phase 1.25 has not split_checked. Both stay held and
 * `count` names them. On 2026-10-26 a first run wrote plain reads to a needs_splitting book; they were reverted.
 *
 * RELEASE. When a book has no unread page left it is released to the status it was held at; Phase 2 then finds
 * nothing to read and advances it to ocr_complete. A page the reader failed or the writer refused is written to the
 * ledger (DIR/../cli-ocr-ledger.jsonl) and not tried again; a book with ledgered pages stays held and `count` names it.
 *
 * HOW IT FAILS. A quota reply or a locked model makes the reader exit 3; the run stops and the next resumes from the
 * reads already on disk. Without --apply it reads and dry-runs the writer, and releases and ledgers nothing.
 *
 * CORRECT (#7558): the route that passed #7520's router test, lite>agy-flash-low (German 28/30, French 27/29 accepted,
 * against the Flash-Lite draft's 21/30 and 22/30). It spends the main pool's spare quota; it is not the held-book lane.
 *
 *   ... cli-ocr-lane.mjs correct-count
 *   ... cli-ocr-lane.mjs correct --out=DIR [--max-pages=N] [--concurrency=N] [--book-chunk=40] [--deadline-min=M]
 *        [--floor-5h=0.25] [--agy-home=default|auto|DIR] [--weekly-end=0] [--shard=K/N] [--apply]
 *
 * Pages: the router test's frame (scripts/eval/route-judge-6740/judge.mjs, de-lite / fr-lite): a visible German or
 * French book, idle in the pipeline and not held; a page whose stored OCR is a Flash-Lite draft of 300+ characters,
 * not handwritten, not human-edited, not withheld, not a skipped page type, inside the book (15%-95% of its pages,
 * where the test drew). Each is read once by `cli-ocr.mjs read --correct-prompt` (the #5924 one-page template,
 * fc-prompt.mjs, exactly as judged) and written by `cli-ocr.mjs apply` with every guard, stamped `ocr.pipeline =
 * agy-correct-lite-7558`, and `--mark-stale` flags its English (a flag only: no cron re-translates on it). An UNCHANGED
 * answer leaves the page; a CONTAIN answer leaves it and goes to DIR/../correct-contain-claims.jsonl for a by-eye check.
 * Every page tried goes to DIR/../correct-ledger.jsonl with its outcome and is not tried again; once a chunk is
 * ledgered its page images are deleted (only an applied run deletes them).
 *
 * QUOTA FLOOR. Before each book chunk the lane reads `agy -p /quota` and stops when the Gemini weekly remaining
 * fraction is below the straight line to its reset (remaining time / 7 days), or the 5-hour bucket is below
 * --floor-5h (default 0.25, so the other lanes on the pool keep their window). An unreadable /quota stops it too.
 * `--weekly-end=F` bends the line to end at F instead of 0 (line = F + (1 - F) × remaining time / 7 days), so a pool
 * the lane has to itself can be spent down to F by its reset and no further (#7263: the second pool, F = 0.10).
 *
 * POOL (#7263). `--agy-home` picks the agy login every call of the run uses, its reads and its /quota floor alike:
 * `default` (the box's own login; also what no flag means, as before), a DIR (a second login, scripts/workers/
 * agy-guard.sh AGY_HOME, e.g. /root/.agy-james), or `auto`: the pool with the most Gemini weekly left whose floor is
 * open, chosen once at the start by the Siku lane's picker (scripts/lib/agy-pools.mjs). The lane's processes are
 * marked AGY_POOL_SHARED=1, so the Siku lane does not count a pool this lane shares as busy.
 *
 * TWO RUNS AT ONCE (#7263). One run a pool, each from its own cron line and flock, sharing one --out folder (so one
 * ledger). Before a book chunk the run CLAIMS the book: an exclusive-create file <ledger dir>/claims/<book>.json,
 * removed when the chunk is ledgered. A run skips a book another live run has claimed (a claim whose pid is gone, or
 * older than 3 h, is stale and taken over), and after claiming re-reads the ledger lines other runs appended, so it
 * never takes a page another run has tried. A book a correction reader is reading right now (/proc) is skipped too.
 * Claims, the ledger and /proc are one box's. Runs on DIFFERENT boxes split the books with `--shard=K/N` instead: a run
 * takes only the books whose id hashes to K mod N (bookShard), so no book is in two boxes' queues (#7263: main's
 * main-pool line 0/2, gex45's second-pool line 1/2).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { ocrLaneForBook, CLI_FLASH_OCR_HOLD } from '../lib/ocr-routing.mjs';
import { releaseBook, HOLD_STATUS } from '../lib/pipeline-hold.mjs';
import { scriptFamily } from '../lib/quality-gate-screens.mjs';
import { agyEnv, quotaBuckets, readQuotaStdout, readPools, choosePool, poolName } from '../lib/agy-pools.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Why this lane must not read the book with the plain page prompt (see SPREADS above), or null. */
export function spreadReason(book, pages) {
  if (book.needs_splitting) return 'needs_splitting: wants the spread prompt and post-OCR split';
  if (pages.length && !book.pipeline_auto?.split_checked && pages.every((p) => !p.crop && !p.cropped_photo)) return 'no page has crop data and the book is not split_checked: possible unsplit spreads (#523)';
  return null;
}

/** The CLI model that reads in place of each routed model agy does not offer (see WHICH MODEL above). */
export const CLI_MODEL_FOR = Object.freeze({ 'gemini-3-flash-preview': 'gemini-3.8-flash-low' });

/** The pages this lane reads: the orchestrator's Phase 2 filter (submitOcrForBook), without the per-model block. */
export const UNREAD = Object.freeze({
  page_number: { $gt: 0 },
  'ocr.recitation_blocked': { $ne: true },
  $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }],
  $and: [{
    $or: [
      { archived_photo: { $exists: true, $regex: /^https?:\/\// } },
      { cropped_photo: { $exists: true, $nin: [null, ''] } },
      { photo: { $exists: true, $ne: null } },
      { photo_original: { $exists: true, $ne: null } },
    ],
  }],
});

/** Highest processing_priority first, then visible, then the oldest hold. */
export const byQueueOrder = (a, b) => (b.processing_priority ?? 0) - (a.processing_priority ?? 0)
  || (b.visible ? 1 : 0) - (a.visible ? 1 : 0)
  || String(a.pipeline_auto?.hold?.held_at ?? '').localeCompare(String(b.pipeline_auto?.hold?.held_at ?? ''));

function run(args, tag = '', env = process.env) {
  console.log(`${tag}$ node ${args.map((a) => path.relative(process.cwd(), a) || a).join(' ')}`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, AGY_JOB: env.AGY_JOB || 'cli-ocr-lane-7089' } });
    // Books read in parallel (--concurrency): each line carries its book's tag so the log stays readable.
    const pipe = (src, dst) => { let buf = ''; src.on('data', (d) => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) dst.write(`${tag}${l}\n`); }); src.on('end', () => { if (buf) dst.write(`${tag}${buf}\n`); }); };
    pipe(child.stdout, process.stdout); pipe(child.stderr, process.stderr);
    child.on('close', (code) => resolve(code));
  });
}

/**
 * Pages a call for a book (#7558): `perCall` for Latin-script books (the #7522 cell), `perCallArabic` for Arabic
 * script (its own 20-page check), and 1 for every other script, which no block test has covered.
 */
export function perCallFor(book, { perCall = 1, perCallArabic = 1 } = {}) {
  const family = scriptFamily(book.language);
  return family === 'latin' ? perCall : family === 'arabic' ? perCallArabic : 1;
}

const readLedger = (f) => new Set(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id) : []);

async function heldBooks(db) {
  const books = await db.collection('books').find(
    // The status first: it is indexed, and a held book carries both (pipeline-hold.mjs).
    { 'pipeline_auto.status': HOLD_STATUS, 'pipeline_auto.hold.reason': CLI_FLASH_OCR_HOLD.reason },
    { projection: { id: 1, title: 1, language: 1, visible: 1, image_source: 1, processing_priority: 1, created_at: 1, needs_splitting: 1, 'pipeline_auto.hold': 1, 'pipeline_auto.split_checked': 1 } },
  ).toArray();
  return books.sort(byQueueOrder);
}

// ── correct (#7558) ──
export const CORRECT_LANE = 'agy-correct-lite-7558';
export const CORRECT_MODEL = 'gemini-3.8-flash-low';
/** The cells the route passed (#7520): German and French. Latin was not measured. */
export const CORRECT_LANGUAGES = /^(German|French)/;
export const LITE_MODELS = Object.freeze(['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview']);
export const IDLE_STATUSES = Object.freeze(['complete', 'archive_complete', 'failed', 'parked', 'ocr_complete']);
/** The router test drew interior pages only (scripts/eval/ground-truth-5935/lib.mjs isInterior). */
export const isInterior = (pn, pagesCount) => pn > Math.floor(pagesCount * 0.15) && pn <= Math.ceil(pagesCount * 0.95);
const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * The quota floor. `buckets`: agy /quota's Gemini buckets {id, remaining_fraction, reset_time}. Returns
 * { ok, why, weekly, line, five_h }: not ok when the weekly bucket is under the straight line to its reset, the 5-hour
 * bucket is under `floor5h`, or either bucket is missing.
 */
export function quotaFloor(buckets, { now = Date.now(), floor5h = 0.25, weeklyEnd = 0 } = {}) {
  const weekly = buckets?.find((b) => b.id === 'gemini-weekly'), five = buckets?.find((b) => b.id === 'gemini-5h');
  if (!weekly || typeof weekly.remaining_fraction !== 'number' || !weekly.reset_time) return { ok: false, why: 'no Gemini weekly bucket in /quota' };
  const line = weeklyEnd + (1 - weeklyEnd) * Math.min(1, Math.max(0, (Date.parse(weekly.reset_time) - now) / WEEK_MS));
  const r = { weekly: weekly.remaining_fraction, line, five_h: five?.remaining_fraction ?? null };
  if (weekly.remaining_fraction < line) return { ok: false, why: `weekly ${(100 * weekly.remaining_fraction).toFixed(1)}% is under the pace line ${(100 * line).toFixed(1)}%`, ...r };
  if (typeof five?.remaining_fraction !== 'number') return { ok: false, why: 'no Gemini 5-hour bucket in /quota', ...r };
  if (five.remaining_fraction < floor5h) return { ok: false, why: `5-hour bucket ${(100 * five.remaining_fraction).toFixed(1)}% is under ${100 * floor5h}%`, ...r };
  return { ok: true, why: null, ...r };
}
const readQuota = (home) => quotaBuckets(readQuotaStdout(home));

/** `--agy-home` value → { home } for a fixed pool (null = the default login), or { auto: true }. */
export function parseAgyHome(v, env = process.env) {
  if (v === 'auto') return { auto: true };
  if (v === 'default') return { home: null };
  if (v) return { home: path.resolve(v) };
  return { home: env.AGY_HOME || null };
}

const CLAIM_STALE_MS = 3 * 3600 * 1000;
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** Is this claim still held by a live run? claim = parsed claim file. */
export function claimLive(claim, { now = Date.now(), alive = pidAlive } = {}) {
  if (!claim || !Number.isInteger(claim.pid)) return false;
  if (!(now - Date.parse(claim.at) < CLAIM_STALE_MS)) return false;
  return alive(claim.pid);
}
/** Claim a book for this run (see TWO RUNS AT ONCE). Returns true when this run holds it. */
export function claimBook(dir, bookId, me) {
  const f = path.join(dir, `${bookId}.json`);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 3; i++) {
    try { fs.writeFileSync(f, JSON.stringify({ ...me, at: new Date().toISOString() }), { flag: 'wx' }); return true; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    let held = null;
    try { held = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* half-written or gone: treat as stale */ }
    if (claimLive(held)) return false;
    // Stale: move it aside, then try again. A rename succeeds for one run only, so two runs taking over the same stale
    // claim cannot both remove it and both write their own (the loser's rename fails, and its next write finds the winner's).
    try { fs.renameSync(f, `${f}.stale-${process.pid}-${i}`); fs.rmSync(`${f}.stale-${process.pid}-${i}`, { force: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return false;
}
/**
 * Books a correction reader is reading right now on this box, from /proc (cli-ocr.mjs read --lane=<CORRECT_LANE>; the
 * book is the folder of its --page-ids-file). Covers a run that does not claim (code from before the claims).
 */
export function liveReaderBooks(procDir = '/proc') {
  const out = new Set();
  for (const pid of fs.readdirSync(procDir).filter((d) => /^\d+$/.test(d))) {
    let argv;
    try { argv = fs.readFileSync(path.join(procDir, pid, 'cmdline'), 'utf8').split('\0'); } catch { continue; }
    if (!argv.some((a) => a.endsWith('cli-ocr.mjs')) || !argv.includes('read') || !argv.includes(`--lane=${CORRECT_LANE}`)) continue;
    const f = argv.find((a) => a.startsWith('--page-ids-file='));
    if (f) out.add(path.basename(path.dirname(f.slice('--page-ids-file='.length))));
  }
  return out;
}
/** The shard (0..n-1) a book belongs to: the first 8 hex digits of sha1(book id), mod n. Stable across boxes and runs. */
export const bookShard = (bookId, n) => parseInt(createHash('sha1').update(String(bookId)).digest('hex').slice(0, 8), 16) % n;
/** `--shard=K/N` → { k, n }, or null for no flag; throws on a malformed value. */
export function parseShard(v) {
  if (!v) return null;
  const m = /^(\d+)\/(\d+)$/.exec(v);
  if (!m || +m[2] < 1 || +m[1] >= +m[2]) throw new Error(`--shard must be K/N with 0 <= K < N, got ${v}`);
  return { k: +m[1], n: +m[2] };
}
export const releaseBookClaim = (dir, bookId) => fs.rmSync(path.join(dir, `${bookId}.json`), { force: true });
/** Ledger lines appended since the last call (other runs write the same file): adds their page ids to `set`. */
function ledgerTail(file, set, state) {
  if (!file || !fs.existsSync(file)) return;
  const size = fs.statSync(file).size;
  if (size <= state.offset) return;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(size - state.offset);
  fs.readSync(fd, buf, 0, buf.length, state.offset);
  fs.closeSync(fd);
  const text = buf.toString('utf8');
  const cut = text.lastIndexOf('\n') + 1;      // a line still being written waits for the next call
  state.offset += Buffer.byteLength(text.slice(0, cut));
  for (const l of text.slice(0, cut).split('\n').filter(Boolean)) { try { set.add(JSON.parse(l).page_id); } catch { /* skip */ } }
}

/** The correctable pages of one book (see CORRECT in the header), filtered in Mongo; ids and page numbers only. */
async function correctablePages(db, book, { SKIP_TRANSLATION_PAGE_TYPES }) {
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id: book.id, page_number: { $gt: 0 }, 'ocr.model': { $in: LITE_MODELS }, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' }, translation_withheld: { $ne: true }, page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'ocr.data': { $type: 'string' } } },
    { $project: { _id: 0, id: 1, page_number: 1, n: { $strLenCP: '$ocr.data' }, hw: { $regexMatch: { input: '$ocr.data', regex: '<script>\\s*handwritten', options: 'i' } } } },
    { $match: { n: { $gte: 300 }, hw: false } },
    { $sort: { page_number: 1 } },
  ]).toArray();
  return rows.filter((p) => isInterior(p.page_number, book.pages_count));
}

async function correctMain(mode, arg) {
  const APPLY = process.argv.includes('--apply');
  const OUT = arg('out') && path.resolve(arg('out'));
  if (mode === 'correct' && !OUT) { console.error('correct needs --out=DIR'); process.exit(2); }
  const LEDGER = arg('ledger') || (OUT ? path.join(path.dirname(OUT), 'correct-ledger.jsonl') : null);
  const CLAIMS = OUT ? path.join(path.dirname(OUT), 'correct-contain-claims.jsonl') : null;
  const { SKIP_TRANSLATION_PAGE_TYPES } = await import('../lib/translate-core.mjs');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const ledger = new Set(), tailState = { offset: 0 };
  ledgerTail(LEDGER, ledger, tailState);
  let SHARD;
  try { SHARD = parseShard(arg('shard')); } catch (e) { console.error(e.message); process.exit(2); }
  const books = (await db.collection('books').find(
    { visible: true, pages_count: { $gt: 0 }, language: { $regex: CORRECT_LANGUAGES }, 'pipeline_auto.status': { $in: IDLE_STATUSES }, 'pipeline_auto.hold': { $exists: false }, 'pipeline_auto.held': { $ne: true } },
    { projection: { id: 1, title: 1, language: 1, pages_count: 1, processing_priority: 1 } },
  ).toArray()).filter((b) => (!arg('book') || b.id === arg('book')) && (!SHARD || bookShard(b.id, SHARD.n) === SHARD.k))
    .sort((a, b) => (b.processing_priority ?? 0) - (a.processing_priority ?? 0) || a.id.localeCompare(b.id));
  if (mode === 'correct-count') {
    const t = {};
    for (const b of books) {
      const ps = (await correctablePages(db, b, { SKIP_TRANSLATION_PAGE_TYPES })).filter((p) => !ledger.has(p.id));
      const k = String(b.language).match(CORRECT_LANGUAGES)[1];
      t[k] ??= { books: 0, books_with_pages: 0, pages: 0 };
      t[k].books++; t[k].pages += ps.length; if (ps.length) t[k].books_with_pages++;
    }
    console.log(`correction queue (${CORRECT_LANE}): ${JSON.stringify(t)}`);
    await client.close(); return;
  }
  const MAX = Number(arg('max-pages') || 200), CHUNK = Number(arg('book-chunk') || 40), FLOOR5H = Number(arg('floor-5h') ?? 0.25);
  const WEEKLY_END = Number(arg('weekly-end') ?? 0);
  if (!(WEEKLY_END >= 0 && WEEKLY_END < 1)) { console.error('--weekly-end must be in [0, 1)'); process.exit(2); }
  const want = parseAgyHome(arg('agy-home'));
  let HOME = want.home ?? null;
  if (want.auto) {
    const pools = readPools();
    for (const p of pools) console.log(`pool ${poolName(p)}: ${p.reading ? `weekly ${(100 * p.reading.weekly).toFixed(1)}%, 5h ${p.reading.fiveHour == null ? '-' : (100 * p.reading.fiveHour).toFixed(1) + '%'}` : 'NO READING'}${p.busy ? `, busy (pid ${p.busy})` : ''}`);
    const toBuckets = (r) => [{ id: 'gemini-weekly', remaining_fraction: r.weekly, reset_time: r.weeklyReset }, { id: 'gemini-5h', remaining_fraction: r.fiveHour }];
    const pick = choosePool(pools, (r) => { const q = quotaFloor(toBuckets(r), { floor5h: FLOOR5H, weeklyEnd: WEEKLY_END }); return { open: q.ok, why: q.why }; });
    if (!pick) { console.log('correct: no pool has its floor open; nothing read'); await client.close(); return; }
    HOME = pick.home;
  } else if (HOME && !fs.existsSync(HOME)) { console.error(`--agy-home: ${HOME} does not exist`); await client.close(); process.exit(2); }
  const POOL = poolName({ home: HOME });
  const CHILD_ENV = agyEnv(HOME);
  const CLAIMS_DIR = path.join(path.dirname(LEDGER), 'claims');
  const ME = { pid: process.pid, pool: POOL };
  const held = new Set();
  process.on('exit', () => { for (const id of held) releaseBookClaim(CLAIMS_DIR, id); });
  const CONCURRENCY = Number(arg('concurrency') || 1);
  if (!(Number.isInteger(CONCURRENCY) && CONCURRENCY >= 1 && CONCURRENCY <= 4)) { console.error('--concurrency must be 1 to 4'); process.exit(2); }
  const DEADLINE = arg('deadline-min') ? Date.now() + Number(arg('deadline-min')) * 60_000 : Infinity;
  const job = `cli-ocr-correct-${new Date().toISOString().slice(0, 10)}`;
  fs.mkdirSync(OUT, { recursive: true });
  // The template, built once per day folder by the #5924 builder, which refuses if the live OCR prompt has moved.
  const TPL = path.join(OUT, 'fc-correct-prompt.txt');
  if (!fs.existsSync(TPL)) {
    const r = spawnSync(process.execPath, [path.join(HERE, '../eval/flash-reread-5924/fc-prompt.mjs'), TPL], { stdio: 'inherit', env: process.env });
    if (r.status !== 0) { console.error('fc-prompt.mjs refused: the correction template could not be built; nothing read'); await client.close(); process.exit(1); }
  }
  console.log(`correct: pool ${POOL}${WEEKLY_END ? ` (pace line ends at ${100 * WEEKLY_END}%)` : ''}; ${books.length} books in frame${SHARD ? ` (shard ${SHARD.k}/${SHARD.n})` : ''}, up to ${MAX} pages, ${CONCURRENCY} book(s) at a time, ${CHUNK} pages a book chunk${Number.isFinite(DEADLINE) ? `, no new chunk after ${new Date(DEADLINE).toISOString()}` : ''}`);
  let budget = MAX, stop = null, bi = 0;
  const tally = { written: 0, unchanged: 0, contain: 0, other: 0 };
  const nextChunk = async () => {
    while (bi < books.length) {
      const b = books[bi++];
      if (liveReaderBooks().has(b.id)) continue;       // a reader (of any run) is on this book now
      if (!claimBook(CLAIMS_DIR, b.id, ME)) continue;  // another live run is on this book
      held.add(b.id);
      ledgerTail(LEDGER, ledger, tailState);
      const open = (await correctablePages(db, b, { SKIP_TRANSLATION_PAGE_TYPES })).filter((p) => !ledger.has(p.id));
      if (open.length) return { book: b, open };
      releaseBookClaim(CLAIMS_DIR, b.id); held.delete(b.id);
    }
    return null;
  };
  const worker = async () => {
    while (!stop) {
      if (budget <= 0) { stop ??= 'page budget spent'; break; }
      if (Date.now() >= DEADLINE) { stop ??= 'deadline'; break; }
      const q = quotaFloor(readQuota(HOME), { floor5h: FLOOR5H, weeklyEnd: WEEKLY_END });
      if (!q.ok) { stop ??= `quota floor: ${q.why}`; break; }
      const c = await nextChunk();
      if (!c) { stop ??= 'queue empty'; break; }
      // Sized after the await, so two workers never both spend the same budget.
      const { book } = c;
      const release = () => { releaseBookClaim(CLAIMS_DIR, book.id); held.delete(book.id); };
      if (budget <= 0) { release(); stop ??= 'page budget spent'; break; }
      const take = c.open.slice(0, Math.min(CHUNK, budget));
      budget -= take.length;
      const tag = CONCURRENCY > 1 ? `[${book.id.slice(-6)}] ` : '';
      const dir = path.join(OUT, book.id);
      fs.mkdirSync(dir, { recursive: true });
      const ids = path.join(dir, `page-ids-${Date.now()}.json`);
      fs.writeFileSync(ids, JSON.stringify(take.map((p) => p.id)));
      console.log(`\n${tag}${book.id} ${String(book.title || '').slice(0, 40)} (${book.language}): ${take.length} of ${c.open.length} pages; pool ${POOL} weekly ${(100 * q.weekly).toFixed(1)}% (line ${(100 * q.line).toFixed(1)}%), 5h ${(100 * q.five_h).toFixed(1)}%`);
      const read = await run([path.join(HERE, 'cli-ocr.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${CORRECT_MODEL}`, `--correct-prompt=${TPL}`, `--lane=${CORRECT_LANE}`, `--job=${job}`, '--stop-on-quota'], tag, CHILD_ENV);
      if (read === 3) { release(); stop ??= 'quota'; console.log(`${tag}quota reached: stopping; the next run resumes`); break; }
      if (read !== 0) { release(); console.log(`${tag}  reader exited ${read}: chunk skipped this run`); continue; }
      const reason = `#7558 correction lane: Flash-Lite draft corrected by ${CORRECT_MODEL} through agy (lite>agy-flash-low passed #7520's router test on German and French)`;
      const t0 = Date.now();
      const applied = await run([path.join(HERE, 'cli-ocr.mjs'), 'apply', `--out=${dir}`, `--reason=${reason}`, `--mark-stale=${CORRECT_LANE}`, ...(APPLY ? ['--apply'] : [])], tag, CHILD_ENV);
      if (!APPLY || applied !== 0) { release(); continue; }
      const summaryFile = fs.readdirSync(dir).filter((f) => /^apply-summary-(?!dry|refused).*\.json$/.test(f)).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).mtimeMs >= t0).sort().pop();
      const sum = summaryFile ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : {};
      const written = new Set(sum.written_page_ids || []);
      for (const cl of sum.contain_claims || []) if (take.some((p) => p.id === cl.page_id)) fs.appendFileSync(CLAIMS, JSON.stringify({ ...cl, at: new Date().toISOString(), lane: CORRECT_LANE }) + '\n');
      for (const p of take) {
        const why = written.has(p.id) ? 'written' : sum.skipped_pages?.[p.id] ?? 'not_read';
        const k = why === 'written' ? 'written' : /UNCHANGED/.test(why) ? 'unchanged' : /CONTAIN/.test(why) ? 'contain' : 'other';
        tally[k]++;
        fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.id, book_id: book.id, page_number: p.page_number, outcome: k, why, at: new Date().toISOString() }) + '\n');
        ledger.add(p.id);
      }
      // The chunk is written and ledgered: its page images (~420 KB a page, ~1.3 GB a full run) are not needed again
      // (apply checks the recorded image hash; the prompt sent is in each write's provenance). The root disk is #6223.
      for (const p of take) fs.rmSync(path.join(dir, `ws-${p.id}`), { recursive: true, force: true });
      release();
      console.log(`${tag}  ${JSON.stringify(tally)}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\ncorrect run ended (pool ${POOL}): ${stop ?? 'done'}; ${MAX - budget} page(s) taken; ${JSON.stringify(tally)}`);
  await client.close();
}

async function main() {
  const mode = process.argv[2];
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  if (mode === 'correct' || mode === 'correct-count') return correctMain(mode, arg);
  if (!['count', 'run'].includes(mode)) { console.error('usage: cli-ocr-lane.mjs count | run --out=DIR [--max-pages=120] [--book=ID] [--apply] | correct-count | correct --out=DIR [--apply]'); process.exit(2); }
  const APPLY = process.argv.includes('--apply');
  const OUT = arg('out') && path.resolve(arg('out'));
  const LEDGER = arg('ledger') || (OUT ? path.join(path.dirname(OUT), 'cli-ocr-ledger.jsonl') : null);
  if (mode === 'run' && !OUT) { console.error('run needs --out=DIR'); process.exit(2); }
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const ledger = LEDGER ? readLedger(LEDGER) : new Set();

  const ONLY_BOOK = arg('book');
  const books = (await heldBooks(db)).filter((b) => !ONLY_BOOK || b.id === ONLY_BOOK);
  const plan = [];
  for (const book of books) {
    const lane = ocrLaneForBook(book);
    const pages = await db.collection('pages').find({ book_id: book.id, ...UNREAD }, { projection: { id: 1, page_number: 1, crop: 1, cropped_photo: 1 } }).sort({ page_number: 1 }).toArray();
    plan.push({ book, lane, cliModel: CLI_MODEL_FOR[lane.model] ?? null, spread: spreadReason(book, pages), pages, open: pages.filter((p) => !ledger.has(p.id)) });
  }
  const tally = {};
  for (const r of plan) {
    const k = r.lane.channel !== 'cli' ? 'now api channel: release' : r.spread ? 'spread book: waits for a spread read' : r.cliModel ? `${r.book.language ?? '?'} → ${r.cliModel}` : `no CLI model for ${r.lane.model}: waits`;
    tally[k] ??= { books: 0, pages: 0, ledgered: 0, visible: 0 };
    tally[k].books++; tally[k].pages += r.open.length; tally[k].ledgered += r.pages.length - r.open.length; tally[k].visible += r.book.visible ? 1 : 0;
  }
  console.log(`books held for the CLI OCR lane (${CLI_FLASH_OCR_HOLD.reason}): ${books.length}`);
  for (const [k, t] of Object.entries(tally)) console.log(`  ${k.padEnd(48)} ${String(t.books).padStart(4)} books (${t.visible} visible) · ${String(t.pages).padStart(6)} pages to read · ${t.ledgered} ledgered`);
  for (const r of plan.filter((x) => x.open.length === 0 && x.pages.length > 0)) console.log(`  stuck: ${r.book.id} ${String(r.book.title || '').slice(0, 50)} — ${r.pages.length} ledgered page(s) only; look at ${LEDGER ?? 'the ledger'}`);
  for (const r of plan.filter((x) => x.spread && x.pages.length)) console.log(`  spread: ${r.book.id} ${String(r.book.title || '').slice(0, 50)} — ${r.spread}`);
  if (mode === 'count') { await client.close(); return; }

  const MAX = Number(arg('max-pages') || 120);
  const int14 = (name, dflt) => { const v = Number(arg(name) || dflt); if (!(Number.isInteger(v) && v >= 1 && v <= 4)) { console.error(`--${name} must be 1 to 4`); process.exit(2); } return v; };
  const PER_CALL = int14('per-call', 1), PER_CALL_ARABIC = int14('per-call-arabic', 1), CONCURRENCY = int14('concurrency', 1);
  const VARIANT = arg('prompt-variant');
  const DEADLINE = arg('deadline-min') ? Date.now() + Number(arg('deadline-min')) * 60_000 : Infinity;
  const job = `cli-ocr-lane-${new Date().toISOString().slice(0, 10)}`;
  let budget = MAX, stop = null;
  console.log(`run: up to ${MAX} pages, ${CONCURRENCY} book(s) at a time, ${PER_CALL}/call (Arabic ${PER_CALL_ARABIC}/call)${VARIANT ? `, prompt ${VARIANT}` : ''}${Number.isFinite(DEADLINE) ? `, no new book after ${new Date(DEADLINE).toISOString()}` : ''}`);
  // Releases first, in order (no read, no quota): then the books to read go to the workers.
  const toRead = [];
  for (const r of plan) {
    const { book, lane, cliModel } = r;
    const label = `${book.id} ${String(book.title || '').slice(0, 40)}`;
    if (lane.channel !== 'cli') {
      console.log(`\n${label}: now routed to ${lane.model} on the API channel; releasing to the Batch lanes`);
      if (APPLY) console.log(`  ${JSON.stringify(await releaseBook(db, book.id, { note: `ocr routing now sends this book to ${lane.model} (API channel)`, source: 'cli-ocr-lane' }))}`);
      continue;
    }
    if (r.pages.length === 0) {
      console.log(`\n${label}: nothing left to read; releasing`);
      if (APPLY) console.log(`  ${JSON.stringify(await releaseBook(db, book.id, { note: 'every unread page read by the CLI OCR lane (#7089)', source: 'cli-ocr-lane' }))}`);
      continue;
    }
    if (r.spread) continue;
    if (!cliModel || r.open.length === 0) continue;
    toRead.push(r);
  }
  const readBook = async (r) => {
    const { book, lane, cliModel } = r;
    const tag = CONCURRENCY > 1 ? `[${book.id.slice(-6)}] ` : '';
    const label = `${book.id} ${String(book.title || '').slice(0, 40)}`;
    const take = r.open.slice(0, budget);
    budget -= take.length;
    const perCall = perCallFor(book, { perCall: PER_CALL, perCallArabic: PER_CALL_ARABIC });
    const dir = path.join(OUT, book.id);
    fs.mkdirSync(dir, { recursive: true });
    const ids = path.join(dir, 'page-ids.json');
    fs.writeFileSync(ids, JSON.stringify(take.map((p) => p.id)));
    console.log(`\n${tag}${label}: ${take.length} of ${r.open.length} pages on ${cliModel} (routed ${lane.model}), ${perCall}/call`);
    const read = await run([path.join(HERE, 'cli-ocr.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${cliModel}`, `--job=${job}`, '--stop-on-quota',
      ...(perCall > 1 ? [`--per-call=${perCall}`] : []), ...(VARIANT ? [`--prompt-variant=${VARIANT}`] : [])], tag);
    if (read === 3) { stop ??= 'quota'; console.log(`${tag}quota reached: stopping; the next run resumes`); return; }
    if (read !== 0) { console.log(`${tag}  reader exited ${read}: book skipped this run`); return; }
    const reason = `#7089 CLI OCR lane: routed ${lane.model}, read by ${cliModel} through agy (agy offers no 3 Flash)${perCall > 1 ? `, ${perCall} pages a call (#7558)` : ''}`;
    const applied = await run([path.join(HERE, 'cli-ocr.mjs'), 'apply', `--out=${dir}`, `--reason=${reason}`, ...(APPLY ? ['--apply'] : [])], tag);
    if (!APPLY || applied !== 0) return;
    // What this run tried and could not write goes to the ledger, so it is not read again every run.
    const left = new Set((await db.collection('pages').find({ id: { $in: take.map((p) => p.id) }, ...UNREAD }, { projection: { id: 1 } }).toArray()).map((p) => p.id));
    for (const p of take.filter((x) => left.has(x.id))) {
      let meta = null;
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, `${p.id}.meta.json`), 'utf8')); } catch { /* not read */ }
      fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.id, book_id: book.id, page_number: p.page_number, model: cliModel, exit: meta?.exit ?? null, error_class: meta?.error_class ?? (meta ? 'not_written' : 'not_read'), at: new Date().toISOString() }) + '\n');
    }
    if (left.size) console.log(`${tag}  ${left.size} page(s) not written: ledgered, not retried`);
    const remaining = await db.collection('pages').countDocuments({ book_id: book.id, ...UNREAD });
    if (remaining === 0) console.log(`${tag}  released: ${JSON.stringify(await releaseBook(db, book.id, { note: 'every unread page read by the CLI OCR lane (#7089)', source: 'cli-ocr-lane' }))}`);
  };
  const queue = [...toRead];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length && !stop) {
      if (budget <= 0) { stop ??= 'page budget spent'; break; }
      if (Date.now() >= DEADLINE) { stop ??= 'deadline'; break; }
      await readBook(queue.shift());
    }
  }));
  console.log(`\nrun ended: ${stop ?? 'queue empty'}; ${MAX - budget} page(s) taken, ${queue.length} book(s) left for the next run`);
  await client.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
