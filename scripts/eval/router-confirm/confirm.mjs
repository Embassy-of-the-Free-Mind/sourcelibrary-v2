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
 *        [--routes=COMPARATOR,ARM,...] [--min-words=N] [--page-type=text]    name the arms (first = comparator)
 *   ... confirm.mjs drop  --cell=... --keys=K,... --why=TEXT [--n=30]        drop pages seen to be outside the cell
 *   ... confirm.mjs arms  --cell=... [--concurrency=2]                       every route on every drawn page (agy)
 *   ... confirm.mjs judge --cell=... [--max-calls=80] [--concurrency=3]      Opus judge, claude -p (subscription)
 *   ... confirm.mjs analyze --cell=... [--results=DIR]                        the verdict; results/<cell>-<date>.json
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
import { CORRECT_LANE, LITE_MODELS, IDLE_STATUSES, isInterior, lastPageNumber, rereadReadArgs, rereadApplyArgs } from '../../batch/cli-ocr-lane.mjs';
import { VISIBLE_PAGE_MATCH } from '../../lib/page-counts.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { scriptClass } from '../lane-judge-sampler.mjs';
import { judgeAbsolute, paceCheck, wrongText, stripFurniture } from '../correction-pass-7818/lib.mjs';
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
const LANG_NAME = { german: 'German', french: 'French', latin: 'Latin' };
/** Words of a page's text, furniture tags (header, page-type, ...) and markup removed: the frame's --min-words unit. */
export const wordCount = (t) => (stripFurniture(t).replace(/<[^>]+>/g, ' ').match(/\p{L}[\p{L}\p{M}'’-]*/gu) || []).length;

/** A route id → how this harness runs it, or null (not runnable here). */
export function routeRunner(id) {
  if (id === 'lite') return { kind: 'stored', calls_per_page: 0 };
  if (id === 'lite>agy-flash-low') return { kind: 'correct', calls_per_page: 1 };
  const m = /^agy-flash-low(?:@(\d+))?-read$/.exec(id);
  if (m) return { kind: 'read', per_call: Number(m[1] || 1), calls_per_page: 1 };
  return null;
}

/**
 * The cell's frame, or null. The #7558 queue cells (Flash-Lite text in German or French) and latin-lite (#7263,
 * 2026-11-03: the same page rule over live Latin books; no lane serves the cell yet, so there is no queue to mirror).
 */
export function frameFor(cell) {
  const m = /^(german|french|latin)-lite\/(print|unknown|manuscript)$/.exec(cell);
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
async function pageOf(db, book, frame, rnd, perCall, { minWords = 0, pageType = null } = {}) {
  const { SKIP_TRANSLATION_PAGE_TYPES } = await import('../../lib/translate-core.mjs');
  const rows0 = await db.collection('pages').aggregate([
    { $match: { book_id: book.id, ...VISIBLE_PAGE_MATCH, 'ocr.model': { $in: LITE_MODELS }, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' }, translation_withheld: { $ne: true }, page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'ocr.data': { $type: 'string' } } },
    { $project: { _id: 0, id: 1, page_number: 1, n: { $strLenCP: '$ocr.data' }, hw: { $regexMatch: { input: '$ocr.data', regex: '<script>\\s*handwritten', options: 'i' } },
      pt: pageType ? { $regexMatch: { input: '$ocr.data', regex: `<page-type>\\s*${pageType}\\s*</page-type>`, options: 'i' } } : { $literal: true }, ...(minWords ? { data: '$ocr.data' } : {}) } },
    { $match: { n: { $gte: 300 }, hw: false, pt: true } }, { $sort: { page_number: 1 } }]).toArray();
  // --min-words (latin-lite, #7263 2026-11-03: a body page of 150+ words) is counted on the stored text, before the pick
  const rows = minWords ? rows0.filter((r) => wordCount(r.data) >= minWords).map(({ data, ...r }) => r) : rows0;
  if (!rows.length) return { skip: rows0.length ? `no Flash-Lite page of ${minWords}+ words` : 'no Flash-Lite page waiting' };
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
  // the bytes the readers and the judge will see: a placeholder (a 457-byte black IIIF tile, 2026-11-01) is no page
  try { const r = await fetch(image); const n = (await r.arrayBuffer()).byteLength; if (!r.ok || n < 2000) return { skip: `image ${r.ok ? `under 2 KB (${n} B)` : `HTTP ${r.status}`}` }; } catch (e) { return { skip: `image fetch failed (${String(e.message).slice(0, 40)})` }; }
  if (all.length < perCall) return { skip: `book under ${perCall} pages` };
  const s = Math.min(i, all.length - perCall);
  return { page_id: p.id, page_number: p.page_number, image, block: all.slice(s, s + perCall).map((x) => x.id), stored: p.ocr.data, stored_model: p.ocr.model, script: sc,
    owed: owed.length, words: wordCount(p.ocr.data) };
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
  // --routes=COMPARATOR,ARM,... (#7263, 2026-11-03): a decision taken outside the table (latin-lite/print is "keep
  // lite>opus" in current.json; Derek's 2026-11-01 row names lite>agy-flash-low). Every arm is compared with the first.
  const routesArg = arg('routes') ? arg('routes').split(',').map((x) => x.trim()).filter(Boolean) : null;
  if (routesArg && routesArg.length < 2) stop('--routes needs a comparator and at least one arm');
  if (!routesArg && !/^switch\b/.test(row.decision || '')) stop(`${CELL} is "${row.decision}", not a switch (name the arms with --routes=)`);
  const served = Object.entries(Object.fromEntries(defaultCrontabs(ROOT).map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]))).flatMap(([, t]) => servedByCrontab(t));
  const cur = routesArg ? { route: routesArg[0], source: '--routes (the comparator)' } : arg('cur') ? { route: arg('cur'), source: '--cur' } : currentRoute(row, served);
  const win = routesArg ? routesArg[1] : row.route;
  if (cur.route === win) stop(`production already runs ${win} in ${CELL}: nothing to confirm against`);
  const runners = { win: routeRunner(win), cur: routeRunner(cur.route) };
  if (!runners.win || !runners.cur) stop(`not runnable here: ${[!runners.win && win, !runners.cur && cur.route].filter(Boolean).join(', ')}`);
  const armRoutes = routesArg ? routesArg.map((r, i) => ({ arm: i === 0 ? 'served' : String.fromCharCode(65 + i), route: r, ...routeRunner(r) })) : null;
  if (armRoutes?.some((a) => !a.kind)) stop(`not runnable here: ${armRoutes.filter((a) => !a.kind).map((a) => a.route).join(', ')}`);
  const frame = frameFor(CELL);
  if (!frame) stop(`no frame for ${CELL} (this harness draws the #7558 Flash-Lite queue cells only)`);
  const n = Number(arg('n') || 30), seed = Number(arg('seed') || DEFAULT_SEED);
  const perCall = Math.max(runners.win.per_call || 1, runners.cur.per_call || 1, ...(armRoutes || []).map((a) => a.per_call || 1));
  const pageRule = { minWords: Number(arg('min-words') || 0), pageType: arg('page-type') || null };
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
      const pg = await pageOf(db, b, frame, makeRng(seed + parseInt(b.id.replace(/[^0-9a-f]/g, '').slice(-6) || '0', 16)), perCall, pageRule);
      if (pg.skip) { skipped[pg.skip] = (skipped[pg.skip] ?? 0) + 1; continue; }
      const key = `V4-${pg.page_id}`;
      fs.mkdirSync(path.join(OUT, 'texts'), { recursive: true });
      fs.writeFileSync(path.join(OUT, 'texts', `${key}.lite.txt`), pg.stored);
      sel.push({ key, book_id: b.id, title: String(b.title || '').slice(0, 80), language: b.language, year: b.year ?? null, page_id: pg.page_id, page_number: pg.page_number, image: pg.image, block: pg.block, stored_model: pg.stored_model, stored_sha: sha(pg.stored).slice(0, 16), words: pg.words, script: pg.script, owed: pg.owed });
      console.log(`  ${sel.length}/${n} ${b.id} p.${pg.page_number} (${pg.owed} waiting) ${String(b.title || '').slice(0, 50)}`);
    }
    return { books_in_frame: books.length, excluded_books_in_frame: excluded, books_tried: tried, skipped, sel, ex };
  });
  const agyCalls = out.sel.length * (armRoutes ? armRoutes.reduce((a, r) => a + r.calls_per_page, 0) : runners.win.calls_per_page + runners.cur.calls_per_page);
  const judgeCalls = out.sel.length * (armRoutes ? armRoutes.length : 2) + 2;
  const cap = Number(arg('max-calls') || 80);
  const p = {
    at: new Date().toISOString(), cell: CELL, table: row.table || table.name, decision: row.decision, pages_waiting: row.pages_waiting,
    winner: { route: win, ...runners.win, table_kn: (({ k, n: nn }) => `${k}/${nn}`)(row.routes.find((r) => r.id === win) || {}) },
    current: { route: cur.route, source: cur.source, ...runners.cur, table_kn: (({ k, n: nn }) => `${k}/${nn}`)(row.routes.find((r) => r.id === cur.route) || {}) },
    rule: { within: rules.switch.within, wrong_text_max: rules.switch.wrong_text_max, source: 'rules.json switch', max_unparsed_share: MAX_UNPARSED_SHARE },
    arms: armRoutes, page_rule: { min_chars: 300, min_words: pageRule.minWords || null, page_type: pageRule.pageType },
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

/**
 * `drop --keys=K1,K2 --why=TEXT [--n=30]`, between plan and arms: drop drawn pages seen on the image to be outside the
 * cell (latin-lite/print, #7947: a manuscript goes to another reader), then keep the first n of the rest in draw order.
 * Refused once an arm has run, so a drop cannot follow the outcome.
 */
async function drop() {
  const P = J('plan.json');
  if (jsonl(ARMS_LOG()).some((r) => r.arm !== 'served')) throw new Error('drop: arms have run; a drop now would follow the outcome');
  const keys = new Set(String(arg('keys') || '').split(',').filter(Boolean));
  const why = arg('why'); if (!why) throw new Error('--why= is required');
  const unknown = [...keys].filter((k) => !P.selected.some((s) => s.key === k)); if (unknown.length) throw new Error(`not drawn: ${unknown.join(', ')}`);
  P.dropped_by_eye = [...(P.dropped_by_eye || []), ...P.selected.filter((s) => keys.has(s.key)).map((s) => ({ key: s.key, book_id: s.book_id, page_id: s.page_id, why }))];
  P.by_eye_checks = [...(P.by_eye_checks || []), { at: new Date().toISOString(), why, checked: P.selected.length, dropped: keys.size }];
  const rest = P.selected.filter((s) => !keys.has(s.key));
  const n = Number(arg('n') || P.n_target);
  P.surplus = [...(P.surplus || []), ...rest.slice(n).map((s) => ({ key: s.key, book_id: s.book_id, page_id: s.page_id }))];
  P.selected = rest.slice(0, n);
  P.n_drawn = P.selected.length;
  W('plan.json', P);
  console.log(`dropped ${keys.size} (${why}); kept ${P.selected.length}; surplus ${P.surplus.length}; dropped by eye in all ${P.dropped_by_eye.length}`);
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
const REASON = '#7263 V4 confirmation arm (dry run, never applied)';
/** extra: more apply flags; or full: the whole apply argv (the lane's own builder's, without --apply). Always a dry run. */
async function dryApply(dir, extra, full = null) {
  const emit = path.join(dir, 'emit.jsonl'); fs.rmSync(emit, { force: true });
  for (const f of fs.readdirSync(dir).filter((f) => /^apply-summary-dry/.test(f))) fs.rmSync(path.join(dir, f));
  const argv = full ? [...full, `--emit-written=${emit}`] : [CLI, 'apply', `--out=${dir}`, `--reason=${REASON}`, `--emit-written=${emit}`, ...extra];
  if (argv.includes('--apply')) throw new Error('dryApply: --apply in a confirmation arm');
  const code = await node(argv, path.join(dir, 'apply.log'));
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
  // the re-read: the lane's own argv (cli-ocr-lane.mjs rereadReadArgs / rereadApplyArgs: --lane, --print-only,
  // --only, --mark-stale), so its apply guards are the lane's (#7263, 2026-11-03; the 11-01 French run had no --print-only)
  const job = `router-confirm-${SLUG}`;
  const readArgv = runner.kind === 'correct' ? [CLI, 'read', ...common, `--correct-prompt=${template()}`, `--lane=${CORRECT_LANE}`]
    : rereadReadArgs({ cli: CLI, ids, dir, model: AGY_MODEL, job, perCall: runner.per_call });
  const code = await node(readArgv, path.join(dir, 'read.log'));
  if (code === 3) { logRow({ key: s.key, arm, route, quota: true }); return 'quota'; }
  const ap = runner.kind === 'correct' ? await dryApply(dir, [`--mark-stale=${CORRECT_LANE}`])
    : await dryApply(dir, null, rereadApplyArgs({ cli: CLI, ids, dir, reason: REASON, apply: false }));
  const served = ap.emitted.get(s.page_id) ?? null, m = meta(dir, s.page_id);
  const raw = fs.existsSync(path.join(dir, `${s.page_id}.txt`)) ? fs.readFileSync(path.join(dir, `${s.page_id}.txt`), 'utf8') : '';
  if (raw) writeT(s.key, `${arm}-read`, raw);
  writeT(s.key, arm, served ?? lite);   // a refused read serves the stored text, as the lane would
  const why = served != null ? 'written' : ap.skipped[s.page_id] ?? (m ? 'not in dry-run output' : 'not read');
  logRow({ key: s.key, arm, route, read_exit: code, apply_exit: ap.code, meta_exit: m?.exit ?? null, written: served != null, why, call_pages: pages.length });
  console.log(`  ${arm} ${route} ${s.key}: ${why}`);
  return null;
}

/** The plan's arms in run order: [{arm, route, kind, per_call}]. A two-route plan (no --routes) is cur then win. */
export const planArms = (P) => (P.arms?.length ? P.arms : [{ arm: 'cur', ...P.current }, { arm: 'win', ...P.winner }]);

async function arms() {
  const P = J('plan.json');
  const conc = Math.max(1, Math.min(2, Number(arg('concurrency') || 2)));
  for (const R of planArms(P)) {
    const arm = R.arm;
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
export function judgeItems(selected, textOf, seed = DEFAULT_SEED, armIds = ['win', 'cur']) {
  const items = [];
  const ctlArm = armIds[0];   // a wrong-page control carries another page's text from this arm
  for (const s of selected) {
    const byText = new Map();
    for (const arm of armIds) { const t = textOf(s.key, arm); if (t == null) continue; const h = sha(t).slice(0, 16); if (!byText.has(h)) byText.set(h, { id: `${s.key}:${h}`, set: 'abs', key: s.key, page_id: s.page_id, text_sha: h, arms: [] }); byText.get(h).arms.push(arm); }
    items.push(...byText.values());
  }
  const rnd = makeRng(seed + 1);
  const pool = shuffle(selected.filter((s) => textOf(s.key, ctlArm) != null), rnd);
  const controls = [];
  for (let j = 0; j + 1 < pool.length && controls.length < 2; j += 2) {
    const a = pool[j], b = pool[j + 1];
    controls.push({ id: `wp-${a.key}-${b.key}`, set: 'wrong_page', key: a.key, page_id: a.page_id, text_of: b.key, arms: [ctlArm] });
  }
  return { items: shuffle(items, makeRng(seed + 2)), controls };
}

/** Arm ids in judge order: the arms under test first (the first carries the wrong-page controls), the comparator last. */
export const judgeArmIds = (P) => (P.arms?.length ? [...P.arms.slice(1), P.arms[0]].map((a) => a.arm) : ['win', 'cur']);

async function judge() {
  const P = J('plan.json');
  const lang = P.lang_name ?? LANG_NAME[frameFor(P.cell).lang];   // a plan from another draw names its language (zh-gemini-reocr-7263)
  let { items, controls } = judgeItems(P.selected, readT, DEFAULT_SEED, judgeArmIds(P));
  // --retest=ARM,...: those arms' texts and the controls judged again under a `#retest` id, mixed into the queue (the
  // earlier verdicts stay, zh-reocr-cheap-arms-7263): a same-sitting row for the comparator and a test-retest figure.
  // --retest-tag=NAME: a later sitting's ids (`#NAME`), so its comparator and controls are judged again in that sitting too.
  const retest = String(arg('retest') || '').split(',').filter(Boolean);
  if (retest.length) {
    const again = (it) => ({ ...it, id: `${it.id}#${arg('retest-tag') || 'retest'}` });
    items = shuffle([...items, ...items.filter((it) => it.arms.some((x) => retest.includes(x))).map(again)], makeRng(DEFAULT_SEED + 3));
    controls = [...controls, ...controls.map(again)];
  }
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
      const text = it.set === 'wrong_page' ? readT(it.text_of, it.arms[0]) : readT(it.key, it.arms[0]);
      let img;
      // a page with no usable image (a placeholder, a dead link) is no route outcome: recorded, dropped from both arms
      try { img = await imageFor(s.key, s.image); } catch (e) {
        calls--; fs.appendFileSync(VO(), JSON.stringify({ ...it, image_error: e.message, at: new Date().toISOString() }) + '\n');
        console.log(`  ${it.set} ${it.id}: no image (${e.message})`); continue;
      }
      const r = await judgeAbsolute({ lang, text }, img);
      if (r.cls === 'quota') { limits.noteLimitHit('claude', { reason: String(r.raw || '').slice(0, 200) }); stop = 'quota reply'; break; }
      fs.appendFileSync(VO(), JSON.stringify({ ...it, ...r, at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.set} ${it.id}: ${r.verdict ? `accept=${r.verdict.accept} f${r.verdict.fidelity}${wrongText(r.verdict) ? ' WRONG-TEXT' : ''}` : 'unparsed'}`);
    }
  }));
  console.log(`${calls} calls this run; ${stop ? `STOPPED: ${stop}` : 'queue done'}; meter ${JSON.stringify(state.meter ?? null)}`);
}

// ── analyze ──
const SEVERE = new Set(['misleads', 'wrong_text']);
/** Severe defects (misleads + wrong_text) and wrong_text per 1,000 words of the PAGE (stored text's words), pooled, with a
 *  95% bootstrap interval over pages (one page a book, so over books). rows: [{words, severe, wrong}]. */
export function per1k(rows, seed = DEFAULT_SEED, iters = 10000) {
  const W = rows.reduce((a, r) => a + r.words, 0);
  const rate = (rs, k) => { const w = rs.reduce((a, r) => a + r.words, 0); return w ? (1000 * rs.reduce((a, r) => a + r[k], 0)) / w : 0; };
  const ci = (k) => { const rnd = makeRng(seed + 7); const xs = []; for (let i = 0; i < iters; i++) xs.push(rate(Array.from({ length: rows.length }, () => rows[Math.floor(rnd() * rows.length)]), k)); xs.sort((a, b) => a - b); return [xs[Math.floor(0.025 * iters)], xs[Math.floor(0.975 * iters)]].map((x) => +x.toFixed(2)); };
  return { pages: rows.length, words: W, severe: rows.reduce((a, r) => a + r.severe, 0), severe_per_1k: +rate(rows, 'severe').toFixed(2), severe_per_1k_ci95: rows.length > 1 ? ci('severe') : null,
    wrong_text_defects: rows.reduce((a, r) => a + r.wrong, 0), wrong_text_per_1k: +rate(rows, 'wrong').toFixed(2), wrong_text_per_1k_ci95: rows.length > 1 ? ci('wrong') : null };
}

/** Three-or-more-arm plans (--routes): every arm against the comparator under the V4 bar, the arms against each other. */
async function analyzeArms(P) {
  const V = jsonl(VO()).filter((r) => r.verdict);
  const last = new Map(); for (const r of V) last.set(r.id, r);
  const noImage = new Set(jsonl(VO()).filter((r) => r.image_error).map((r) => r.key));
  const ids = judgeArmIds(P);
  const { items, controls: allControls } = judgeItems(P.selected, readT, DEFAULT_SEED, ids);
  const sel = P.selected.filter((s) => !noImage.has(s.key));
  const ctl = allControls.filter((c) => !noImage.has(c.key)).map((c) => last.get(c.id)).filter(Boolean).map((r) => ({ id: r.id, accept: !!r.verdict.accept, fidelity: r.verdict.fidelity }));
  const vOf = (key, arm) => { const it = items.find((x) => x.key === key && x.arms.includes(arm)); const r = it && last.get(it.id); if (!r) return null;
    const d = r.verdict.defects || [];
    return { accept: !!r.verdict.accept, wrong: wrongText(r.verdict), fidelity: r.verdict.fidelity, severe: d.filter((x) => SEVERE.has(x.severity)).length, misleads: d.filter((x) => x.severity === 'misleads').length, wrong_defects: d.filter((x) => x.severity === 'wrong_text').length, item: it.id }; };
  const cmp = P.arms[0].arm;
  const armRows = jsonl(ARMS_LOG());
  const lastArm = new Map(); for (const r of armRows.filter((x) => !x.quota)) lastArm.set(`${r.key}:${r.arm}`, r);
  const outcome = (arm) => { const t = {}; for (const s of sel) { const r = lastArm.get(`${s.key}:${arm}`); const k = r ? (r.written ? 'written' : r.why) : 'not run'; t[k] = (t[k] ?? 0) + 1; } return t; };
  const w90 = (k, n) => (n ? wilson(k, n, 1.645).map((x) => +x.toFixed(3)) : null);
  const words = new Map(sel.map((s) => [s.key, s.words ?? wordCount(readT(s.key, 'lite'))]));
  const defects = (arm) => per1k(sel.map((s) => ({ s, v: vOf(s.key, arm) })).filter((x) => x.v).map(({ s, v }) => ({ words: words.get(s.key), severe: v.severe, wrong: v.wrong_defects })));
  const paired = (a, b) => sel.map((s) => { const x = vOf(s.key, a), y = vOf(s.key, b); return x && y ? { key: s.key, win: x, cur: y } : null; });
  const fmt = (v) => ({ verdict: v.verdict, why: v.why, n: v.n, unparsed: v.unparsed, arm_kn: v.winner, comparator_kn: v.current, d: v.d == null ? null : +v.d.toFixed(3), d_ci95: v.ci95?.map((x) => +x.toFixed(3)) ?? null,
    separated_from_margin: v.separated, gained: v.gained, lost: v.lost, sign_test_p: +v.sign_test_p.toFixed(4) });
  const arms = {};
  for (const a of P.arms) {
    const ok = sel.map((s) => vOf(s.key, a.arm)).filter(Boolean);
    arms[a.arm] = { route: a.route, kind: a.kind, per_call: a.per_call ?? null, accepted: `${ok.filter((x) => x.accept).length}/${ok.length}`, ci90: w90(ok.filter((x) => x.accept).length, ok.length),
      wrong_text_pages: ok.filter((x) => x.wrong).length, served_outcomes: outcome(a.arm), defects: defects(a.arm),
      identical_to_comparator: a.arm === cmp ? null : sel.filter((s) => readT(s.key, a.arm) != null && readT(s.key, a.arm) === readT(s.key, cmp)).length,
      vs_comparator: a.arm === cmp ? null : fmt(v4Verdict(paired(a.arm, cmp), ctl, P.rule)) };
  }
  // the defect-rates shape experiments-lint reads (defectRatesShapeOk: study_cells → route → misleads / wrong_text per 1k + fidelity_mean)
  const study_cells = Object.fromEntries(P.arms.map((a) => {
    const vs = sel.map((s) => ({ s, v: vOf(s.key, a.arm) })).filter((x) => x.v), W = vs.reduce((t, x) => t + words.get(x.s.key), 0);
    const per = (k) => (W ? +((1000 * vs.reduce((t, x) => t + x.v[k], 0)) / W).toFixed(2) : null);
    return [`${P.cell} ${a.route}`, { route: a.route, pages: vs.length, words: W, fidelity_mean: vs.length ? +(vs.reduce((t, x) => t + x.v.fidelity, 0) / vs.length).toFixed(2) : null,
      misleads_per_1k: per('misleads'), wrong_text_per_1k: per('wrong_defects'), severe_per_1k: per('severe'), unit: 'defects in the judge verdict per 1,000 words of the page (stored text word count)' }];
  }));
  const between = [];
  for (let i = 1; i < P.arms.length; i++) for (let j = i + 1; j < P.arms.length; j++) {
    const a = P.arms[j].arm, b = P.arms[i].arm;   // d = acc(later arm) - acc(earlier arm)
    between.push({ arm: a, vs: b, ...fmt(v4Verdict(paired(a, b), ctl, P.rule)), note: 'descriptive: the bar is set against the comparator; this pair has none' });
  }
  const calls = jsonl(VO()).filter((r) => r.verdict || r.usage).length;
  const res = {
    at: new Date().toISOString(), cell: P.cell, table: P.table, decision: P.decision, pages_waiting: P.pages_waiting, comparator: cmp, rule: P.rule,
    arms, study_cells, between, controls: { n: allControls.length, judged: ctl.length, accepted: ctl.filter((c) => c.accept).length, fidelity: ctl.map((c) => c.fidelity) },
    pages: sel.length, dropped_no_image: [...noImage], judge_calls: calls, judge_items: items.length, page_rule: P.page_rule, frame: P.frame, n_drawn: P.n_drawn, seed: P.seed, dropped_by_eye: P.dropped_by_eye ?? null, by_eye_checks: P.by_eye_checks ?? null, surplus: P.surplus?.length ?? 0,
    per_page: sel.map((s) => ({ book_id: s.book_id, page_id: s.page_id, page_number: s.page_number, words: words.get(s.key), ...Object.fromEntries(P.arms.map((a) => {
      const v = vOf(s.key, a.arm), r = lastArm.get(`${s.key}:${a.arm}`);
      return [a.arm, v ? { accept: v.accept, wrong: v.wrong, fidelity: v.fidelity, severe: v.severe, served: a.kind === 'stored' ? 'stored' : r?.written ? 'written' : `stored (${r?.why ?? 'not run'})` } : null]; })) })),
  };
  const RES = arg('results') ? path.resolve(ROOT, arg('results')) : path.join(HERE, 'results');
  fs.mkdirSync(RES, { recursive: true });
  const file = path.join(RES, `${SLUG}-${res.at.slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(res, null, 1) + '\n');
  const { per_page, frame, ...head } = res;
  console.log(JSON.stringify(head, null, 1));
  console.log(`-> ${path.relative(ROOT, file)}`);
}

async function analyze() {
  const P = J('plan.json');
  if (P.arms?.length) return analyzeArms(P);
  const V = jsonl(VO()).filter((r) => r.verdict);
  const last = new Map(); for (const r of V) last.set(r.id, r);
  const noImage = new Set(jsonl(VO()).filter((r) => r.image_error).map((r) => r.key));
  const { items, controls: allControls } = judgeItems(P.selected, readT);
  const controls = allControls.filter((c) => !noImage.has(c.key));
  P.selected = P.selected.filter((s) => !noImage.has(s.key));
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
    gained: v.gained, lost: v.lost, sign_test_p: +v.sign_test_p.toFixed(4), pairs: v.n, unparsed_pairs: v.unparsed, identical_texts: identical, dropped_no_image: [...noImage],
    controls: v.controls, judge_calls: calls, frame: P.frame, n_drawn: P.n_drawn, seed: P.seed,
    per_page: pairs.map((p, i) => ({ book_id: P.selected[i].book_id, page_id: P.selected[i].page_id, page_number: P.selected[i].page_number, win: p?.win ?? null, cur: p?.cur ?? null })),
  };
  const RES = arg('results') ? path.resolve(ROOT, arg('results')) : path.join(HERE, 'results');
  fs.mkdirSync(RES, { recursive: true });
  const file = path.join(RES, `${SLUG}-${res.at.slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(res, null, 1) + '\n');
  const { per_page, frame, ...head } = res;
  console.log(JSON.stringify(head, null, 1));
  console.log(`-> ${path.relative(ROOT, file)}`);
}

const stages = { plan, drop, arms, judge, analyze };
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[process.argv[2]]();
}
