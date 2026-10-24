#!/usr/bin/env node
// PRIOR ART: scripts/batch/claude-translate.mjs (read) and scripts/batch/cli-translate.mjs (apply) do the work; this
// only queues the frame book by book across a few workers and stops at each rolling-audit boundary. The pilot driver
// (read-loop.sh) is used for each book's read.
/**
 * run.mjs — stage 2 of job opus-tib-sa-6948 (#6948): translate the frame with Opus (subscription) and write it.
 *
 *   split   Writes $JOB_SCRATCH/frame-part1.json and frame-part2.json: the Tibetan frame minus the pilot pages, books in
 *           ascending order of frame pages (the most books brought to readable per page), dealt alternately to the
 *           two parts so both start on the short books. Sanskrit is all in part 1. [{lang, book_id, pages:[ids]}]
 *           Part 2 is for a second job on another account (the dispatcher's cloudlayer note); this job never reads it.
 *   run     --part=1 --lang=sa|bo --per-call=N [--workers=3] [--round-every=2000]
 *           Per book: re-reads which frame pages still have no English and whose book is not held by another lane,
 *           reads them (read-loop.sh: the job's usage caps, waits on the meter), then applies them through
 *           cli-translate.mjs apply --apply. Counts pages written in $JOB_SCRATCH/run/state.json. When the count reaches
 *           the next round boundary, no new book starts; the workers finish theirs and the run exits 10 ("round due").
 *           The round (audit.mjs + by eye) is run outside, and `round-done` moves the boundary on.
 *   round-done --written-since=N   Moves state.next_round on by --round-every after a passed round.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readJsonl, byBook } from './sample.mjs';

const S = process.env.JOB_SCRATCH;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const CMD = process.argv[2];
const STATE = `${S}/run/state.json`;
const HOLD_OK = new Set(['tibetan-retranslation-awaits-derek', 'specialist-ocr-lane-4523', 'tibetan-unverified-gemini-ocr-4523', 'gpu-backlog-5660']);
const REASON = {
  bo: '#6948 Opus lane: Yigdzin-transcribed Tibetan page with no English; stage-1 gate passed (blind image-grounded audit + by eye), rolling audit every 2,000 pages',
  sa: '#6948 Opus lane: Sanskrit page with OCR and no English; stage-1 gate passed (blind image-grounded audit incl. OCR leaf check + by eye), rolling audit every 2,000 pages',
};
const loadState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { written: 0, next_round: 2000, books_done: {}, rounds: 0 });
const saveState = (s) => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(`${STATE}.tmp`, JSON.stringify(s, null, 1)); fs.renameSync(`${STATE}.tmp`, STATE); };

if (CMD === 'split') {
  const pilot = new Set(JSON.parse(fs.readFileSync(`${S}/pilot.json`, 'utf8')).pilot.flatMap((b) => b.pages.map((p) => p.id)));
  const part = { 1: [], 2: [] };
  for (const lang of ['sa', 'bo']) {
    const books = [...byBook(readJsonl(`${S}/frame-${lang}.jsonl`))].map(([book_id, ps]) => ({ lang, book_id, title: ps[0].title, pages: ps.filter((p) => !pilot.has(p.page_id)).map((p) => p.page_id) })).filter((b) => b.pages.length);
    books.sort((a, b) => a.pages.length - b.pages.length || a.book_id.localeCompare(b.book_id));
    books.forEach((b, i) => part[lang === 'sa' || i % 2 === 0 ? 1 : 2].push(b));
  }
  for (const k of [1, 2]) fs.writeFileSync(`${S}/frame-part${k}.json`, JSON.stringify(part[k]));
  const n = (k, l) => part[k].filter((b) => b.lang === l);
  console.log(JSON.stringify(Object.fromEntries([1, 2].map((k) => [`part${k}`, Object.fromEntries(['sa', 'bo'].map((l) => [l, { books: n(k, l).length, pages: n(k, l).reduce((s, b) => s + b.pages.length, 0) }]))]))));
}

const sh = (cmd, args, log) => new Promise((resolve) => {
  const out = fs.openSync(log, 'a');
  const c = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', out, out] });
  c.on('close', (code) => { fs.closeSync(out); resolve(code); });
});

if (CMD === 'run') {
  const PART = arg('part', '1'), LANG = arg('lang'), PC = arg('per-call'), WORKERS = Number(arg('workers', 3)), EVERY = Number(arg('round-every', 2000));
  if (!LANG || !PC) { console.error('run needs --lang and --per-call'); process.exit(2); }
  const queue = JSON.parse(fs.readFileSync(`${S}/frame-part${PART}.json`, 'utf8')).filter((b) => b.lang === LANG);
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  let state = loadState();
  let stopping = false, exitCode = 0;
  const logDir = `${S}/run/logs`; fs.mkdirSync(logDir, { recursive: true });
  const next = () => { while (queue.length) { const b = queue.shift(); if (!state.books_done[b.book_id]) return b; } return null; };
  const worker = async (w) => {
    for (let b = next(); b && !stopping; b = next()) {
      state = loadState();
      if (state.written >= state.next_round) { stopping = true; exitCode = 10; queue.unshift(b); break; }
      const book = await db.collection('books').findOne({ id: b.book_id }, { projection: { visible: 1, pages_count: 1, 'pipeline_auto.hold.reason': 1 } });
      const hold = book?.pipeline_auto?.hold?.reason;
      if (!book?.visible || !(book.pages_count > 0) || (hold && !(LANG === 'bo' && HOLD_OK.has(hold)))) { console.log(`[w${w}] ${b.book_id} skipped: ${!book?.visible ? 'not live' : `held ${hold}`}`); state = loadState(); state.books_done[b.book_id] = { skipped: hold || 'not live', at: new Date().toISOString() }; saveState(state); continue; }
      const still = (await db.collection('pages').find({ id: { $in: b.pages }, $or: [{ 'translation.data': { $exists: false } }, { 'translation.data': '' }, { 'translation.data': null }] }, { projection: { id: 1, page_number: 1 } }).toArray()).sort((x, y) => x.page_number - y.page_number).map((p) => p.id);
      const dir = `${S}/run/${LANG}/${b.book_id}`; fs.mkdirSync(dir, { recursive: true });
      const log = `${logDir}/${b.book_id}.log`;
      if (still.length) {
        fs.writeFileSync(`${dir}.ids.json`, JSON.stringify(still));
        const chk = LANG === 'bo' ? undefined : 'Sanskrit OCR leaf-audited in #6948 stage 1 (blind Opus with the image, OCR spans counted per page); gate passed';
        const rc = await sh(`${ROOT}/scripts/eval/opus-tib-sa-6948/read-loop.sh`, [`${dir}.ids.json`, dir, PC, `opus-6948-${LANG}`, ...(chk ? [chk] : [])], log);
        if (rc !== 0) { console.log(`[w${w}] ${b.book_id} read exited ${rc}; stopping`); stopping = true; exitCode = rc === 4 ? 4 : 5; break; }
      }
      const rc2 = await sh('node', [`--env-file=${ROOT}/.env.production.local`, 'scripts/batch/cli-translate.mjs', 'apply', `--out=${dir}`, `--reason=${REASON[LANG]}`, '--apply'], log);
      const tail = fs.readFileSync(log, 'utf8').split('\n').reverse().find((l) => /^written: \d+/.test(l)) || '';
      const written = Number(/^written: (\d+)/.exec(tail)?.[1] || 0);
      state = loadState();
      state.written += written;
      state.books_done[b.book_id] = { lang: LANG, frame_pages: b.pages.length, read: still.length, written, apply_rc: rc2, line: tail.trim(), at: new Date().toISOString() };
      saveState(state);
      fs.appendFileSync(`${S}/run/written.jsonl`, JSON.stringify({ at: new Date().toISOString(), lang: LANG, book_id: b.book_id, title: b.title, written, total: state.written }) + '\n');
      console.log(`[w${w}] ${b.book_id} ${b.title?.slice(0, 40)}: read ${still.length}, written ${written} (total ${state.written}, next round at ${state.next_round})`);
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i + 1)));
  await c.close();
  state = loadState();
  if (!exitCode && state.written >= state.next_round) exitCode = 10;
  console.log(`run ${LANG}: exit ${exitCode} (${exitCode === 10 ? 'round due' : exitCode === 0 ? 'queue done' : 'stopped'}); written ${state.written}`);
  process.exit(exitCode);
}

if (CMD === 'round-done') {
  const s = loadState();
  s.rounds += 1; s.next_round = s.written + Number(arg('round-every', 2000)); s.last_round_at = new Date().toISOString();
  saveState(s);
  console.log(JSON.stringify({ rounds: s.rounds, written: s.written, next_round: s.next_round }));
}
