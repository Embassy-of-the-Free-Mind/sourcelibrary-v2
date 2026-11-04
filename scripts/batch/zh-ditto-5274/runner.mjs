#!/usr/bin/env node
// PRIOR ART: scripts/batch/siku-translate-lane.mjs (a detached wave lane with a ledger, a hold re-check before each
// apply and an ntfy page; it translates, never corrects OCR), scripts/batch/cli-ocr-lane.mjs correct (the held queue's
// correction lane: agy, per-language cells, not correct.mjs), scripts/batch/ocr-convergence/driver.mjs apply (drives
// cli-ocr.mjs apply --only for an adjudicated set; one set, no pacing). None runs correct.mjs over a frame in waves
// with a weekly-limit stop, a ceiling in account-weeks and a translation gate per book. This one does, and writes
// only through `correct.mjs` (reads) and `cli-ocr.mjs apply` (the guarded writer, page_revisions per page).
/**
 * runner.mjs — #5274: restore the 丨 ditto marks of the zero-丨 pages (佩文韻府 / 駢字類編 / 韻府拾遺) by Opus correction
 * of the stored Paddle text on the stored image, with the ditto instruction (route P2-r2).
 *
 *   node --env-file=<repo>/.env.production.local scripts/batch/zh-ditto-5274/runner.mjs run [--per-call=10] [--dry]
 *   node scripts/batch/zh-ditto-5274/runner.mjs status            the progress: pages by state, quota used
 *
 * State: $ZD_DIR (default $JOB_SCRATCH/run): ledger.jsonl (one row per page and outcome; the last row wins), meter.jsonl,
 * contain.jsonl (CONTAIN answers: never written, listed on the issue), waves/<n>/ (correct.mjs set dirs; images and
 * transcripts removed after each apply). Re-running resumes: a page with a ledger row is not taken again.
 *
 * Per wave: pace check (this login's weekly percent; >= 92% sleeps to the reset; unreadable sleeps and re-reads, never
 * calls), then up to WAVE_CALLS correct.mjs calls, then per book the translation gate, then
 * `cli-ocr.mjs apply --only=<corrected> --lane=zh-ditto-opus-5274 --mark-stale=zh-ditto-5274 --apply`.
 *
 * Translation gate (no paid re-translation): an unheld book is written only while it is `complete` and at least 90%
 * translated, so orchestrator Phase 4 gap-fill (pipeline-orchestrator.mjs, < 90% only) cannot select it; a stale page
 * still counts as translated (page-counts.mjs), so the write cannot push it under. A held book only under one of the
 * OCR-only holds (their release names translation as the priced decision, not OCR). Anything else: ledgered, not read.
 * Ceiling: CEILING_POINTS weekly-percent points moved on this login (2.5 account-weeks), then it stops.
 * On done or stop: ntfy sourcelibrary-uptime and a comment on #5274.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const ENV = process.env.ZD_ENV_FILE || '/data/scratch/sl/sourcelibrary/.env.production.local';
const DIR = process.env.ZD_DIR || path.join(process.env.JOB_SCRATCH || '/data/scratch/sl/jobs/zh-ditto-correct-5274', 'run');
const STEP = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const PER_CALL = Number(arg('per-call', 10));
const MODEL = arg('model', 'opus');   // the pilot decides: opus unless sonnet met the bar (#5274 inbox 07:37Z)
const DRY = process.argv.includes('--dry');
const WAVE_CALLS = Number(arg('wave-calls', 12));
const CONCURRENCY = Number(arg('concurrency', 3));
const WEEKLY_STOP = 92;
const CEILING_POINTS = Number(arg('ceiling-points', 250));
export const LANE = `zh-ditto-${MODEL}-5274`;
export const STALE_LANE = 'zh-ditto-5274';
export const OK_HOLDS = new Set(['paddle-zh-5600-ocr-only', 'gpu-backlog-5660', 'paddle-zh-6388-ocr-only']);
const FAM = '佩文韻府|韻府拾遺|駢字類編';
const MIN_HAN = 300;
const REASON = `#5274: restore the 丨 ditto marks lost by Paddle (zero-丨 pages), ${MODEL} correction of the stored text on the stored image with the ditto instruction (P2-r2, pilot 2026-11-04)`;
const ISSUE = 5274;
const F = (n) => path.join(DIR, n);
fs.mkdirSync(path.join(DIR, 'waves'), { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const append = (f, rows) => { if (rows.length) fs.appendFileSync(F(f), rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ledger() { const m = new Map(); for (const r of readJsonl(F('ledger.jsonl'))) m.set(r.page_id, r); return m; }

/** Weekly-percent points this login moved since the runner began (resets handled), from meter.jsonl. */
function pointsUsed() {
  let used = 0, prev = null;
  for (const r of readJsonl(F('meter.jsonl'))) {
    if (r.weekly == null) continue;
    // the endpoint's reset time jitters by a second between reads: same week when the resets are within an hour
    const sameWeek = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) < 3600e3;
    if (prev) used += sameWeek(prev.weekly_reset, r.weekly_reset) ? Math.max(0, r.weekly - prev.weekly) : r.weekly;
    prev = r;
  }
  return used;
}
async function meter() {
  const r = spawnSync('node', [path.join(HERE, 'meter.mjs')], { cwd: REPO, encoding: 'utf8', timeout: 60000 });
  let m = null; try { m = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* unreadable */ }
  append('meter.jsonl', [{ at: new Date().toISOString(), ...(m || { weekly: null }) }]);
  return m;
}
async function ntfy(title, body, priority = 'default') {
  try { await fetch('https://ntfy.sh/sourcelibrary-uptime', { method: 'POST', headers: { Title: title, Priority: priority, Tags: 'zh-ditto-5274' }, body }); } catch { /* best effort */ }
}
function comment(body) { spawnSync('gh', ['issue', 'comment', String(ISSUE), '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--body', body], { encoding: 'utf8', timeout: 120000 }); }

function run(cmd, args, out) {
  return new Promise((resolve) => {
    const fd = fs.openSync(out, 'a');
    const c = spawn(cmd, args, { cwd: REPO, stdio: ['ignore', fd, fd], env: process.env });
    c.on('close', (code) => { fs.closeSync(fd); resolve(code); });
  });
}

/**
 * The next wave's pages: the census's zero-丨 pages (frame.mjs, taken once; a page whose Kanripo leaf has no mark is
 * left out) with no ledger row, book by book, re-read from Mongo by id: still Paddle, still no 丨, not human-edited.
 * A book the gate refuses is ledgered in book-gate.jsonl and not taken.
 */
async function nextWave(db, done, maxPages) {
  const { census } = await import('./leaf-marks.mjs');
  const rows = census().filter((r) => r.marks === 0 && r.leaf_marks !== 0 && !done.has(r.pid)).sort((a, b) => (a.bid < b.bid ? -1 : a.bid > b.bid ? 1 : a.pn - b.pn));
  const skipped = new Set(readJsonl(F('book-gate.jsonl')).map((r) => r.book_id));
  const byBook = new Map(); for (const r of rows) if (!skipped.has(r.bid)) (byBook.get(r.bid) ?? byBook.set(r.bid, []).get(r.bid)).push(r);
  const pages = [];
  for (const [bid, rs] of byBook) {
    if (pages.length >= maxPages) break;
    const b = await db.collection('books').findOne({ id: bid }, { projection: { _id: 0, id: 1, visible: 1, pages_ocr: 1, pages_blank: 1, pages_translated: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold.reason': 1 } });
    const why = !b ? 'book not found' : b.visible !== true ? 'not visible' : bookGate(b);
    if (why) { append('book-gate.jsonl', [{ at: new Date().toISOString(), book_id: bid, why, zero_pages: rs.length }]); log(`book ${bid}: ${why} (${rs.length} pages not taken)`); continue; }
    const live = await db.collection('pages').find({ id: { $in: rs.map((r) => r.pid) } }, { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.edited_by': 1 } }).toArray();
    const ok = new Map(live.filter((p) => p.ocr?.source === 'paddle' && !p.ocr?.edited_by && !/丨/.test(p.ocr?.data || '')).map((p) => [p.id, p]));
    const gone = rs.filter((r) => !ok.has(r.pid));
    append('ledger.jsonl', gone.map((r) => ({ page_id: r.pid, book_id: bid, page_number: r.pn, state: 'changed-since-census', at: new Date().toISOString() })));
    for (const r of rs) if (ok.has(r.pid)) pages.push({ page_id: r.pid, book_id: bid, page_number: r.pn });
  }
  return pages.slice(0, maxPages);
}
export function bookGate(b) {
  const hold = b.pipeline_auto?.hold?.reason;
  if (hold) return OK_HOLDS.has(hold) ? null : `held ${hold}: not an OCR-only hold`;
  if (b.pipeline_auto?.status !== 'complete') return `status ${b.pipeline_auto?.status}: not complete`;
  const d = (b.pages_ocr || 0) - (b.pages_blank || 0);
  if (!(d > 0) || (b.pages_translated || 0) / d < 0.9) return `translated ${b.pages_translated}/${d} < 90%: gap-fill would re-translate`;
  return null;
}

async function runLoop() {
  const { MongoClient } = await import('mongodb');
  const client = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  const db = client.db('bookstore');
  const waveNo = () => fs.readdirSync(path.join(DIR, 'waves')).length;
  let stopWhy = null;
  log(`runner start: ${MODEL}, per-call ${PER_CALL}, wave ${WAVE_CALLS} calls, concurrency ${CONCURRENCY}${DRY ? ', DRY' : ''}`);
  for (;;) {
    if (fs.existsSync(F('STOP'))) { stopWhy = `STOP file (${fs.readFileSync(F('STOP'), 'utf8').trim()})`; break; }
    // pace: this login's week
    const m = await meter();
    if (!m) { log('meter unreadable: sleeping 20 min, no call'); await sleep(20 * 60e3); continue; }
    const used = pointsUsed();
    if (used >= CEILING_POINTS) { stopWhy = `ceiling: ${used} weekly points moved (${CEILING_POINTS} = 2.5 account-weeks)`; break; }
    if (m.weekly >= WEEKLY_STOP) {
      const until = new Date(m.weekly_reset).getTime() + 15 * 60e3;
      log(`weekly ${m.weekly}% >= ${WEEKLY_STOP}%: sleeping to the reset ${m.weekly_reset}`);
      await ntfy('zh-ditto-5274 sleeping to the weekly reset', `weekly ${m.weekly}% on ${m.email}; resumes after ${m.weekly_reset}. ${status(false)}`, 'low');
      while (Date.now() < until && !fs.existsSync(F('STOP'))) await sleep(Math.min(30 * 60e3, Math.max(60e3, until - Date.now())));
      continue;
    }
    const done = ledger();
    const wave = (await nextWave(db, done, WAVE_CALLS * PER_CALL));
    if (!wave.length) { stopWhy = null; log('frame exhausted'); break; }
    const wd = path.join(DIR, 'waves', String(waveNo()).padStart(4, '0'));
    fs.mkdirSync(wd, { recursive: true });
    fs.writeFileSync(path.join(wd, 'manifest.jsonl'), wave.map((p) => JSON.stringify(p)).join('\n') + '\n');
    log(`wave ${path.basename(wd)}: ${wave.length} pages, ${new Set(wave.map((p) => p.book_id)).size} books; weekly ${m.weekly}%, ${used} points used`);
    const code = await run('node', [`--env-file=${ENV}`, 'scripts/batch/ocr-convergence/correct.mjs', `--set-dir=${wd}`, `--model=${MODEL}`, `--per-call=${PER_CALL}`, `--concurrency=${CONCURRENCY}`, `--job=${STALE_LANE}`, '--language=Chinese', `--instruction-file=${path.join(HERE, 'ditto-instruction.txt')}`], path.join(wd, 'correct.log'));
    // what the reads say, page by page
    const metas = wave.map((p) => { try { return JSON.parse(fs.readFileSync(path.join(wd, 'reads', `${p.page_id}.meta.json`), 'utf8')); } catch { return null; } });
    const corrected = [], rows = [];
    wave.forEach((p, i) => {
      const mt = metas[i];
      if (!mt) return;   // not reached (a usage stop): taken again next wave
      if (mt.outcome === 'corrected') corrected.push(p.page_id);
      else rows.push({ page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, state: mt.outcome, reason: mt.reason ?? null, wave: path.basename(wd), at: new Date().toISOString() });
      if (mt.outcome === 'contain') append('contain.jsonl', [{ page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, reason: mt.reason, wave: path.basename(wd) }]);
    });
    // the gate again, on the books as they are now, before any write
    const ids = [...new Set(wave.filter((p) => corrected.includes(p.page_id)).map((p) => p.book_id))];
    const nowBooks = new Map((await db.collection('books').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, pages_ocr: 1, pages_blank: 1, pages_translated: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold.reason': 1 } }).toArray()).map((b) => [b.id, b]));
    const writeIds = [];
    for (const id of corrected) {
      const p = wave.find((q) => q.page_id === id); const why = bookGate(nowBooks.get(p.book_id));
      if (why) rows.push({ page_id: id, book_id: p.book_id, page_number: p.page_number, state: 'gate-at-apply', reason: why, wave: path.basename(wd), at: new Date().toISOString() });
      else writeIds.push(id);
    }
    if (writeIds.length) {
      fs.writeFileSync(path.join(wd, 'write-ids.json'), JSON.stringify(writeIds));
      const before = new Set(fs.readdirSync(path.join(wd, 'reads')).filter((f) => f.startsWith('apply-summary-')));
      await run('node', [`--env-file=${ENV}`, 'scripts/batch/cli-ocr.mjs', 'apply', `--out=${path.join(wd, 'reads')}`, `--only=${path.join(wd, 'write-ids.json')}`, `--lane=${LANE}`, `--mark-stale=${STALE_LANE}`, `--reason=${REASON}`, ...(DRY ? [] : ['--apply'])], path.join(wd, 'apply.log'));
      const sf = fs.readdirSync(path.join(wd, 'reads')).find((f) => f.startsWith('apply-summary-') && !before.has(f));
      const s = sf ? JSON.parse(fs.readFileSync(path.join(wd, 'reads', sf), 'utf8')) : null;
      const written = new Set(s?.written_page_ids || []);
      for (const id of writeIds) {
        const p = wave.find((q) => q.page_id === id);
        const state = DRY ? 'dry-would-write' : written.has(id) ? 'written' : s?.skipped_pages?.[id] ? 'apply-skipped' : 'apply-unknown';
        rows.push({ page_id: id, book_id: p.book_id, page_number: p.page_number, state, reason: s?.skipped_pages?.[id] ?? null, run: s?.run ?? null, wave: path.basename(wd), at: new Date().toISOString() });
      }
    }
    append('ledger.jsonl', rows);
    // disk: the wave's images and transcripts go; texts, metas and logs stay (they are small)
    for (const f of fs.existsSync(path.join(wd, 'reads')) ? fs.readdirSync(path.join(wd, 'reads')) : []) if (f.startsWith('ws-')) fs.rmSync(path.join(wd, 'reads', f), { recursive: true, force: true });
    fs.rmSync(path.join(wd, 'transcripts'), { recursive: true, force: true });
    log(`wave ${path.basename(wd)} done: ${JSON.stringify(Object.fromEntries(Object.entries(Object.groupBy(rows, (r) => r.state)).map(([k, v]) => [k, v.length])))}; correct.mjs exit ${code}`);
    if (DRY) { stopWhy = 'dry run: one wave'; break; }
    if (code === 3) { log('usage limit inside the wave: sleeping 30 min'); await sleep(30 * 60e3); }
  }
  await client.close();
  const s = status(false);
  if (stopWhy) { await ntfy('zh-ditto-5274 STOPPED', `${stopWhy}. ${s}`, 'high'); comment(`**zh-ditto-5274 runner stopped:** ${stopWhy}\n\n${status(true)}`); }
  else { await ntfy('zh-ditto-5274 done', s); comment(`**zh-ditto-5274 runner done** (frame exhausted)\n\n${status(true)}`); }
  fs.writeFileSync(F(stopWhy ? 'STOPPED' : 'DONE'), `${new Date().toISOString()} ${stopWhy ?? 'frame exhausted'}\n`);
}

/** Pages by state (the last ledger row per page), CONTAIN count, points used. */
export function status(md) {
  const l = ledger();
  const by = {}; for (const r of l.values()) by[r.state] = (by[r.state] || 0) + 1;
  const books = readJsonl(F('book-gate.jsonl'));
  const contain = readJsonl(F('contain.jsonl'));
  const last = readJsonl(F('meter.jsonl')).filter((r) => r.weekly != null).pop();
  const o = { pages: l.size, by_state: by, books_gated_out: books.length, pages_gated_out: books.reduce((a, b) => a + (b.zero_pages || 0), 0), contain: contain.length, weekly_points_used: pointsUsed(), weekly_now: last?.weekly ?? null, weekly_reset: last?.weekly_reset ?? null };
  if (!md) return JSON.stringify(o);
  return ['| state | pages |', '|---|---:|', ...Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`), '',
    `Books not taken by the translation gate: ${o.books_gated_out} (${o.pages_gated_out} pages). CONTAIN answers (not written): ${o.contain}, listed in \`${F('contain.jsonl')}\`.`,
    `Quota: ${o.weekly_points_used} weekly-percent points moved on this login (ceiling ${CEILING_POINTS}); now ${o.weekly_now}%, resets ${o.weekly_reset}.`,
    `Progress: \`node ${path.join(REPO, 'scripts/batch/zh-ditto-5274/runner.mjs')} status\` (ZD_DIR=${DIR}).`].join('\n');
}

if (STEP === 'run') await runLoop();
else if (STEP === 'status') console.log(process.argv.includes('--md') ? status(true) : JSON.stringify(JSON.parse(status(false)), null, 1));
else if (STEP) { console.error('usage: runner.mjs run|status'); process.exit(2); }
