#!/usr/bin/env node
// PRIOR ART: scripts/batch/ocr-convergence/correct.mjs and scripts/batch/cli-ocr.mjs apply (the reader and the writer, run
// unchanged as child processes; every guard stays theirs). scripts/batch/cli-ocr-lane.mjs correct (the scheduled twin, on
// agy and on cron: it reads agy pools, and this brief forbids a new cron). scripts/batch/refused-pages.mjs weeklyMeter (the
// meter read, imported). scripts/lib/lane-stop.mjs (a lane's paged stop; it files through the lane registry, and this is a
// one-off job on one issue, so the page is a plain ntfy post as reader-request-lane.mjs does).
/**
 * #7263 job zh-print-correct-7263: the detached runner. Opus corrects the Gemini-read Chinese in true print books, books
 * readers open first, on this box's subscription login. Resumes from its ledger; no state outside DIR.
 *
 *   node --env-file=... runner.mjs run    --dir=DIR --frame-dir=FRAME --per-call=N [--wave=200] [--concurrency=3] [--max-pages=N]
 *        [--ceiling-points=350] [--check-at=1000] [--no-notify]
 *   node --env-file=... runner.mjs status --dir=DIR       pages by state, quota used, what it is doing now
 *
 * ONE WAVE. Re-read the books and pages from Mongo; a page still owed (frame.mjs pageState) in a book writeGate lets through
 * goes in. correct.mjs reads them into DIR/waves/NNNN. A correction whose text resembles a neighbouring page's stored text
 * more than its own stored text is dropped before apply. cli-ocr.mjs apply --only=<the corrections> writes the rest: only
 * corrections are passed, so an UNCHANGED or CONTAIN answer is never stamped as a failed read. The ledger takes one row per
 * page. The wave folder is packed to a .tar.gz, its images and transcripts dropped.
 *
 * NO PAID RE-TRANSLATION. Nothing here marks a page stale for a lane or names a lane a cron drains (ocr.pipeline is LANE,
 * which no `cli-translate-lane.mjs stale` line reads). writeGate leaves out any book a paid lane could select.
 *
 * QUOTA. Before each wave: weekly >= 92% on this box's account sleeps to the week's reset, with no call made. A usage-limit
 * reply (correct.mjs exit 3) sleeps an hour, or to the reset if the meter is at the line. A stale meter waits. The sum of the
 * weekly meter's rises while this runner is up is an UPPER bound on what it used, since other jobs share the login; at
 * CEILING_POINTS (3.5 account-weeks) it stops.
 *
 * STOPS (paged on ntfy, commented on the issue, exit 0 so systemd does not restart it): the queue is empty, the ceiling, DIR/STOP
 * exists, the --check-at check fails (check.mjs: 30 written pages, blind Opus judge, under 24/30 accepted), or a wave trips the breaker: under half its reads answered, or over 15% of its corrections refused by apply, or an
 * apply that failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { VISIBLE_PAGE_MATCH } from '../../lib/page-counts.mjs';
import { weeklyMeter } from '../refused-pages.mjs';
import { pageState, writeGate, MODEL_RE } from './frame.mjs';
import { bigrams, dice } from './bigrams.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const DIR = path.resolve(arg('dir', '.'));
const FRAME = arg('frame-dir') && path.resolve(arg('frame-dir'));
const PER_CALL = Number(arg('per-call', 1));
const WAVE = Number(arg('wave', 200));
const CONCURRENCY = Number(arg('concurrency', 3));
const MAX_PAGES = Number(arg('max-pages', Infinity));
// Job zh-print-bulk-7263 counts what the pilot's login used against the same 3.5 account-weeks: --ceiling-points=344.
export const CEILING_POINTS = Number(arg('ceiling-points', 350));
const CHECK_AT = Number(arg('check-at', 0));
const NOTIFY = !process.argv.includes('--no-notify');
export const LANE = 'opus-correct-zh-print-7263';
const JOB = 'zh-print-bulk-7263';
const ISSUE = 7263;
const STOP_PCT = 92;
const ENV_FILE = ['/data/scratch/sl/sourcelibrary', '/root/sourcelibrary'].map((d) => `${d}/.env.production.local`).find((f) => fs.existsSync(f));
const LEDGER = path.join(DIR, 'ledger.jsonl');
const STATE = path.join(DIR, 'state.json');
const REASON = '#7263: Opus corrected the stored Gemini read of this Chinese print page against its image (gemini>opus, print 26/30 accepted; job zh-print-bulk-7263)';
// Every report says so: the pilot missed its bar and bulk runs on Derek's decision, not on a pass.
const DECIDED = 'Bulk runs on Derek\'s decision of 2026-11-04. The pilot missed its bar (PILOT-RESULT fail: 51/60 accepted, 6 wrong-text against a limit of 4); this is not a pass.';

const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const now = () => new Date().toISOString();
const log = (m) => console.log(`${now()} ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { started_at: now(), wave: 0, points: 0, last_pct: null, list_usd: 0, calls: 0 });
const writeState = (s) => fs.writeFileSync(STATE, JSON.stringify({ ...s, updated_at: now() }, null, 1));

/** Pages by state from the ledger: the last row of a page wins. */
export function tallyLedger(rows) {
  const last = new Map(); for (const r of rows) last.set(r.page_id, r);
  const t = {}; for (const r of last.values()) t[r.state] = (t[r.state] ?? 0) + 1;
  return { pages: last.size, states: t };
}

/** A final state: the page is not read again. A deferred book's pages have no row, and a no-answer may be tried once more. */
const isFinal = (r) => r.state !== 'no-answer' || (r.tries ?? 1) >= 2;

function meter() {
  // The account a `claude` child uses: CLAUDE_CONFIG_DIR's login when set (team@ on main), not the box's default.
  const m = weeklyMeter(undefined, process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : undefined);
  if (!m) return null;
  return { pct: m.pct, hoursLeft: m.hoursLeft };
}

/** The account's weekly meter's rise since the last look: added to the ceiling's count. A reset lowers it, adding nothing. */
function countPoints(s, m) {
  if (s.last_pct != null && m.pct > s.last_pct) s.points += m.pct - s.last_pct;
  s.last_pct = m.pct;
}

/**
 * Books whose corrections apply mostly refuses: 20+ corrections and over 40% refused by the shared-words guard. Their reads
 * are spent for nothing (the stored text stays), so they are set aside, listed in the report, and not read again.
 */
export function setAsideBooks(rows) {
  const last = new Map(); for (const r of rows) last.set(r.page_id, r);
  const by = new Map();
  for (const r of last.values()) { const b = by.get(r.book_id) ?? by.set(r.book_id, { written: 0, refused: 0 }).get(r.book_id); if (r.state === 'written') b.written++; else if (String(r.state).startsWith('refused')) b.refused++; }
  return new Map([...by].filter(([, b]) => b.written + b.refused >= 20 && b.refused / (b.written + b.refused) > 0.4));
}

async function nextWave(db, frameBooks, done, limit, aside = new Map()) {
  const ids = frameBooks.map((b) => b.book_id);
  const docs = new Map((await db.collection('books').find({ id: { $in: ids } }, { projection: { id: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, needs_splitting: 1, split_completed: 1, pipeline_auto: 1 } }).toArray()).map((b) => [b.id, b]));
  const out = []; const deferred = {};
  for (const b of frameBooks) {
    if (out.length >= limit) break;
    if (aside.has(b.book_id)) { deferred[b.book_id] = 'set aside: apply refuses over 40% of its corrections'; continue; }
    const d = docs.get(b.book_id);
    const gate = d ? writeGate(d) : 'book gone';
    if (gate) { deferred[b.book_id] = gate; continue; }
    const rows = await db.collection('pages').find({ book_id: b.book_id, ...VISIBLE_PAGE_MATCH, 'ocr.model': { $regex: MODEL_RE } }, { projection: { id: 1, page_number: 1, script_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.edited_by': 1, 'ocr.source': 1, 'ocr.unreadable': 1, translation_withheld: 1 } }).sort({ page_number: 1 }).toArray();
    for (const p of rows) {
      if (out.length >= limit) break;
      if (done.has(p.id) || pageState(p)) continue;
      out.push({ page_id: p.id, book_id: b.book_id, slug: b.slug, page_number: p.page_number, why: JOB, stored_model: p.ocr.model });
    }
  }
  return { pages: out, deferred };
}

/** Text whose Han bigrams match a neighbouring stored page better than its own stored page: the slide #5021 found. */
function slidOffLeaf(setDir, page, byBook) {
  const read = path.join(setDir, 'reads', `${page.page_id}.txt`), stored = path.join(setDir, 'stored', `${page.page_id}.txt`);
  if (!fs.existsSync(read) || !fs.existsSync(stored)) return false;
  const b = bigrams(fs.readFileSync(read, 'utf8'));
  const own = dice(b, bigrams(fs.readFileSync(stored, 'utf8')));
  return byBook.get(page.book_id).filter((q) => Math.abs(q.page_number - page.page_number) === 1).some((q) => {
    const f = path.join(setDir, 'stored', `${q.page_id}.txt`);
    return fs.existsSync(f) && dice(b, bigrams(fs.readFileSync(f, 'utf8'))) > own;
  });
}

function pack(setDir) {
  // Images and transcripts go first: the reads are kept in R2 (#7075), the text and metas in this tarball.
  for (const e of fs.readdirSync(path.join(setDir, 'reads'))) if (e.startsWith('ws-')) fs.rmSync(path.join(setDir, 'reads', e), { recursive: true, force: true });
  fs.rmSync(path.join(setDir, 'transcripts'), { recursive: true, force: true });
  const r = spawnSync('tar', ['-czf', `${setDir}.tar.gz`, '-C', path.dirname(setDir), path.basename(setDir)]);
  if (r.status === 0) fs.rmSync(setDir, { recursive: true, force: true });
}

async function notify(title, body) {
  if (!NOTIFY) return;
  spawnSync('curl', ['-s', '-m', '20', '-H', `Title: ${title}`, '-H', 'Priority: high', '-d', body.slice(0, 1500), 'https://ntfy.sh/sourcelibrary-uptime'], { stdio: 'ignore' });
  spawnSync('gh', ['issue', 'comment', String(ISSUE), '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--body', `**${title}**\n\n${body}`], { stdio: 'ignore', cwd: ROOT });
}

function report(s, why, deferred = {}) {
  const rows = jsonl(LEDGER), t = tallyLedger(rows);
  const contain = rows.filter((r) => r.state === 'contain');
  const gates = {}; for (const g of Object.values(deferred)) { const k = g.replace(/^\d+% translated/, 'under 92% translated').slice(0, 60); gates[k] = (gates[k] ?? 0) + 1; }
  const aside = setAsideBooks(rows);
  const contains = contain.slice(0, 60).map((r) => `- \`${r.book_id}\` p.${r.page_number}: ${String(r.reason ?? '').slice(0, 160)}`).join('\n');
  return `${why}\n\n${DECIDED}\n\n| | |\n|---|---|\n| pages with a final state | ${t.pages} |\n${Object.entries(t.states).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}\n| weekly meter rises while running (upper bound, login shared) | ${s.points} points = ${(s.points / 100).toFixed(2)} account-weeks |\n| list value of the calls | $${s.list_usd.toFixed(2)} in ${s.calls} calls; cash $0 |\n| books deferred at the last wave | ${JSON.stringify(gates)} |\n| books set aside (apply refused over 40%) | ${[...aside].map(([id, b]) => `\`${id}\` ${b.refused}/${b.written + b.refused}`).join(', ') || 'none'} |\n\nProgress: \`node --env-file=${ENV_FILE} ${path.join(ROOT, 'scripts/batch/zh-print-correct-7263/runner.mjs')} status --dir=${DIR}\`\n\n${contain.length ? `**CONTAIN answers, not written (${contain.length}${contain.length > 60 ? ', first 60; all in the ledger' : ''}). A model's claim, unchecked by eye:**\n${contains}` : 'No CONTAIN answers.'}`;
}

async function run() {
  fs.mkdirSync(path.join(DIR, 'waves'), { recursive: true });
  const frameBooks = JSON.parse(fs.readFileSync(path.join(FRAME, 'books.json'), 'utf8')).books.filter((b) => b.owed > 0).sort((a, b) => a.rank - b.rank);
  const s = readState();
  let lastDeferred = {};
  for (;;) {
    if (fs.existsSync(path.join(DIR, 'STOP'))) return stopAll(s, 'Stopped: DIR/STOP exists.', lastDeferred);
    const m = meter();
    if (!m) { log('meter stale or absent: waiting 10 min'); s.doing = 'waiting: the meter is stale'; writeState(s); await sleep(600e3); continue; }
    countPoints(s, m);
    if (s.points >= CEILING_POINTS) return stopAll(s, `Stopped at the ceiling: ${s.points} points of the weekly meter, ${(CEILING_POINTS / 100).toFixed(2)} account-weeks on this login.`, lastDeferred);
    if (m.pct >= STOP_PCT) {
      const ms = Math.max(600e3, (m.hoursLeft ?? 1) * 3.6e6 + 300e3);
      s.doing = `sleeping: weekly ${m.pct}%, reset in ${(ms / 3.6e6).toFixed(1)} h`; writeState(s); log(s.doing);
      await sleep(Math.min(ms, 1800e3));   // looks again every 30 min; a call is made only under the line
      continue;
    }
    const rows = jsonl(LEDGER);
    const final = new Set(); const tries = new Map();
    for (const r of rows) { tries.set(r.page_id, r.tries ?? 1); if (isFinal(r)) final.add(r.page_id); else final.delete(r.page_id); }
    const written = rows.filter((r) => r.state === 'written').length;
    if (written >= MAX_PAGES) return stopAll(s, `Stopped: --max-pages=${MAX_PAGES} reached.`, lastDeferred);
    if (CHECK_AT && written >= CHECK_AT && !fs.existsSync(path.join(DIR, `check-${CHECK_AT}`, 'result.json'))) {
      s.doing = `checking: 30 of the first ${written} written pages, blind Opus judge`; writeState(s); log(s.doing);
      const ck = spawnSync('node', [path.join(HERE, 'check.mjs'), `--dir=${DIR}`, `--out=${path.join(DIR, `check-${CHECK_AT}`)}`], { encoding: 'utf8', env: process.env, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
      fs.appendFileSync(path.join(DIR, 'check.log'), (ck.stdout ?? '') + (ck.stderr ?? ''));
      const resFile = path.join(DIR, `check-${CHECK_AT}`, 'result.json');
      if (!fs.existsSync(resFile)) { s.doing = `check not finished (exit ${ck.status}): again in 30 min`; writeState(s); log(s.doing); await sleep(1800e3); continue; }
      const res = JSON.parse(fs.readFileSync(resFile, 'utf8'));
      if (!res.pass) return stopAll(s, `Stopped by the ${CHECK_AT}-page check: ${res.summary}`, lastDeferred);
      spawnSync('gh', ['issue', 'comment', String(ISSUE), '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--body', `**zh-print-bulk-7263: the ${CHECK_AT}-page check held; bulk continues.**\n\n${DECIDED}\n\n${res.summary}\n\n${res.table}`], { stdio: 'ignore', cwd: ROOT });
      continue;
    }
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
    await client.connect();
    const { pages, deferred } = await nextWave(client.db('bookstore'), frameBooks, final, Math.min(WAVE, MAX_PAGES - written), setAsideBooks(rows));
    await client.close();
    lastDeferred = deferred;
    if (!pages.length) return stopAll(s, 'Done: no owed page is left in a book that may be written.', deferred);
    s.wave++;
    const set = path.join(DIR, 'waves', String(s.wave).padStart(4, '0'));
    fs.mkdirSync(set, { recursive: true });
    fs.writeFileSync(path.join(set, 'manifest.jsonl'), pages.map((p) => JSON.stringify(p)).join('\n') + '\n');
    // A shared box: when its 15-minute load is over 1.25 a core, one call at a time, so the other jobs are not crowded.
    const conc = Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[2]) > 1.25 * os.cpus().length ? 1 : CONCURRENCY;
    s.doing = `wave ${s.wave}: reading ${pages.length} pages, ${PER_CALL} a call, ${conc} at once`; writeState(s); log(s.doing);
    const read = spawnSync('node', [path.join(ROOT, 'scripts/batch/ocr-convergence/correct.mjs'), `--set-dir=${set}`, '--model=opus', `--per-call=${PER_CALL}`, `--concurrency=${conc}`, `--job=${JOB}-w${s.wave}`], { encoding: 'utf8', env: process.env, cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
    fs.writeFileSync(path.join(set, 'read.log'), (read.stdout ?? '') + (read.stderr ?? ''));
    if (read.status === 3) log('correct.mjs stopped on a usage limit');
    else if (read.status !== 0) { if (fs.existsSync(path.join(set, 'calls.jsonl'))) pack(set); return stopAll(s, `Stopped: correct.mjs exit ${read.status} in wave ${s.wave}. ${(read.stderr ?? '').slice(-300)}`, deferred); }

    const metas = pages.map((p) => { const f = path.join(set, 'reads', `${p.page_id}.meta.json`); return fs.existsSync(f) ? { p, m: JSON.parse(fs.readFileSync(f, 'utf8')) } : { p, m: null }; });
    const byBook = new Map(); for (const p of pages) (byBook.get(p.book_id) ?? byBook.set(p.book_id, []).get(p.book_id)).push(p);
    const corrected = metas.filter((x) => x.m?.outcome === 'corrected');
    const slid = new Set(corrected.filter((x) => slidOffLeaf(set, x.p, byBook)).map((x) => x.p.page_id));
    const only = corrected.map((x) => x.p.page_id).filter((id) => !slid.has(id));
    const onlyFile = path.join(set, 'only.json');
    fs.writeFileSync(onlyFile, JSON.stringify(only));
    let summary = { written_page_ids: [], skipped_pages: {} };
    if (only.length) {
      const before = new Set(fs.readdirSync(path.join(set, 'reads')).filter((f) => f.startsWith('apply-summary-')));
      const ap = spawnSync('node', [path.join(ROOT, 'scripts/batch/cli-ocr.mjs'), 'apply', `--out=${path.join(set, 'reads')}`, `--only=${onlyFile}`, `--lane=${LANE}`, `--reason=${REASON}`, '--apply'], { encoding: 'utf8', env: process.env, cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
      fs.writeFileSync(path.join(set, 'apply.log'), (ap.stdout ?? '') + (ap.stderr ?? ''));
      const made = fs.readdirSync(path.join(set, 'reads')).filter((f) => f.startsWith('apply-summary-') && !before.has(f));
      if (ap.status !== 0 || made.length !== 1) { pack(set); return stopAll(s, `Stopped: apply exit ${ap.status} in wave ${s.wave}. ${(ap.stderr ?? '').slice(-300)}`, deferred); }
      summary = JSON.parse(fs.readFileSync(path.join(set, 'reads', made[0]), 'utf8'));
    }
    const writtenIds = new Set(summary.written_page_ids);
    const tally = {};
    for (const { p, m } of metas) {
      const state = !m ? (read.status === 3 ? null : 'no-answer') : m.outcome === 'corrected' ? (writtenIds.has(p.page_id) ? 'written' : slid.has(p.page_id) ? 'refused: resembles a neighbour page' : `refused: ${String(summary.skipped_pages?.[p.page_id] ?? 'not written').replace(/\d+%/g, 'N%').slice(0, 60)}`) : m.outcome;
      if (!state) continue;   // not reached before the limit: asked again next wave, with no try counted
      tally[state] = (tally[state] ?? 0) + 1;
      fs.appendFileSync(LEDGER, JSON.stringify({ page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, state, wave: s.wave, tries: (tries.get(p.page_id) ?? 0) + (state === 'no-answer' ? 1 : 0) || 1, at: now(), run: summary.run ?? null, per_call: PER_CALL, reason: m?.outcome === 'contain' ? m.reason : undefined, stored_model: p.stored_model }) + '\n');
    }
    const calls = jsonl(path.join(set, 'calls.jsonl'));
    s.calls += calls.length; s.list_usd += calls.reduce((t, c) => t + (c.usage?.list_cost_usd ?? 0), 0);
    pack(set);
    log(`wave ${s.wave}: ${JSON.stringify(tally)}; ${calls.length} calls`);
    s.doing = `wave ${s.wave} done: ${JSON.stringify(tally)}`; writeState(s);
    const answered = metas.filter((x) => x.m && x.m.outcome !== 'no-answer').length;
    const refused = corrected.length - corrected.filter((x) => writtenIds.has(x.p.page_id)).length;
    if (read.status === 3) {
      const after = meter();
      const ms = after && after.pct >= STOP_PCT ? 1800e3 : 3600e3;
      s.doing = `sleeping ${ms / 60e3} min: usage limit reply`; writeState(s); log(s.doing);
      await sleep(ms);
      continue;
    }
    if (metas.length >= 10 && answered < metas.length / 2) return stopAll(s, `Stopped by the breaker: wave ${s.wave} answered ${answered} of ${metas.length} pages.`, deferred);
    // Refusals that sit in one book are that book's stored text (#7263 wave 3: 17 of 100, all in 道藏, whose stored read the
    // corrections fix by eye); that book is set aside at 40%. The breaker is for a fault across books.
    const refusedBy = {}; for (const x of corrected) if (!writtenIds.has(x.p.page_id)) refusedBy[x.p.book_id] = (refusedBy[x.p.book_id] ?? 0) + 1;
    const top = Math.max(0, ...Object.values(refusedBy));
    if (corrected.length >= 10 && refused / corrected.length > 0.15 && top < 0.8 * refused) return stopAll(s, `Stopped by the breaker: apply refused ${refused} of ${corrected.length} corrections in wave ${s.wave}. ${JSON.stringify(tally)}`, deferred);
  }
}

async function stopAll(s, why, deferred) {
  s.doing = why; s.ended_at = now(); writeState(s);
  log(why);
  await notify(`zh-print-correct-7263: ${why.split(':')[0].split('.')[0]}`, report(s, why, deferred));
}

function status() {
  const s = readState(), t = tallyLedger(jsonl(LEDGER));
  console.log(JSON.stringify({ doing: s.doing, updated_at: s.updated_at, wave: s.wave, ended_at: s.ended_at ?? null, ...t, weekly_points_upper_bound: s.points, account_weeks_upper_bound: +(s.points / 100).toFixed(2), ceiling_points: CEILING_POINTS, list_usd: +s.list_usd.toFixed(2), calls: s.calls, meter_now: meter(), bytes: Number(spawnSync('du', ['-sb', DIR], { encoding: 'utf8' }).stdout.split('\t')[0]) }, null, 1));
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const stage = process.argv[2];
  if (stage === 'run') await run(); else if (stage === 'status') status(); else { console.error('stages: run | status'); process.exit(2); }
}
