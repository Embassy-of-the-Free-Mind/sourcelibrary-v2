#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate.mjs (the CLI translation writer: production prompt, provenance block, write door,
// sweep_log and book_events rows; this script keeps all of that). It does not fit as is: it reads a page list ONE call at a
// time with no checkpoint per write, no quota back-off (it stops) and, on main, without the #6523 sentinels and tool gate.
// The fixed runner with those (scripts/lib/agy-cli.mjs, PR #6578) is not merged; its call is taken here from the copy
// the #6567 gate measured (scripts/eval/stale-gate-6567/run-cli-arm.py + agy-tool-gate.py, which this script reuses).
// scripts/eval/stale-gate-6567/draw.mjs is the frame and the old-vs-new CER (#6518), re-derived here the same way.
/**
 * Retranslate the stale Siku English whose Paddle reading barely changed (#6567, Derek approved 2026-10-11).
 *
 * The rule (gate PR #6581): pages with `translation_stale.lane = paddle-zh-2026-10` and an old-vs-new CER < 0.1 are
 * retranslated from the CURRENT Paddle reading with Gemini 3.8 Flash through the subscription CLI (`agy -p`, $0) and the
 * production single-page prompt. Pages at CER >= 0.1 are left for the OCR fix (#6561). No diff-correct.
 *
 *   select  node --env-file=/root/sourcelibrary/.env.production.local scripts/batch/stale-retranslate-6567.mjs select --out=DIR
 *           The frame, the exclusions and their counts (DIR/census.json), and the eligible pages in book and page order
 *           (DIR/set.jsonl). Writes nothing to the database.
 *   pilot   ... pilot --out=DIR [--n=300]       DIR/pilot-ids.txt: one page per book, seeded, n books.
 *   run     ... run --out=DIR [--ids=FILE] [--parallel=2] [--limit=N] [--apply]
 *           Books are worked through in parallel (one worker per book, pages in order, so each page is seeded with the
 *           English just written for the page before, as the worker seeds). One `agy -p` call per page.
 *           Without --apply it reads and checkpoints but writes nothing.
 *
 * THE CALL: `agy -p <prompt> --model gemini-3.8-flash-low --mode plan --output-format json`, in an empty workspace with
 * the #6523 tool gate (scripts/eval/stale-gate-6567/agy-tool-gate.py: every tool denied with a reason), the prompt asking
 * for the translation between <<<BEGIN>>> / <<<END>>>. Exactly what the gate's RETRANSLATE arm sent. Up to 2 calls a page
 * when the reply is empty, cut or has text outside the markers; then the page is counted as a failure and not written.
 *
 * THE WRITE (per page, at once): the page is re-read live and must still be eligible (no human edit on either field, not
 * unreadable, not withheld, OCR byte-identical to what was sent). Then writePageTranslation (translate-core): the
 * page_revisions snapshot, the human-edit guard, the health / hidden-meta / reasoning-leak / stray-script refusals, the
 * provenance block (api 'cli', the CLI name and version, model, prompt id+version+hash and the hash of the prompt SENT,
 * run id), and `translation_stale` cleared. The chatter guard (cli-chatter.mjs) runs first. One sweep_log row per page,
 * one book_events row and a counter sync per book when its pages are done.
 *
 * WHAT IT DOES NOT DO: it never releases the books' `paddle-zh-*-ocr-only` pipeline hold. That hold is what keeps the
 * paid translate lanes, gap-fill and the OCR lanes off these books; this run writes pages directly instead. Books held for
 * any OTHER reason are excluded.
 *
 * WITHHELD MODE (#6561 item 2, Derek "yes" 2026-10-13): `select-withheld --out=DIR` then `run --withheld --out=DIR ...`.
 *   The pages job serve-6561 served (sweep_log sweep `serve-opus-correct-6561`: withheld Paddle table pages, now the
 *   Opus-corrected reading) whose English is still withheld (`translation_withheld`, no `translation.data`). Same call,
 *   prompt, guards and write door; a page qualifies only while its OCR is that served reading (job id
 *   /^serve-opus-correct-6561/), not unreadable, not human-edited, and its book's hold is the lane's own or
 *   `gpu-backlog-5660`. After the write, `translation_withheld` is unset (the old English stays in page_revisions).
 *   Own sweep (`retranslate-withheld-tables-6561`), note and reason. Book holds are never touched.
 *
 * CHECKPOINT: DIR/done.jsonl, one row per page with its outcome. A restart skips every page already there.
 * QUOTA: a 429 / RESOURCE_EXHAUSTED pauses every worker for --backoff minutes (default 20), then goes on; the call is
 * logged to /var/log/sourcelibrary/agy-calls.jsonl like every other. FAILURE: 12 failed pages in a row (not quota) stops
 * the run with exit 4: the CLI is broken, and nothing should fall back to a paid API.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { bodyText, foldHan, makeRng } from '../eval/ground-truth-5935/lib.mjs';
import { LANE } from '../lib/paddle-zh-lane.mjs';
import { paddleTableRisk } from '../lib/paddle-table-detect.mjs';
import { PAGE_BREAK_SCOPED, pageBreakVariant, buildTranslationPrompt, loadTranslationPrompts, isTranslatablePage, sameLanguageReason, writePageTranslation, syncBookTranslationCounters, contentHash } from '../lib/translate-core.mjs';
import { cliChatterReason } from '../lib/cli-chatter.mjs';
import { geminiEngine, translationInput, notRecorded, codeVersion, host } from '../lib/write-provenance.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const CALL_SITE = 'scripts/batch/stale-retranslate-6567.mjs';
const SWEEP = 'stale-retranslate-6567';
const ISSUE = 6567;
const CLI = 'agy';
const MODEL = 'gemini-3.8-flash-low';
const JOB = process.env.CLI_JOB_NAME || (process.argv.includes('--withheld') ? 'retranslate-withheld-tables-6561' : 'stale-retranslate-6567');
const CALL_LOG = '/var/log/sourcelibrary/agy-calls.jsonl';
const GATE = path.join(path.dirname(new URL(import.meta.url).pathname), '../eval/stale-gate-6567/agy-tool-gate.py');
const GATE_REASON = 'That tool is disabled here, and no tool or file is needed: the text to translate is in the prompt. Write the translation directly in your reply, between the markers, following the instructions exactly.';
const CER_MAX = 0.1, MIN_HAN = 8;
const OWN_HOLD = /^paddle-zh-\d+-ocr-only$/;   // the lane's own OCR-only hold: this run is the approval it waits for
const REASON = 'Stale Siku English (Paddle reading changed by CER < 0.1): retranslated from the current Paddle reading with 3.8 Flash via the CLI, production prompt (#6567 gate, PR #6581; Derek approved 2026-10-11)';

// What the gate's RETRANSLATE arm appended (scripts/eval/stale-gate-6567/gate.mjs): cli-translate.mjs's CLI suffix + the #6523 sentinels.
const CLI_SUFFIX = '\n\nOutput only the English translation in the format above. Do not open, read or write any file, do not use any tool, and add no preamble or commentary.'
  + '\n\nWrite the translation between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary.';

const STAGE = process.argv[2];
// #6561 item 2: the served table pages' withheld English (see WITHHELD MODE above).
const WITHHELD = STAGE === 'select-withheld' || process.argv.includes('--withheld');
const SERVED_SWEEP = 'serve-opus-correct-6561';
const SERVED_JOB = /^serve-opus-correct-6561/;
const WITHHELD_HOLD = /^(paddle-zh-\d+-ocr-only|gpu-backlog-5660)$/;
const W = WITHHELD ? {
  sweep: 'retranslate-withheld-tables-6561', issue: 6561, note: 'translate_cli_withheld_tables_6561', action: 'retranslated-withheld-through-cli',
  reason: 'Withheld English of a served Opus-corrected Paddle table page: translated from the served reading with 3.8 Flash via the CLI, production prompt, same guards as the #6567 run (#6561 item 2; Derek approved 2026-10-13)',
} : { sweep: SWEEP, issue: ISSUE, note: 'translate_cli_stale_6567', action: 'retranslated-stale-through-cli', reason: REASON };
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out') && path.resolve(arg('out'));
const APPLY = process.argv.includes('--apply');
if (!['select', 'select-withheld', 'pilot', 'run'].includes(STAGE) || !OUT) { console.error('usage: stale-retranslate-6567.mjs select|pilot|run --out=DIR ... (see the header)'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const HAN = /\p{Script=Han}/u;
const fold1 = (c) => { const f = foldHan(c); return [...f].length === 1 ? f : c; };
const hanFold = (t) => [...bodyText(t)].filter((c) => HAN.test(c)).map(fold1);
function lev(x, y) {
  if (!x.length) return y.length; if (!y.length) return x.length;
  let prev = new Int32Array(y.length + 1), cur = new Int32Array(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[y.length];
}
const humanEdited = (f) => !!f && (f.source === 'manual' || !!f.edited_by);
const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');
const STALE_Q = { 'translation_stale.reason': 'ocr_rewritten', 'translation_stale.lane': LANE };   // the reason field hits pages_translation_stale_partial

// Why a page is not (or no longer) eligible, or null. `book` carries pipeline_auto and title.
function ineligible(p, book) {
  if (WITHHELD) return ineligibleWithheld(p, book);
  if (p.translation_stale?.lane !== LANE) return 'no longer stale (retranslated or reset)';
  if (p.ocr?.unreadable === true) return 'ocr.unreadable (withheld, e.g. #6574 tables)';
  if (p.translation_withheld) return 'English withheld';
  if (humanEdited(p.translation)) return 'human-edited translation';
  if (humanEdited(p.ocr)) return 'human-edited OCR';
  const en = String(p.translation?.data || '').trim();
  if (!en || /^\s*\[[^\]]*\]\s*$/.test(en)) return 'no stored English';
  if (p.ocr?.source !== 'paddle') return 'OCR is not the Paddle reading';
  const hold = book?.pipeline_auto?.hold;
  if (hold && !OWN_HOLD.test(hold.reason || '')) return `book held: ${hold.reason}`;
  if (!book) return 'book not found';
  return null;
}

function ineligibleWithheld(p, book) {
  if (!p.translation_withheld) return 'English no longer withheld';
  if (String(p.translation?.data || '').trim()) return 'has English';
  if (p.ocr?.unreadable === true) return 'ocr.unreadable (still withheld)';
  if (humanEdited(p.translation)) return 'human-edited translation';
  if (humanEdited(p.ocr)) return 'human-edited OCR';
  if (!SERVED_JOB.test(p.ocr?.engine?.run?.job_id || '')) return 'OCR is not the served Opus-corrected reading';
  if (typeof p.ocr?.data !== 'string' || !p.ocr.data.trim()) return 'no OCR text';
  if (!book) return 'book not found';
  const hold = book.pipeline_auto?.hold;
  if (hold && !WITHHELD_HOLD.test(hold.reason || '')) return `book held: ${hold.reason}`;
  return null;
}

if (STAGE === 'select-withheld') {
  const served = await db.collection('sweep_log').distinct('detail.page_id', { sweep: SERVED_SWEEP });
  const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.unreadable': 1, 'ocr.source': 1, 'ocr.edited_by': 1, 'ocr.engine.run.job_id': 1, 'translation.data': 1, 'translation.source': 1, 'translation.edited_by': 1, translation_withheld: 1 };
  const pages = [];
  for (let i = 0; i < served.length; i += 500) pages.push(...await db.collection('pages').find({ id: { $in: served.slice(i, i + 500) }, translation_withheld: { $exists: true, $ne: null } }, { projection: PROJ }).toArray());
  const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(pages.map((p) => p.book_id))] } }, { projection: { _id: 0, id: 1, title: 1, pipeline_auto: 1 } }).toArray()).map((b) => [b.id, b]));
  const counts = { mode: 'withheld', served_pages: served.length, withheld_english: pages.length, excluded: {}, eligible: 0, holds: {} };
  const set = [];
  for (const p of pages) {
    const book = books.get(p.book_id);
    const h = book?.pipeline_auto?.hold?.reason || 'none'; counts.holds[h] = (counts.holds[h] || 0) + 1;
    const why = ineligibleWithheld(p, book);
    if (why) { counts.excluded[why] = (counts.excluded[why] || 0) + 1; continue; }
    counts.eligible++;
    set.push({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, cer: null });
  }
  set.sort((a, b) => (a.book_id < b.book_id ? -1 : a.book_id > b.book_id ? 1 : a.page_number - b.page_number));
  counts.books = new Set(set.map((s) => s.book_id)).size;
  fs.writeFileSync(path.join(OUT, 'set.jsonl'), set.map((s) => JSON.stringify(s)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'census.json'), JSON.stringify({ computed_at: new Date().toISOString(), served_sweep: SERVED_SWEEP, ...counts }, null, 1) + '\n');
  console.log(JSON.stringify(counts, null, 1));
  await client.close();
  process.exit(0);
}

if (STAGE === 'select') {
  const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.unreadable': 1, 'ocr.edited_by': 1, 'translation.data': 1, 'translation.source': 1, 'translation.edited_by': 1, translation_stale: 1, translation_withheld: 1 };
  const pages = await db.collection('pages').find(STALE_Q, { projection: { ...PROJ, 'ocr.source': 1 } }).toArray();
  console.log('stale pages (lane)', pages.length);
  const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(pages.map((p) => p.book_id))] } }, { projection: { _id: 0, id: 1, title: 1, pipeline_auto: 1 } }).toArray()).map((b) => [b.id, b]));
  const revs = new Map();
  for (let i = 0; i < pages.length; i += 500) {
    const ids = pages.slice(i, i + 500).map((p) => p.id);
    const rows = await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr', reason: /^reocr_paddle_zh_/ }, { projection: { _id: 0, page_id: 1, data: 1, created_at: 1 } }).toArray();
    for (const r of rows) { const q = revs.get(r.page_id); if (!q || r.created_at > q.created_at) revs.set(r.page_id, r); }
  }
  const counts = { stale_pages: pages.length, excluded: {}, cer_ge_0_1: 0, eligible: 0, eligible_by_bin: { '0–0.05': 0, '0.05–0.1': 0 } };
  const ex = (why) => { counts.excluded[why] = (counts.excluded[why] || 0) + 1; };
  const holds = {};
  const set = [];
  for (const p of pages) {
    const book = books.get(p.book_id);
    const h = book?.pipeline_auto?.hold?.reason || 'none'; holds[h] = (holds[h] || 0) + 1;
    const why = ineligible(p, book);
    if (why) { ex(why); continue; }
    const rev = revs.get(p.id);
    if (!rev) { ex('no lane revision (old reading)'); continue; }
    const o = hanFold(rev.data), nw = hanFold(p.ocr.data);
    if (nw.length < MIN_HAN) { ex(`under ${MIN_HAN} Han characters`); continue; }
    const cer = Math.min(1, lev(o, nw) / Math.max(1, nw.length));
    if (cer >= CER_MAX) { counts.cer_ge_0_1++; continue; }
    if (paddleTableRisk(p.ocr.data, { title: book.title || '' }).flag) { ex('table detector (#6516)'); continue; }
    counts.eligible++; counts.eligible_by_bin[cer < 0.05 ? '0–0.05' : '0.05–0.1']++;
    set.push({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, cer: +cer.toFixed(4) });
  }
  set.sort((a, b) => (a.book_id < b.book_id ? -1 : a.book_id > b.book_id ? 1 : a.page_number - b.page_number));
  counts.books = new Set(set.map((s) => s.book_id)).size;
  counts.page_holds_by_reason = holds;
  fs.writeFileSync(path.join(OUT, 'set.jsonl'), set.map((s) => JSON.stringify(s)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'census.json'), JSON.stringify({ computed_at: new Date().toISOString(), lane: LANE, cer_max: CER_MAX, ...counts }, null, 1) + '\n');
  console.log(JSON.stringify(counts, null, 1));
  await client.close();
  process.exit(0);
}

if (STAGE === 'pilot') {
  const n = Number(arg('n') || 300);
  const set = readJsonl(path.join(OUT, 'set.jsonl'));
  const byBook = new Map();
  for (const s of set) (byBook.get(s.book_id) || byBook.set(s.book_id, []).get(s.book_id)).push(s);
  const rng = makeRng(ISSUE);
  const bookIds = [...byBook.keys()].sort();
  for (let i = bookIds.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [bookIds[i], bookIds[j]] = [bookIds[j], bookIds[i]]; }
  const pick = bookIds.slice(0, n).map((b) => { const xs = byBook.get(b); return xs[Math.floor(rng() * xs.length)]; });
  // "one per book where possible": with fewer books than n, the rest are further random pages
  const taken = new Set(pick.map((p) => p.page_id));
  const rest = set.filter((s) => !taken.has(s.page_id));
  while (pick.length < n && rest.length) pick.push(rest.splice(Math.floor(rng() * rest.length), 1)[0]);
  fs.writeFileSync(path.join(OUT, 'pilot-ids.txt'), pick.map((p) => p.page_id).join('\n') + '\n');
  console.log(`pilot: ${pick.length} pages in ${new Set(pick.map((p) => p.book_id)).size} books (of ${byBook.size} books, ${set.length} pages)`);
  await client.close();
  process.exit(0);
}

// ── run ──
const PARALLEL = Number(arg('parallel') || 2);
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity;
const BACKOFF_MIN = Number(arg('backoff') || 20);
const DONE = path.join(OUT, 'done.jsonl');
{ let mode = null; try { mode = JSON.parse(fs.readFileSync(path.join(OUT, 'census.json'), 'utf8')).mode || null; } catch { /* no census */ }
  if ((mode === 'withheld') !== WITHHELD) { console.error(`${OUT} was selected ${mode === 'withheld' ? 'with select-withheld: run it with --withheld' : 'by select: run it without --withheld'}`); process.exit(2); } }
const RAW = path.join(OUT, 'raw'); fs.mkdirSync(RAW, { recursive: true });
const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout?.trim();
if (!version) { console.error(`${CLI} is not installed or not on PATH`); process.exit(1); }
if (!fs.existsSync(GATE)) { console.error(`tool gate missing: ${GATE}`); process.exit(1); }
const prompts = await loadTranslationPrompts(db);
const runId = arg('run-id') || `${W.sweep}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
const codeVer = await codeVersion();
const done = new Set(readJsonl(DONE).map((r) => r.page_id));
let set = readJsonl(path.join(OUT, 'set.jsonl'));
if (arg('ids')) { const want = new Set(fs.readFileSync(arg('ids'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)); set = set.filter((s) => want.has(s.page_id)); }
const todo = set.filter((s) => !done.has(s.page_id)).slice(0, LIMIT);
const queue = [];
for (const s of todo) { const last = queue[queue.length - 1]; if (last && last.book_id === s.book_id) last.pages.push(s); else queue.push({ book_id: s.book_id, pages: [s] }); }
console.log(`run ${runId}: ${set.length} pages in the set, ${done.size} already done, ${todo.length} to do in ${queue.length} books; ${PARALLEL} in flight; ${APPLY ? 'WRITING' : 'dry run (reads only)'}; ${CLI} ${version}`);

const logCall = (rec) => { try { fs.appendFileSync(CALL_LOG, JSON.stringify({ ts: new Date().toISOString(), job: JOB, model: MODEL, kind: 'translate', ...rec }) + '\n'); } catch { /* the box has the log dir */ } };
const record = (row) => fs.appendFileSync(DONE, JSON.stringify({ at: new Date().toISOString(), run: runId, ...row }) + '\n');
const tally = { written: 0, would_write: 0, skipped: {}, failed: {}, calls: 0, quota_pauses: 0 };
let failStreak = 0, pausedUntil = 0, halted = null;

function agyCall(prompt) {
  return new Promise((resolve) => {
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'agy-sr-'));
    fs.mkdirSync(path.join(ws, '.agents'), { recursive: true });
    const glog = path.join(ws, '.agents', 'gate.jsonl');
    fs.writeFileSync(path.join(ws, '.agents', 'hooks.json'), JSON.stringify({ 'translate-tool-gate': { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', timeout: 10, command: `AGY_GATE_REASON='${GATE_REASON.replace(/'/g, '')}' AGY_GATE_ROOT='${ws}' AGY_GATE_LOG='${glog}' python3 '${GATE}'` }] }] } }));
    const t0 = Date.now();
    const child = spawn(CLI, ['-p', prompt, '--model', MODEL, '--mode', 'plan', '--print-timeout', '180s', '--output-format', 'json'], { cwd: ws, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 240_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {}; try { j = JSON.parse(out); } catch { /* not JSON: an error */ }
      const text = String(j?.response ?? '').trim();
      let tools = []; try { tools = fs.readFileSync(glog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => r.tool + (r.decision === 'allow' ? '' : ':deny')); } catch { /* none */ }
      fs.rmSync(ws, { recursive: true, force: true });
      const blob = out + err;
      const cls = /RESOURCE_EXHAUSTED|quota reached|quota exceeded|exhausted your|\b429\b/i.test(blob) && text.length < 200 ? 'quota'
        : code === null ? 'killed' : /print timeout/i.test(blob) ? 'timeout' : code !== 0 ? `exit_${code}` : !text ? 'empty' : null;
      resolve({ text, cls, code, secs: (Date.now() - t0) / 1000, tools, err: err.slice(-300) });
    });
  });
}

// Strict: the reply must be exactly <<<BEGIN>>> … <<<END>>>, nothing outside but whitespace.
function unwrap(raw) {
  const s = String(raw || ''); const a = s.indexOf('<<<BEGIN>>>'), b = s.lastIndexOf('<<<END>>>');
  if (a < 0) return { problem: 'no <<<BEGIN>>> marker' };
  if (b < a) return { problem: 'reply cut before <<<END>>>' };
  if ((s.slice(0, a) + s.slice(b + 9)).trim()) return { problem: 'text outside the markers' };
  return { text: s.slice(a + 11, b).trim() };
}

const PAGE_PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1, translation_stale: 1, translation_withheld: 1 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function onePage(s, book) {
  const p = await db.collection('pages').findOne({ id: s.page_id }, { projection: PAGE_PROJ });
  const why = p ? ineligible(p, book) : 'page not found';
  if (why) return { outcome: 'skipped', why };
  const tr = isTranslatablePage(p);
  if (!tr.ok) return { outcome: 'skipped', why: `not translatable: ${tr.reason}` };
  const same = sameLanguageReason({ book, page: p });
  if (same) return { outcome: 'skipped', why: same };
  const near = await db.collection('pages').find({ book_id: p.book_id, page_number: { $in: [p.page_number - 1, p.page_number + 1] } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.engine.run.job_id': 1 } }).toArray();
  const prev = near.find((n) => n.page_number === p.page_number - 1), next = near.find((n) => n.page_number === p.page_number + 1);
  // Seeded with the page before, as the worker seeds; when that page was retranslated by this sweep, it is the new English.
  const built = buildTranslationPrompt({ prompts, book, ocrText: p.ocr.data, previousTranslation: prev?.translation?.data || null, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED });
  const sent = built.prompt + CLI_SUFFIX;
  const ocrHash = contentHash(p.ocr.data);
  let r, u, calls = 0;
  const t0 = new Date();
  while (calls < 2) {
    while (Date.now() < pausedUntil) await sleep(15_000);
    if (halted) return { outcome: 'halted' };
    r = await agyCall(sent); calls++; tally.calls++;
    logCall({ seconds: Math.round(r.secs), ok: !r.cls, error_class: r.cls });
    if (r.cls === 'quota') {
      if (Date.now() >= pausedUntil) { pausedUntil = Date.now() + BACKOFF_MIN * 60_000; tally.quota_pauses++; console.log(`QUOTA at ${new Date().toISOString()}: pausing all workers ${BACKOFF_MIN} min`); }
      calls--; continue;   // a quota answer is not an attempt at the page
    }
    u = r.cls ? { problem: r.cls } : unwrap(r.text);
    if (!u.problem) break;
  }
  fs.writeFileSync(path.join(RAW, `${s.page_id}.txt`), r.text || '');
  const meta = { calls, secs: Math.round(r.secs), tools: r.tools, prev_from: prev?.translation?.engine?.run?.job_id?.startsWith(W.sweep) ? 'this-sweep' : prev?.translation?.data ? 'stored' : null, prompt: `${built.promptRef?.name} v${built.promptRef?.version}`, prompt_hash: built.promptRef?.content_hash, sent_hash: contentHash(sent) };
  if (u.problem) return { outcome: 'failed', why: u.problem, ...meta, err: r.err };
  const chatter = cliChatterReason(u.text);
  if (chatter) return { outcome: 'failed', why: `not a translation: ${chatter}`, ...meta };
  // The page again, live, right before the write: a reading that changed while the model ran is never written over.
  const now = await db.collection('pages').findOne({ id: s.page_id }, { projection: PAGE_PROJ });
  const why2 = now ? ineligible(now, book) : 'page not found';
  if (why2) return { outcome: 'skipped', why: `at write: ${why2}`, ...meta };
  if (contentHash(now.ocr?.data || '') !== ocrHash) return { outcome: 'skipped', why: 'OCR changed during the call', ...meta };
  if (!APPLY) return { outcome: 'would_write', chars: u.text.length, ...meta };
  const engine = geminiEngine({
    call_site: CALL_SITE, api: 'cli', cli: { name: CLI, version }, model: MODEL,
    prompt: { id: built.promptRef?.id, name: built.promptRef?.name, version: built.promptRef?.version, hash: built.promptRef?.content_hash, sent_hash: contentHash(sent), sent_chars: sent.length },
    generationConfig: notRecorded(`${CLI} -p exposes no temperature, output cap or thinking setting; the model id names the tier`),
    run: { job_id: runId, code_version: codeVer, host: host(), at: new Date(), read_started_at: t0.toISOString(), reason: W.reason },
    input: translationInput({ ocrText: now.ocr.data, ocrUpdatedAt: now.ocr.updated_at, context: { previous_translation: !!prev?.translation?.data, previous_from: meta.prev_from, prev_ocr: !!prev?.ocr?.data, next_ocr: !!next?.ocr?.data, page_break: pageBreakVariant(PAGE_BREAK_SCOPED), sentinels: true, tool_gate: true } }),
  });
  const res = await writePageTranslation(db, { page: now, book, text: u.text, promptRef: built.promptRef, model: MODEL, jobId: runId, note: W.note, refuseUnhealthy: true, engine });
  if (res.protected) return { outcome: 'skipped', why: 'human-edited translation (door)', ...meta };
  if (res.unhealthy) return { outcome: 'refused', why: `door: ${res.reason}`, ...meta };
  if (WITHHELD) {
    // The English is back: the withheld marker goes (its old text stays in page_revisions). Only on this run's write.
    const u2 = await db.collection('pages').updateOne({ id: s.page_id, 'translation.engine.run.job_id': runId, 'translation.data': { $type: 'string', $ne: '' } }, { $unset: { translation_withheld: '' } });
    if (!u2.modifiedCount) return { outcome: 'written', why: 'translation_withheld NOT unset (page changed after the write)', chars: res.text.length, from_model: null, ...meta };
    return { outcome: 'written', chars: res.text.length, from_model: null, was_withheld: { reason: now.translation_withheld?.reason ?? null, model: now.translation_withheld?.model ?? null, withheld_at: now.translation_withheld?.withheld_at ?? null }, ...meta };
  }
  return { outcome: 'written', chars: res.text.length, from_model: p.translation?.model ?? null, ...meta };
}

async function oneBook(job) {
  const book = await db.collection('books').findOne({ id: job.book_id }, { projection: { _id: 0 } });
  const written = [], sweepRows = [];
  for (const s of job.pages) {
    if (halted) break;
    let res;
    try { res = await onePage(s, book); } catch (e) { res = { outcome: 'failed', why: `error: ${String(e?.message || e).slice(0, 200)}` }; }
    if (res.outcome === 'halted') break;
    record({ page_id: s.page_id, book_id: s.book_id, page_number: s.page_number, cer: s.cer, ...res });
    if (res.outcome === 'written') {
      tally.written++; failStreak = 0; written.push(s.page_number);
      sweepRows.push({ sweep: W.sweep, book_id: s.book_id, action: W.action, detail: { page_id: s.page_id, page_number: s.page_number, cer: s.cer, from_model: res.from_model, ...(res.was_withheld ? { was_withheld: res.was_withheld } : {}), to_model: MODEL, cli: `${CLI} ${version}`, run: runId, issue: W.issue } });
    } else if (res.outcome === 'would_write') { tally.would_write++; failStreak = 0; }
    else if (res.outcome === 'failed') {
      tally.failed[res.why] = (tally.failed[res.why] || 0) + 1;
      if (++failStreak >= 12) { halted = `12 failed pages in a row (last: ${res.why})`; }
    } else { const k = `${res.outcome}: ${res.why}`; tally.skipped[k] = (tally.skipped[k] || 0) + 1; }
    const n = tally.written + tally.would_write;
    if (n && n % 50 === 0 && res.outcome !== 'skipped') console.log(`${new Date().toISOString()} ${n} ${APPLY ? 'written' : 'read'}, failed ${JSON.stringify(tally.failed)}, calls ${tally.calls}, quota pauses ${tally.quota_pauses}`);
  }
  if (APPLY && written.length) {
    await recordSweepActions(db, sweepRows);
    await syncBookTranslationCounters(db, job.book_id);
    await db.collection('book_events').insertOne({ book_id: job.book_id, type: 'translated_cli', at: new Date(), source: CALL_SITE, details: { run: runId, api: 'cli', models: [MODEL], pages: written.length, page_numbers: written.sort((a, b) => a - b), reason: W.reason, issue: W.issue } });
  }
}

let next = 0;
await Promise.all(Array.from({ length: PARALLEL }, async () => { while (!halted && next < queue.length) await oneBook(queue[next++]); }));
console.log(`\n${halted ? `HALTED: ${halted}\n` : ''}${APPLY ? 'written' : 'would write'}: ${APPLY ? tally.written : tally.would_write}   failed: ${JSON.stringify(tally.failed)}   skipped: ${JSON.stringify(tally.skipped)}   calls ${tally.calls}   quota pauses ${tally.quota_pauses}   run ${runId}`);
await client.close();
process.exit(halted ? 4 : 0);
