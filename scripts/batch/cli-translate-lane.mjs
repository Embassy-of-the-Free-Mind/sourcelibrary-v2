#!/usr/bin/env node
// PRIOR ART: scripts/batch/refused-pages.mjs — the scheduled `claude -p` job this copies (weekly-limit guard, exit-3
// stop, per-day output folder, a ledger of pages not to retry); it selects REFUSED OCR pages, not books held for a
// translation lane. scripts/batch/claude-translate.mjs and cli-translate.mjs (read + apply) — the readers and the writer
// this drives, unchanged. The OCR twin of the hold (CLI_FLASH_OCR_HOLD) has no runner yet (#7089). Nothing drained
// books held for a CLI translation lane, because nothing held them before #7075.
/**
 * cli-translate-lane — translate the books the pipeline held for a subscription CLI translation lane (#7075).
 *
 * WHO RUNS IT: cron on a Hetzner box whose `claude` (Opus rows) or `agy` (3.8 Flash rows) is signed in — or a session,
 * by hand. No paid API: Opus runs through `claude -p` (claude-translate.mjs), Gemini 3.8 Flash through `agy -p`
 * (cli-translate.mjs read), and cli-translate.mjs apply writes both through translate-core's door.
 *
 *   node --env-file=.env.production.local scripts/batch/cli-translate-lane.mjs count
 *   node --env-file=.env.production.local scripts/batch/cli-translate-lane.mjs run --out=DIR [--max-pages=60]
 *        [--engine=claude-opus-5-5|gemini-3.8-flash+agy-cli] [--max-weekly-pct=70] [--agy-home=auto|default|DIR] [--apply]
 *
 * WHICH BOOKS. Those held with reason CLI_TRANSLATE_HOLD.reason: the orchestrator's Phase 4 holds a book when
 * translateLaneForBook (the `channel: "cli"` rows of scripts/lib/translation-routing-table.json) names a CLI reader.
 * The lane is recomputed here from the table: a book whose row is gone or no longer cli is released at once, back to
 * the Batch lanes. Visible books first, then the oldest hold.
 *
 * WHICH PAGES. Untranslated only (no translation.data), translatable, not health-blocked, page_number > 0. Retranslating
 * a page that has English is a separate decision (#7075).
 *
 * RELEASE. When a book has no untranslated page left, it is released to the status it was held at, and Phase 4 then
 * advances it as it does any book with nothing left to translate. A page the reader failed or the writer refused is
 * written to the ledger (DIR/../cli-translate-ledger.jsonl) and not tried again; a book with ledgered pages stays held
 * and `count` names it, for a person to look at.
 *
 * WHICH READER. Opus rows: claude-translate.mjs. agy rows: cli-translate.mjs read (one page, or a folio-marked pair, a
 * call), unless the row carries `per_call`; then claude-translate.mjs --cli=agy --per-call=N, the block reader the
 * row's adoption sample measured (#7263: Latin, German, Italian, French at 4 a call). Both are written by
 * cli-translate.mjs apply.
 *
 * WHICH AGY POOL (#7263). --agy-home=auto takes the agy login with the most Gemini weekly left whose quota floor is open
 * (cli-ocr-lane.mjs quotaFloor: over the other lanes' weekly reserve (agy-pools.mjs weeklyReserve, #7911), 5-hour bucket over --floor-5h, default 0.25), read once at
 * the start (scripts/lib/agy-pools.mjs); no pool open, no agy read this run. `default` or a DIR fixes the pool. The
 * readers run with that AGY_HOME and AGY_POOL_SHARED=1. Without the flag the readers inherit the environment, as before.
 *
 * STALE (#7263, Derek 2026-11-03): `stale --stale-lane=agy-reread-lite-7853 --row=latin-cli-agy4 --out=DIR [--per-call=1]
 * [--concurrency=6] [--book-chunk=40] [--max-pages=N] [--deadline-min=M] [--floor-5h=0.25] [--agy-home=auto|default|DIR] [--book=ID[,ID]] [--apply]`
 * re-translates pages whose OCR a lane rewrote and whose English therefore predates it: `ocr.pipeline` is the lane and
 * `translation_stale` is set, whichever writer set it (the daily sweep's ocr_newer keeps its marker and has no lane). This is
 * the decision the WHICH PAGES rule above leaves out, taken for the Latin re-read: V4 (PR #8000) measured the pair, wrong end
 * to end 7/30 against the stored English's 15/26. Only books the row serves. Same reader and writer as `run`; the door
 * snapshots the old English and clears the flag, and refuses a human-edited translation. A page the writer leaves goes to
 * DIR/../cli-retranslate-ledger.jsonl and is not retried. It stops at the pool's quota floor with every reserve
 * in LANE_RESERVES kept, including cli-translate's own: first translations keep theirs. Order: cli-ocr-lane.mjs
 * byRereadPriority. --per-call defaults to 1; the gex45 line runs 4, the row's own number, since the #5021 anchor guard
 * (#8009) merged and its first live run was clean (2026-11-03: 117 pages in 40 calls, none refused; Opus: 10/10 on the right leaf).
 *
 * HOW IT FAILS. A usage-limit reply makes the reader exit 3; the run stops and the next resumes. A reader that exits 2
 * (claude-translate's OCR-first gate: the book's OCR is mostly flash-lite and the row has no adoption.ocr_checked) skips
 * that book and says so. Without --apply it reads and dry-runs the writer, and releases and ledgers nothing.
 */
import { VISIBLE_PAGE_MATCH } from '../lib/page-counts.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { translateLaneForBook, CLI_TRANSLATE_HOLD, SKIP_TRANSLATION_PAGE_TYPES } from '../lib/translate-core.mjs';
import { releaseBook, HOLD_STATUS } from '../lib/pipeline-hold.mjs';
import { CLI_TRANSLATE_LANES } from '../lib/translation-routing.mjs';
import { laneQuota } from '../lib/lane-quota.mjs';
import { agyEnv, readPools, choosePool, poolName, quotaBuckets, readQuotaStdout } from '../lib/agy-pools.mjs';
import { quotaFloor, parseAgyHome, byRereadPriority } from './cli-ocr-lane.mjs';
import { ocrFirstGate, NO_TEXT } from '../lib/ocr-first-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/** The pages this lane translates: the orchestrator's Phase 4 filter without the stale-translation branch. */
export const UNTRANSLATED = Object.freeze({
  ...VISIBLE_PAGE_MATCH,
  'ocr.data': { $exists: true, $nin: [null, ''] },
  page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
  'translation.health_blocked': { $exists: false },
  $or: [{ 'translation.data': { $exists: false } }, { 'translation.data': null }, { 'translation.data': '' }],
});

/** The two commands for one book's read, by engine: the reader's argv (after node). */
export function readerArgs(lane, { ids, dir, job, ocrChecked }) {
  const reader = path.join(ROOT, lane.reader);
  if (lane.engine === 'claude-opus-5-5') {
    return [reader, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${lane.model}`, `--job=${job}`, ...(ocrChecked ? [`--ocr-checked=${ocrChecked}`] : [])];
  }
  // A row's per_call (#7263): the block reader its adoption sample ran, Gemini through agy.
  if (lane.row?.per_call) {
    // A row's seam_pass (#8399): the seam pass after the reads; cli-translate.mjs apply writes its repairs under their own run id.
    const seam = lane.row.seam_pass ? ['--seam-pass=1', ...(lane.row.seam_pass === 'edit-before' ? ['--seam-edit-before=1'] : [])] : [];
    return [path.join(ROOT, 'scripts/batch/claude-translate.mjs'), 'read', '--cli=agy', `--per-call=${lane.row.per_call}`, ...seam, `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${lane.model}`, `--job=${job}`, ...(ocrChecked ? [`--ocr-checked=${ocrChecked}`] : [])];
  }
  return [reader, 'read', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${lane.model}`, ...(ocrChecked ? [`--ocr-checked=${ocrChecked}`] : [])];
}

function run(args, base = process.env) {
  console.log(`$ node ${args.map((a) => path.relative(process.cwd(), a) || a).join(' ')}`);
  return spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...base, CLI_JOB_NAME: process.env.CLI_JOB_NAME || 'cli-translate-lane-7075' } }).status;
}

/**
 * The readers' OCR-first gate, asked before a book takes any of the run's page budget (#7263). A reader the gate stops
 * exits 2 having read nothing, but its pages had already been taken from the budget, and the lane holds books oldest
 * first: the Flash-Lite books Phase 4 holds first (most Latin books at ocr_complete; the armc correction is what lets
 * them through) would have spent the whole budget on refusals every run. ocr.data stays on the server: the gate needs
 * only whether a read says it has no text (NO_TEXT), so that is all the projection returns.
 */
export async function gateBeforeRead(db, take, ocrChecked) {
  const pages = await db.collection('pages').aggregate([
    { $match: { id: { $in: take.map((p) => p.id) } } },
    { $project: { _id: 0, 'ocr.model': 1, 'ocr.edited_by': 1, 'ocr.source': 1,
      no_text: { $regexMatch: { input: { $ifNull: ['$ocr.data', ''] }, regex: NO_TEXT.source, options: 'i' } } } },
  ]).toArray();
  return ocrFirstGate(pages.map((p) => ({ ocr: { ...p.ocr, data: p.no_text ? '<page-type>blank' : '' } })), ocrChecked);
}

const readLedger = (f) => new Set(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id) : []);

async function heldBooks(db) {
  return db.collection('books').find(
    // The status first: it is indexed, and a held book carries both (pipeline-hold.mjs).
    { 'pipeline_auto.status': HOLD_STATUS, 'pipeline_auto.hold.reason': CLI_TRANSLATE_HOLD.reason },
    // title, publisher and image_source.provider: a row's `unless` reads them (translation-routing.mjs).
    { projection: { id: 1, title: 1, publisher: 1, language: 1, visible: 1, image_source: 1, 'pipeline_auto.hold': 1 } },
  ).sort({ visible: -1, 'pipeline_auto.hold.held_at': 1 }).toArray();
}

/** The pages `stale` re-translates in one book (header: STALE). */
export const staleLanePages = (bookId, lane) => ({
  book_id: bookId, ...VISIBLE_PAGE_MATCH, 'ocr.pipeline': lane, 'translation_stale.reason': { $exists: true },
  page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'translation.data': { $type: 'string' }, 'translation.health_blocked': { $exists: false },
  'translation.edited_by': { $exists: false }, 'translation.source': { $ne: 'manual' }, translation_withheld: { $ne: true },
});
/** A row's `per_call` for this run: the reader takes it from the row (readerArgs). */
export const laneWithPerCall = (lane, perCall) => ({ ...lane, row: { ...lane.row, per_call: perCall } });

function runAsync(args, env, tag) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, CLI_JOB_NAME: 'cli-retranslate-7263', AGY_JOB: 'cli-retranslate-7263' } });
    const pipe = (src, dst) => { let buf = ''; src.on('data', (d) => { buf += d; const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) dst.write(`${tag}${l}\n`); }); src.on('end', () => { if (buf) dst.write(`${tag}${buf}\n`); }); };
    pipe(child.stdout, process.stdout); pipe(child.stderr, process.stderr);
    child.on('close', resolve);
  });
}

async function staleMain(arg) {
  const LANE = arg('stale-lane'), ROW = arg('row'), APPLY = process.argv.includes('--apply');
  const OUT = arg('out') && path.resolve(arg('out'));
  if (!LANE || !ROW || !OUT) { console.error('stale needs --stale-lane --row --out'); process.exit(2); }
  const PER_CALL = Number(arg('per-call') || 1), CONCURRENCY = Number(arg('concurrency') || 1), CHUNK = Number(arg('book-chunk') || 40);
  if (![1, 2, 3, 4].includes(PER_CALL) || !(CONCURRENCY >= 1 && CONCURRENCY <= 8)) { console.error('--per-call 1 to 4, --concurrency 1 to 8'); process.exit(2); }
  const MAX = Number(arg('max-pages') || 200), DEADLINE = arg('deadline-min') ? Date.now() + Number(arg('deadline-min')) * 60_000 : Infinity;
  const floor5h = Number(arg('floor-5h') ?? 0.25);
  const toBuckets = (r) => [{ id: 'gemini-weekly', remaining_fraction: r.weekly, reset_time: r.weeklyReset }, { id: 'gemini-5h', remaining_fraction: r.fiveHour }];
  const want = parseAgyHome(arg('agy-home'));
  let home = want.home ?? null;
  if (want.auto) {
    const pools = readPools();
    for (const p of pools) console.log(`pool ${poolName(p)}: ${p.reading ? `weekly ${(100 * p.reading.weekly).toFixed(1)}%, 5h ${p.reading.fiveHour == null ? '-' : (100 * p.reading.fiveHour).toFixed(1) + '%'}` : 'NO READING'}${p.busy ? `, busy (pid ${p.busy})` : ''}`);
    const pick = choosePool(pools, (r) => { const f = quotaFloor(toBuckets(r), { floor5h }); return { open: f.ok, why: f.why }; });
    if (!pick) { console.log('stale: no agy pool has its floor open; nothing read'); return; }
    home = pick.home;
  } else if (home && !fs.existsSync(home)) { console.error(`--agy-home: ${home} does not exist`); process.exit(2); }
  const ENV = agyEnv(home), POOL = poolName({ home });
  const LEDGER = path.join(path.dirname(OUT), 'cli-retranslate-ledger.jsonl');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const ledger = readLedger(LEDGER);
  const ids = await db.collection('pages').distinct('book_id', { 'translation_stale.reason': { $exists: true }, 'ocr.pipeline': LANE });
  const books = (await db.collection('books').find(
    { id: { $in: ids }, visible: true, 'pipeline_auto.held': { $ne: true } },
    { projection: { id: 1, title: 1, publisher: 1, language: 1, year: 1, published: 1, image_source: 1, human_read_count: 1, pages_translated: 1 } },
  ).toArray()).map((b) => ({ ...b, lane: translateLaneForBook(b) })).filter((b) => b.lane.row?.id === ROW && (!arg('book') || arg('book').split(',').includes(b.id))).sort(byRereadPriority);
  console.log(`stale (${LANE} → row ${ROW}, ${PER_CALL} a call): pool ${POOL}; ${books.length} of ${ids.length} books with stale pages on this row; up to ${MAX} pages, ${CONCURRENCY} at a time${APPLY ? '' : ', DRY RUN'}`);
  let budget = MAX, bi = 0, stop = null;
  const tally = { written: 0, not_written: 0, books: 0 };
  const job = `cli-retranslate-${new Date().toISOString().slice(0, 10)}`;
  const worker = async () => {
    while (!stop) {
      if (budget <= 0) { stop = 'page budget spent'; break; }
      if (Date.now() >= DEADLINE) { stop = 'deadline'; break; }
      if (bi >= books.length) { stop = 'queue empty'; break; }
      // Read twice, as readPool does: one failed /quota in a long run (2026-11-03 14:30) must not end the run for the hour
      const q = quotaFloor(quotaBuckets(readQuotaStdout(home)) ?? quotaBuckets(readQuotaStdout(home)), { floor5h });
      if (!q.ok) { stop = `quota floor: ${q.why}`; break; }
      const book = books[bi++];
      const open = (await db.collection('pages').find(staleLanePages(book.id, LANE), { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray()).filter((p) => !ledger.has(p.id));
      if (!open.length) continue;
      const take = open.slice(0, Math.min(CHUNK, budget));
      budget -= take.length;
      const tag = CONCURRENCY > 1 ? `[${book.id.slice(-6)}] ` : '';
      const dir = path.join(OUT, book.id, String(Date.now()));
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'page-ids.json');
      fs.writeFileSync(file, JSON.stringify(take.map((p) => p.id)));
      console.log(`\n${tag}${book.id} ${String(book.title || '').slice(0, 40)}: ${take.length} of ${open.length} pages (weekly ${(100 * q.weekly).toFixed(1)}%, 5h ${(100 * q.five_h).toFixed(1)}%)`);
      const read = await runAsync(readerArgs(laneWithPerCall(book.lane, PER_CALL), { ids: file, dir, job, ocrChecked: book.lane.row.adoption?.ocr_checked }), ENV, tag);
      if (read === 3) { stop = 'usage limit'; break; }
      if (read !== 0) { console.log(`${tag}  reader exited ${read}: chunk skipped this run`); continue; }
      const reason = `#7263 re-translation after the ${LANE} re-read: row ${book.lane.row.id}, ${book.lane.engine}, ${PER_CALL} a call (V4, PR #8000: wrong end to end 7/30 against the stored English's 15/26)`;
      const applied = await runAsync([path.join(HERE, 'cli-translate.mjs'), 'apply', `--out=${dir}`, `--reason=${reason}`, ...(APPLY ? ['--apply'] : [])], ENV, tag);
      if (!APPLY || applied !== 0) continue;
      tally.books++;
      const left = new Set((await db.collection('pages').find({ id: { $in: take.map((p) => p.id) }, 'translation_stale.reason': { $exists: true } }, { projection: { id: 1 } }).toArray()).map((p) => p.id));
      tally.written += take.length - left.size; tally.not_written += left.size;
      for (const p of take.filter((x) => left.has(x.id))) {
        let meta = null;
        try { meta = JSON.parse(fs.readFileSync(path.join(dir, `${p.id}.meta.json`), 'utf8')); } catch { /* not read */ }
        fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.id, book_id: book.id, page_number: p.page_number, row: ROW, exit: meta?.exit ?? null, error_class: meta?.error_class ?? (meta ? 'not_written' : 'not_read'), at: new Date().toISOString() }) + '\n');
        ledger.add(p.id);
      }
      console.log(`${tag}  ${JSON.stringify(tally)}`);
      // The rest of this book next, ahead of lower priority books; only now, so no two workers hold one book.
      if (open.length > take.length) books.splice(bi, 0, book);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\nstale run ended (pool ${POOL}): ${stop ?? 'done'}; ${MAX - budget} page(s) taken; ${JSON.stringify(tally)}`);
  await client.close();
}

async function main() {
  const mode = process.argv[2];
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  if (mode === 'stale') return staleMain(arg);
  if (!['count', 'run'].includes(mode)) { console.error('usage: cli-translate-lane.mjs stale --stale-lane=L --row=R --out=DIR ... | count | run --out=DIR [--max-pages=60] [--engine=E] [--max-weekly-pct=70] [--agy-home=auto|default|DIR] [--apply]'); process.exit(2); }
  const ENGINE = arg('engine') || null;
  const APPLY = process.argv.includes('--apply');
  const OUT = arg('out') && path.resolve(arg('out'));
  const LEDGER = arg('ledger') || (OUT ? path.join(path.dirname(OUT), 'cli-translate-ledger.jsonl') : null);
  if (mode === 'run') {
    if (!OUT) { console.error('run needs --out=DIR'); process.exit(2); }
    // A cron spends the box account's subscription: the lane's quota gate (lane-quota.mjs, #7301) idles it at its
    // share of the week (70% for Opus) and opens it in the last stretch, when the quota would otherwise be lost: Opus
    // to 95% in the last 24 h (its `endOfWeek`, #7448), agy at the shared 90% in the last 48 h.
    // --max-weekly-pct overrides the registered share.
    const agy = ENGINE === 'gemini-3.8-flash+agy-cli';
    const q = laneQuota(agy ? 'agy-flash-translate' : 'claude-opus-translate', { model: agy ? CLI_TRANSLATE_LANES[ENGINE].model : null, maxWeeklyPct: arg('max-weekly-pct') ?? null });
    if (!q.open) { console.log(`skip: lane ${q.lane} idles (${q.state}): ${q.why}`); return; }
    console.log(`quota: lane ${q.lane} ${q.state}: ${q.why}`);
  }
  // --agy-home (#7263): which agy login the agy readers spend; null = inherit the environment (as before the flag).
  let AGY_ENV = null;
  if (mode === 'run' && arg('agy-home')) {
    const want = parseAgyHome(arg('agy-home'));
    let home = want.home ?? null;
    if (want.auto) {
      const floor5h = Number(arg('floor-5h') ?? 0.25);
      const pools = readPools();
      for (const p of pools) console.log(`pool ${poolName(p)}: ${p.reading ? `weekly ${(100 * p.reading.weekly).toFixed(1)}%, 5h ${p.reading.fiveHour == null ? '-' : (100 * p.reading.fiveHour).toFixed(1) + '%'}` : 'NO READING'}${p.busy ? `, busy (pid ${p.busy})` : ''}`);
      const toBuckets = (r) => [{ id: 'gemini-weekly', remaining_fraction: r.weekly, reset_time: r.weeklyReset }, { id: 'gemini-5h', remaining_fraction: r.fiveHour }];
      const pick = choosePool(pools, (r) => { const f = quotaFloor(toBuckets(r), { floor5h, lane: 'cli-translate' }); return { open: f.ok, why: f.why }; });
      if (!pick) { console.log('skip: no agy pool has its floor open; nothing read'); return; }
      home = pick.home;
    } else if (home && !fs.existsSync(home)) { console.error(`--agy-home: ${home} does not exist`); process.exit(2); }
    AGY_ENV = agyEnv(home);
    console.log(`agy pool: ${poolName({ home })}`);
  }
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const ledger = LEDGER ? readLedger(LEDGER) : new Set();

  const books = await heldBooks(db);
  const plan = [];
  for (const book of books) {
    const lane = translateLaneForBook(book);
    const pages = await db.collection('pages').find({ book_id: book.id, ...UNTRANSLATED }, { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray();
    plan.push({ book, lane, pages, open: pages.filter((p) => !ledger.has(p.id)) });
  }
  const tally = {};
  for (const r of plan) {
    const k = r.lane.channel === 'cli' ? `${r.lane.engine} (${r.lane.row.id})` : 'no longer cli: release';
    tally[k] ??= { books: 0, pages: 0, ledgered: 0, visible: 0 };
    tally[k].books++; tally[k].pages += r.open.length; tally[k].ledgered += r.pages.length - r.open.length; tally[k].visible += r.book.visible ? 1 : 0;
  }
  console.log(`books held for a CLI translation lane (${CLI_TRANSLATE_HOLD.reason}): ${books.length}`);
  for (const [k, t] of Object.entries(tally)) console.log(`  ${k.padEnd(48)} ${String(t.books).padStart(4)} books (${t.visible} visible) · ${String(t.pages).padStart(6)} pages to translate · ${t.ledgered} ledgered`);
  for (const r of plan.filter((x) => x.open.length === 0 && x.pages.length > 0)) console.log(`  stuck: ${r.book.id} ${String(r.book.title || '').slice(0, 50)} — ${r.pages.length} ledgered page(s) only; look at ${LEDGER ?? 'the ledger'}`);
  if (mode === 'count') { await client.close(); return; }

  const MAX = Number(arg('max-pages') || 60);
  const job = `cli-tr-${new Date().toISOString().slice(0, 10)}`;
  let budget = MAX;
  const gated = { books: 0, pages: 0 };
  for (const r of plan) {
    const { book, lane } = r;
    const label = `${book.id} ${String(book.title || '').slice(0, 40)}`;
    if (lane.channel !== 'cli') {
      console.log(`\n${label}: its row is no longer a cli row; releasing to the Batch lanes`);
      if (APPLY) console.log(`  ${JSON.stringify(await releaseBook(db, book.id, { note: 'translation-routing-table no longer routes this book to a CLI lane', source: 'cli-translate-lane' }))}`);
      continue;
    }
    if (ENGINE && lane.engine !== ENGINE) continue;
    if (r.pages.length === 0) {
      console.log(`\n${label}: nothing left to translate; releasing`);
      if (APPLY) console.log(`  ${JSON.stringify(await releaseBook(db, book.id, { note: `every untranslated page written by the ${lane.engine} lane (#7075)`, source: 'cli-translate-lane' }))}`);
      continue;
    }
    if (budget <= 0 || r.open.length === 0) continue;
    const take = r.open.slice(0, budget);
    const gate = await gateBeforeRead(db, take, lane.row.adoption?.ocr_checked);
    if (!gate.ok) { gated.books++; gated.pages += take.length; continue; }
    budget -= take.length;
    const dir = path.join(OUT, book.id);
    fs.mkdirSync(dir, { recursive: true });
    const ids = path.join(dir, 'page-ids.json');
    fs.writeFileSync(ids, JSON.stringify(take.map((p) => p.id)));
    console.log(`\n${label}: ${take.length} of ${r.open.length} pages on ${lane.engine} (row ${lane.row.id})`);
    const read = run(readerArgs(lane, { ids, dir, job, ocrChecked: lane.row.adoption?.ocr_checked }), lane.engine !== 'claude-opus-5-5' && AGY_ENV ? AGY_ENV : process.env);
    if (read === 3) { console.log('usage limit reached: stopping; the next run resumes'); break; }
    if (read === 2) budget += take.length;   // refused before any call (its gate, or its arguments): nothing was read
    if (read !== 0) { console.log(`  reader exited ${read}: book skipped this run`); continue; }
    const reason = `#7075 CLI translation lane: row ${lane.row.id}, ${lane.engine} (adopted on ${lane.row.adoption.sample})`;
    const applied = run([path.join(HERE, 'cli-translate.mjs'), 'apply', `--out=${dir}`, `--reason=${reason}`, ...(APPLY ? ['--apply'] : [])]);
    if (!APPLY || applied !== 0) continue;
    // What this run tried and could not write goes to the ledger, so it is not read again every run.
    const left = new Set((await db.collection('pages').find({ id: { $in: take.map((p) => p.id) }, ...UNTRANSLATED }, { projection: { id: 1 } }).toArray()).map((p) => p.id));
    for (const p of take.filter((x) => left.has(x.id))) {
      let meta = null;
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, `${p.id}.meta.json`), 'utf8')); } catch { /* not read */ }
      fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.id, book_id: book.id, page_number: p.page_number, engine: lane.engine, exit: meta?.exit ?? null, error_class: meta?.error_class ?? (meta ? 'not_written' : 'not_read'), at: new Date().toISOString() }) + '\n');
    }
    if (left.size) console.log(`  ${left.size} page(s) not written: ledgered, not retried`);
    const remaining = await db.collection('pages').countDocuments({ book_id: book.id, ...UNTRANSLATED });
    if (remaining === 0) console.log(`  released: ${JSON.stringify(await releaseBook(db, book.id, { note: `every untranslated page written by the ${lane.engine} lane (#7075)`, source: 'cli-translate-lane' }))}`);
  }
  if (gated.books) console.log(`\nOCR-first gate: ${gated.books} book(s), ${gated.pages} page(s) wait on a Flash-Lite transcription (the OCR correction lanes, cli-ocr-lane.mjs); none took budget`);
  await client.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
