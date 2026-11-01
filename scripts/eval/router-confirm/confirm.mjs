#!/usr/bin/env node
// PRIOR ART: scripts/eval/queue-routes-7853/ — the #7558 queue frame (census's page rule, the 4-page block), the arms
// (corr: the lane's own correction read + dry apply; plainRead: a fresh read N a call + dry apply) and the judge queue,
// all restated here because that study fixes OUT, its seeds and its selected.json at module level and cannot be pointed
// at another draw. scripts/eval/correction-pass-7818/lib.mjs judgeAbsolute / paceCheck / wrongText — imported
// unchanged (route-judge-6740/judge.mjs judgePrompt + opusCall + parseVerdict, the router's own judge).
// scripts/lib/router-binding.mjs loadCurrentTable — the live decisions; scripts/audit/router-binding.mjs
// servedByCrontab — the route production runs. None of them is a confirmation run: each study drew its own frame for
// its own question, and nothing re-tests a decision on books outside the evidence that made it (paper V4).
/**
 * V4 confirmation run (.claude/docs/router-optimization-paper.md, #7263): does a switch reproduce on fresh books?
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/router-confirm/confirm.mjs plan --cell=french-lite/print
 *        [--n=30] [--cur=ROUTE] [--seed=N] [--max-calls=80] [--out=DIR]     frame + draw + plan; no model call
 *   ... confirm.mjs arms  --cell=... [--concurrency=2]                       both routes on every drawn page (agy)
 *   ... confirm.mjs judge --cell=... [--max-calls=80] [--concurrency=3]      Opus judge, claude -p (subscription)
 *   ... confirm.mjs analyze --cell=...                                        the verdict; results/<cell>-<date>.json
 *
 * THE QUESTION. The cell's decided route (the WINNER, current.json) against the route production runs there now (the
 * CURRENT: the cron lane serving the cell in the repo's crontabs, else the route the table named before the switch, else
 * --cur), on the SAME pages, judged blind, one page per book, on books that are in none of the cell's evidence.
 *
 * FRAME (`<german|french>-lite/<script>`, the #7558 queue; other cells have no frame here and `plan` says so): visible
 * books in the language with an idle pipeline and no hold, in a seeded order (book-uniform, not page-weighted); in each,
 * one page uniform among its interior pages that still hold Flash-Lite text of 300+ characters, not human-edited, not
 * handwritten, of the cell's script class (lane-judge-sampler scriptClass). Excluded: every book named in a score file
 * any route of the cell's base cites in rules.json, and every book in lane_judge_verdicts.
 *
 * ROUTES this harness runs: `lite` (the stored text), `lite>agy-flash-low` (the #7558 lane's correction read, dry apply
 * with its guards), `agy-flash-low[@N]-read` (a fresh read of the page's N-page block, dry apply). A route the apply
 * refuses serves the stored text, as the lane would. Every reader runs under readonly-mongo.mjs: no database write.
 *
 * THE BAR (set before the data, from rules.json `switch`): d = acceptance(winner) - acceptance(current), paired.
 *   PASS  d >= -within (0.08) AND wrong-text rate(winner) <= wrong-text rate(current) + wrong_text_max (0.04)
 *   FAIL  otherwise
 *   VOID  a wrong-page control accepted, or more than 10% of pairs without two parsed verdicts
 * The 95% bootstrap interval of d is reported beside it: a PASS whose lower bound is under -within is a pass on the
 * point estimate that n cannot separate from a gap beyond the margin.
 */
import './readonly-mongo.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { loadCurrentTable } from '../../lib/router-binding.mjs';
import { servedByCrontab } from '../../audit/router-binding.mjs';
import { defaultCrontabs } from '../../audit/router-table-drift.mjs';
import { CORRECT_LANE, LITE_MODELS, IDLE_STATUSES, isInterior, lastPageNumber } from '../../batch/cli-ocr-lane.mjs';
import { VISIBLE_PAGE_MATCH } from '../../lib/page-counts.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { scriptClass } from '../lane-judge-sampler.mjs';
import { judgeAbsolute, paceCheck, wrongText } from '../correction-pass-7818/lib.mjs';
import { makeRng, resetSeed, bootstrapCI, binomTwoSided } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const RT = path.join(ROOT, 'scripts/eval/estimator/router-table');
const CLI = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
const PRELOAD = path.join(HERE, 'readonly-mongo.mjs');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const CELL = arg('cell');
const SLUG = String(CELL || '').replace(/[^a-z0-9]+/gi, '-');
const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'router-confirm', SLUG));
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => { fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true }); fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1)); };
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const shuffle = (xs, rnd) => { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const AGY_MODEL = 'gemini-3.8-flash-low';
export const DEFAULT_SEED = 20261101;
export const MAX_UNPARSED_SHARE = 0.10;
const LANG_NAME = { german: 'German', french: 'French' };

/** A route id → how this harness runs it, or null (not runnable here). */
export function routeRunner(id) {
  if (id === 'lite') return { kind: 'stored', calls_per_page: 0 };
  if (id === 'lite>agy-flash-low') return { kind: 'correct', calls_per_page: 1 };
  const m = /^agy-flash-low(?:@(\d+))?-read$/.exec(id);
  if (m) return { kind: 'read', per_call: Number(m[1] || 1), calls_per_page: 1 };
  return null;
}

/** The cell's frame, or null. Only the #7558 queue cells (Flash-Lite text in German or French) have one. */
export function frameFor(cell) {
  const m = /^(german|french)-lite\/(print|unknown|manuscript)$/.exec(cell);
  return m ? { base: `${m[1]}-lite`, lang: m[1], language_re: `^${LANG_NAME[m[1]]}`, script: m[2] } : null;
}

/** The route production runs in the cell: a crontab lane's route, else the table's route before the switch. */
export function currentRoute(row, served) {
  const lane = served.filter((s) => s.cell === row.id).map((s) => s.route);
  if (lane.length) return { route: lane[0], source: `cron lane (${[...new Set(lane)].join(', ')})` };
  const before = /→\s*(\S+)/.exec(String(row.before || ''))?.[1];
  if (before && before !== row.route) return { route: before, source: `the table's route before the switch (${row.before})` };
  return { route: row.current, source: 'the table row\'s `current`' };
}

/**
 * The verdict of a V4 run from paired per-page outcomes. pairs: [{win: {accept, wrong}, cur: {accept, wrong}} | null
 * where a verdict is missing]; controls: [{accept}]; rule: {within, wrong_text_max}.
 */
export function v4Verdict(pairs, controls, rule, { seed = DEFAULT_SEED } = {}) {
  const ok = pairs.filter((p) => p && p.win && p.cur);
  const unparsed = pairs.length - ok.length;
  const n = ok.length;
  const accW = ok.filter((p) => p.win.accept).length, accC = ok.filter((p) => p.cur.accept).length;
  const wrW = ok.filter((p) => p.win.wrong).length, wrC = ok.filter((p) => p.cur.wrong).length;
  const d = n ? (accW - accC) / n : null;
  resetSeed(seed);
  const ci = n >= 2 ? bootstrapCI(ok.map((p) => Number(p.win.accept) - Number(p.cur.accept))) : null;
  const gained = ok.filter((p) => p.win.accept && !p.cur.accept).length, lost = ok.filter((p) => !p.win.accept && p.cur.accept).length;
  const controlsAccepted = controls.filter((c) => c.accept).length;
  let verdict, why;
  if (controlsAccepted) { verdict = 'VOID'; why = `${controlsAccepted} wrong-page control(s) accepted`; }
  else if (!n || unparsed / pairs.length > MAX_UNPARSED_SHARE) { verdict = 'VOID'; why = `${unparsed} of ${pairs.length} pairs lack two parsed verdicts`; }
  else {
    const accOk = d >= -rule.within - 1e-12, wrongOk = wrW / n <= wrC / n + rule.wrong_text_max + 1e-12;
    verdict = accOk && wrongOk ? 'PASS' : 'FAIL';
    why = [accOk ? `d ${d.toFixed(3)} >= -${rule.within}` : `d ${d.toFixed(3)} < -${rule.within}`,
      wrongOk ? `wrong text ${wrW}/${n} within ${rule.wrong_text_max} of ${wrC}/${n}` : `wrong text ${wrW}/${n} over ${wrC}/${n} + ${rule.wrong_text_max}`].join('; ');
  }
  return { verdict, why, n, unparsed, winner: { k: accW, n, wrong_text: wrW }, current: { k: accC, n, wrong_text: wrC }, d, ci95: ci,
    separated: ci ? ci[0] >= -rule.within : false, gained, lost, sign_test_p: binomTwoSided(gained, gained + lost), controls: { n: controls.length, accepted: controlsAccepted } };
}

async function withDb(fn) { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); try { return await fn(c.db('bookstore')); } finally { await c.close(); } }

/**
 * The committed files behind the cell's evidence: every score file a route of the cell's base cites in rules.json, the
 * results folder of the study each came from (scripts/eval/<name>/results, route-judge-6740/results/<name>-*, the
 * score file's own `file`), recursively. A score file alone is not enough: most carry counts, not the drawn pages.
 */
export function evidenceSources(base, root = ROOT) {
  const rules = JSON.parse(fs.readFileSync(path.join(RT, 'rules.json'), 'utf8'));
  const cell = rules.cells.find((c) => c.id === base);
  if (!cell) throw new Error(`rules.json has no cell ${base}`);
  const scores = [...new Set(cell.routes.flatMap((r) => (r.evidence || []).map((e) => e.score)))];
  const dirs = new Set();
  const RJ = path.join(root, 'scripts/eval/route-judge-6740/results');
  for (const f of scores) {
    const abs = path.join(root, f);
    if (/\/results\//.test(f)) dirs.add(path.dirname(abs));
    const name = path.basename(f).replace(/\.score\.json$/, '');
    if (fs.existsSync(path.join(root, 'scripts/eval', name, 'results'))) dirs.add(path.join(root, 'scripts/eval', name, 'results'));
    for (const d of fs.readdirSync(RJ)) if (d.startsWith(`${name}-`)) dirs.add(path.join(RJ, d));
    try { const src = JSON.parse(fs.readFileSync(abs, 'utf8')).file; if (src && /\/results\//.test(src)) dirs.add(path.dirname(path.join(root, src))); } catch { /* listed as missing below */ }
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  return { scores, dirs: [...dirs].sort(), files: [...new Set([...scores.map((f) => path.join(root, f)), ...[...dirs].flatMap(walk)])].filter((f) => fs.existsSync(f)) };
}

/** Book ids of the cell's evidence (every 24-hex id in evidenceSources, page ids resolved to books), + lane_judge_verdicts. */
async function exclusions(db, base) {
  const src = evidenceSources(base);
  const ids = new Set(), per = {};
  for (const f of src.files) {
    let txt = fs.readFileSync(f);
    if (f.endsWith('.gz')) txt = (await import('node:zlib')).gunzipSync(txt);
    const found = String(txt).match(/[0-9a-f]{24}/g) || [];
    for (const x of found) ids.add(x);
    per[path.relative(ROOT, f)] = found.length;
  }
  const books = new Set(), all = [...ids];
  // an id may be a page's or a book's: resolve pages to their books, and keep every id as a possible book id
  for (let i = 0; i < all.length; i += 1000) for (const p of await db.collection('pages').find({ id: { $in: all.slice(i, i + 1000) } }, { projection: { book_id: 1 } }).toArray()) books.add(p.book_id);
  for (const x of all) books.add(x);
  for (const b of await db.collection('lane_judge_verdicts').distinct('book_id')) books.add(b);
  return { books, files: Object.fromEntries(Object.entries(per).filter(([, n]) => n)), dirs: src.dirs.map((d) => path.relative(ROOT, d)), ids: ids.size, with_lane_judge: books.size };
}

/** One eligible page of a book (the frame's page rule), its block of N, its stored text; or {skip}. */
async function pageOf(db, book, frame, rnd, perCall) {
  const { SKIP_TRANSLATION_PAGE_TYPES } = await import('../../lib/translate-core.mjs');
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id: book.id, ...VISIBLE_PAGE_MATCH, 'ocr.model': { $in: LITE_MODELS }, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' }, translation_withheld: { $ne: true }, page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'ocr.data': { $type: 'string' } } },
    { $project: { _id: 0, id: 1, page_number: 1, n: { $strLenCP: '$ocr.data' }, hw: { $regexMatch: { input: '$ocr.data', regex: '<script>\\s*handwritten', options: 'i' } } } },
    { $match: { n: { $gte: 300 }, hw: false } }, { $sort: { page_number: 1 } }]).toArray();
  if (!rows.length) return { skip: 'no Flash-Lite page waiting' };
  const last = await lastPageNumber(db, book.id);
  const owed = rows.filter((p) => isInterior(p.page_number, last));
  if (!owed.length) return { skip: 'no interior page waiting' };
  const pick = owed[Math.floor(rnd() * owed.length)];
  const all = await db.collection('pages').find({ book_id: book.id, ...VISIBLE_PAGE_MATCH }, { projection: { id: 1, book_id: 1, page_number: 1, script_type: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1, 'ocr.data': 1, 'ocr.model': 1 } }).sort({ page_number: 1 }).toArray();
  const i = all.findIndex((x) => x.id === pick.id);
  if (i < 0) return { skip: 'page gone' };
  const p = all[i];
  const sc = scriptClass(p.ocr?.data, p.script_type, null);
  if (sc.script_type !== frame.script) return { skip: `script ${sc.script_type}, not ${frame.script}` };
  const image = getPageSource(p);
  if (!image) return { skip: 'no image source' };
  if (all.length < perCall) return { skip: `book under ${perCall} pages` };
  const s = Math.min(i, all.length - perCall);
  return { page_id: p.id, page_number: p.page_number, image, block: all.slice(s, s + perCall).map((x) => x.id), stored: p.ocr.data, stored_model: p.ocr.model, script: sc,
    owed: owed.length };
}

async function plan() {
  if (!CELL) throw new Error('--cell=<cell id> is required');
  const table = loadCurrentTable();
  const row = table.rows.get(CELL);
  const rules = JSON.parse(fs.readFileSync(path.join(RT, 'rules.json'), 'utf8'));
  const switches = [...table.rows.values()].filter((r) => /^switch\b/.test(r.decision || '')).map((r) => ({ cell: r.id, route: r.route, pages_waiting: r.pages_waiting ?? 0 }))
    .sort((a, b) => a.pages_waiting - b.pages_waiting);
  const stop = (why) => { W('plan.json', { at: new Date().toISOString(), cell: CELL, refused: why, switch_cells: switches }); console.log(`plan refused: ${why}`); process.exit(2); };
  if (!row) stop(`current.json has no cell ${CELL}`);
  if (!/^switch\b/.test(row.decision || '')) stop(`${CELL} is "${row.decision}", not a switch`);
  const served = Object.entries(Object.fromEntries(defaultCrontabs(ROOT).map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]))).flatMap(([, t]) => servedByCrontab(t));
  const cur = arg('cur') ? { route: arg('cur'), source: '--cur' } : currentRoute(row, served);
  const win = row.route;
  if (cur.route === win) stop(`production already runs ${win} in ${CELL}: nothing to confirm against`);
  const runners = { win: routeRunner(win), cur: routeRunner(cur.route) };
  if (!runners.win || !runners.cur) stop(`not runnable here: ${[!runners.win && win, !runners.cur && cur.route].filter(Boolean).join(', ')}`);
  const frame = frameFor(CELL);
  if (!frame) stop(`no frame for ${CELL} (this harness draws the #7558 Flash-Lite queue cells only)`);
  const n = Number(arg('n') || 30), seed = Number(arg('seed') || DEFAULT_SEED);
  const perCall = Math.max(runners.win.per_call || 1, runners.cur.per_call || 1);
  const out = await withDb(async (db) => {
    const ex = await exclusions(db, frame.base);
    const books = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, language: { $regex: frame.language_re }, 'pipeline_auto.status': { $in: IDLE_STATUSES }, 'pipeline_auto.hold': { $exists: false }, 'pipeline_auto.held': { $ne: true } },
      { projection: { id: 1, title: 1, language: 1, year: 1, pages_count: 1 } }).toArray()).sort((a, b) => a.id.localeCompare(b.id));
    const rnd = makeRng(seed);
    const order = shuffle(books, rnd);
    const sel = [], skipped = {}; let tried = 0;
    const excluded = books.filter((b) => ex.books.has(b.id)).length;
    for (const b of order) {
      if (sel.length >= n) break;
      if (ex.books.has(b.id)) continue;
      tried++;
      const pg = await pageOf(db, b, frame, makeRng(seed + parseInt(b.id.replace(/[^0-9a-f]/g, '').slice(-6) || '0', 16)), perCall);
      if (pg.skip) { skipped[pg.skip] = (skipped[pg.skip] ?? 0) + 1; continue; }
      const key = `V4-${pg.page_id}`;
      fs.mkdirSync(path.join(OUT, 'texts'), { recursive: true });
      fs.writeFileSync(path.join(OUT, 'texts', `${key}.lite.txt`), pg.stored);
      sel.push({ key, book_id: b.id, title: String(b.title || '').slice(0, 80), language: b.language, year: b.year ?? null, page_id: pg.page_id, page_number: pg.page_number, image: pg.image, block: pg.block, stored_model: pg.stored_model, stored_sha: sha(pg.stored).slice(0, 16), script: pg.script, owed: pg.owed });
      console.log(`  ${sel.length}/${n} ${b.id} p.${pg.page_number} (${pg.owed} waiting) ${String(b.title || '').slice(0, 50)}`);
    }
    return { books_in_frame: books.length, excluded_books_in_frame: excluded, books_tried: tried, skipped, sel, ex };
  });
  const agyCalls = out.sel.length * (runners.win.calls_per_page + runners.cur.calls_per_page);
  const judgeCalls = out.sel.length * 2 + 2;
  const cap = Number(arg('max-calls') || 80);
  const p = {
    at: new Date().toISOString(), cell: CELL, table: row.table || table.name, decision: row.decision, pages_waiting: row.pages_waiting,
    winner: { route: win, ...runners.win, table_kn: (({ k, n: nn }) => `${k}/${nn}`)(row.routes.find((r) => r.id === win) || {}) },
    current: { route: cur.route, source: cur.source, ...runners.cur, table_kn: (({ k, n: nn }) => `${k}/${nn}`)(row.routes.find((r) => r.id === cur.route) || {}) },
    rule: { within: rules.switch.within, wrong_text_max: rules.switch.wrong_text_max, source: 'rules.json switch', max_unparsed_share: MAX_UNPARSED_SHARE },
    frame: { ...frame, books_in_frame: out.books_in_frame, excluded_books_in_frame: out.excluded_books_in_frame, books_tried: out.books_tried, skipped: out.skipped, exclusion_dirs: out.ex.dirs, exclusion_files: out.ex.files, evidence_ids: out.ex.ids, excluded_ids_and_books: out.ex.with_lane_judge, unit: 'one page a book, books uniform in a seeded order' },
    n_target: n, n_drawn: out.sel.length, seed, agy_model: AGY_MODEL, agy_home: process.env.AGY_HOME || null,
    budget: { agy_calls: agyCalls, judge_calls_max: judgeCalls, judge_cap: cap, fits: judgeCalls <= cap, note: 'judge calls: one per distinct text a page (identical arm texts are judged once) + 2 wrong-page controls' },
    switch_cells_by_volume: switches, selected: out.sel,
  };
  W('plan.json', p);
  const { selected, ...head } = p;
  console.log(JSON.stringify({ ...head, selected: selected.length }, null, 1));
  if (out.sel.length < n) console.log(`SHORT: ${out.sel.length}/${n} drawn`);
}

// ── arms ──
const T = (key, arm) => path.join(OUT, 'texts', `${key}.${arm}.txt`);
const readT = (key, arm) => (fs.existsSync(T(key, arm)) ? fs.readFileSync(T(key, arm), 'utf8') : null);
const writeT = (key, arm, t) => { fs.mkdirSync(path.join(OUT, 'texts'), { recursive: true }); fs.writeFileSync(T(key, arm), t); };
const ARMS_LOG = () => path.join(OUT, 'arms.jsonl');
const logRow = (row) => fs.appendFileSync(ARMS_LOG(), JSON.stringify({ ...row, at: new Date().toISOString() }) + '\n');
const doneArm = (arm) => new Set(jsonl(ARMS_LOG()).filter((r) => r.arm === arm && !r.quota).map((r) => r.key));

function node(args, log) {
  return new Promise((resolve) => {
    const out = fs.openSync(log, 'a');
    const child = spawn(process.execPath, [`--import=${PRELOAD}`, ...args], { stdio: ['ignore', out, out], env: { ...process.env, AGY_JOB: `router-confirm-${SLUG}` } });
    child.on('close', (code) => { fs.closeSync(out); resolve(code); });
  });
}
function template() {
  const tpl = path.join(OUT, 'fc-correct-prompt.txt');
  if (!fs.existsSync(tpl)) { const r = spawnSync(process.execPath, [`--import=${PRELOAD}`, path.join(ROOT, 'scripts/eval/flash-reread-5924/fc-prompt.mjs'), tpl], { stdio: 'inherit' }); if (r.status) throw new Error('fc-prompt.mjs refused'); }
  return tpl;
}
async function dryApply(dir, extra) {
  const emit = path.join(dir, 'emit.jsonl'); fs.rmSync(emit, { force: true });
  for (const f of fs.readdirSync(dir).filter((f) => /^apply-summary-dry/.test(f))) fs.rmSync(path.join(dir, f));
  const code = await node([CLI, 'apply', `--out=${dir}`, '--reason=#7263 V4 confirmation arm (dry run, never applied)', `--emit-written=${emit}`, ...extra], path.join(dir, 'apply.log'));
  const sum = fs.existsSync(path.join(dir, 'apply-summary-dry.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'apply-summary-dry.json'), 'utf8')) : {};
  return { code, emitted: new Map(jsonl(emit).map((r) => [r.page_id, r.text])), skipped: sum.skipped_pages || {} };
}
const meta = (dir, id) => { const f = path.join(dir, `${id}.meta.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };

/** One page through one route; writes texts/<key>.<arm>.txt (the served text) and a log row. Returns 'quota' to stop. */
async function runArm(arm, route, runner, s) {
  const lite = readT(s.key, 'lite');
  if (runner.kind === 'stored') { writeT(s.key, arm, lite); logRow({ key: s.key, arm, route, written: false, why: 'stored text', calls: 0 }); return null; }
  const dir = path.join(OUT, arm, s.book_id); fs.mkdirSync(dir, { recursive: true });
  const pages = runner.kind === 'read' && runner.per_call > 1 ? s.block : [s.page_id];
  const ids = path.join(dir, 'page-ids.json'); fs.writeFileSync(ids, JSON.stringify(pages));
  const common = [`--page-ids-file=${ids}`, `--out=${dir}`, `--model=${AGY_MODEL}`, `--job=router-confirm-${SLUG}`, '--stop-on-quota'];
  const readArgs = runner.kind === 'correct' ? [...common, `--correct-prompt=${template()}`, `--lane=${CORRECT_LANE}`]
    : [...common, ...(runner.per_call > 1 ? [`--per-call=${runner.per_call}`] : [])];
  const code = await node([CLI, 'read', ...readArgs], path.join(dir, 'read.log'));
  if (code === 3) { logRow({ key: s.key, arm, route, quota: true }); return 'quota'; }
  const ap = await dryApply(dir, runner.kind === 'correct' ? [`--mark-stale=${CORRECT_LANE}`] : []);
  const served = ap.emitted.get(s.page_id) ?? null, m = meta(dir, s.page_id);
  const raw = fs.existsSync(path.join(dir, `${s.page_id}.txt`)) ? fs.readFileSync(path.join(dir, `${s.page_id}.txt`), 'utf8') : '';
  if (raw) writeT(s.key, `${arm}-read`, raw);
  writeT(s.key, arm, served ?? lite);   // a refused read serves the stored text, as the lane would
  const why = served != null ? 'written' : ap.skipped[s.page_id] ?? (m ? 'not in dry-run output' : 'not read');
  logRow({ key: s.key, arm, route, read_exit: code, apply_exit: ap.code, meta_exit: m?.exit ?? null, written: served != null, why, call_pages: pages.length });
  console.log(`  ${arm} ${route} ${s.key}: ${why}`);
  return null;
}

async function arms() {
  const P = J('plan.json');
  const conc = Math.max(1, Math.min(2, Number(arg('concurrency') || 2)));
  for (const [arm, R] of [['cur', P.current], ['win', P.winner]]) {
    const have = doneArm(arm);
    const todo = P.selected.filter((s) => !have.has(s.key));
    let i = 0, stop = null;
    await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length) { const s = todo[i++]; if (await runArm(arm, R.route, R, s) === 'quota') stop = 'agy quota'; } }));
    console.log(`${arm} (${R.route}): ${doneArm(arm).size}/${P.selected.length}${stop ? `; STOPPED: ${stop} (rerun resumes)` : ''}`);
    if (stop) return;
  }
}

// ── judge ──
const VO = () => path.join(OUT, 'verdicts.jsonl');
const imageCache = new Map();
async function imageFor(key, url) {
  const f = path.join(OUT, 'img', `${key}.jpg`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  if (imageCache.has(key)) return imageCache.get(key);
  const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/7263 (https://sourcelibrary.org)' } });
  if (!r.ok) throw new Error(`image HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 2000) throw new Error('image under 2 KB');
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
  return buf;
}

/** Judge items: one per distinct served text a page (blind: no arm, no route in the prompt), + 2 wrong-page controls. */
export function judgeItems(selected, textOf, seed = DEFAULT_SEED) {
  const items = [];
  for (const s of selected) {
    const byText = new Map();
    for (const arm of ['win', 'cur']) { const t = textOf(s.key, arm); if (t == null) continue; const h = sha(t).slice(0, 16); if (!byText.has(h)) byText.set(h, { id: `${s.key}:${h}`, set: 'abs', key: s.key, page_id: s.page_id, text_sha: h, arms: [] }); byText.get(h).arms.push(arm); }
    items.push(...byText.values());
  }
  const rnd = makeRng(seed + 1);
  const pool = shuffle(selected.filter((s) => textOf(s.key, 'win') != null), rnd);
  const controls = [];
  for (let j = 0; j + 1 < pool.length && controls.length < 2; j += 2) {
    const a = pool[j], b = pool[j + 1];
    controls.push({ id: `wp-${a.key}-${b.key}`, set: 'wrong_page', key: a.key, page_id: a.page_id, text_of: b.key, arms: ['win'] });
  }
  return { items: shuffle(items, makeRng(seed + 2)), controls };
}

async function judge() {
  const P = J('plan.json');
  const lang = LANG_NAME[frameFor(P.cell).lang];
  const { items, controls } = judgeItems(P.selected, readT);
  const have = jsonl(VO()), done = new Set(have.filter((r) => r.verdict).map((r) => r.id));
  const cap = Number(arg('max-calls') || 80), made = have.filter((r) => r.verdict || r.usage).length;
  const todo = [...controls, ...items].filter((it) => !done.has(it.id));
  console.log(`judge: ${items.length} items + ${controls.length} controls; ${todo.length} to do; ${made} calls made; cap ${cap}`);
  const limits = await import('../../lib/model-limits.mjs');
  const state = {}, bySel = new Map(P.selected.map((s) => [s.key, s]));
  let calls = 0, i = 0, stop = null;
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  await Promise.all(Array.from({ length: conc }, async () => {
    while (!stop && i < todo.length) {
      if (made + calls >= cap) { stop = `call cap ${cap}`; break; }
      const why = await paceCheck(limits, state);
      if (why) { stop = `pace: ${why}`; break; }
      const it = todo[i++]; calls++;
      const s = bySel.get(it.key);
      const text = it.set === 'wrong_page' ? readT(it.text_of, 'win') : readT(it.key, it.arms[0]);
      const img = await imageFor(s.key, s.image);
      const r = await judgeAbsolute({ lang, text }, img);
      if (r.cls === 'quota') { limits.noteLimitHit('claude', { reason: String(r.raw || '').slice(0, 200) }); stop = 'quota reply'; break; }
      fs.appendFileSync(VO(), JSON.stringify({ ...it, ...r, at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.set} ${it.id}: ${r.verdict ? `accept=${r.verdict.accept} f${r.verdict.fidelity}${wrongText(r.verdict) ? ' WRONG-TEXT' : ''}` : 'unparsed'}`);
    }
  }));
  console.log(`${calls} calls this run; ${stop ? `STOPPED: ${stop}` : 'queue done'}; meter ${JSON.stringify(state.meter ?? null)}`);
}

// ── analyze ──
async function analyze() {
  const P = J('plan.json');
  const V = jsonl(VO()).filter((r) => r.verdict);
  const last = new Map(); for (const r of V) last.set(r.id, r);
  const { items, controls } = judgeItems(P.selected, readT);
  const vOf = (key, arm) => { const it = items.find((x) => x.key === key && x.arms.includes(arm)); const r = it && last.get(it.id); return r ? { accept: !!r.verdict.accept, wrong: wrongText(r.verdict), fidelity: r.verdict.fidelity } : null; };
  const pairs = P.selected.map((s) => { const w = vOf(s.key, 'win'), c = vOf(s.key, 'cur'); return w && c ? { key: s.key, book_id: s.book_id, win: w, cur: c } : null; });
  const ctl = controls.map((c) => last.get(c.id)).filter(Boolean).map((r) => ({ id: r.id, accept: !!r.verdict.accept }));
  const rule = P.rule;
  const v = v4Verdict(pairs, ctl, rule);
  const armRows = jsonl(ARMS_LOG());
  const lastArm = new Map(); for (const r of armRows.filter((x) => !x.quota)) lastArm.set(`${r.key}:${r.arm}`, r);
  const outcome = (arm) => { const t = {}; for (const s of P.selected) { const r = lastArm.get(`${s.key}:${arm}`); const k = r ? (r.written ? 'written' : r.why) : 'not run'; t[k] = (t[k] ?? 0) + 1; } return t; };
  const identical = P.selected.filter((s) => readT(s.key, 'win') != null && readT(s.key, 'win') === readT(s.key, 'cur')).length;
  const calls = jsonl(VO()).filter((r) => r.verdict || r.usage).length;
  const w = (k, n) => (n ? wilson(k, n, 1.645).map((x) => +x.toFixed(3)) : null);
  const res = {
    at: new Date().toISOString(), cell: P.cell, table: P.table, decision: P.decision, pages_waiting: P.pages_waiting,
    winner: { ...P.winner, fresh: `${v.winner.k}/${v.n}`, fresh_ci90: w(v.winner.k, v.n), wrong_text: v.winner.wrong_text, served_outcomes: outcome('win') },
    current: { ...P.current, fresh: `${v.current.k}/${v.n}`, fresh_ci90: w(v.current.k, v.n), wrong_text: v.current.wrong_text, served_outcomes: outcome('cur') },
    rule, verdict: v.verdict, why: v.why, d: v.d == null ? null : +v.d.toFixed(3), d_ci95: v.ci95?.map((x) => +x.toFixed(3)) ?? null, separated_from_margin: v.separated,
    gained: v.gained, lost: v.lost, sign_test_p: +v.sign_test_p.toFixed(4), pairs: v.n, unparsed_pairs: v.unparsed, identical_texts: identical,
    controls: v.controls, judge_calls: calls, frame: P.frame, n_drawn: P.n_drawn, seed: P.seed,
    per_page: pairs.map((p, i) => ({ book_id: P.selected[i].book_id, page_id: P.selected[i].page_id, page_number: P.selected[i].page_number, win: p?.win ?? null, cur: p?.cur ?? null })),
  };
  fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
  const file = path.join(HERE, 'results', `${SLUG}-${res.at.slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(res, null, 1) + '\n');
  const { per_page, frame, ...head } = res;
  console.log(JSON.stringify(head, null, 1));
  console.log(`-> ${path.relative(ROOT, file)}`);
}

const stages = { plan, arms, judge, analyze };
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[process.argv[2]]();
}
