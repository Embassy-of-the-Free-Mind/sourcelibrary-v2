#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate-lane.mjs `stale` — the per-book chunk loop, the pool choice (readPools /
// choosePool / quotaFloor with every LANE_RESERVES reserve kept), the readers' argv and the apply call are its; it selects
// pages by `translation_stale` + `ocr.pipeline` and keeps no resumable per-page ledger, check gates or reports, so it cannot
// take a fixed 39K-page frame. scripts/maintenance/wrong-leaf-fix-5021.mjs `run` — the ledger, progress.json, sleep to the
// reset, and the ntfy + issue comment at the end. scripts/batch/zh-print-correct-7263/runner.mjs (#8077) — --check-at.
/**
 * #8169: re-translate the 3 Flash English on Paddle-read Chinese with agy gemini-3.8-flash-low, 4 pages a call.
 *
 *   node --env-file=.env.production.local scripts/batch/zh-retranslate-8169/runner.mjs --frame=FRAME_DIR --dir=RUN_DIR
 *        [--apply] [--concurrency=2] [--chunk=40] [--floor-5h=0.25] [--first-check=1000] [--check-every=10000]
 *        [--max-pages=N] [--notify] [--report-hours=6]
 *        [--kind=prose|reference] [--spread] [--job=NAME] [--min-accept=10] [--max-worse=3]
 *
 * PAGES: frame.mjs's frame.jsonl.gz, in its order (reference works first, by readers; whole books, leaf order). A page with
 * a final ledger row is never taken again. Before each write every page is read back: English or OCR changed since the
 * draw → `skip-changed`, its read is moved aside and not applied.
 * READ: claude-translate.mjs read --cli=agy --per-call=4 (the F4 arm of #8134: the block prompt, the stored English of the
 * page before the block, neighbour OCR, the #5021 anchor guard; a refused call or guarded page is read again alone).
 * WRITE: cli-translate.mjs apply --apply: every guard; the door snapshots the old English to page_revisions and clears
 * translation_stale; a page-text-writer revision row makes `revert-run.mjs --run-id <run>` undo a run. No book status or
 * hold is changed.
 * POOLS: $0, agy only. Before each book, the login with most Gemini weekly left whose floor is open (every lane's weekly
 * reserve kept, cli-ocr-lane quotaFloor, lane null; 5-hour bucket over --floor-5h). None open → sleep to the earliest
 * reset read, then read /quota again. A usage-limit exit from the reader drops that pool until its next reading.
 * CHECKS: after --first-check written pages, then each --check-every: check.mjs (30 pages one per book, blind Opus,
 * 2 wrong-page controls), recorded to book_checks. STOP on its rule or when no check ran. After the FIRST check passes the
 * run stops until RUN_DIR/gate1-by-eye.json exists (a person or session opened >= 5 written pages with the image).
 * STOP FILE: RUN_DIR/STOP stops the run at the next book. Reports: a comment on #8169 every --report-hours, ntfy
 * sourcelibrary-uptime + a final comment when it ends (done or stopped).
 * WAVES (the prose wave, 2026-11-04): --kind keeps one kind of the frame; --spread orders books round-robin by work family
 * (title before its volume mark) and sends a book with pages left to the back of the queue, so the first check's 30 pages
 * come from 30 families, not the first work in the frame; --job names the run (ledger tags, check run_id, reports);
 * --min-accept / --max-worse go to check.mjs. Give each wave its own --dir: its own ledger, checks and STOP file.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { agyEnv, readPools, choosePool, poolName, quotaBuckets, readQuotaStdout } from '../../lib/agy-pools.mjs';
import { quotaFloor } from '../cli-ocr-lane.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';
import { familyOf } from './check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const FRAME = path.resolve(arg('frame')), DIR = path.resolve(arg('dir'));
const APPLY = process.argv.includes('--apply'), NOTIFY = process.argv.includes('--notify');
const CONC = Number(arg('concurrency', 2)), CHUNK = Number(arg('chunk', 40)), FLOOR5H = Number(arg('floor-5h', 0.25));
const FIRST = Number(arg('first-check', 1000)), EVERY = Number(arg('check-every', 10000)), MAXP = Number(arg('max-pages', Infinity));
const REPORT_MS = Number(arg('report-hours', 6)) * 3600e3;
const KIND = arg('kind', null), SPREAD = process.argv.includes('--spread');
const MIN_ACCEPT = arg('min-accept', null), MAX_WORSE = arg('max-worse', null);
const ISSUE = 8169, JOB = arg('job', 'zh-retranslate-8169'), MODEL = 'gemini-3.8-flash-low';
const ENV_FILE = process.env.SL_ENV_FILE || path.join(ROOT, '.env.production.local');
const REASON = `#8169 re-translation of 3 Flash English on Paddle-read Chinese: agy 3.8 Flash low, 4 pages a call (#8134 paired test, F4 33/58 vs stored 13/60; Derek 2026-11-04, ${KIND === 'prose' ? 'the prose wave' : 'reference works first'})`;
const LEDGER = path.join(DIR, 'ledger.jsonl'), PROGRESS = path.join(DIR, 'progress.json'), STOPF = path.join(DIR, 'STOP'), GATE1 = path.join(DIR, 'gate1-by-eye.json');
const FINAL = new Set(['written', 'refused', 'skip-changed', 'not-read', 'read-failed']);
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(path.join(DIR, 'books'), { recursive: true });
fs.mkdirSync(path.join(DIR, 'checks'), { recursive: true });

// ── state ──
const last = new Map(); let seq = 0;
for (const r of jsonl(LEDGER)) { last.set(r.page_id, r); seq = Math.max(seq, (r.seq ?? 0) + 1); }
const tries = new Map(); for (const r of jsonl(LEDGER)) if (r.state === 'read-failed') tries.set(r.page_id, (tries.get(r.page_id) ?? 0) + 1);
const isDone = (id) => { const r = last.get(id); if (!r) return false; if (r.state === 'read-failed') return (tries.get(id) ?? 0) >= 2; return FINAL.has(r.state); };
function ledger(row) { const r = { seq: seq++, ...row, at: new Date().toISOString() }; fs.appendFileSync(LEDGER, JSON.stringify(r) + '\n'); last.set(r.page_id, r); if (r.state === 'read-failed') tries.set(r.page_id, (tries.get(r.page_id) ?? 0) + 1); }
const countBy = () => { const o = {}; for (const r of last.values()) { const k = r.state === 'written' ? 'written' : `${r.state}${r.reason ? `: ${r.reason}` : ''}`; o[k] = (o[k] || 0) + 1; } return o; };
const written = () => [...last.values()].filter((r) => r.state === 'written').length;

const frame = zlib.gunzipSync(fs.readFileSync(path.join(FRAME, 'frame.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !KIND || r.kind === KIND);
const byBook = new Map(); for (const r of frame) { if (!byBook.has(r.book_id)) byBook.set(r.book_id, []); byBook.get(r.book_id).push(r); }
const titles = new Map(JSON.parse(fs.readFileSync(path.join(FRAME, 'books.json'), 'utf8')).map((b) => [b.book_id, b.title]));
function spreadOrder(ids) {
  const fam = new Map(); for (const id of ids) { const f = familyOf(titles.get(id)); if (!fam.has(f)) fam.set(f, []); fam.get(f).push(id); }
  const out = [], lists = [...fam.values()];
  for (let i = 0; out.length < ids.length; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}
const queue = SPREAD ? spreadOrder([...byBook.keys()]) : [...byBook.keys()];

// ── pools ──
const toBuckets = (r) => [{ id: 'gemini-weekly', remaining_fraction: r.weekly, reset_time: r.weeklyReset }, { id: 'gemini-5h', remaining_fraction: r.fiveHour }];
let pool = null, poolAt = 0; const dropped = new Map();
function pickPool() {
  const pools = readPools();
  fs.appendFileSync(path.join(DIR, 'quota.jsonl'), JSON.stringify({ at: new Date().toISOString(), pools: pools.map((p) => ({ pool: poolName(p), busy: p.busy, reading: p.reading })) }) + '\n');
  const pick = choosePool(pools.filter((p) => !(dropped.get(poolName(p)) > Date.now())), (r) => { const f = quotaFloor(toBuckets(r), { floor5h: FLOOR5H }); return { open: f.ok, why: f.why }; });
  if (pick) return { home: pick.home, name: poolName(pick) };
  // Sleep to the earliest reset that could reopen a pool (never probe past a limit).
  const resets = pools.filter((p) => p.reading).flatMap((p) => [p.reading.fiveHourReset, p.reading.weeklyReset]).map((t) => Date.parse(t ?? '')).filter((t) => t > Date.now());
  return { sleepUntil: resets.length ? Math.min(...resets) + 120e3 : Date.now() + 3600e3, why: pools.map((p) => `${poolName(p)} ${p.reading ? `w${(100 * p.reading.weekly).toFixed(0)}% 5h${p.reading.fiveHour == null ? '-' : (100 * p.reading.fiveHour).toFixed(0)}%` : 'unread'}`).join(', ') };
}
async function poolForBook() {
  for (;;) {
    if (stopReason) return null;
    if (!pool || Date.now() - poolAt > 20 * 60e3) {
      const p = pickPool();
      if (p.sleepUntil) { pool = null; log(`no pool open (${p.why}); sleeping to ${new Date(p.sleepUntil).toISOString()}`); state.sleeping_until = new Date(p.sleepUntil).toISOString(); await sleepUntil(p.sleepUntil); state.sleeping_until = null; continue; }
      pool = p; poolAt = Date.now(); log(`pool ${pool.name}`);
    }
    const q = quotaFloor(quotaBuckets(readQuotaStdout(pool.home)) ?? quotaBuckets(readQuotaStdout(pool.home)), { floor5h: FLOOR5H });
    if (q.ok) return { ...pool, q };
    log(`pool ${pool.name} floor closed: ${q.why}`); pool = null;
  }
}
async function sleepUntil(t) { while (Date.now() < t && !stopReason) { if (fs.existsSync(STOPF)) { stopReason = 'STOP file'; break; } await maybeReport(); await sleep(Math.min(300e3, t - Date.now())); } }

// ── child processes ──
function runChild(args, env, logFile) {
  return new Promise((resolve) => {
    const out = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, [`--env-file=${ENV_FILE}`, ...args], { cwd: ROOT, stdio: ['ignore', out, out], env });
    child.on('close', (code) => { fs.closeSync(out); resolve(code); });
  });
}

// ── one book chunk ──
async function doChunk(db, bookId, rows, p) {
  const dir = path.join(DIR, 'books', bookId, String(Date.now()));
  fs.mkdirSync(dir, { recursive: true });
  const ids = path.join(dir, 'page-ids.json');
  fs.writeFileSync(ids, JSON.stringify(rows.map((r) => r.page_id)));
  const logFile = path.join(dir, 'run.log');
  const env = agyEnv(p.home, process.env, { CLI_JOB_NAME: JOB, AGY_JOB: JOB });
  const read = await runChild([path.join(ROOT, 'scripts/batch/claude-translate.mjs'), 'read', '--cli=agy', '--per-call=4', `--page-ids-file=${ids}`, `--out=${dir}`, `--model=${MODEL}`, `--job=${JOB}`], env, logFile);
  if (read === 3) { dropped.set(p.name, Date.now() + 30 * 60e3); pool = null; return 'usage-limit'; }
  if (read === 2) { for (const r of rows) ledger({ page_id: r.page_id, book_id: bookId, page_number: r.page_number, kind: r.kind, state: 'not-read', reason: 'reader OCR-first gate', dir }); return 'ok'; }
  // Re-check every read page against the draw before writing.
  const now = new Map((await db.collection('pages').find({ id: { $in: rows.map((r) => r.page_id) } }, { projection: { _id: 0, id: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray()).map((x) => [x.id, x]));
  fs.mkdirSync(path.join(dir, 'held-back'), { recursive: true });
  const changed = new Set();
  for (const r of rows) {
    const x = now.get(r.page_id), meta = path.join(dir, `${r.page_id}.meta.json`);
    const why = !x ? 'page gone' : contentHash(x.translation?.data || '') !== r.tr_hash ? 'English changed since the draw' : contentHash(x.ocr?.data || '') !== r.ocr_hash ? 'OCR changed since the draw' : null;
    if (!why) continue;
    changed.add(r.page_id);
    if (fs.existsSync(meta)) fs.renameSync(meta, path.join(dir, 'held-back', `${r.page_id}.meta.json`));
    ledger({ page_id: r.page_id, book_id: bookId, page_number: r.page_number, kind: r.kind, state: 'skip-changed', reason: why, dir });
  }
  let applyOut = '';
  if (APPLY) {
    const res = await runChild([path.join(ROOT, 'scripts/batch/cli-translate.mjs'), 'apply', `--out=${dir}`, `--reason=${REASON}`, '--apply'], { ...env, CLI_JOB_NAME: JOB }, path.join(dir, 'apply.log'));
    applyOut = fs.readFileSync(path.join(dir, 'apply.log'), 'utf8');
    if (res !== 0) log(`${bookId}: apply exited ${res}`);
  }
  const skips = new Map([...applyOut.matchAll(/skip p\.(-?\d+): (.+)/g)].map((m) => [Number(m[1]), m[2].trim()]));
  const runId = /run (cli-translate-\d+)/.exec(applyOut)?.[1] ?? null;
  const after = new Map((await db.collection('pages').find({ id: { $in: rows.map((r) => r.page_id) } }, { projection: { _id: 0, id: 1, 'translation.data': 1, 'translation.model': 1 } }).toArray()).map((x) => [x.id, x]));
  for (const r of rows) {
    if (changed.has(r.page_id)) continue;
    let meta = null; try { meta = JSON.parse(fs.readFileSync(path.join(dir, `${r.page_id}.meta.json`), 'utf8')); } catch { /* not read */ }
    const x = after.get(r.page_id);
    const base = { page_id: r.page_id, book_id: bookId, page_number: r.page_number, kind: r.kind, pool: p.name, dir, run: runId };
    if (APPLY && x?.translation?.model === MODEL && contentHash(x.translation.data || '') !== r.tr_hash) ledger({ ...base, state: 'written', new_hash: contentHash(x.translation.data), call_pages: meta?.call_pages ?? null });
    else if (!meta) ledger({ ...base, state: 'not-read', reason: 'reader skipped it (not translatable / same language)' });
    else if (meta.exit !== 0 || meta.error_class) ledger({ ...base, state: 'read-failed', reason: meta.error_class || `exit ${meta.exit}` });
    else if (!APPLY) ledger({ ...base, state: 'read-only', reason: 'dry run' });
    else ledger({ ...base, state: 'refused', reason: skips.get(r.page_number) ?? 'not written (no reason printed)' });
  }
  return 'ok';
}

// ── checks ──
const checkDue = () => { const w = written(); const t = w >= FIRST ? FIRST + Math.floor((w - FIRST) / EVERY) * EVERY : null; return t != null && !fs.existsSync(path.join(DIR, 'checks', String(t), 'result.json')) ? t : null; };
function runCheck(t) {
  const prev = fs.readdirSync(path.join(DIR, 'checks')).map(Number).filter((x) => x < t && fs.existsSync(path.join(DIR, 'checks', String(x), 'result.json'))).sort((a, b) => b - a)[0];
  const since = prev != null ? (JSON.parse(fs.readFileSync(path.join(DIR, 'checks', String(prev), 'result.json'), 'utf8')).seq_at_check ?? 0) : 0;
  const out = path.join(DIR, 'checks', String(t));
  log(`check at ${t} written (since seq ${since})`);
  const extra = [`--job=${JOB}`, ...(SPREAD ? ['--per=family'] : []), ...(MIN_ACCEPT ? [`--min-accept=${MIN_ACCEPT}`] : []), ...(MAX_WORSE ? [`--max-worse=${MAX_WORSE}`] : [])];
  const r = spawnSync(process.execPath, [`--env-file=${ENV_FILE}`, path.join(HERE, 'check.mjs'), `--dir=${DIR}`, `--out=${out}`, `--since=${since}`, `--seed=${8169 + t}`, '--record', ...extra], { cwd: ROOT, encoding: 'utf8', env: process.env, maxBuffer: 64 << 20 });
  fs.writeFileSync(path.join(out, 'check.log'), (r.stdout || '') + (r.stderr || ''));
  if (r.status !== 0 || !fs.existsSync(path.join(out, 'result.json'))) return { ran: false, why: `check exited ${r.status}: ${(r.stderr || '').trim().split('\n').pop()}` };
  const res = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
  res.seq_at_check = seq; fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(res, null, 1));
  return { ran: true, res };
}

// ── reports ──
const state = { started_at: new Date().toISOString(), apply: APPLY, sleeping_until: null };
let lastReport = Date.now(), stopReason = null;
const callsPer1k = () => {
  let calls = 0, pages = 0;
  for (const b of fs.readdirSync(path.join(DIR, 'books'))) for (const d of fs.readdirSync(path.join(DIR, 'books', b))) { const f = path.join(DIR, 'books', b, d, 'calls.jsonl'); calls += jsonl(f).length; pages += JSON.parse(fs.readFileSync(path.join(DIR, 'books', b, d, 'page-ids.json'), 'utf8')).length; }
  return { calls, pages_sent: pages, calls_per_1000_pages: pages ? Math.round((1000 * calls) / pages) : null };
};
function progress() {
  const byState = countBy(), w = written(), left = frame.filter((r) => !isDone(r.page_id)).length;
  const byKind = {}; for (const r of last.values()) if (r.state === 'written') byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  const checks = fs.readdirSync(path.join(DIR, 'checks')).filter((t) => fs.existsSync(path.join(DIR, 'checks', t, 'result.json'))).map((t) => ({ at_written: Number(t), summary: JSON.parse(fs.readFileSync(path.join(DIR, 'checks', t, 'result.json'), 'utf8')).summary }));
  const p = { ...state, at: new Date().toISOString(), frame: frame.length, written: w, written_by_kind: byKind, left, by_state: byState, checks, ...callsPer1k(), stop: stopReason };
  fs.writeFileSync(PROGRESS, JSON.stringify(p, null, 1));
  return p;
}
const fmt = (p) => `frame ${p.frame} pages; **written ${p.written}** (${Object.entries(p.written_by_kind).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}); left ${p.left}.\n\n\`\`\`\n${JSON.stringify(p.by_state, null, 1)}\n\`\`\`\nCalls: ${p.calls} for ${p.pages_sent} pages sent (${p.calls_per_1000_pages ?? '-'} per 1,000).${p.checks.length ? `\n\nChecks:\n${p.checks.map((c) => `- at ${c.at_written}: ${c.summary}`).join('\n')}` : ''}${p.sleeping_until ? `\n\nSleeping to a pool reset: ${p.sleeping_until}.` : ''}`;
function comment(body) { spawnSync('gh', ['issue', 'comment', String(ISSUE), '--body', body], { cwd: ROOT, encoding: 'utf8' }); }
function ntfy(title, msg) { spawnSync('curl', ['-s', '-m', '20', '-H', `Title: ${title}`, '-d', msg, 'https://ntfy.sh/sourcelibrary-uptime']); }
async function maybeReport() { if (!NOTIFY || Date.now() - lastReport < REPORT_MS) return; lastReport = Date.now(); comment(`**${JOB} runner, 6-hourly progress** (${new Date().toISOString().slice(0, 16)}Z, box ${process.env.HOSTNAME || ''})\n\n${fmt(progress())}`); }

// ── main ──
async function main() {
  const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 }); await c.connect();
  const db = c.db('bookstore');
  log(`${JOB}: frame ${frame.length} pages${KIND ? ` (${KIND})` : ''} in ${queue.length} books${SPREAD ? `, spread over ${new Set(queue.map((b) => familyOf(titles.get(b)))).size} families` : ''}; ledger ${last.size} rows, written ${written()}; ${APPLY ? 'APPLY' : 'DRY RUN'}, ${CONC} at a time`);
  let qi = 0, taken = 0, checking = null, active = 0;
  const worker = async (wid) => {
    for (;;) {
      if (fs.existsSync(STOPF)) stopReason ??= 'STOP file';
      if (stopReason) return;
      if (taken >= MAXP) { stopReason ??= `--max-pages ${MAXP} reached`; return; }
      const due = checkDue();
      if (due != null) {
        if (!checking) checking = (async () => { while (active > 0) await sleep(5000); const r = runCheck(due); checking = null; return r; })();
        const r = await checking;
        if (r) {
          if (!r.ran) { stopReason ??= `no check ran at ${due} written (${r.why}): stopping, not passing`; return; }
          if (!r.res.pass) { stopReason ??= `check at ${due} written: ${r.res.summary}`; return; }
          if (due === FIRST && !fs.existsSync(GATE1)) { stopReason ??= `first check passed (${r.res.summary}); waiting for the by-eye gate (${GATE1})`; return; }
        }
        continue;
      }
      if (due == null && written() >= FIRST && !fs.existsSync(GATE1)) { stopReason ??= `waiting for the by-eye gate (${GATE1})`; return; }
      if (qi >= queue.length) return;
      const bookId = queue[qi++];
      const open = byBook.get(bookId).filter((r) => !isDone(r.page_id));
      if (!open.length) continue;
      const p = await poolForBook();
      if (!p) return;
      const take = open.slice(0, Math.min(CHUNK, MAXP - taken));
      taken += take.length; active++;
      log(`[w${wid}] ${bookId} ${String(titles.get(bookId) || '').slice(0, 30)}: ${take.length} of ${open.length} (pool ${p.name} w${(100 * p.q.weekly).toFixed(1)}% 5h${(100 * p.q.five_h).toFixed(1)}%)`);
      let r;
      try { r = await doChunk(db, bookId, take, p); } catch (e) { log(`[w${wid}] ${bookId}: ${e.stack || e}`); r = 'error'; }
      active--;
      if (r === 'usage-limit') { taken -= take.length; queue.splice(qi, 0, bookId); continue; }
      if (open.length > take.length) { if (SPREAD) queue.push(bookId); else queue.splice(qi, 0, bookId); }
      progress(); await maybeReport();
    }
  };
  await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)));
  const p = progress();
  const end = stopReason ?? (p.left ? `queue walked; ${p.left} pages left un-final` : 'frame done');
  log(`ended: ${end}`);
  if (NOTIFY) {
    comment(`**${JOB} runner ended** (${new Date().toISOString().slice(0, 16)}Z): ${end}\n\n${fmt(p)}\n\nLedger \`${LEDGER}\`; undo a run: \`scripts/maintenance/revert-run.mjs --run-id <run>\`.`);
    ntfy(`#${ISSUE} zh re-translation ${stopReason ? 'stopped' : 'done'}`, `${end}. Written ${p.written} of ${p.frame}.`);
  }
  await c.close();
}

await main();
