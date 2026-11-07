#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/retranslate-withheld-5021.mjs (#8012) — the same readers and writer, one page a call,
// but it reads a fixed containment file, sends a Batch-routed book nowhere (listed `paid`), stops a book at the
// OCR-first gate, and has no resumable runner or pool choice; this file is its successor for the whole #5021 queue
// (withheld AND flagged-still-served pages). scripts/batch/cli-translate-lane.mjs `stale` — the pool floor and the
// readers' argv shape are its; it takes only stale pages of books one row serves, and its agy row reads 4 a call.
// scripts/batch/cli-ocr-lane.mjs (rereadReadArgs / rereadApplyArgs, REREAD_LANE) — the OCR-first step is its re-read,
// one page a call, stamped with its lane so the Latin re-read never takes the page again.
// scripts/audit/leaf-shift-confirm-5021.mjs — the gate judge reuses its image fetch and sealed `claude -p` call.
/**
 * wrong-leaf-fix-5021 — put each page's OWN English back on the pages #5021 found serving another leaf's English.
 * One page per call, always (Derek 2026-11-03: "I want you to fix them").
 *
 *   node --env-file=.env.production.local scripts/maintenance/wrong-leaf-fix-5021.mjs build --out=DIR
 *   … gate-pick --out=DIR [--n=30] [--seed=50213]
 *   … run --out=DIR --frame=gate|all [--apply-ocr] [--apply] [--concurrency=6] [--max-books=N] [--weekly-end=0.35]
 *        [--release] [--notify]   (bulk: release the holds it can and page ntfy + comment on #5021 at the end)
 *   … judge --out=DIR [--concurrency=4]              (gate: blind Opus, scans of n-1, n, n+1, stored vs new English)
 *   … gate-verdict --out=DIR
 *   … release --out=DIR [--apply]
 *   … status --out=DIR
 *
 * build      The queue, from Mongo and the #5021 result files, never from counts in a brief:
 *            - withheld: every page withheld by-eye under issue 5021 (sweep_log withhold-by-eye, detail.issue 5021)
 *              that is withheld now, plus the pages named on #5021/#5274 (農政全書 p.489-492, 皇極經世書 p.63);
 *            - flagged: the Flash-Lite screen's shift flags (next/prev/none, top arm) in shift-screen-5021
 *              screen-answers.jsonl.gz, and every Opus next/prev/mixed verdict in the #5021 verdict files.
 *            Left out: a human-edited translation (never touched), a page whose English was rewritten after the
 *            screen (2026-11-03T12:00Z, "re-translated since the flag"), a page withheld for another reason.
 *            Each page gets a ROUTE: the book's translation row (translateLaneForBook). A cli row keeps its reader
 *            (agy gemini-3.8-flash-low, or Opus through `claude -p` for Pali) but one page a call. A Batch row
 *            (gemini-3-flash-preview: BPH, Tibetan, flash-measured; gemini-3.1-flash-lite: the default) is read by
 *            agy gemini-3.8-flash-low instead — the substitution the OCR side makes for 3 Flash (#7089) — which is
 *            this job's cell test (gate below); no paid API is called by this file.
 *            OCR FIRST: a page whose OCR is an unchecked Flash-Lite draft (ocr-first-gate uncheckedLite) is re-read
 *            first by the routed re-read (agy gemini-3.8-flash-low, the live first-read prompt, cli-ocr.mjs with
 *            --lane=agy-reread-lite-7853 and every apply guard, --print-only), ONE page a call, and translated only if
 *            that read was written. A page the re-read leaves (handwritten, under the 40% shared-words floor …) keeps
 *            its English and is reported as `ocr-refused`.
 *            Order: books readers open first (human_read_count), then books with withheld pages, then the most pages.
 * gate-pick  30 flagged, still-served pages, one per book, every route class (row × OCR-first) at least once,
 *            the rest in proportion; seeded.
 * run        Per book, in queue order, N books at once: OCR re-read (written only with --apply-ocr), then the
 *            translation read (cli-translate.mjs with folio pairs OFF, or claude-translate.mjs --per-call=1), then
 *            cli-translate.mjs apply (with --apply): translate-core's door snapshots the old English to page_revisions,
 *            refuses a human-edited translation, clears translation_stale; a withheld page it wrote has its
 *            translation_withheld marker unset (the old English stays in page_revisions). Undo: revert-run.mjs.
 *            Every page lands in DIR/ledger.jsonl with its state; a re-run skips pages with a final state.
 *            POOL: before each book, the agy login with the most Gemini weekly left whose floor is open: weekly over
 *            max(--weekly-end, the other lanes' reserves, agy-pools.mjs weeklyReserve) and the 5-hour bucket over 0.25.
 *            --weekly-end defaults to 0.35, so the Latin re-read keeps first claim on what is under it (#7263). No pool
 *            open → the run sleeps to the earliest reset it read, and reads /quota again only then.
 *            Progress: DIR/progress.json after every book. At the end of a --frame=all run it pages ntfy
 *            (sourcelibrary-uptime) and comments the counts on #5021.
 * judge      The gate: per gate page one sealed `claude -p --model opus` call with the scans and transcriptions of
 *            n-1, n, n+1 and two Englishes for page n in a seeded random order (the stored one and the new read),
 *            not told which is which: for each, which leaf it renders and its defects against THAT leaf.
 * gate-verdict  PASS when the new English is own-leaf on ≥ 27 of 30 and its severity-weighted defects (major 3,
 *            minor 1) are no more than the stored English's.
 * release    A book held `leaf-shift-5021` is released (releaseBook, only that reason) when no page of it is withheld
 *            for any reason and none of its queued pages is left un-fixed.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { translateLaneForBook } from '../lib/translate-core.mjs';
import { uncheckedLite } from '../lib/ocr-first-gate.mjs';
import { readPools, agyEnv, poolName, weeklyReserve } from '../lib/agy-pools.mjs';
import { releaseBook } from '../lib/pipeline-hold.mjs';
import { claudeBlocked } from '../lib/model-limits.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
// --issue=5274 (near-blank-fix-5274, Derek 2026-11-04 "fix those too"): the same runner on the near-blank Chinese
// leaves the #5274 screen found carrying invented English (a captioned woodcut given the entry the model expected).
// Its queue, gate pick, judge and hold differ; the readers, the writer, the pools and the ledger are this file's.
const PROFILE = String(process.argv.find((a) => a.startsWith('--issue='))?.split('=')[1] ?? '5021');
// --issue=5274cb (context-bleed-find-fix-5274, Derek 2026-11-04 "find it and fix/redo"): the library-wide screen's
// pages (a nearly empty leaf carrying a neighbour's English, scripts/eval/context-bleed-5274/) and the #5274 near-blank
// list, queued with `enqueue --from=` and read --own-leaf: the page's own transcription only, no previous page's English,
// no neighbour OCR (the continuity English is what the Feb–Mar lanes' model translated on these leaves), caption leaves
// let past the no-body floor, and the caption line on leaves whose source is nearly empty. Judged by
// scripts/eval/context-bleed-5274/judge.mjs (blind, scans of n-1, n, n+1). It shares 5274's withheld markers; no hold.
const P5274CB = PROFILE === '5274cb';
const P5274 = PROFILE === '5274' || P5274CB;
const ISSUE = P5274 ? 5274 : 5021;
const HOLD_REASON = P5274CB ? null : P5274 ? 'near-blank-invented-5274' : 'leaf-shift-5021';
const NB_DIR = path.join(ROOT, 'scripts/eval/results/zh-near-blank-screen-5274');
// The one prompt line the 5274 gate may add (--prompt-line), appended to each page's prompt via --instructions-file.
const NB_PROMPT_LINE = 'This leaf may carry only a title, a caption or a few labels beside a picture. In the translation, the notes, the summary and the keywords alike, say only what is printed on this leaf or plainly visible in its picture: translate the printed words, describe the picture if there is one, and add no entry text, use, date, dynasty, source work, author or background that the leaf itself does not give.';
const REREAD_LANE = 'agy-reread-lite-7853';
const AGY_MODEL = 'gemini-3.8-flash-low';
const FLAG_CUTOFF = '2026-11-03T12:00:00Z';
const SCREEN = path.join(ROOT, 'scripts/eval/results/shift-screen-5021/2026-11-03/screen-answers.jsonl.gz');
const VERDICT_FILES = [
  'scripts/eval/results/shift-screen-5021/2026-11-03/opus-verdicts.jsonl.gz',
  'scripts/eval/results/translation-leaf-shift-5021/2026-11-03/opus-verdicts.jsonl.gz',
  'scripts/eval/results/caseless-shift-5021/2026-11-03/opus-confirm-20.jsonl',
].map((f) => path.join(ROOT, f));
// Named by eye on #5021 / #5274 (2026-11-03): 農政全書 p.490-492 withheld, p.489's English stops halfway down the
// leaf; 皇極經世書 p.63's OCR and English add four table columns (its OCR is Flash-Lite, so it is re-read first).
const NAMED = [['6992cbd8018b80967354ba40', [489, 490, 491, 492]], ['6a0a4e9f7cd8e1e3d0f496d7', [63]]];
const FINAL = new Set(['retranslated', 'ocr-refused', 'apply-refused', 'read-failed', 'not-translatable', 'skip-human', 'skip-changed', 'skip-gone', 'gate-refused', 'skip-opus-context', 'skip-ocr-neighbour']);
/** The reader's own skip lines in a book's run.log ("  63 skipped: english-book") → Map(page_number → reason). */
export function readerSkips(logText) {
  const m = new Map();
  for (const l of String(logText).split('\n')) {
    const x = l.match(/^\s*(\d+) skipped: (.+)$/) || l.match(/^\s*(\d+) (not translatable \(.+\)); skipped$/);
    if (x) m.set(Number(x[1]), x[2].trim());
  }
  return m;
}

const MODE = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const has = (n) => process.argv.includes(`--${n}`);
const OUT = arg('out') && path.resolve(arg('out'));
if (!OUT || !['build', 'enqueue', 'gate-pick', 'run', 'judge', 'gate-verdict', 'release', 'status'].includes(MODE)) {
  console.error('usage: wrong-leaf-fix-5021.mjs build|enqueue|gate-pick|run|judge|gate-verdict|release|status --out=DIR [--issue=5274] (see the header)');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const ENV_FILE = process.env.SL_ENV_FILE || path.join(ROOT, '.env.production.local');
const JOB = process.env.JOB_NAME || (P5274CB ? 'context-bleed-find-fix-5274' : P5274 ? 'near-blank-fix-5274' : 'wrong-leaf-fix-5021');
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const gz = (f) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString() : fs.readFileSync(f, 'utf8'));
const LEDGER = path.join(OUT, 'ledger.jsonl');
const ledgerState = () => { const m = new Map(); for (const r of readJsonl(LEDGER)) m.set(r.page_id, r); return m; };
const note = (rows) => { if (rows.length) fs.appendFileSync(LEDGER, rows.map((r) => JSON.stringify({ ...r, at: new Date().toISOString() })).join('\n') + '\n'); };

/** The reader a route uses for the English: 'opus' (claude-translate, per call 1) or 'agy'. */
export const translateReader = (lane) => (lane?.engine === 'claude-opus-5-5' ? 'opus' : 'agy');
/** The route class of a page: its translation row and whether the OCR is re-read first. */
export const routeClass = (t) => `${t.lane_row}|${t.ocr_first ? 'reread' : 'ocr-ok'}`;

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000, maxPoolSize: 12 });
await client.connect();
const db = client.db('bookstore');

function spawnP(args, { env = process.env, log }) {
  return new Promise((resolve) => {
    const fd = fs.openSync(log, 'a');
    const child = spawn(process.execPath, [`--env-file=${ENV_FILE}`, ...args], { stdio: ['ignore', fd, fd], env: { ...env, CLI_JOB_NAME: JOB }, cwd: ROOT });
    child.on('close', (code) => { fs.closeSync(fd); resolve(code); });
  });
}

// ── build ──
async function build() {
  const want = new Map();
  const add = (b, p, src) => { const k = `${b}:${p}`; const w = want.get(k) || { book_id: b, page: Number(p), src: [] }; if (!w.src.includes(src)) w.src.push(src); want.set(k, w); };
  for (const l of gz(SCREEN).split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    if (r.arm === 'top' && ['next', 'prev', 'none'].includes(r.role)) { const [b, p] = r.key.split(':'); add(b, p, 'flag'); }
  }
  for (const f of VERDICT_FILES) for (const l of gz(f).split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    for (const v of r.verdicts || []) if (['next', 'prev', 'mixed'].includes(String(v.verdict).toLowerCase())) add(r.book_id, v.page, 'opus');
  }
  const sw = await db.collection('sweep_log').find({ sweep: 'withhold-by-eye', 'detail.issue': { $in: [ISSUE, String(ISSUE)] } }, { projection: { book_id: 1, 'detail.pages': 1 } }).toArray();
  for (const r of sw) for (const p of r.detail.pages) add(r.book_id, p, 'withheld-5021');
  for (const [b, ps] of NAMED) for (const p of ps) add(b, p, 'named');
  const { rows, left, books: nb } = await makeRows(want);
  writeQueue(rows, want.size, left, nb);
}

/** #5274: every near-blank page the screen called invented that is logged withheld by eye under 5274 (sweep_log) — the
 * 12 of 2026-11-03 and the 518 of 2026-11-04 — and the screen's ocr_dropped pages, which are re-read before their English. */
async function build5274() {
  const want = new Map();
  const verdicts = readJsonl(path.join(NB_DIR, 'verdicts.jsonl'));
  const fam = new Map(verdicts.map((v) => [`${v.book_id}:${v.page_number}`, v.family]));
  const add = (b, p, src) => { const k = `${b}:${p}`; const w = want.get(k) || { book_id: b, page: Number(p), src: [], family: fam.get(k) ?? null }; if (!w.src.includes(src)) w.src.push(src); want.set(k, w); };
  const invented = new Set(verdicts.filter((v) => v.verdict === 'invented').map((v) => `${v.book_id}:${v.page_number}`));
  const sw = await db.collection('sweep_log').find({ sweep: 'withhold-by-eye', 'detail.issue': { $in: [ISSUE, String(ISSUE)] } }, { projection: { book_id: 1, 'detail.pages': 1 } }).toArray();
  let otherLogged = 0;
  for (const r of sw) for (const p of r.detail.pages) { if (invented.has(`${r.book_id}:${p}`)) add(r.book_id, p, 'near-blank-invented'); else otherLogged++; }
  for (const l of fs.readFileSync(path.join(NB_DIR, 'reocr-candidates.tsv'), 'utf8').trim().split('\n').slice(1)) { const [b, p] = l.split('\t'); add(b, p, 'ocr-dropped'); }
  const { rows, left, books } = await makeRows(want);
  left.logged_5274_not_near_blank = otherLogged;
  writeQueue(rows, want.size, left, books);
}

const WITHHELD_SRC = ['withheld-5021', 'named', 'near-blank-invented', 'ocr-dropped', 'confirmed'];
// The withheld markers a row may carry and still be this repair's to lift: 5021/5274 by eye, and for the #5274
// ocr_dropped pages the stale marker a re-OCR left (the English was withheld because its OCR changed under it).
const OWN_MARKERS = P5274 ? ['invented_by_eye', 'stale_after_reocr'] : ['invented_by_eye'];
const NB_SCREENED = '2026-11-03T13:00:00Z';
// #5274cb: no page translated twice in a week — a page whose English is younger than this is left out (`since`)
let ocrDupSet = null;
const ocrDup = () => (ocrDupSet ??= new Set(readJsonl(path.join(OUT, 'ocr-overlap.jsonl')).filter((o) => o.ocr_dup).map((o) => o.page_id)));
const CB_WEEK_AGO = new Date(Date.now() - 7 * 86400e3).toISOString();
// #5274cb: the caption line, on leaves whose source is nearly empty (near_blank in the queue row). Stricter than
// NB_PROMPT_LINE on the summary and keywords, where gate 2 of near-blank-fix-5274 found its four misses.
const CB_CAPTION_LINE = 'This leaf carries little or no text: a title, a caption or a few labels, perhaps beside a picture. Translate only the words printed on this leaf. If there is a picture, describe only what is visible, in one short note. Add nothing else: no entry text, explanation, use, date, dynasty, source work, author or background, in the translation, the notes, the summary or the keywords. The summary is one sentence saying what is printed and shown on this leaf.';

async function makeRows(want) {
  const byBook = new Map();
  for (const w of want.values()) { const a = byBook.get(w.book_id) || []; a.push(w.page); byBook.set(w.book_id, a); }
  const books = new Map((await db.collection('books').find({ id: { $in: [...byBook.keys()] } }, { projection: { id: 1, title: 1, language: 1, publisher: 1, image_source: 1, visible: 1, human_read_count: 1, 'pipeline_auto.hold.reason': 1 } }).toArray()).map((b) => [b.id, b]));
  const rows = [], left = { human: 0, since: 0, other_withheld: 0, no_english: 0, missing: 0 };
  for (const [b, pages] of byBook) {
    const bk = books.get(b);
    if (!bk) { left.missing += pages.length; continue; }
    const lane = translateLaneForBook(bk);
    const ps = await db.collection('pages').aggregate([
      { $match: { book_id: b, page_number: { $in: pages } } },
      { $project: { _id: 0, id: 1, page_number: 1, 'ocr.model': 1, 'ocr.edited_by': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'translation.updated_at': 1, 'translation.edited_by': 1, 'translation.source': 1,
        has_tr: { $gt: [{ $strLenCP: { $cond: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, '$translation.data', ''] } }, 0] },
        no_text: { $regexMatch: { input: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] }, regex: '<page-type>\\s*(illustration|plate|map|blank)', options: 'i' } },
        tw: '$translation_withheld.reason', tw_at: '$translation_withheld.withheld_at' } },
    ]).toArray();
    const found = new Set(ps.map((p) => p.page_number));
    left.missing += pages.filter((p) => !found.has(p)).length;
    for (const p of ps) {
      const w = want.get(`${b}:${p.page_number}`);
      const withheld = OWN_MARKERS.includes(p.tw) && w.src.some((s) => WITHHELD_SRC.includes(s));
      if (p.translation?.edited_by || p.translation?.source === 'manual') { left.human++; continue; }
      if (p.tw && !withheld) { left.other_withheld++; continue; }
      if (!withheld && !p.has_tr) { left.no_english++; continue; }
      const trAt = p.translation?.updated_at ? new Date(p.translation.updated_at).toISOString() : null;
      if (!withheld && trAt && trAt >= (P5274CB ? CB_WEEK_AGO : FLAG_CUTOFF)) { left.since++; continue; }
      const ocr = { ...p.ocr, data: p.no_text ? '<page-type>blank' : '' };
      // #5274 ocr_dropped: the OCR the screen saw left the leaf's text out, so it is re-read first whatever its model,
      // unless it was rewritten after the screen.
      const ocrAt = p.ocr?.updated_at ? new Date(p.ocr.updated_at).toISOString() : null;
      const ocrForce = w.src.includes('ocr-dropped') && !(ocrAt && ocrAt >= NB_SCREENED);
      rows.push({
        page_id: p.id, book_id: b, page: p.page_number, src: w.src, state: withheld ? 'withheld' : 'served', tr_at: trAt,
        ocr_model: p.ocr?.model ?? null, ocr_first: ocrForce || uncheckedLite({ ocr }), ...(ocrForce && { ocr_force: true }), ...(w.family && { family: w.family }),
        language: bk.language, title: String(bk.title || '').slice(0, 90),
        lane_row: lane.row?.id ?? 'default', engine: lane.engine, channel: lane.channel ?? 'batch', reader: translateReader(lane),
        reads: bk.human_read_count || 0, hold: bk.pipeline_auto?.hold?.reason ?? null, ...(w.near_blank && { near_blank: true }),
      });
    }
  }
  return { rows, left, books: byBook.size };
}

function rankRows(rows) {
  const per = new Map();
  for (const r of rows) { const s = per.get(r.book_id) || { reads: r.reads, withheld: 0, n: 0 }; s.n++; if (r.state === 'withheld') s.withheld++; per.set(r.book_id, s); }
  const rank = (b) => per.get(b);
  rows.sort((x, y) => (rank(y.book_id).reads - rank(x.book_id).reads) || (rank(y.book_id).withheld - rank(x.book_id).withheld) || (rank(y.book_id).n - rank(x.book_id).n) || (x.book_id < y.book_id ? -1 : x.book_id > y.book_id ? 1 : x.page - y.page));
  return rows;
}

function writeQueue(rows, targets, left) {
  rankRows(rows);
  fs.writeFileSync(path.join(OUT, 'queue.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const tab = {};
  for (const r of rows) { const k = `${r.state} ${routeClass(r)} ${r.reader}`; tab[k] = (tab[k] || 0) + 1; }
  const summary = { built_at: new Date().toISOString(), issue: ISSUE, targets, queued: rows.length, books: new Set(rows.map((r) => r.book_id)).size, withheld: rows.filter((r) => r.state === 'withheld').length, served: rows.filter((r) => r.state === 'served').length, ocr_first: rows.filter((r) => r.ocr_first).length, left_out: left, by_class: tab };
  fs.writeFileSync(path.join(OUT, 'build.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}

/** Add pages to an existing queue without rebuilding it (a rebuild would drop every page the run already rewrote):
 * --from=FILE, a JSON { pages: [{ book_id, page }] } such as wrong-leaf-find-5021's confirmed-for-fix.json.
 * Pages already queued are left as they are; the new rows go to the FRONT, so the next run takes them first. */
async function enqueue() {
  const f = arg('from');
  const src = JSON.parse(fs.readFileSync(f, 'utf8'));
  const q = readJsonl(path.join(OUT, 'queue.jsonl'));
  const have = new Set(q.map((r) => `${r.book_id}:${r.page}`));
  const want = new Map();
  let already = 0;
  for (const p of src.pages || src) {
    const k = `${p.book_id}:${p.page ?? p.page_number}`;
    if (have.has(k)) { already++; continue; }
    want.set(k, { book_id: p.book_id, page: Number(p.page ?? p.page_number), src: ['confirmed', ...(p.src ? [].concat(p.src) : [])], ...(p.near_blank && { near_blank: true }) });
  }
  const { rows, left } = await makeRows(want);
  rankRows(rows);
  fs.writeFileSync(path.join(OUT, 'queue.jsonl'), [...rows, ...q].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const s = { enqueued_at: new Date().toISOString(), from: f, asked: (src.pages || src).length, already_queued: already, added: rows.length, left_out: left, added_ids: rows.map((r) => r.page_id) };
  fs.writeFileSync(path.join(OUT, `enqueue-${path.basename(f, '.json')}.json`), JSON.stringify(s, null, 1));
  console.log(JSON.stringify({ ...s, added_ids: undefined }, null, 1));
}

// ── gate-pick ──
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** #5274 gate strata: the three picture encyclopedias the screen found worst on 3 Flash, and the rest. */
const nbBucket = (r) => (['三才圖會', '武備志', '植物名實圖考'].includes(r.family) ? r.family : 'other');
const gateEligible = (r) => (P5274 ? r.state === 'withheld' && r.src.includes('near-blank-invented') : r.state === 'served' && r.src.includes('flag'));
const gateClass = (r) => (P5274 ? nbBucket(r) : routeClass(r));

/** #5274: 30 withheld near-blank pages, one per book, weighted to 三才圖會, 武備志, 植物名實圖考 and "other"
 * (--alloc=10,7,6,7), seeded. Pages the ledger already holds (an earlier gate's) are left out, so a re-gate is on
 * fresh pages; an earlier gate.json is kept as gate-<k>.json. */
function gatePick5274() {
  const [a, b, c, d] = String(arg('alloc', '10,7,6,7')).split(',').map(Number);
  const alloc = new Map([['三才圖會', a], ['武備志', b], ['植物名實圖考', c], ['other', d]]);
  const rnd = mulberry32(Number(arg('seed', 52740)));
  const led = ledgerState();
  const gf = path.join(OUT, 'gate.json');
  if (fs.existsSync(gf)) { let k = 1; while (fs.existsSync(path.join(OUT, `gate-${k}.json`))) k++; fs.renameSync(gf, path.join(OUT, `gate-${k}.json`)); }
  const q = readJsonl(path.join(OUT, 'queue.jsonl')).filter((r) => gateEligible(r) && !led.has(r.page_id));
  const usedBooks = new Set(), picked = [];
  for (const [k, n0] of alloc) {
    const pool = q.filter((r) => nbBucket(r) === k).sort((x, y) => (x.page_id < y.page_id ? -1 : 1));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    let n = n0;
    for (const r of pool) { if (n <= 0) break; if (usedBooks.has(r.book_id)) continue; usedBooks.add(r.book_id); picked.push(r); n--; }
  }
  fs.writeFileSync(gf, JSON.stringify({ seed: Number(arg('seed', 52740)), n: picked.length, alloc: Object.fromEntries(alloc), prompt_line: has('prompt-line') ? NB_PROMPT_LINE : null, pages: picked }, null, 1));
  const got = {}; for (const r of picked) got[nbBucket(r)] = (got[nbBucket(r)] || 0) + 1;
  console.log(`gate: ${picked.length} pages in ${usedBooks.size} books`, got);
}

function gatePick() {
  if (has('top-up')) return gateTopUp();
  if (P5274) return gatePick5274();
  const N = Number(arg('n', 30)), rnd = mulberry32(Number(arg('seed', 50213)));
  const q = readJsonl(path.join(OUT, 'queue.jsonl')).filter((r) => r.state === 'served' && r.src.includes('flag'));
  const byClass = new Map();
  for (const r of q) { const k = routeClass(r); const a = byClass.get(k) || []; a.push(r); byClass.set(k, a); }
  const classes = [...byClass.keys()].sort();
  const alloc = new Map(classes.map((k) => [k, 1]));
  let rest = N - classes.length;
  const tot = q.length;
  const share = classes.map((k) => [k, (byClass.get(k).length / tot) * rest]).sort((a, b) => b[1] - a[1]);
  for (const [k, s] of share) { const add = Math.floor(s); alloc.set(k, alloc.get(k) + add); rest -= add; }
  for (const [k] of share) { if (rest <= 0) break; alloc.set(k, alloc.get(k) + 1); rest--; }
  const usedBooks = new Set(), picked = [];
  for (const k of classes) {
    const pool = [...byClass.get(k)].sort((a, b) => (a.page_id < b.page_id ? -1 : 1));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    let n = alloc.get(k);
    for (const r of pool) { if (n <= 0) break; if (usedBooks.has(r.book_id)) continue; usedBooks.add(r.book_id); picked.push(r); n--; }
  }
  fs.writeFileSync(path.join(OUT, 'gate.json'), JSON.stringify({ seed: Number(arg('seed', 50213)), n: picked.length, alloc: Object.fromEntries(alloc), pages: picked }, null, 1));
  console.log(`gate: ${picked.length} pages in ${usedBooks.size} books`, Object.fromEntries(alloc));
}

/** Replace each gate page that produced no new English (OCR re-read refused, not translatable) by another page of
 * the same route class from a book not yet in the gate, seeded; the replaced pages stay in the ledger as they are. */
function gateTopUp() {
  const g = JSON.parse(fs.readFileSync(path.join(OUT, 'gate.json'), 'utf8'));
  const led = ledgerState(), rnd = mulberry32(Number(arg('seed', 50214)));
  const ok = g.pages.filter((p) => ['read', 'retranslated'].includes(led.get(p.page_id)?.state));
  const out = g.pages.filter((p) => !ok.includes(p) && FINAL.has(led.get(p.page_id)?.state));
  const books = new Set(g.pages.map((p) => p.book_id));
  const q = readJsonl(path.join(OUT, 'queue.jsonl')).filter((r) => gateEligible(r) && !books.has(r.book_id) && !led.has(r.page_id) && !/^english/i.test(r.language || ''));
  const add = [];
  for (const o of out) {
    const pool = q.filter((r) => gateClass(r) === gateClass(o) && !books.has(r.book_id)).sort((a, b) => (a.page_id < b.page_id ? -1 : 1));
    // #5274: a stratum with no book left (植物名實圖考: 11 books, most leaves caption-only and refused as no-body)
    // is filled from the rest of the queue; the substitution is recorded in gate.json `filled_from_other`.
    const any = P5274 && !pool.length ? q.filter((r) => !books.has(r.book_id)).sort((a, b) => (a.page_id < b.page_id ? -1 : 1)) : [];
    const from = pool.length ? pool : any;
    const pick = from.length ? from[Math.floor(rnd() * from.length)] : null;
    if (pick) { books.add(pick.book_id); add.push(pick); if (!pool.length) g.filled_from_other = [...(g.filled_from_other || []), { for: gateClass(o), page_id: pick.page_id, class: gateClass(pick) }]; }
  }
  // --fill-to=N (#5274): a gate that lost pages to a stratum with no book left is filled back to N from the rest.
  const fillTo = Number(arg('fill-to', 0));
  const keep = g.pages.length - out.length + add.length;
  if (P5274 && keep < fillTo) {
    const rest = q.filter((r) => !books.has(r.book_id)).sort((a, b) => (a.page_id < b.page_id ? -1 : 1));
    for (let i = keep; i < fillTo && rest.length; i++) {
      const pick = rest.splice(Math.floor(rnd() * rest.length), 1)[0];
      if (books.has(pick.book_id)) { i--; continue; }
      books.add(pick.book_id); add.push(pick);
      g.filled_from_other = [...(g.filled_from_other || []), { for: 'fill-to', page_id: pick.page_id, class: gateClass(pick) }];
    }
  }
  g.replaced = [...(g.replaced || []), ...out.map((p) => ({ page_id: p.page_id, class: gateClass(p), state: led.get(p.page_id)?.state, why: led.get(p.page_id)?.why }))];
  g.pages = [...ok, ...g.pages.filter((p) => !ok.includes(p) && !out.includes(p)), ...add];
  g.n = g.pages.length;
  fs.writeFileSync(path.join(OUT, 'gate.json'), JSON.stringify(g, null, 1));
  console.log(`gate top-up: ${out.length} replaced, ${add.length} added; ${g.pages.length} pages`);
}

// ── pools ──
const WEEKLY_END = Number(arg('weekly-end', 0.35));
const FLOOR_5H = Number(arg('floor-5h', 0.25));
let poolCache = { at: 0, pools: [] };
function poolOpen(r) {
  if (!r) return { open: false, why: 'unreadable' };
  const line = Math.max(WEEKLY_END, weeklyReserve({ resetTime: r.weeklyReset, lane: null }));
  if (r.weekly < line) return { open: false, why: `weekly ${(100 * r.weekly).toFixed(0)}% < ${(100 * line).toFixed(0)}%`, until: r.weeklyReset };
  if (typeof r.fiveHour !== 'number' || r.fiveHour < FLOOR_5H) return { open: false, why: `5h ${(100 * (r.fiveHour ?? 0)).toFixed(0)}% < ${100 * FLOOR_5H}%`, until: r.fiveHourReset };
  return { open: true };
}
function pickPool() {
  if (Date.now() - poolCache.at > 10 * 60e3) poolCache = { at: Date.now(), pools: readPools() };
  const ok = poolCache.pools.filter((p) => !p.busy && poolOpen(p.reading).open).sort((a, b) => b.reading.weekly - a.reading.weekly);
  if (ok.length) return { pool: ok[0] };
  const untils = poolCache.pools.map((p) => Date.parse(poolOpen(p.reading).until || '')).filter(Number.isFinite);
  return { pool: null, until: untils.length ? Math.min(...untils) : Date.now() + 3600e3, why: poolCache.pools.map((p) => `${poolName(p)}: ${p.busy ? `busy (pid ${p.busy})` : poolOpen(p.reading).why}`).join('; ') };
}

// ── run ──
async function doBook(rows, { applyOcr, apply, home, retryIds = new Set() }) {
  const book = rows[0].book_id, dir = path.join(OUT, 'books', book);
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, 'run.log');
  const env = agyEnv(home, process.env, { TRANSLATE_FOLIO_MARKERS_CLI: '0', AGY_JOB: JOB });
  const out = [];
  const fresh = new Map((await db.collection('pages').aggregate([
    { $match: { id: { $in: rows.map((r) => r.page_id) } } },
    { $project: { _id: 0, id: 1, 'ocr.model': 1, 'ocr.edited_by': 1, 'ocr.source': 1, 'translation.updated_at': 1, 'translation.edited_by': 1, 'translation.source': 1, 'translation_withheld.withheld_at': 1, 'translation_withheld.reason': 1,
      no_text: { $regexMatch: { input: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] }, regex: '<page-type>\\s*(illustration|plate|map|blank)', options: 'i' } } } },
  ]).toArray()).map((p) => [p.id, p]));
  let work = [];
  for (const r of rows) {
    const p = fresh.get(r.page_id);
    if (!p) { out.push({ ...r, state: 'skip-gone' }); continue; }
    if (p.translation?.edited_by || p.translation?.source === 'manual') { out.push({ ...r, state: 'skip-human' }); continue; }
    const trAt = p.translation?.updated_at ? new Date(p.translation.updated_at).toISOString() : null;
    // #5274cb: claude-translate.mjs (the Opus route, Pali) still sends the previous page's English; not read here, listed
    // #5274cb: the page's OWN OCR is a neighbour's text (show-through, a wrong-leaf read; ocr-overlap.mjs): re-translating
    // it gives the same wrong English, so it is listed for an OCR repair instead of read
    if (P5274CB && ocrDup().has(r.page_id)) { out.push({ ...r, state: 'skip-ocr-neighbour', why: 'its OCR is a neighbour leaf\'s text (ocr-overlap.jsonl): needs an OCR re-read from the image, not a re-translation' }); continue; }
    if (P5274CB && r.reader === 'opus') { out.push({ ...r, state: 'skip-opus-context', why: 'the Opus route sends neighbour context; not read by the own-leaf repair' }); continue; }
    if (r.state === 'served' && trAt !== r.tr_at) { out.push({ ...r, state: 'skip-changed', why: `English rewritten ${trAt} since the queue was built` }); continue; }
    if (r.state === 'withheld' && !p.translation_withheld) { out.push({ ...r, state: 'skip-changed', why: 'no longer withheld' }); continue; }
    work.push({ ...r, _p: p });
  }
  // 1. OCR first: unchecked Flash-Lite drafts are re-read, one page a call, and written only with --apply-ocr.
  const lite = work.filter((r) => r.ocr_force || uncheckedLite({ ocr: { ...r._p.ocr, data: r._p.no_text ? '<page-type>blank' : '' } }));
  if (lite.length) {
    const ids = path.join(dir, 'ocr-ids.json');
    fs.writeFileSync(ids, JSON.stringify(lite.map((r) => r.page_id)));
    // --retry=ocr-refused: the refused read is moved aside (kept) and the re-read is --fresh, as for the English below.
    const ocrDir = path.join(dir, 'ocr'), again = lite.filter((r) => retryIds.has(r.page_id));
    if (again.length && fs.existsSync(ocrDir)) {
      const aside = path.join(dir, `ocr-before-retry-${Date.now()}`);
      fs.mkdirSync(aside, { recursive: true });
      for (const r of again) for (const f of fs.readdirSync(ocrDir).filter((f) => f.startsWith(`${r.page_id}.`))) fs.renameSync(path.join(ocrDir, f), path.join(aside, f));
    }
    const code = await spawnP([path.join(ROOT, 'scripts/batch/cli-ocr.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${ocrDir}`, `--model=${AGY_MODEL}`, `--lane=${REREAD_LANE}`, `--job=${JOB}`, '--stop-on-quota', ...(again.length ? ['--fresh'] : [])], { env, log });
    if (code === 3) return { quota: true, out };
    if (applyOcr) {
      const why = P5274
        ? `#5274 OCR first: the stored OCR under a near-blank-flagged page is re-read (agy ${AGY_MODEL}, one page a call, the ${REREAD_LANE} route) before its English is re-translated: the screen found it dropped text that is on the leaf, or it is an unchecked Flash-Lite draft`
        : `#5021 OCR first: the stored Flash-Lite draft under a wrong-leaf page is re-read (agy ${AGY_MODEL}, one page a call, the ${REREAD_LANE} route) before its English is re-translated`;
      await spawnP([path.join(ROOT, 'scripts/batch/cli-ocr.mjs'), 'apply', `--out=${path.join(dir, 'ocr')}`, `--only=${ids}`, `--reason=${why}`, `--lane=${REREAD_LANE}`, '--print-only', '--apply'], { env, log });
      const after = new Map((await db.collection('pages').find({ id: { $in: lite.map((r) => r.page_id) } }, { projection: { _id: 0, id: 1, 'ocr.model': 1, 'ocr.pipeline': 1 } }).toArray()).map((p) => [p.id, p]));
      for (const r of lite) {
        const a = after.get(r.page_id);
        if (a?.ocr?.pipeline === REREAD_LANE && !/flash-lite/i.test(a.ocr.model || '')) { r.ocr_reread = true; continue; }
        out.push({ ...r, _p: undefined, state: 'ocr-refused' });
      }
      work = work.filter((r) => !lite.includes(r) || r.ocr_reread);
    } else {
      for (const r of lite) out.push({ ...r, _p: undefined, state: 'ocr-read-only' });
      work = work.filter((r) => !lite.includes(r));
    }
  }
  if (!work.length) return { out };
  // 2. The English, one page a call.
  const ids = path.join(dir, 'tr-ids.json'), trDir = path.join(dir, 'tr');
  fs.writeFileSync(ids, JSON.stringify(work.map((r) => r.page_id)));
  // --retry: the earlier read of a retried page is moved aside (kept, never deleted) and the reader is told --fresh,
  // so it neither skips the page as "already read" nor hands back the same kept read.
  const retried = work.filter((r) => retryIds.has(r.page_id));
  if (retried.length && fs.existsSync(trDir)) {
    const aside = path.join(dir, `tr-before-retry-${Date.now()}`);
    fs.mkdirSync(aside, { recursive: true });
    for (const r of retried) for (const f of fs.readdirSync(trDir).filter((f) => f.startsWith(`${r.page_id}.`))) fs.renameSync(path.join(trDir, f), path.join(aside, f));
  }
  const opus = work[0].reader === 'opus';
  if (opus && claudeBlocked()) return { quota: true, out, why: 'claude blocked' };
  // --prompt-line (#5274 gate, round 2): one line appended to each page's prompt, recorded in the read's meta.
  let instr = [];
  if (P5274CB) {
    const nb = work.filter((r) => r.near_blank);
    if (nb.length) {
      const f = path.join(dir, 'instructions.json');
      fs.writeFileSync(f, JSON.stringify(Object.fromEntries(nb.map((r) => [r.page_id, CB_CAPTION_LINE]))));
      instr = [`--instructions-file=${f}`];
    }
  } else if (has('prompt-line') && P5274) {
    const f = path.join(dir, 'instructions.json');
    fs.writeFileSync(f, JSON.stringify(Object.fromEntries(work.map((r) => [r.page_id, NB_PROMPT_LINE]))));
    instr = [`--instructions-file=${f}`];
  }
  const readArgs = opus
    ? [path.join(ROOT, 'scripts/batch/claude-translate.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${trDir}`, '--model=opus', '--per-call=1', `--job=${JOB}`]
    : [path.join(ROOT, 'scripts/batch/cli-translate.mjs'), 'read', `--page-ids-file=${ids}`, `--out=${trDir}`, `--model=${AGY_MODEL}`, ...instr, ...(P5274CB ? ['--own-leaf', '--caption-leaves'] : []), ...(retried.length ? ['--fresh'] : [])];
  const rc = await spawnP(readArgs, { env, log });
  if (rc === 3) return { quota: true, out };
  if (rc === 2) { for (const r of work) out.push({ ...r, _p: undefined, state: 'gate-refused' }); return { out }; }
  const skips = readerSkips(fs.readFileSync(log, 'utf8'));
  const hasRead = (r) => fs.existsSync(path.join(trDir, `${r.page_id}.txt`)) && fs.statSync(path.join(trDir, `${r.page_id}.txt`)).size > 0;
  // a page the reader will not translate (an English book, a blank or same-language page) is out of this repair's reach
  const unread = (r) => (skips.has(r.page) ? { state: 'not-translatable', why: skips.get(r.page) } : { state: 'read-failed' });
  if (!apply) { for (const r of work) out.push({ ...r, _p: undefined, ...(hasRead(r) ? { state: 'read' } : unread(r)) }); return { out }; }
  // 3. Write through translate-core's door, then lift the withheld marker on what it wrote.
  const t0 = new Date();
  const reader = opus ? 'Opus, claude -p' : `agy ${AGY_MODEL}`;
  const why = P5274CB
    ? `#5274 context-bleed repair: this leaf's English was another leaf's text (the previous page's English was sent as context and translated in its place) or composed for the leaf; re-translated one page a call from its own transcription only, no neighbouring text (${reader}${instr.length ? ', with the caption line' : ''})`
    : P5274
    ? `#5274 near-blank repair: this leaf's English carried text that is not on the leaf (Opus screen with the image; withheld by eye) or its OCR dropped the leaf's text; re-translated one page a call from its own transcription (${reader}${instr.length ? ', with the caption-only prompt line' : ''})`
    : `#5021 wrong-leaf repair: this page served another leaf's English (Flash-Lite screen flag or Opus with the scans); re-translated one page a call from its own transcription (${reader})`;
  await spawnP([path.join(ROOT, 'scripts/batch/cli-translate.mjs'), 'apply', `--out=${trDir}`, `--reason=${why}`, '--apply'], { env, log });
  const now = new Map((await db.collection('pages').find({ id: { $in: work.map((r) => r.page_id) } }, { projection: { _id: 0, id: 1, 'translation.data': 1, 'translation.updated_at': 1, translation_withheld: 1 } }).toArray()).map((p) => [p.id, p]));
  for (const r of work) {
    const p = now.get(r.page_id);
    const wrote = p?.translation?.data && new Date(p.translation.updated_at) >= t0;
    if (wrote && p.translation_withheld && new Date(p.translation.updated_at) > new Date(p.translation_withheld.withheld_at)) {
      await db.collection('pages').updateOne({ id: p.id, 'translation.updated_at': p.translation.updated_at }, { $unset: { translation_withheld: '' } });
    }
    out.push({ ...r, _p: undefined, ...(wrote ? { state: 'retranslated' } : hasRead(r) ? { state: 'apply-refused' } : unread(r)), pool: home ? path.basename(home) : (opus ? 'claude' : 'default') });
  }
  return { out };
}

/** A row the runner ledgered read-failed whose book log shows the reader's own skip is not-translatable. */
function relabel(led) {
  const logs = new Map();
  for (const [id, r] of led) {
    if (r.state !== 'read-failed') continue;
    const f = path.join(OUT, 'books', r.book_id, 'run.log');
    if (!logs.has(r.book_id)) logs.set(r.book_id, fs.existsSync(f) ? readerSkips(fs.readFileSync(f, 'utf8')) : new Map());
    const why = logs.get(r.book_id).get(r.page);
    if (why) led.set(id, { ...r, state: 'not-translatable', why });
  }
  return led;
}

function progress(extra = {}) {
  const q = readJsonl(path.join(OUT, 'queue.jsonl'));
  const led = relabel(ledgerState());
  const by = {};
  for (const r of q) { const s = led.get(r.page_id)?.state || 'queued'; const k = `${r.state}:${s}`; by[k] = (by[k] || 0) + 1; }
  const p = { at: new Date().toISOString(), queued: q.length, by_state: by, ...extra };
  fs.writeFileSync(path.join(OUT, 'progress.json'), JSON.stringify(p, null, 1));
  return p;
}

async function run() {
  const frame = arg('frame', 'all');
  const applyOcr = has('apply-ocr') || has('apply'), apply = has('apply');
  let q = readJsonl(path.join(OUT, 'queue.jsonl'));
  if (frame === 'gate') { const g = new Set(JSON.parse(fs.readFileSync(path.join(OUT, 'gate.json'), 'utf8')).pages.map((p) => p.page_id)); q = q.filter((r) => g.has(r.page_id)); }
  if (frame === 'ids') { const g = new Set(JSON.parse(fs.readFileSync(arg('ids-file'), 'utf8'))); q = q.filter((r) => g.has(r.page_id)); }
  const led = ledgerState();
  // --retry=apply-refused[,ocr-refused]: take pages again whose last state was one of these (a new ledger row supersedes).
  const retry = new Set(String(arg('retry', '')).split(',').filter(Boolean));
  const isFinal = (s) => FINAL.has(s) && !retry.has(s);
  const todo = q.filter((r) => !isFinal(led.get(r.page_id)?.state) && !(frame !== 'gate' && !apply && led.get(r.page_id)?.state === 'read'));
  const retryIds = new Set(todo.filter((r) => retry.has(led.get(r.page_id)?.state)).map((r) => r.page_id));
  const books = [];
  const seen = new Map();
  for (const r of todo) { if (!seen.has(r.book_id)) { seen.set(r.book_id, []); books.push(r.book_id); } seen.get(r.book_id).push(r); }
  const maxBooks = Number(arg('max-books', books.length));
  const queue = books.slice(0, maxBooks);
  const CONC = Number(arg('concurrency', 6));
  console.log(`run ${frame}: ${todo.length} pages in ${books.length} books (${queue.length} this run), ${CONC} at a time; ocr ${applyOcr ? 'WRITE' : 'read only'}, English ${apply ? 'WRITE' : 'read only'}`);
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      let pick = pickPool();
      while (!pick.pool && !opusOnly(seen.get(queue[0]))) {
        const wait = Math.max(10 * 60e3, Math.min(6 * 3600e3, pick.until - Date.now() + 60e3));
        console.log(`no pool open (${pick.why}); sleeping ${(wait / 60e3).toFixed(0)} min to the reset`);
        progress({ sleeping_until: new Date(Date.now() + wait).toISOString(), why: pick.why });
        await new Promise((r) => setTimeout(r, wait));
        poolCache.at = 0;
        pick = pickPool();
      }
      const book = queue.shift();
      if (!book) break;
      const rows = seen.get(book);
      const res = await doBook(rows, { applyOcr, apply, home: pick.pool?.home ?? null, retryIds });
      note(res.out);
      if (res.quota) { console.log(`  ${book}: quota reply (${res.why || 'agy'}); back of the queue, pools re-read`); poolCache.at = 0; queue.push(book); await new Promise((r) => setTimeout(r, 60e3)); continue; }
      done++;
      const c = {}; for (const o of res.out) c[o.state] = (c[o.state] || 0) + 1;
      console.log(`  [${done}/${books.length}] ${book} ${rows[0].language} ${rows.length} pages via ${pick.pool ? poolName(pick.pool) : 'claude'}: ${JSON.stringify(c)}`);
      progress({ running: true });
    }
  };
  const opusOnly = (rows) => rows && rows[0].reader === 'opus' && !rows.some((r) => r.ocr_first);
  await Promise.all(Array.from({ length: CONC }, worker));
  const p = progress({ running: false, finished_at: new Date().toISOString() });
  console.log(JSON.stringify(p, null, 1));
  let rel = null;
  if (['all', 'ids'].includes(frame) && apply && has('release')) rel = await release();
  if (['all', 'ids'].includes(frame) && apply && has('notify')) {
    const msg = `${JOB} run finished: ${JSON.stringify(p.by_state)}${rel ? `; holds released ${rel.released.length} of ${rel.held}` : ''}. Progress: ${path.join(OUT, 'progress.json')}`;
    spawnSync('curl', ['-s', '-H', `Title: #${ISSUE} ${P5274 ? 'near-blank' : 'wrong-leaf'} re-translation done`, '-d', msg, 'https://ntfy.sh/sourcelibrary-uptime']);
    spawnSync('gh', ['issue', 'comment', String(ISSUE), '--body', `**${JOB} runner finished** (${p.finished_at}, \`--issue=${ISSUE}\`).\n\n\`\`\`\n${JSON.stringify(p.by_state, null, 1)}\n\`\`\`\nState key: \`withheld|served : retranslated | ocr-refused (the Flash-Lite OCR could not be re-read under the guards; English kept or still withheld) | apply-refused | read-failed | skip-*\`. ${rel ? `\n\nHolds \`${HOLD_REASON}\`: ${rel.released.length} of ${rel.held} released; ${rel.kept_queue} kept with queued pages, ${rel.kept_withheld} kept with a withheld page.` : ''}\nLedger: \`${LEDGER}\`. Progress: \`node --env-file=.env.production.local scripts/maintenance/wrong-leaf-fix-5021.mjs status --issue=${PROFILE} --out=${OUT}\``], { cwd: ROOT });
  }
}

// ── judge (gate) ──
/** #5274: one sealed `claude -p --model opus` call per gate page with ITS scan and transcription and two Englishes
 * (the withheld one and the new read) in a seeded random order, not told which is which. For each: is every sentence
 * on the leaf (a translation of printed words, or a description of the picture presented as one), or does it add
 * text that is not printed there. The failure being beaten: under a captioned woodcut the model writes the entry it
 * expects. Judged on that, not on fluency. */
async function judge5274() {
  const { fetchLeaf, claudeCall } = await import('../audit/leaf-shift-confirm-5021.mjs');
  const { getPageSource } = await import('../lib/page-image-url.mjs');
  const g = JSON.parse(fs.readFileSync(path.join(OUT, 'gate.json'), 'utf8')).pages;
  const resFile = path.join(OUT, 'judge.jsonl');
  const done = new Set(readJsonl(resFile).filter((r) => r.verdict).map((r) => r.page_id));
  const rnd = mulberry32(5274);
  const items = g.map((r) => ({ r, newFirst: rnd() < 0.5 })).filter(({ r }) => !done.has(r.page_id));
  const CONC = Number(arg('concurrency', 4));
  const worker = async () => {
    for (let it = items.shift(); it; it = items.shift()) {
      const { r, newFirst } = it;
      const readFile = path.join(OUT, 'books', r.book_id, 'tr', `${r.page_id}.txt`);
      const fresh = fs.existsSync(readFile) ? fs.readFileSync(readFile, 'utf8').trim() : '';
      if (!fresh) { fs.appendFileSync(resFile, JSON.stringify({ page_id: r.page_id, book_id: r.book_id, page: r.page, cls: 'no_new_read' }) + '\n'); continue; }
      const p = await db.collection('pages').findOne({ id: r.page_id }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, translation_withheld: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1 } });
      const stored = String(p?.translation_withheld?.text || p?.translation?.data || '');
      const dir = path.join(OUT, 'judge', r.page_id);
      fs.mkdirSync(dir, { recursive: true });
      const got = await fetchLeaf({ display_photo: getPageSource(p) }, path.join(dir, 'leaf.jpg'));
      if (!got) { fs.appendFileSync(resFile, JSON.stringify({ page_id: r.page_id, book_id: r.book_id, page: r.page, cls: 'no_image' }) + '\n'); continue; }
      const [X, Y] = newFirst ? [fresh, stored] : [stored, fresh];
      const L = [
        `You are checking English translations of ONE page of "${r.title}" (language: ${r.language}) against the page itself. Open the scan with the Read tool first: leaf.jpg. Below it is a machine transcription of the page, which can be wrong or incomplete; trust the image.`,
        '', 'Transcription:', '<<<', String(p?.ocr?.data || '(empty)').slice(0, 4000), '>>>', '',
        'Two English versions, X and Y, have been produced for this page. They come from different processes; do not assume either is better.',
        '', 'Version X:', '<<<', X.slice(0, 6000), '>>>', '', 'Version Y:', '<<<', Y.slice(0, 6000), '>>>', '',
        'For EACH version, go through it piece by piece and sort every sentence into one of:',
        '  (a) a translation of words printed on THIS leaf (title, caption, labels, text);',
        '  (b) a description of what the picture on this leaf visibly shows, presented as a description (in a <note>, bracketed, or "the illustration shows ..."), adding no facts that are neither printed nor visible;',
        '  (g) a translator\'s gloss marked as a note (<note>...</note>) on a word printed on the leaf: its original characters, romanization, or a phrase saying what the term means. Readers see these as notes, not as the page;',
        '  (c) anything else: text presented as if it were the page\'s content but not printed on the leaf (an entry, a description of the plant or animal or weapon, a poem, a biography, a table, a commentary in the author\'s voice), or background or explanation beyond a short gloss.',
        '<summary>, <keywords> and <vocab> blocks are metadata about the page: a summary that says what is on the leaf is (b); one that claims content not on the leaf is (c).',
        'verdict "clean" when every piece is (a), (b) or (g); "adds" when any piece is (c). Do not judge style or fluency. Also list printed text left untranslated (omitted) and meaning changed (mistranslated), each major (a reader is misled) or minor.',
        'Answer with JSON only, no code fence: {"X":{"verdict":"clean|adds","adds":[{"quote":"a few words of the English","why":"..."}],"omitted":[{"severity":"major|minor","note":"..."}],"mistranslated":[{"severity":"major|minor","note":"..."}]},"Y":{...},"leaf":"one line: what is printed on the leaf"}',
      ];
      const prompt = L.join('\n');
      fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
      const res = await claudeCall(prompt, dir);
      let v = null;
      try { const a = res.text.indexOf('{'), b = res.text.lastIndexOf('}'); v = JSON.parse(res.text.slice(a, b + 1)); } catch { /* unparsed */ }
      const verdict = v && v.X && v.Y ? { new: newFirst ? v.X : v.Y, stored: newFirst ? v.Y : v.X, leaf: v.leaf } : null;
      fs.appendFileSync(resFile, JSON.stringify({ page_id: r.page_id, book_id: r.book_id, page: r.page, family: r.family, bucket: nbBucket(r), new_was: newFirst ? 'X' : 'Y', verdict, cls: res.cls || (verdict ? null : 'unparsed'), model: res.model, turns: res.usage?.turns, secs: res.secs, ...(verdict ? {} : { raw: String(res.text).slice(0, 800), err: res.err }) }) + '\n');
      console.log(`  ${r.page_id} ${r.family}: new ${verdict?.new?.verdict} (${verdict?.new?.adds?.length ?? '?'}), stored ${verdict?.stored?.verdict}${res.cls ? ` ${res.cls}` : ''}`);
      if (res.cls === 'usage_limit') { items.length = 0; console.log('usage limit: stopping; re-run to resume'); }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
}

function gateVerdict5274() {
  const g = JSON.parse(fs.readFileSync(path.join(OUT, 'gate.json'), 'utf8'));
  const ids = new Set(g.pages.map((p) => p.page_id));
  const last = new Map(); for (const r of readJsonl(path.join(OUT, 'judge.jsonl'))) if (ids.has(r.page_id)) last.set(r.page_id, r);
  const rs = [...last.values()].filter((r) => r.verdict);
  const maj = (v) => [...(v.omitted || []), ...(v.mistranslated || [])].filter((d) => d.severity === 'major').length;
  const clean = rs.filter((r) => r.verdict.new.verdict === 'clean').length;
  const v = {
    judged: rs.length, of: g.n, prompt_line: g.prompt_line ?? null, new_clean: clean, stored_clean: rs.filter((r) => r.verdict.stored.verdict === 'clean').length,
    major_other: { new: rs.reduce((s, r) => s + maj(r.verdict.new), 0), stored: rs.reduce((s, r) => s + maj(r.verdict.stored), 0) },
    by_bucket: Object.fromEntries(['三才圖會', '武備志', '植物名實圖考', 'other'].map((k) => { const x = rs.filter((r) => r.bucket === k); return [k, `${x.filter((r) => r.verdict.new.verdict === 'clean').length}/${x.length}`]; })),
    pass: rs.length === g.n && clean >= 27,
    adds: rs.filter((r) => r.verdict.new.verdict !== 'clean').map((r) => ({ page_id: r.page_id, book_id: r.book_id, page: r.page, family: r.family, adds: r.verdict.new.adds })),
  };
  fs.writeFileSync(path.join(OUT, 'gate-verdict.json'), JSON.stringify(v, null, 1));
  console.log(JSON.stringify(v, null, 1));
}

async function judge() {
  if (P5274) return judge5274();
  const { fetchLeaf, claudeCall } = await import('../audit/leaf-shift-confirm-5021.mjs');
  const g = JSON.parse(fs.readFileSync(path.join(OUT, 'gate.json'), 'utf8')).pages;
  const resFile = path.join(OUT, 'judge.jsonl');
  const done = new Set(readJsonl(resFile).filter((r) => r.verdict).map((r) => r.page_id));
  const rnd = mulberry32(5021);
  const items = g.map((r) => ({ r, newFirst: rnd() < 0.5 })).filter(({ r }) => !done.has(r.page_id));
  const CONC = Number(arg('concurrency', 4));
  const worker = async () => {
    for (let it = items.shift(); it; it = items.shift()) {
      const { r, newFirst } = it;
      const readFile = path.join(OUT, 'books', r.book_id, 'tr', `${r.page_id}.txt`);
      const fresh = fs.existsSync(readFile) ? fs.readFileSync(readFile, 'utf8').trim() : '';
      if (!fresh) { fs.appendFileSync(resFile, JSON.stringify({ page_id: r.page_id, book_id: r.book_id, page: r.page, cls: 'no_new_read' }) + '\n'); continue; }
      const pages = await db.collection('pages').find({ book_id: r.book_id, page_number: { $gte: r.page - 1, $lte: r.page + 1 } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, display_photo: 1, photo: 1, archived_photo: 1, photo_original: 1 } }).sort({ page_number: 1 }).toArray();
      const me = pages.find((p) => p.page_number === r.page);
      // the stored English the readers were served when the queue was built (page_revisions keeps it if a run rewrote it)
      let stored = me?.translation?.data || '';
      const rev = await db.collection('page_revisions').find({ page_id: r.page_id, field: 'translation', created_at: { $gt: new Date(FLAG_CUTOFF) } }).sort({ created_at: 1 }).limit(1).toArray();
      if (typeof rev[0]?.data === 'string') stored = rev[0].data;
      const dir = path.join(OUT, 'judge', r.page_id);
      fs.mkdirSync(dir, { recursive: true });
      const win = [];
      for (const p of pages) { const img = `p${p.page_number}.jpg`; const got = await fetchLeaf(p, path.join(dir, img)); win.push({ n: p.page_number, img: got ? img : null, ocr: String(p.ocr?.data || '').slice(0, 3500) }); }
      const [X, Y] = newFirst ? [fresh, stored] : [stored, fresh];
      const L = [];
      L.push(`You are a careful reviewer of translations of historical books. Below are up to three consecutive pages of "${r.title}" (language: ${r.language}): each page's scan image (open EVERY image with the Read tool) and a machine transcription that can be wrong; trust the image.`);
      L.push('');
      for (const w of win) { L.push(`=== Page ${w.n} ===`, w.img ? `Image file: ${w.img}` : 'Image: (not available)', `Transcription of page ${w.n}:`, '<<<', w.ocr || '(empty)', '>>>', ''); }
      L.push(`Two English versions, X and Y, have been produced for page ${r.page}. They come from different processes; do not assume either is better.`);
      L.push('', 'Version X:', '<<<', X.slice(0, 6000), '>>>', '', 'Version Y:', '<<<', Y.slice(0, 6000), '>>>', '');
      L.push(`For EACH version: (1) leaf: which page's printed text it mainly renders — own (page ${r.page}), next, prev, mixed (substantial parts of two pages), other (none of these pages, or a comment instead of a translation). (2) defects: judged against the leaf it actually renders, list each real error: invented (content not on that leaf), omitted (a sentence or more of that leaf left out; for 'own', text of page ${r.page} missing), mistranslated (meaning changed). Severity major (a reader is misled about what the page says) or minor. Do not count style.`);
      L.push('Answer with JSON only, no code fence: {"X":{"leaf":"own|next|prev|mixed|other","defects":[{"type":"invented|omitted|mistranslated","severity":"major|minor","note":"..."}],"evidence":"one phrase of the English and the matching original words with their page"},"Y":{…}}');
      const prompt = L.join('\n');
      fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt);
      const res = await claudeCall(prompt, dir);
      let v = null;
      try { const a = res.text.indexOf('{'), b = res.text.lastIndexOf('}'); v = JSON.parse(res.text.slice(a, b + 1)); } catch { /* unparsed */ }
      const verdict = v && v.X && v.Y ? { new: newFirst ? v.X : v.Y, stored: newFirst ? v.Y : v.X } : null;
      fs.appendFileSync(resFile, JSON.stringify({ page_id: r.page_id, book_id: r.book_id, page: r.page, language: r.language, class: routeClass(r), new_was: newFirst ? 'X' : 'Y', verdict, cls: res.cls || (verdict ? null : 'unparsed'), model: res.model, secs: res.secs, ...(verdict ? {} : { raw: String(res.text).slice(0, 800), err: res.err }) }) + '\n');
      console.log(`  ${r.page_id} ${r.language}: new ${verdict?.new?.leaf} (${verdict?.new?.defects?.length ?? '?'}), stored ${verdict?.stored?.leaf} (${verdict?.stored?.defects?.length ?? '?'})${res.cls ? ` ${res.cls}` : ''}`);
      if (res.cls === 'usage_limit') { items.length = 0; console.log('usage limit: stopping; re-run to resume'); }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
}

function gateVerdict() {
  if (P5274) return gateVerdict5274();
  const rs = readJsonl(path.join(OUT, 'judge.jsonl')).filter((r) => r.verdict);
  const w = (ds) => (ds || []).reduce((s, d) => s + (d.severity === 'major' ? 3 : 1), 0);
  const own = rs.filter((r) => r.verdict.new.leaf === 'own').length;
  const storedOwn = rs.filter((r) => r.verdict.stored.leaf === 'own').length;
  const dNew = rs.reduce((s, r) => s + w(r.verdict.new.defects), 0), dOld = rs.reduce((s, r) => s + w(r.verdict.stored.defects), 0);
  const majNew = rs.reduce((s, r) => s + (r.verdict.new.defects || []).filter((d) => d.severity === 'major').length, 0);
  const majOld = rs.reduce((s, r) => s + (r.verdict.stored.defects || []).filter((d) => d.severity === 'major').length, 0);
  const g = JSON.parse(fs.readFileSync(path.join(OUT, 'gate.json'), 'utf8')).n;
  const pass = rs.length === g && own >= 27 && dNew <= dOld;
  const v = { judged: rs.length, of: g, new_own: own, stored_own: storedOwn, defects_weighted: { new: dNew, stored: dOld }, major: { new: majNew, stored: majOld }, pass, not_own: rs.filter((r) => r.verdict.new.leaf !== 'own').map((r) => ({ page_id: r.page_id, class: r.class, leaf: r.verdict.new.leaf, evidence: r.verdict.new.evidence })) };
  fs.writeFileSync(path.join(OUT, 'gate-verdict.json'), JSON.stringify(v, null, 1));
  console.log(JSON.stringify(v, null, 1));
}

// ── release ──
async function release() {
  const q = readJsonl(path.join(OUT, 'queue.jsonl'));
  const led = relabel(ledgerState());
  // #5021: a book is open while any queued page is not re-translated. #5274: while any queued page has no final state
  // (a served ocr_dropped page the OCR re-read refused keeps its English and does not hold the book; a withheld page
  // that is not re-translated is caught by the withheld count below).
  const open = new Set(q.filter((r) => { const s = led.get(r.page_id)?.state; return P5274 ? !FINAL.has(s) : s !== 'retranslated' && !String(s || '').startsWith('skip-'); }).map((r) => r.book_id));
  if (!HOLD_REASON) { console.log('this profile holds no book: nothing to release'); return null; }
  const held = await db.collection('books').find({ 'pipeline_auto.hold.reason': HOLD_REASON }, { projection: { id: 1, title: 1 } }).toArray();
  const out = { held: held.length, released: [], kept_queue: 0, kept_withheld: 0 };
  for (const b of held) {
    if (open.has(b.id)) { out.kept_queue++; continue; }
    const w = await db.collection('pages').countDocuments({ book_id: b.id, 'translation_withheld.reason': { $gt: '' } });
    if (w) { out.kept_withheld++; continue; }
    const r = await releaseBook(db, b.id, { note: P5274 ? `#5274: every near-blank page of this book withheld for invented English is re-translated one page a call and no page is withheld (${JOB})` : `#5021: every wrong-leaf page of this book is re-translated one page a call and no page is withheld (${JOB})`, source: JOB, reason: HOLD_REASON }, { dryRun: !has('apply') });
    out.released.push({ id: b.id, title: String(b.title || '').slice(0, 60), outcome: r.outcome, to: r.to });
  }
  fs.writeFileSync(path.join(OUT, `release${has('apply') ? '' : '-dry'}.json`), JSON.stringify(out, null, 1));
  console.log(`held ${out.held}: ${out.released.length} ${has('apply') ? 'released' : 'would release'}; kept: ${out.kept_queue} with queued pages, ${out.kept_withheld} with a withheld page`);
  return out;
}

try {
  if (MODE === 'build') await (P5274 ? build5274() : build());
  if (MODE === 'enqueue') await enqueue();
  if (MODE === 'gate-pick') gatePick();
  if (MODE === 'run') await run();
  if (MODE === 'judge') await judge();
  if (MODE === 'gate-verdict') gateVerdict();
  if (MODE === 'release') await release();
  if (MODE === 'status') console.log(JSON.stringify(progress(), null, 1));
} finally {
  await client.close();
}
