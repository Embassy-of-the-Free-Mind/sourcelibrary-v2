#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs — the route judge. Its prompt (judgePrompt), Opus call (opusCall,
// claude -p on the subscription, image in the workspace), verdict parser, book-cluster CI and score.json shape are
// IMPORTED, not copied, so a lane verdict is the router tests' verdict. It does not fit as is: it judges a fixed draw
// made for one study (sample.json -> packet -> verdicts in a folder); this draws from what the live lanes WROTE, by
// their own provenance stamps, keeps every verdict in one durable store across runs, and caps itself by the week.
// scripts/eval/estimator/router-table/build.py + rules.json — the router table this feeds (read, never forked; the
// nightly rebuild runs build.py on a copy of origin/main). scripts/batch/cli-ocr-lane.mjs `correct` (#7558) — the lane
// whose writes are sampled; its CORRECT_LANE / LITE_MODELS / CORRECT_LANGUAGES are imported. Searched: `gh pr list
// --search "judge sampler"`, `gh issue list --search "lane judge sample"`, scripts/eval/INDEX.md: no sampler of live
// lane output existed (#7611).
/**
 * lane-judge-sampler (#7611): judge a random sample of what the live agy / GPU lanes WRITE, and feed the router.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/lane-judge-sampler.mjs run --out=DIR
 *        [--since=ISO] [--until=ISO] [--seed=N] [--dry-run] [--cap-points=1] [--max-calls=N] [--draft-share=1]
 *        [--planted=2]                       planted-error controls per cell x route per ISO week (#7611; 0 = none)
 *        [--book=ID[,ID] [--per-book=3]]   book-depth (#7263 pilots): N random written pages of each named book, no rate
 *                                          or per-book cap; window from 2026-10-27 unless --since; never moves the nightly window
 *   ... lane-judge-sampler.mjs export --file=PATH          the store as one route-judge score.json (router evidence)
 *   ... lane-judge-sampler.mjs rebuild --out=DIR [--export=FILE] [--no-publish] [--no-post]
 *                                                      build.py on origin/main + this export; publish; post flips
 *   ... lane-judge-sampler.mjs annotate                    give older store records their script type (print / manuscript)
 *   ... lane-judge-sampler.mjs nightly --out=DIR           run, annotate, export, rebuild (the cron line)
 *   ... lane-judge-sampler.mjs weekly-pr --out=DIR         the repo copy: a PR with the export + rules.json entries
 *
 * FIND. Pages a lane wrote in the window, from the lane's OWN stamps on the page (LANES below: `ocr.pipeline`, the
 * page_revisions row its writer left with its `reason`), never from a log. The window is --since (default: the end of
 * the last real run whose queue finished; a run the cap stopped keeps its start; else 2026-10-27) to --until (now). Only agy and GPU routes are sampled: Opus is the
 * judge and the bar, never a candidate (Derek, 2026-10-28). A page counts only while it still holds the text the
 * lane wrote (the revision row's next_hash); its draft is that row's `data`, and must be a draft of the route's engine.
 *
 * DRAW (drawPages). Books in a seeded weighted order without replacement (Efraimidis-Spirakis: key = u^(1/w)), weight
 * w = 1 + ln(1 + books.human_read_count) — the reader-opened count (#5048) the other lanes queue by; read_count counts
 * bots. One page per book per run, uniform among its written pages; at most 2 pages per book over all runs (pages of
 * one book are one observation). CHECK FLAG (#7263): a page its lane flagged (engine.input.draft.check_flag) is drawn
 * ALWAYS, beside the random draw, as stratum 'flagged', first in the queue; it is reported apart and is never evidence. Rate: every eligible book while the route has fewer than 60 books judged in that
 * cell, then 5% (a drift check). A page judged once is never drawn again. The seed (default: the run date as
 * yyyymmdd) and every draw decision go to DIR/draw.json and the run record, so a draw can be reproduced.
 *
 * JUDGE. Each drawn page's lane output, and its draft (--draft-share, default every page; for worse-than-draft), as
 * one blind item each, with judge.mjs's judgePrompt / opusCall / parseVerdict exactly as the router tests ran them;
 * plus two wrong-page controls per cell x route per ISO week (this page's image, another book's output), and PLANTED
 * controls (#7611, "test the test"): --planted=K (default 2) per cell x route per ISO week, a page the judge ACCEPTED
 * before with one error planted in its body (lib/plant-ocr-errors.mjs: B a number, C a noun, D a line dropped, E a
 * sentence inserted, the kind rotating), judged blind like any item. Opus through
 * `claude -p` on the box's subscription; claudeEnv strips every API key. No Opus read or correction is made.
 *
 * BUDGET. A hard weekly cap: --cap-points (default 1 = 1% of one Claude account-week) / the router table's price of
 * one judge call (rules.json test_next.judge_points_per_output) = the calls allowed in any 7 days, counted from the
 * store (every call, parsed or not). And the pace guard before every call: model-limits.mjs's local stop, then this
 * box's meter (climits, or this login's own usage endpoint, as the route-judge pilot read it); unreadable = stop.
 * Weekly >= LANE_JUDGE_WEEKLY_MAX (85) or 5-hour >= LANE_JUDGE_SESSION_MAX (95) = stop. A quota reply stops the run and
 * notes the limit; nothing is retried into it. The run records the meter before and after (the measured price).
 *
 * STORE. Mongo `lane_judge_verdicts`, one document per judge call (append-only, _id = the item's hash, so a page is
 * never judged twice): page, book, cell, route, lane, the lane's write (revision id, run id, time, text hash), judge
 * model, prompt template hash and prompt hash, seed, run id, date, verdict, and the page's script type (scriptClass). `lane_judge_runs`: one per run (window,
 * seed, draw log, meter, calls, retry queue). Not `pages` or `books` (field-sprawl.md): nothing on a page changes.
 *
 * FEED. `export` writes every counted verdict as one score.json in the route-judge format, cells and routes named as
 * rules.json names them (german-lite / lite>agy-flash-low), so build.py pools it as one more source, scaled by its
 * books (#7606). Every k/n is also split by script type (by_script); a print cell's evidence counts its print pages
 * only (Derek, 2026-10-28: print and manuscript are separate). A route whose wrong-page control failed is listed under routes_not_counted;
 * so is one whose judge misses planted errors: rolling catch rate (the last 56 days, >= 8 plants) below 0.80. The
 * catch rate rides on every route block as `judge_planted`, and build.py prints it next to k/n. The DRAFT verdicts are a
 * conditioned frame (the lane writes only the pages its corrector changed) and go to drafts_conditioned and
 * made_worse, never into evidence. `rebuild` runs build.py on a copy of origin/main with and without the export,
 * publishes the table (ops_reports `router-table:lane-judge`, and DIR/published/), and comments on #7263 only when a
 * cell's decision differs from the last published table. `weekly-pr` refreshes the repo copy by a PR (never main).
 *
 * READ-ONLY on production text: no page is reverted, withheld or rewritten here. A rejected page goes to the run's
 * retry queue (DIR/retry-queue-<run>.jsonl); a page the judge says carries text not on the leaf (O1/O2/O3/I1 wrong
 * text) is posted on #7611 as a containment candidate for a session to check by eye (containment-on-finding.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRng } from './lib/paired-stats.mjs';
import { judgePrompt, opusCall, parseVerdict, clusterCI } from './route-judge-6740/judge.mjs';
import { CORRECT_LANE, LITE_MODELS, CORRECT_LANGUAGES, GPU_LANE, GPU_ROUTE, GPU_LANE_REASON, FIRST_READ_LANE, FIRST_READ_CORRECT_LANE, FIRST_READ_REASON, FIRST_READ_CORRECT_REASON, FIRST_READ_MODEL, firstReadLanguage, ARMC_LANE, ARMC_REASON, ARMC_ENGINES, armcLang } from '../batch/cli-ocr-lane.mjs';
import { extractScriptType } from '../lib/ocr-result-parse.mjs';
import { bookHand } from '../lib/ocr-trust-gate.mjs';
import { plantError, scorePlant, langCode, ERROR_KINDS } from './lib/plant-ocr-errors.mjs';
import { wilson } from './lib/agreement-stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const flag = (n) => process.argv.includes(`--${n}`);
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export const VERDICTS = 'lane_judge_verdicts';
export const RUNS = 'lane_judge_runs';
export const RATE_FULL_BOOKS = 60;
export const RATE_AFTER = 0.05;
export const DEFAULT_SINCE = '2026-10-27T00:00:00Z';
export const EVIDENCE_PATH = 'scripts/eval/estimator/router-table/evidence/lane-judge-sampler.score.json';
// build.py's script split (#7621) reads each source cut by script type from evidence/by-script/<basename>; a source
// without one enters only the /unknown cells. Written beside the export, from its `by_script_cells`.
export const BY_SCRIPT_PATH = 'scripts/eval/estimator/router-table/evidence/by-script/lane-judge-sampler.score.json';
const WEEKLY_MAX = Number(process.env.LANE_JUDGE_WEEKLY_MAX || 85);
const SESSION_MAX = Number(process.env.LANE_JUDGE_SESSION_MAX || 95);
const WRONG_TEXT_CONTAIN = /^(O1|O2|O3|I1)$/;   // text not on this leaf: containment-on-finding.md
// Planted controls (#7611): the bar is Tibetan's (judge.mjs tib-kangyur): below 0.80 the judge does not decide the cell.
export const PLANT_BAR = 0.8;
export const PLANT_MIN = 8;
export const PLANT_WINDOW_DAYS = 56;

/**
 * The lanes, by the stamps they leave. Only `enabled` lanes are drawn. Each maps a written page to a router cell and
 * route by rules.json ids. A lane is off until its cell is named and the judge is valid for its script.
 */
/** First-read lane (#7701): language code -> [rules.json cell, route]. */
export const FIRST_READ_CELLS = Object.freeze({ lat: ['latin-blank', 'agy-flash-low@4-written'], deu: ['german-blank', 'agy-flash-low@4-written'], fra: ['french-blank', 'agy-flash-low-written'] });
export const FIRST_READ_CORRECT_CELLS = Object.freeze({ lat: ['latin-blank', 'agy-flash-low@4>agy-flash-low-written'], deu: ['german-blank', 'agy-flash-low@4>agy-flash-low-written'], fra: ['french-blank', 'agy-flash-low>agy-flash-low-written'] });
export const LANES = [
  { lane: CORRECT_LANE, enabled: true, field: 'ocr', stamp: { 'ocr.pipeline': CORRECT_LANE }, reason: /^#7558 correction lane/,
    route: 'lite>agy-flash-low', draft_route: 'lite', draft_models: LITE_MODELS, hand: 'print',
    cell: (lang) => (/^German/.test(lang) ? 'german-lite' : /^French/.test(lang) ? 'french-lite' : null),
    lang: (lang) => (/^German/.test(lang) ? 'German' : /^French/.test(lang) ? 'French' : null), languages: CORRECT_LANGUAGES },
  // Route C (#7263): a PERO draft of a page with no OCR, corrected by agy Flash-low with the image. The page had no text
  // before (`unread`), so there is no served draft to judge beside it; the check flag (>= 27% of the draft's words changed)
  // is drawn ALWAYS, as its own stratum.
  { lane: GPU_LANE, enabled: true, field: 'ocr', stamp: { 'ocr.pipeline': GPU_LANE }, reason: new RegExp(`^${GPU_LANE_REASON}`),
    route: GPU_ROUTE, draft_route: null, unread: true, hand: 'print',
    cell: (lang) => (/^Latin/.test(lang) ? 'latin-gpu-7263' : null), lang: (lang) => (/^Latin/.test(lang) ? 'Latin' : null), languages: /^Latin/ },
  // #7567 arm c: the language's GPU draft (la PERO-OCR, it LightOnOCR) corrected by agy Flash-low with the image, written
  // OVER the stored Flash-Lite draft (the revision row's data), with the E3 diff guard's put-back. The lite draft is the
  // served text it replaced, judged beside it; route by language (`route` is a function of the book's language here).
  { lane: ARMC_LANE, enabled: true, field: 'ocr', stamp: { 'ocr.pipeline': ARMC_LANE }, reason: new RegExp(`^${ARMC_REASON}`),
    route: (lang) => ARMC_ENGINES[armcLang(lang)]?.route ?? null, draft_route: 'lite', draft_models: LITE_MODELS, hand: 'print',
    cell: (lang) => ARMC_ENGINES[armcLang(lang)]?.cell ?? null, lang: (lang) => ({ la: 'Latin', it: 'Italian' }[armcLang(lang)] ?? null), languages: /^(Latin|Italian)/ },
  { lane: 'tib-correct-6560', enabled: false, why: 'Tibetan: the judge alone does not decide the cell (planted-syllable catch below 0.80 hands it to Derge, judge.mjs tib-kangyur); needs the Derge stage' },
  { lane: 'tib_gutter_vllm_6871', enabled: false, why: 'GPU Yigdzin gutter reads: no rules.json route for them yet' },
  // #7701: first reads of pages with no OCR in visible books held as scans only (cli-ocr-lane.mjs run --cohort), agy
  // Flash-low, 4 pages a call for German (Latin is not scheduled), 1 for French. No draft (`unread`): nothing is judged
  // beside it. The route is the no-stored-text cell's `-written` row, the pages the lane writes.
  { lane: FIRST_READ_LANE, enabled: true, field: 'ocr', stamp: { 'ocr.pipeline': FIRST_READ_LANE }, reason: new RegExp(`^${FIRST_READ_REASON}(?! correction)`),
    route: (lang) => (FIRST_READ_CELLS[firstReadLanguage({ language: lang })] ?? [])[1] ?? null, draft_route: null, unread: true, hand: 'print',
    cell: (lang) => (FIRST_READ_CELLS[firstReadLanguage({ language: lang })] ?? [])[0] ?? null,
    lang: (lang) => ({ lat: 'Latin', deu: 'German', fra: 'French' })[firstReadLanguage({ language: lang })] ?? null, languages: /^(Latin|German|French|la|de|fr)$/i },
  // #7701 arm B: the first read corrected in a second pass (cli-ocr-lane.mjs run --cohort --correct=deu). Its draft is the
  // first read the revision row holds, so it is judged beside it (worse than the draft).
  { lane: FIRST_READ_CORRECT_LANE, enabled: true, field: 'ocr', stamp: { 'ocr.pipeline': FIRST_READ_CORRECT_LANE }, reason: new RegExp(`^${FIRST_READ_CORRECT_REASON}`),
    route: (lang) => FIRST_READ_CORRECT_CELLS[firstReadLanguage({ language: lang })]?.[1] ?? null,
    draft_route: (lang) => FIRST_READ_CELLS[firstReadLanguage({ language: lang })]?.[1] ?? null, draft_models: [FIRST_READ_MODEL], hand: 'print',
    cell: (lang) => FIRST_READ_CORRECT_CELLS[firstReadLanguage({ language: lang })]?.[0] ?? null,
    lang: (lang) => ({ lat: 'Latin', deu: 'German', fra: 'French' })[firstReadLanguage({ language: lang })] ?? null, languages: /^(Latin|German|French|la|de|fr)$/i },
  { lane: '(no ocr.pipeline) gemini-3.8-flash-low', enabled: false, why: 'the held-book CLI read (#7089) stamps no lane; first reads of scans-only books are agy-first-read-7701 above' },
];

/** The draw weight of a book: 1 + ln(1 + human_read_count). */
export const bookWeight = (b) => 1 + Math.log1p(Math.max(0, Number(b?.human_read_count) || 0));

/**
 * Print or manuscript (Derek, 2026-10-28: they are separate, and every k/n is split by it). The page's own <script> tag in
 * its current text first (it wins a conflict with the field: ~28% of OCR'd pages have no field, 7% carry the tag
 * without it), then `pages.script_type`, then the book's majority (ocr-trust-gate.mjs bookHand), else unknown.
 * Returns { script_type: 'print' | 'manuscript' | 'mixed' | 'unknown', script_source }.
 */
export function scriptClass(ocrText, field, bookHandValue) {
  const of = (v) => ({ printed: 'print', handwritten: 'manuscript', mixed: 'mixed' }[v]);
  const tag = of(extractScriptType(ocrText));
  if (tag) return { script_type: tag, script_source: 'ocr tag' };
  if (of(field)) return { script_type: of(field), script_source: 'pages.script_type' };
  if (bookHandValue === 'print' || bookHandValue === 'manuscript') return { script_type: bookHandValue, script_source: 'book majority' };
  return { script_type: 'unknown', script_source: 'none' };
}

/** A book's script profile (bookHand's input): counts of pages.script_type. */
async function bookProfiles(db, bookIds) {
  const rows = await db.collection('pages').aggregate([{ $match: { book_id: { $in: bookIds }, script_type: { $in: ['printed', 'handwritten', 'mixed'] } } },
    { $group: { _id: { b: '$book_id', t: '$script_type' }, n: { $sum: 1 } } }]).toArray();
  const out = new Map(bookIds.map((b) => [b, { printed: 0, handwritten: 0, mixed: 0 }]));
  for (const r of rows) out.get(r._id.b)[r._id.t] = r.n;
  return out;
}

/**
 * The draw. cands: [{ page_id, book_id, cell, route, weight }]. hist: { pagesJudged: Set<page_id>, bookPages:
 * Map<book_id, distinct pages judged>, routeBooks: Map<'cell|route', Set<book_id>> }. One pick per book, so one page per
 * book per run by construction. Deterministic in (cands as a set, hist, seed). Returns { drawn, log }.
 */
export function drawPages(cands, hist, { seed, rateFull = RATE_FULL_BOOKS, rateAfter = RATE_AFTER, perBookTotal = 2 } = {}) {
  if (!Number.isFinite(seed)) throw new Error('drawPages: a numeric seed is required');
  const rnd = makeRng(seed);
  const log = { seed, candidates: cands.length, judged_page: 0, book_cap: 0, rate_skip: 0, books: 0 };
  const byBook = new Map();
  for (const c of cands) {
    if (hist.pagesJudged.has(c.page_id)) { log.judged_page++; continue; }
    if (!byBook.has(c.book_id)) byBook.set(c.book_id, []);
    byBook.get(c.book_id).push(c);
  }
  const books = [...byBook.keys()].sort();
  log.books = books.length;
  const keyed = books.map((b) => { const w = Math.max(1e-9, byBook.get(b)[0].weight ?? 1); return { b, key: rnd() ** (1 / w) }; })
    .sort((x, y) => y.key - x.key || (x.b < y.b ? -1 : 1));
  const drawn = [], inRun = new Map();
  for (const { b, key } of keyed) {
    const pages = byBook.get(b).slice().sort((x, y) => (x.page_id < y.page_id ? -1 : 1));
    const pick = pages[Math.floor(rnd() * pages.length)], u = rnd();
    if ((hist.bookPages.get(b) ?? 0) >= perBookTotal) { log.book_cap++; continue; }
    const g = `${pick.cell}|${pick.route}`;
    const have = hist.routeBooks.get(g) ?? new Set();
    const judged = have.size + (inRun.get(g) ?? 0);
    const rate = judged < rateFull ? 1 : rateAfter;
    if (u >= rate) { log.rate_skip++; continue; }
    drawn.push({ ...pick, key: +key.toFixed(6), rate, u: +u.toFixed(6) });
    if (!have.has(b)) inRun.set(g, (inRun.get(g) ?? 0) + 1);
  }
  return { drawn, log };
}

/**
 * The book-depth draw (`run --book=ID[,ID] --per-book=N`, #7263 pilots): every named book's written pages, N of them per
 * book uniformly without replacement (seeded), pages judged before excluded; no rate and no per-book cap. Returns
 * { drawn, log } like drawPages.
 */
export function drawBookDepth(cands, hist, { seed, perBook = 3 } = {}) {
  if (!Number.isFinite(seed)) throw new Error('drawBookDepth: a numeric seed is required');
  const rnd = makeRng(seed);
  const log = { seed, mode: 'book-depth', per_book: perBook, candidates: cands.length, judged_page: 0, books: 0 };
  const byBook = new Map();
  for (const c of cands) {
    if (hist.pagesJudged.has(c.page_id)) { log.judged_page++; continue; }
    if (!byBook.has(c.book_id)) byBook.set(c.book_id, []);
    byBook.get(c.book_id).push(c);
  }
  const drawn = [];
  for (const b of [...byBook.keys()].sort()) {
    const pages = byBook.get(b).slice().sort((x, y) => (x.page_id < y.page_id ? -1 : 1));
    for (let i = 0; i < Math.min(perBook, pages.length); i++) {
      const j = i + Math.floor(rnd() * (pages.length - i));
      [pages[i], pages[j]] = [pages[j], pages[i]];
      drawn.push({ ...pages[i], key: null, rate: 1, u: null });
    }
  }
  log.books = byBook.size;
  return { drawn, log };
}

/** The check-flag stratum: flagged candidates not drawn and never judged, all of them (judged ALWAYS, #7263). */
export function flaggedStratum(cands, drawn, hist) {
  const inDraw = new Set(drawn.map((d) => d.page_id));
  return cands.filter((c) => c.check_flag && !inDraw.has(c.page_id) && !hist.pagesJudged.has(c.page_id)).map((c) => ({ ...c, key: null, rate: 1, u: null, stratum: 'flagged' }));
}

/** The weekly cap: calls allowed in any 7 days = floor(capPoints / pointsPerCall); left = that minus calls made. */
export function weeklyBudget({ callsLast7d, pointsPerCall, capPoints }) {
  if (!(pointsPerCall > 0) || !(capPoints >= 0)) throw new Error('weeklyBudget: pointsPerCall > 0 and capPoints >= 0');
  const maxCalls = Math.floor(capPoints / pointsPerCall + 1e-9);
  return { maxCalls, left: Math.max(0, maxCalls - callsLast7d), pointsPerCall, capPoints };
}

/** The ISO week a date falls in, e.g. 2026-W44 (the wrong-page controls are owed once per cell x route per week). */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, '0')}`;
}

/**
 * The planted controls owed to one cell x route this run (#7611). sources: [{ rec, text }] — store records the judge
 * ACCEPTED (kind item) with the text they were accepted on, still the page's text; prior: planted records of this cell x
 * route already in the store (their count rotates the kind B -> C -> D -> E; their planted_from is never reused).
 * Returns [{ rec, text, plant, plantedText }]: up to `owed`, one per book, a seeded draw. Each slot's kind is held
 * across pages (a page with no number does not skip B: the next page is tried); only when no page has a site for it
 * does the slot take the next kind. Deterministic in (sources as a set, prior, seed).
 */
export function planPlanted(sources, { owed, prior = [], seed, lang }) {
  if (!Number.isFinite(seed)) throw new Error('planPlanted: a numeric seed is required');
  const used = new Set(prior.map((r) => r.planted_from)), rnd = makeRng(seed);
  const pool = sources.filter((s) => !used.has(s.rec._id)).sort((a, b) => (a.rec._id < b.rec._id ? -1 : 1))
    .map((s) => ({ s, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.s);
  const out = [], books = new Set();
  for (let slot = 0; slot < owed; slot++) {
    let got = null;
    for (let j = 0; j < ERROR_KINDS.length && !got; j++) {
      const kind = ERROR_KINDS[(prior.length + slot + j) % ERROR_KINDS.length];
      for (const src of pool) {
        if (books.has(src.rec.book_id)) continue;
        const r = plantError(src.text, { kind, lang: lang ?? src.rec.lang, seed: parseInt(h(`${src.rec._id}:${kind}:${seed}`).slice(0, 8), 16) });
        if (r) { got = { rec: src.rec, text: src.text, plant: r.plant, plantedText: r.text }; break; }
      }
    }
    if (!got) break;
    out.push(got); books.add(got.rec.book_id);
  }
  return out;
}

/** A route's planted-control block: all plants, the rolling window, and whether the judge is validated on it. */
export function plantedBlock(rows, { now = Date.now(), windowDays = PLANT_WINDOW_DAYS, min = PLANT_MIN, bar = PLANT_BAR } = {}) {
  const kn = (g) => { const k = g.filter((r) => r.catch.caught).length; return { caught: `${k}/${g.length}`, rate: g.length ? +(k / g.length).toFixed(3) : null, ci95: g.length ? wilson(k, g.length).map((x) => +x.toFixed(3)) : null }; };
  const got = rows.map((r) => ({ ...r, catch: scorePlant(r.verdict, r.plant) }));
  const recent = got.filter((r) => now - Date.parse(r.judged_at) <= windowDays * 864e5);
  const roll = kn(recent);
  const failed = recent.length >= min && roll.rate < bar;
  const byKind = {};
  for (const k of ERROR_KINDS) { const g = got.filter((r) => r.plant?.kind === k); if (g.length) byKind[k] = kn(g).caught; }
  return { n: got.length, ...kn(got), named: `${got.filter((r) => r.catch.named).length}/${got.length}`, by_kind: byKind,
    rolling: { days: windowDays, n: recent.length, ...roll }, validated: recent.length >= min ? !failed : null, failed,
    rule: `rolling catch rate over the last ${windowDays} days, counted from ${min} plants: below ${bar} the route is not counted` };
}

/** The prompt's template hash: judgePrompt with placeholders, so a change to the rubric shows as a new hash. */
export const PROMPT_TEMPLATE_SHA = h(judgePrompt({ task: 'ocr', lang: '{lang}', text: '{text}' }, '{image}')).slice(0, 16);

const REQUIRED = ['_id', 'kind', 'page_id', 'book_id', 'cell', 'route', 'lane', 'judge', 'run_id', 'judged_at'];
/** Read-side shape check (a store another session can write): a record missing any of these is not counted. */
export const validRecord = (r) => r && REQUIRED.every((k) => r[k] != null) && ['item', 'draft', 'wrong_page', 'planted'].includes(r.kind)
  && (r.verdict == null || (typeof r.verdict.accept === 'boolean' && Number(r.verdict.fidelity) >= 1 && Number(r.verdict.fidelity) <= 5));

const cls = (d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2';
const wrongText = (v) => (v.defects || []).some((d) => d.severity === 'wrong_text');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const opusJudged = (r) => r.verdict && /opus/i.test(r.judge?.model_reported || r.judge?.model || '');

function routeBlock(got) {
  const accept = got.filter((r) => r.verdict.accept), wt = got.filter((r) => wrongText(r.verdict));
  const classes = {}, wtClasses = {};
  for (const r of got) {
    for (const c of new Set((r.verdict.defects || []).map(cls))) classes[c] = (classes[c] ?? 0) + 1;
    for (const c of new Set((r.verdict.defects || []).filter((d) => d.severity === 'wrong_text').map(cls))) wtClasses[c] = (wtClasses[c] ?? 0) + 1;
  }
  const k2n = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([c, k]) => [c, `${k}/${got.length}`]));
  return { n: got.length, books: new Set(got.map((r) => r.book_id)).size,
    accept: `${accept.length}/${got.length}`, accept_rate: got.length ? +(accept.length / got.length).toFixed(3) : null,
    accept_ci: clusterCI(got.map((r) => ({ book: r.book_id, v: r.verdict.accept ? 1 : 0 })), 7611),
    wrong_text_pages: `${wt.length}/${got.length}`, wrong_text_ci: clusterCI(got.map((r) => ({ book: r.book_id, v: wrongText(r.verdict) ? 1 : 0 })), 7612),
    wrong_text_classes: k2n(wtClasses), classes_k_of_n: k2n(classes),
    fidelity_mean: got.length ? +mean(got.map((r) => Number(r.verdict.fidelity))).toFixed(2) : null };
}

const scriptOf = (r) => r.script_type ?? 'unknown';
const routerScript = (r) => (scriptOf(r) === 'mixed' ? 'print' : ['print', 'manuscript'].includes(scriptOf(r)) ? scriptOf(r) : 'unknown');
/** Write the export and its by-script cut under a repo root (a rebuild copy, a PR worktree). */
export function writeEvidence(root, score) {
  for (const [f, body] of [[EVIDENCE_PATH, score], [BY_SCRIPT_PATH, { source: score.source, generated_at: score.generated_at, of: EVIDENCE_PATH, cells: score.by_script_cells ?? {} }]]) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), JSON.stringify(body, null, 1) + '\n');
  }
}
const handOf = (r) => r.cell_hand ?? LANES.find((l) => l.lane === r.lane)?.hand ?? null;
// The check-flag stratum (#7263) is drawn because it is flagged, not at random: reported apart, never evidence.
const inEvidence = (r) => r.draw?.stratum !== 'flagged' && (handOf(r) !== 'print' || scriptOf(r) === 'print');
function byScript(rs) {
  const out = {};
  for (const t of [...new Set(rs.map(scriptOf))].sort()) {
    const g = rs.filter((r) => scriptOf(r) === t);
    out[t] = { accept: `${g.filter((r) => r.verdict.accept).length}/${g.length}`, wrong_text_pages: `${g.filter((r) => wrongText(r.verdict)).length}/${g.length}`, books: new Set(g.map((r) => r.book_id)).size };
  }
  return out;
}

/** The store as one route-judge score.json. records: every document of lane_judge_verdicts. */
export function exportScore(records, { generatedAt = new Date().toISOString() } = {}) {
  const ok = records.filter(validRecord), bad = records.length - ok.length;
  const judged = ok.filter(opusJudged);
  const report = { generated_at: generatedAt, source: 'lane-judge-sampler (#7611)', file: EVIDENCE_PATH,
    judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt, against the page image', prompt_template_sha: [...new Set(judged.map((r) => r.judge.prompt_template_sha))],
    frame: "pages a live lane WROTE, by its own stamps; one page per book per run, at most two per book; books weighted by 1 + ln(1 + human_read_count); every book until a route has 60 books judged in its cell, then 5%. The lane writes only pages its corrector CHANGED (an UNCHANGED answer leaves no stamp), so a route's rate is over changed pages: the router tests' unchanged share was 0/30 German, 3/29 French.",
    calls: { records: records.length, malformed_not_counted: bad, judged: judged.length, unparsed: ok.filter((r) => !r.verdict).length,
      list_usd_equiv: +ok.reduce((a, r) => a + (r.list_usd || 0), 0).toFixed(2) },
    cells: {}, contain_candidates: [], by_script_cells: {} };
  const cells = [...new Set(judged.map((r) => r.cell))].sort();
  for (const cell of cells) {
    const rs = judged.filter((r) => r.cell === cell);
    const C = report.cells[cell] = { task: 'ocr', lang: rs[0].lang ?? null, controls: {}, routes: {}, routes_not_counted: {}, drafts_conditioned: {}, made_worse: {} };
    for (const route of [...new Set(rs.filter((r) => r.kind === 'item').map((r) => r.route))].sort()) {
      const wp = rs.filter((r) => r.kind === 'wrong_page' && r.route === route);
      const wpPassed = wp.length > 0 && wp.every((r) => !r.verdict.accept && Number(r.verdict.fidelity) <= 2);
      const pl = rs.filter((r) => r.kind === 'planted' && r.route === route && r.plant);
      const judgePlanted = pl.length ? plantedBlock(pl, { now: Date.parse(generatedAt) || Date.now() }) : null;
      const passed = wpPassed && !judgePlanted?.failed;
      C.controls[route] = { n: wp.length, passed, wrong_page_passed: wpPassed, verdicts: wp.map((r) => ({ accept: r.verdict.accept, fidelity: r.verdict.fidelity, week: r.week })),
        ...(judgePlanted && { planted: judgePlanted }) };
      const all = rs.filter((r) => r.kind === 'item' && r.route === route);
      // A print cell's evidence is its print pages; manuscript, mixed and unknown pages are reported apart (by_script).
      const got = all.filter(inEvidence);
      const flagged = all.filter((r) => r.draw?.stratum === 'flagged');
      const block = { ...routeBlock(got), lane: [...new Set(all.map((r) => r.lane))], counts: passed, served: 'the live lane\'s applied output (served)',
        judge_planted: judgePlanted && { caught: judgePlanted.rolling.caught, rate: judgePlanted.rolling.rate, ci95: judgePlanted.rolling.ci95, validated: judgePlanted.validated, all: judgePlanted.caught },
        ...(!passed && { not_counted_because: [!wpPassed && 'wrong-page control not passed', judgePlanted?.failed && `judge-unvalidated: planted catch ${judgePlanted.rolling.caught} < ${PLANT_BAR}`].filter(Boolean) }),
        evidence_rule: [...new Set(all.map(handOf))].includes('print') ? 'print cell: print pages only' : 'all pages', by_script: byScript(all),
        ...(flagged.length && { flagged_stratum: { ...routeBlock(flagged), note: 'pages the lane check-flagged (>= 27% of the draft changed), judged always; not evidence' } }) };
      (passed ? C.routes : C.routes_not_counted)[route] = block;
      // The by-script cut build.py reads (split_evidence.py's shape, `<cell>|<script>`; mixed counts as print, as there).
      if (passed) for (const t of ['print', 'manuscript', 'unknown']) {
        const g = all.filter((r) => routerScript(r) === t); if (!g.length) continue;
        const { n, books, accept, wrong_text_pages, classes_k_of_n } = routeBlock(g);
        ((report.by_script_cells[`${cell}|${t}`] ??= { routes: {} }).routes[route] = { n, books, accept, wrong_text_pages, classes_k_of_n, script_basis: { page: g.length } });
      }
      for (const r of all) {
        const wtd = (r.verdict.defects || []).filter((d) => d.severity === 'wrong_text');
        if (wtd.some((d) => WRONG_TEXT_CONTAIN.test(cls(d))))
          report.contain_candidates.push({ cell, route, page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, defects: wtd, note: r.verdict.reader_note });
      }
    }
    for (const route of [...new Set(rs.filter((r) => r.kind === 'draft').map((r) => r.route))].sort())
      { const ds = rs.filter((r) => r.kind === 'draft' && r.route === route); C.drafts_conditioned[route] = { ...routeBlock(ds.filter(inEvidence)), by_script: byScript(ds) }; }
    // Worse than the draft: the lane's output beside the draft it replaced, on the same page.
    for (const route of Object.keys({ ...C.routes, ...C.routes_not_counted })) {
      const items = rs.filter((r) => r.kind === 'item' && r.route === route && inEvidence(r));
      const pairs = items.map((a) => [rs.find((d) => d.kind === 'draft' && d.page_id === a.page_id && d.write?.revision_id === a.write?.revision_id), a]).filter(([d]) => d);
      if (!pairs.length) continue;
      const diff = pairs.map(([d, a]) => Number(a.verdict.fidelity) - Number(d.verdict.fidelity));
      const worse = pairs.filter(([d, a], i) => diff[i] < 0 || (d.verdict.accept && !a.verdict.accept) || (!wrongText(d.verdict) && wrongText(a.verdict)));
      C.made_worse[`${pairs[0][0].route} -> ${route}`] = { pairs: pairs.length, fidelity_diff: +mean(diff).toFixed(2),
        fidelity_diff_ci: clusterCI(pairs.map(([d], i) => ({ book: d.book_id, v: diff[i] })), 7613).ci95,
        worse: `${worse.length}/${pairs.length}`, better: `${diff.filter((x) => x > 0).length}/${pairs.length}`,
        accept_lost: `${pairs.filter(([d, a]) => d.verdict.accept && !a.verdict.accept).length}/${pairs.length}`,
        accept_gained: `${pairs.filter(([d, a]) => !d.verdict.accept && a.verdict.accept).length}/${pairs.length}`,
        wrong_text_added: `${pairs.filter(([d, a]) => !wrongText(d.verdict) && wrongText(a.verdict)).length}/${pairs.length}`,
        worse_pages: worse.map(([d, a]) => ({ page_id: a.page_id, book_id: a.book_id, page_number: a.page_number, draft: d.verdict.fidelity, after: a.verdict.fidelity, accept: `${d.verdict.accept}->${a.verdict.accept}`, note: a.verdict.reader_note })) };
    }
  }
  return report;
}

/** The rules.json evidence entries an export supports: one per counted route of a cell rules.json has. */
export function evidenceEntries(score, rules) {
  const out = [];
  for (const [cell, C] of Object.entries(score.cells)) {
    const rc = rules.cells.find((c) => c.id === cell); if (!rc) continue;
    for (const route of Object.keys(C.routes)) if (rc.routes.some((r) => r.id === route)) out.push({ cell, route, entry: { score: EVIDENCE_PATH, cell, route } });
  }
  return out;
}

// ── rules.json, edited as TEXT (its hand layout is one route a line; a JSON re-dump would rewrite every line) ──
function closeOf(s, open) {   // index of the bracket closing s[open], skipping JSON strings
  const pair = { '[': ']', '{': '}' }[s[open]]; let depth = 0, inStr = false;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === s[open]) depth++;
    else if (c === pair && --depth === 0) return i;
  }
  return -1;
}
/** Add one evidence entry to a route in rules.json's text; idempotent; throws unless only that route's list changed. */
export function addEvidence(text, cellId, routeId, entry) {
  const before = JSON.parse(text);
  const route0 = before.cells.find((c) => c.id === cellId)?.routes.find((r) => r.id === routeId);
  if (!route0) throw new Error(`addEvidence: no route ${cellId}/${routeId} in rules.json`);
  if ((route0.evidence || []).some((e) => e.score === entry.score && e.cell === entry.cell && e.route === entry.route)) return text;
  const cellAt = text.search(new RegExp(`\\{\\s*"id":\\s*"${cellId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  if (cellAt < 0) throw new Error(`addEvidence: cell ${cellId} not found as text`);
  const cellEnd = closeOf(text, cellAt);
  const re = new RegExp(`\\{\\s*"id":\\s*"${routeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g');
  re.lastIndex = cellAt + 1;
  const m = re.exec(text); if (!m || m.index > cellEnd) throw new Error(`addEvidence: route ${routeId} not found inside ${cellId}`);
  const rStart = m.index, rEnd = closeOf(text, rStart);
  const obj = text.slice(rStart, rEnd + 1);
  const ent = `{"score": ${JSON.stringify(entry.score)}, "cell": ${JSON.stringify(entry.cell)}, "route": ${JSON.stringify(entry.route)}}`;
  const ev = obj.search(/"evidence":\s*\[/);
  let obj2;
  if (ev >= 0) { const o = obj.indexOf('[', ev), c = closeOf(obj, o); obj2 = obj.slice(0, c) + (obj.slice(o + 1, c).trim() ? `, ${ent}` : ent) + obj.slice(c); }
  else { const t = obj.lastIndexOf('}'); obj2 = obj.slice(0, t).replace(/\s*$/, '') + `, "evidence": [${ent}] ` + obj.slice(t); }
  const out = text.slice(0, rStart) + obj2 + text.slice(rEnd + 1);
  const after = JSON.parse(out);
  const r1 = after.cells.find((c) => c.id === cellId).routes.find((r) => r.id === routeId);
  const last = r1.evidence.pop();
  if (JSON.stringify(last) !== JSON.stringify(entry)) throw new Error('addEvidence: the entry did not land where intended');
  if (!r1.evidence.length && !route0.evidence) delete r1.evidence;
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('addEvidence: more than the one route changed');
  return out;
}

// ── the meter and the pace guard ──
/** This box's Claude account: climits (model-limits.mjs), else the login's own usage endpoint, else null. */
export async function claudeMeter(limits) {
  const u = limits.claudeUsage();
  if (u && u.weekly != null) return { source: 'climits', email: u.email, weekly: u.weekly, session: u.session, weekly_reset: u.weeklyReset, session_reset: u.sessionReset, at: new Date().toISOString() };
  try {   // the route-judge pilot's reading (meter.json: api.anthropic.com/api/oauth/usage); never refreshes the token
    const login = limits.claudeLoginFiles();   // CLAUDE_CONFIG_DIR's login when set: the one `claude -p` spends
    const c = JSON.parse(fs.readFileSync(login.credentials, 'utf8')).claudeAiOauth;
    if (!c?.accessToken || !(c.expiresAt > Date.now() + 60e3)) return null;
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: `Bearer ${c.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' }, signal: AbortSignal.timeout(20e3) });
    if (!r.ok) return null;
    const j = await r.json();
    if (typeof j.seven_day?.utilization !== 'number') return null;
    let email = null; try { email = JSON.parse(fs.readFileSync(login.account, 'utf8')).oauthAccount?.emailAddress ?? null; } catch { /* none */ }
    return { source: 'oauth-usage', email, weekly: j.seven_day.utilization, session: j.five_hour?.utilization ?? null, weekly_reset: j.seven_day.resets_at, session_reset: j.five_hour?.resets_at ?? null, at: new Date().toISOString() };
  } catch { return null; }
}
/** null = go; else why not. */
export function paceBlock(meter, { weeklyMax = WEEKLY_MAX, sessionMax = SESSION_MAX } = {}) {
  if (!meter) return 'meter unreadable (climits has no reading for this login, and its usage endpoint did not answer): fail closed';
  if (meter.weekly >= weeklyMax) return `weekly ${meter.weekly}% >= ${weeklyMax}% (resets ${meter.weekly_reset})`;
  if (meter.session != null && meter.session >= sessionMax) return `5-hour ${meter.session}% >= ${sessionMax}% (resets ${meter.session_reset})`;
  return null;
}

// ── run ──
async function mongo() {
  const { MongoClient } = await import('mongodb');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set: run with --env-file');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  return { c, db: c.db('bookstore') };
}

/** Pages each enabled lane wrote in [since, until), with the revision row that proves the write and its draft. */
async function findWrites(db, since, until) {
  const { textHash } = await import('../lib/page-text-writer.mjs');
  const out = [], frame = {};
  for (const L of LANES.filter((l) => l.enabled)) {
    const F = frame[L.lane] = { pages_stamped: 0, no_cell: 0, rewritten_since: 0, no_revision: 0, draft_not_route_engine: 0, held_or_hidden: 0, eligible: 0 };
    const pages = await db.collection('pages').find({ ...L.stamp, [`${L.field}.updated_at`]: { $gte: since, $lt: until } },
      { projection: { id: 1, book_id: 1, page_number: 1, script_type: 1, [`${L.field}.data`]: 1, [`${L.field}.model`]: 1, [`${L.field}.updated_at`]: 1, [`${L.field}.engine.input.draft.check_flag`]: 1, [`${L.field}.engine.input.draft.change_share`]: 1 } }).toArray();
    F.pages_stamped = pages.length;
    const prof = await bookProfiles(db, [...new Set(pages.map((p) => p.book_id))]);
    F.script = {};
    const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(pages.map((p) => p.book_id))] } },
      { projection: { id: 1, language: 1, human_read_count: 1, visible: 1, 'pipeline_auto.held': 1 } }).toArray()).map((b) => [b.id, b]));
    // The newest revision row this lane's writer left on each page: its next_hash must still be the page's text.
    const revs = new Map();
    for (let i = 0; i < pages.length; i += 500) {
      const ids = pages.slice(i, i + 500).map((p) => p.id);
      const rows = await db.collection('page_revisions').find({ page_id: { $in: ids }, field: L.field, created_at: { $gte: new Date(since.getTime() - 864e5) } },
        { projection: { id: 1, page_id: 1, reason: 1, run_id: 1, created_at: 1, next_hash: 1, data: 1, model: 1, aborted: 1 } }).sort({ created_at: -1 }).toArray();
      for (const r of rows) if (!r.aborted && L.reason.test(r.reason || '') && !revs.has(r.page_id)) revs.set(r.page_id, r);
    }
    for (const p of pages) {
      const b = books.get(p.book_id), cell = L.cell(b?.language || '');
      if (!cell) { F.no_cell++; continue; }
      if (!b.visible || b.pipeline_auto?.held) { F.held_or_hidden++; continue; }
      const r = revs.get(p.id);
      if (!r) { F.no_revision++; continue; }
      if (r.next_hash !== textHash(p[L.field])) { F.rewritten_since++; continue; }
      // An unread lane's revision row holds the page's prior text, which must be none; any other lane's, a draft of its engine.
      if (L.unread ? (typeof r.data === 'string' && r.data.trim()) : !L.draft_models.includes(r.model)) { F.draft_not_route_engine++; continue; }
      F.eligible++;
      const sc = scriptClass(p[L.field].data, p.script_type, bookHand(prof.get(p.book_id)));
      F.script[sc.script_type] = (F.script[sc.script_type] ?? 0) + 1;
      out.push({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, cell, route: typeof L.route === 'function' ? L.route(b.language) : L.route, draft_route: typeof L.draft_route === 'function' ? L.draft_route(b.language) : L.draft_route, lane: L.lane, lang: L.lang(b.language),
        weight: bookWeight(b), human_read_count: b.human_read_count ?? 0, ...sc, cell_hand: L.hand,
        write: { revision_id: r.id, run_id: r.run_id ?? null, written_at: r.created_at, text_hash: r.next_hash, model: p[L.field].model },
        draft_model: r.model, ...(L.unread && { check_flag: !!p[L.field].engine?.input?.draft?.check_flag, change_share: p[L.field].engine?.input?.draft?.change_share ?? null }) });
    }
  }
  return { cands: out, frame };
}

async function history(db) {
  const rows = await db.collection(VERDICTS).find({}, { projection: { kind: 1, page_id: 1, book_id: 1, cell: 1, route: 1, judged_at: 1, called: 1, week: 1, judge: 1, lane: 1, run_id: 1, _id: 1 } }).toArray();
  const pagesJudged = new Set(), bookPagesSet = new Map(), routeBooks = new Map();
  for (const r of rows.filter((x) => x.kind !== 'wrong_page' && x.kind !== 'planted' && validRecordLoose(x))) {
    pagesJudged.add(r.page_id);
    if (!bookPagesSet.has(r.book_id)) bookPagesSet.set(r.book_id, new Set());
    bookPagesSet.get(r.book_id).add(r.page_id);
    if (r.kind === 'item') { const g = `${r.cell}|${r.route}`; if (!routeBooks.has(g)) routeBooks.set(g, new Set()); routeBooks.get(g).add(r.book_id); }
  }
  const bookPages = new Map([...bookPagesSet].map(([b, s]) => [b, s.size]));
  const weekAgo = Date.now() - 7 * 864e5;
  const callsLast7d = rows.filter((r) => r.called !== false && Date.parse(r.judged_at) >= weekAgo).length;
  return { pagesJudged, bookPages, routeBooks, callsLast7d, rows };
}
const validRecordLoose = (r) => r && r.page_id && r.book_id && r.cell && r.route;

async function run() {
  const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'lane-judge-sampler'));
  fs.mkdirSync(OUT, { recursive: true });
  const DRY = flag('dry-run');
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/estimator/router-table/rules.json'), 'utf8'));
  const ppc = Number(rules.test_next?.judge_points_per_output);
  const capPoints = Number(arg('cap-points') ?? 1);
  const draftShare = Number(arg('draft-share') ?? 1);
  const limits = await import('../lib/model-limits.mjs');
  const { c, db } = await mongo();
  try {
    // The window starts where the last real run's finished queue left it: a run the cap or the meter stopped leaves
    // its start in place, so the pages it did not reach are drawn from again.
    // --book=ID[,ID] (#7263): the book-depth mode, a pilot's books judged N pages each; it never moves the nightly window.
    const BOOKS = arg('book') ? new Set(arg('book').split(',').filter(Boolean)) : null;
    const PER_BOOK = Number(arg('per-book') ?? 3);
    const last = await db.collection(RUNS).find({ dry_run: false, mode: { $ne: 'book-depth' } }).sort({ at: -1 }).limit(1).next();
    const since = new Date(arg('since') || (BOOKS ? DEFAULT_SINCE : last?.next_since) || DEFAULT_SINCE), until = new Date(arg('until') || Date.now());
    const today = until.toISOString().slice(0, 10);
    const seed = Number(arg('seed') ?? today.replace(/-/g, ''));
    const runId = `lane-judge-${until.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}${BOOKS ? '-books' : ''}${DRY ? '-dry' : ''}`;
    const found = await findWrites(db, since, until);
    const { frame } = found;
    const cands = BOOKS ? found.cands.filter((c) => BOOKS.has(c.book_id)) : found.cands;
    const hist = await history(db);
    const { drawn: random, log } = BOOKS ? drawBookDepth(cands, hist, { seed, perBook: PER_BOOK }) : drawPages(cands, hist, { seed });
    const flaggedDrawn = flaggedStratum(cands, random, hist);
    const drawn = [...random.map((d) => ({ ...d, stratum: 'random' })), ...flaggedDrawn];
    log.flagged = flaggedDrawn.length;
    const budget = weeklyBudget({ callsLast7d: hist.callsLast7d, pointsPerCall: ppc, capPoints });
    const maxCalls = Math.min(budget.left, Number(arg('max-calls') ?? Infinity));
    const rnd = makeRng(seed ^ 0x7611);
    // Items in draw order: the lane's output, then its draft (the draft share is seeded per page).
    const week = isoWeek(until);
    const items = [];
    // The flagged stratum first (judged always), then the random draw in draw order. Book depth (a pilot) puts the random
    // draw first instead: the pilot's decision rests on it, and a meter stop must not leave it half judged.
    const randomItems = drawn.filter((x) => x.stratum !== 'flagged');
    for (const d of BOOKS ? [...randomItems, ...flaggedDrawn] : [...flaggedDrawn, ...randomItems]) {
      items.push({ kind: 'item', d, route: d.route });
      if (d.draft_route && rnd() < draftShare) items.push({ kind: 'draft', d, route: d.draft_route });
    }
    // Wrong-page controls: two per cell x route per ISO week, first in line (a route whose control fails does not count).
    const controls = [];
    for (const g of [...new Set(drawn.map((d) => `${d.cell}|${d.route}`))]) {
      const [cell, route] = g.split('|');
      const owed = 2 - hist.rows.filter((r) => r.kind === 'wrong_page' && r.cell === cell && r.route === route && r.week === week).length;
      const mine = drawn.filter((d) => d.cell === cell && d.route === route && d.stratum !== 'flagged');
      for (let i = 0; i < owed && mine.length >= 3; i++) {
        const d = mine[i], other = mine.find((o, j) => j > i && o.book_id !== d.book_id);
        if (other) controls.push({ kind: 'wrong_page', d, other, route });
      }
    }
    // Planted controls (#7611): K per cell x route per ISO week, on pages the judge ACCEPTED before, still holding that
    // text; one error each in the body, the kind rotating B -> E. Judged blind beside the items; scored in the export.
    const planted = [];
    const PER_WEEK = Number(arg('planted') ?? 2);
    if (PER_WEEK > 0) {
      for (const g of [...new Set(drawn.map((d) => `${d.cell}|${d.route}`))]) {   // every cell x route judged this run, flagged-only ones too
        const [cell, route] = g.split('|');
        // A language the planter has no bank for (it plants la / de / fr) gets no planted control, and says so.
        const lang = drawn.find((d) => `${d.cell}|${d.route}` === g)?.lang;
        if (!langCode(lang)) { console.log(`  planted: no planter for ${lang} (${g}); none owed`); continue; }
        const prior = await db.collection(VERDICTS).find({ kind: 'planted', cell, route }, { projection: { planted_from: 1, week: 1 } }).toArray();
        const owed = PER_WEEK - prior.filter((r) => r.week === week).length;
        if (owed <= 0) continue;
        const accepted = await db.collection(VERDICTS).find({ kind: 'item', cell, route, 'verdict.accept': true, 'draw.stratum': { $ne: 'flagged' } }).toArray();
        const ok = accepted.filter((r) => validRecord(r) && inEvidence(r));
        const texts = new Map((await db.collection('pages').find({ id: { $in: ok.map((r) => r.page_id) } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p.ocr?.data]));
        const sources = ok.map((rec) => ({ rec, text: texts.get(rec.page_id) })).filter((x) => typeof x.text === 'string' && h(x.text.trim()).slice(0, 16) === x.rec.text_hash);
        for (const x of planPlanted(sources, { owed, prior, lang, seed: seed ^ 0x7611 ^ parseInt(h(g).slice(0, 6), 16) })) {
          const r = x.rec;
          planted.push({ kind: 'planted', route, text: x.plantedText, plant: x.plant, from: r._id,
            d: { page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, cell, route, lane: r.lane, lang: r.lang, script_type: r.script_type, script_source: r.script_source,
              cell_hand: r.cell_hand, write: r.write, draft_model: r.draft_model, key: null, rate: null, u: null, human_read_count: r.draw?.human_read_count ?? null, stratum: 'planted' } });
        }
      }
    }
    const queue = [...controls, ...planted, ...items];
    const drawFile = path.join(OUT, `draw-${runId}.json`);
    fs.writeFileSync(drawFile, JSON.stringify({ run_id: runId, since, until, seed, frame, log, budget, max_calls: maxCalls, draft_share: draftShare, prompt_template_sha: PROMPT_TEMPLATE_SHA,
      mode: BOOKS ? 'book-depth' : 'nightly', books: BOOKS ? [...BOOKS] : null, per_book: BOOKS ? PER_BOOK : null,
      drawn: drawn.map(({ page_id, book_id, page_number, cell, route, key, rate, u, human_read_count, write, stratum, check_flag, change_share }) => ({ page_id, book_id, page_number, cell, route, key, rate, u, human_read_count, revision_id: write.revision_id, stratum, check_flag, change_share })),
      queue: queue.map((q) => ({ kind: q.kind, page_id: q.d.page_id, route: q.route, other: q.other?.page_id, ...(q.plant && { plant: q.plant, planted_from: q.from }) })) }, null, 1));
    const tally = {}; for (const d of drawn) tally[`${d.cell}/${d.route}`] = (tally[`${d.cell}/${d.route}`] ?? 0) + 1;
    console.log(`window ${since.toISOString()} .. ${until.toISOString()}  seed ${seed}  run ${runId}`);
    console.log(`frame ${JSON.stringify(frame)}`);
    console.log(`draw ${JSON.stringify(log)} -> ${drawn.length} pages ${JSON.stringify(tally)}; queue ${queue.length} calls (${controls.length} wrong-page controls, ${planted.length} planted)`);
    console.log(`budget: ${budget.maxCalls} calls / 7 days (${capPoints} pt / ${ppc} pt a call); ${hist.callsLast7d} made; ${maxCalls} this run`);
    const meter0 = await claudeMeter(limits);
    console.log(`meter: ${meter0 ? `${meter0.source} ${meter0.email ?? ''} weekly ${meter0.weekly}% 5h ${meter0.session}%` : 'unreadable'}`);
    if (DRY) { console.log(`dry run: nothing judged, nothing stored; draw in ${drawFile}`); return { runId, drawn, queue, frame }; }

    const { getPageSource } = await import('../lib/page-image-url.mjs');
    const pageDocs = new Map((await db.collection('pages').find({ id: { $in: [...new Set(queue.flatMap((q) => [q.d.page_id, q.other?.page_id].filter(Boolean)))] } },
      { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p]));
    const drafts = new Map((await db.collection('page_revisions').find({ id: { $in: drawn.map((d) => d.write.revision_id) } }, { projection: { id: 1, data: 1 } }).toArray()).map((r) => [r.id, typeof r.data === 'string' ? r.data : null]));
    let calls = 0, stop = null, meterAt = 0, meter = meter0;
    const retry = [];
    for (const q of queue) {
      if (calls >= maxCalls) { stop = `weekly cap: ${budget.maxCalls} calls in 7 days`; break; }
      if (Date.now() - meterAt > 5 * 60e3) { meter = await claudeMeter(limits); meterAt = Date.now(); }
      const local = limits.claudeBlocked({ weeklyMax: WEEKLY_MAX, sessionMax: SESSION_MAX });
      const why = local ? `${local.reason} (until ${local.until})` : paceBlock(meter);
      if (why) { stop = why; break; }
      const p = pageDocs.get(q.d.page_id);
      const text = q.kind === 'draft' ? drafts.get(q.d.write.revision_id) : q.kind === 'wrong_page' ? pageDocs.get(q.other.page_id)?.ocr?.data : q.kind === 'planted' ? q.text : p?.ocr?.data;
      const imageUrl = p && getPageSource(p);
      if (!text?.trim() || !imageUrl) { console.log(`  skip ${q.kind} ${q.d.page_id}: ${!imageUrl ? 'no image' : 'no text'}`); continue; }
      if (q.kind === 'item' && (await import('../lib/page-text-writer.mjs')).textHash(p.ocr) !== q.d.write.text_hash) { console.log(`  skip ${q.d.page_id}: rewritten since the draw`); continue; }
      const _id = `lj${h(`${q.kind}:${q.d.cell}:${q.route}:${q.d.page_id}:${q.other?.page_id ?? ''}:${h(text.trim())}`).slice(0, 16)}`;
      if (await db.collection(VERDICTS).findOne({ _id }, { projection: { _id: 1 } })) continue;
      const it = { id: _id, task: 'ocr', lang: q.d.lang, image_url: imageUrl, text };
      const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'lj-opus-'));
      let res;
      try {
        const img = await fetch(imageUrl);
        if (!img.ok) { console.log(`  skip ${q.d.page_id}: image HTTP ${img.status}`); continue; }
        fs.writeFileSync(path.join(ws, 'page.jpg'), Buffer.from(await img.arrayBuffer()));
        const prompt = judgePrompt(it, 'the file ./page.jpg in your working directory (open it with Read before you answer)');
        const t0 = Date.now(); calls++;
        res = await opusCall(prompt, ws);
        if (res.cls === 'quota') { limits.noteLimitHit('claude', { reason: res.text.slice(0, 200) }); stop = 'quota reply from claude -p'; break; }
        const v = parseVerdict(res.text);
        const doc = { _id, kind: q.kind, page_id: q.d.page_id, book_id: q.d.book_id, page_number: q.d.page_number, cell: q.d.cell, route: q.route, lane: q.d.lane, lang: q.d.lang,
          other_page_id: q.other?.page_id, script_type: q.d.script_type, script_source: q.d.script_source, cell_hand: q.d.cell_hand, write: q.d.write, draft_model: q.d.draft_model, image_url: imageUrl, text_hash: h(text.trim()).slice(0, 16),
          judge: { by: 'claude -p --model opus', model_reported: res.model, prompt_template_sha: PROMPT_TEMPLATE_SHA, prompt_sha: h(prompt).slice(0, 16), instrument: 'route-judge-6740 judgePrompt' },
          verdict: v, raw: v ? undefined : String(res.text).slice(0, 500), cls: res.cls, usage: res.usage, list_usd: res.cost, secs: Math.round((Date.now() - t0) / 1000),
          ...(q.kind === 'planted' && { plant: q.plant, planted_from: q.from, catch: v ? scorePlant(v, q.plant) : null }),
          seed, run_id: runId, week, draw: { key: q.d.key, rate: q.d.rate, u: q.d.u, human_read_count: q.d.human_read_count, stratum: q.d.stratum ?? 'random', ...(BOOKS && { mode: 'book-depth' }), ...(q.d.check_flag != null && { check_flag: q.d.check_flag, change_share: q.d.change_share }) }, called: true, judged_at: new Date().toISOString() };
        await db.collection(VERDICTS).insertOne(doc);
        console.log(`  ${q.kind} ${q.d.cell}/${q.route} ${q.d.book_id}:${q.d.page_number}: ${v ? `accept=${v.accept} ${v.fidelity} (${(v.defects || []).length} defects)` : `unparsed ${res.cls ?? ''}`}`);
        if (q.kind === 'item' && v && (!v.accept || wrongText(v))) retry.push({ page_id: q.d.page_id, book_id: q.d.book_id, page_number: q.d.page_number, cell: q.d.cell, route: q.route, accept: v.accept, fidelity: v.fidelity,
          defects: (v.defects || []).map((d) => ({ class: cls(d), severity: d.severity, quote: String(d.quote || '').slice(0, 120) })), next: 'GPU draft > agy (#7611 retry queue)' });
      } finally { fs.rmSync(ws, { recursive: true, force: true }); }
    }
    const meter1 = await claudeMeter(limits);
    if (retry.length) fs.writeFileSync(path.join(OUT, `retry-queue-${runId}.jsonl`), retry.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const runDoc = { _id: runId, dry_run: false, mode: BOOKS ? 'book-depth' : 'nightly', ...(BOOKS && { books: [...BOOKS], per_book: PER_BOOK }), since, until, seed, frame, draw_log: log, drawn: drawn.length, queue: queue.length, calls, stop, budget, cap_points: capPoints,
      draft_share: draftShare, meter_before: meter0, meter_after: meter1, prompt_template_sha: PROMPT_TEMPLATE_SHA, retry_queue: retry, host: os.hostname(), at: new Date().toISOString() };
    runDoc.next_since = stop ? since : until;
    await db.collection(RUNS).insertOne(runDoc);
    console.log(`judged ${calls} calls; ${stop ? `STOPPED: ${stop}` : 'queue done'}; ${retry.length} rejected -> retry queue`);
    return { runId, calls, stop, retry };
  } finally { await c.close(); }
}

/** Fill script_type / cell_hand on store records that lack them (records from before the rule; idempotent). */
async function annotate() {
  const { c, db } = await mongo();
  try {
    const todo = await db.collection(VERDICTS).find({ script_type: { $exists: false } }, { projection: { _id: 1, page_id: 1, book_id: 1, lane: 1 } }).toArray();
    if (!todo.length) { console.log('annotate: nothing to do'); return 0; }
    const pages = new Map((await db.collection('pages').find({ id: { $in: [...new Set(todo.map((r) => r.page_id))] } }, { projection: { id: 1, script_type: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p]));
    const prof = await bookProfiles(db, [...new Set(todo.map((r) => r.book_id))]);
    for (const r of todo) {
      const p = pages.get(r.page_id), sc = scriptClass(p?.ocr?.data, p?.script_type, bookHand(prof.get(r.book_id)));
      await db.collection(VERDICTS).updateOne({ _id: r._id, script_type: { $exists: false } }, { $set: { ...sc, cell_hand: LANES.find((l) => l.lane === r.lane)?.hand ?? null, script_annotated_at: new Date().toISOString() } });
    }
    console.log(`annotate: ${todo.length} records given a script type`);
    return todo.length;
  } finally { await c.close(); }
}

async function readStore() {
  const { c, db } = await mongo();
  try { return { records: await db.collection(VERDICTS).find({}).toArray(), runs: await db.collection(RUNS).find({ dry_run: false }).sort({ at: 1 }).toArray() }; } finally { await c.close(); }
}

async function doExport(file, root) {
  const { records, runs } = await readStore();
  const score = exportScore(records);
  // The measured price: the meter's movement over the runs that judged (integer percents, the account is shared).
  const judgedRuns = runs.filter((r) => r.calls > 0 && r.meter_before?.weekly != null && r.meter_after?.weekly != null && r.meter_before.email === r.meter_after.email);
  const pts = judgedRuns.reduce((a, r) => a + Math.max(0, r.meter_after.weekly - r.meter_before.weekly), 0), n = judgedRuns.reduce((a, r) => a + r.calls, 0);
  score.meter = { runs: judgedRuns.length, calls: n, weekly_points_delta: pts, points_per_call: n ? +(pts / n).toPrecision(3) : null,
    note: 'upper bound: integer meter, and the account is shared with the box\'s other sessions' };
  if (file) { fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); fs.writeFileSync(file, JSON.stringify(score, null, 1) + '\n'); }
  if (root) writeEvidence(root, score);
  for (const [cell, C] of Object.entries(score.cells)) for (const [route, x] of Object.entries({ ...C.routes, ...C.routes_not_counted }))
    console.log(`${cell}/${route}: ${x.counts ? 'counts' : 'control not passed'} accept ${x.accept} [${x.accept_ci.ci95?.join(', ')}] by ${x.accept_ci.unit} wrong_text ${x.wrong_text_pages} books ${x.books}`);
  return score;
}

const sh = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts }); if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${r.stderr || r.stdout}`); return r.stdout; };
const REPO = () => process.env.SL_REPO || '/data/scratch/sl/sourcelibrary';

/** The repo paths build.py opens: the table's own folder, its inputs, the script split's, and every evidence source but ours. */
export function rebuildInputs(rules, RT = 'scripts/eval/estimator/router-table') {
  const ss = rules.script_split?.on ? [rules.script_split.waiting].filter(Boolean) : [];
  return [...new Set([RT, 'scripts/eval/estimator/ocr', 'scripts/eval/estimator/chain', ...Object.values(rules.inputs), ...ss,
    ...rules.cells.flatMap((c) => c.routes.flatMap((r) => (r.evidence || []).map((e) => e.score)))])]
    .filter((p) => p !== EVIDENCE_PATH && p !== BY_SCRIPT_PATH);
}

/** build.py on a copy of origin/main, before and after the export; publish; comment on #7263 when a decision flips. */
async function rebuild() {
  const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'lane-judge-sampler'));
  const stamp = new Date().toISOString().slice(0, 10), dir = path.join(OUT, 'rebuild', stamp);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const ref = arg('ref') || 'origin/main', RT = 'scripts/eval/estimator/router-table';
  sh('git', ['-C', REPO(), 'fetch', '-q', 'origin', 'main']);
  const rulesText = sh('git', ['-C', REPO(), 'show', `${ref}:${RT}/rules.json`]);
  const rules = JSON.parse(rulesText);
  const need = rebuildInputs(rules, RT);
  const tar = spawnSync('git', ['-C', REPO(), 'archive', '--format=tar', ref, ...need], { maxBuffer: 1 << 30 });
  if (tar.status !== 0) throw new Error(`git archive: ${tar.stderr}`);
  sh('tar', ['-x', '-C', dir], { input: tar.stdout, encoding: undefined });
  // --export=FILE: a given score.json instead of the store (a replay, or a test of the feed)
  const score = arg('export') ? JSON.parse(fs.readFileSync(arg('export'), 'utf8')) : await doExport(null, dir);
  if (arg('export')) writeEvidence(dir, score);
  const py = (name, extra = []) => sh('python3', [`${RT}/build.py`, '--name', name, ...extra], { cwd: dir });
  py('baseline');
  let text = rulesText; const added = [];
  for (const { cell, route, entry } of evidenceEntries(score, rules)) { text = addEvidence(text, cell, route, entry); added.push(`${cell}/${route}`); }
  fs.writeFileSync(path.join(dir, RT, 'rules.json'), text);
  py('lane-judge', ['--before', `${RT}/baseline.json`]);
  const table = JSON.parse(fs.readFileSync(path.join(dir, RT, 'lane-judge.json'), 'utf8'));
  const md = fs.readFileSync(path.join(dir, RT, 'lane-judge.md'), 'utf8');
  const decisions = Object.fromEntries(table.rows.map((r) => [r.id, `${r.decision} ${r.route}`]));
  const pubDir = path.join(OUT, 'published'); fs.mkdirSync(pubDir, { recursive: true });
  const prevFile = path.join(pubDir, 'latest.json');
  const prev = fs.existsSync(prevFile) ? JSON.parse(fs.readFileSync(prevFile, 'utf8')).decisions
    : Object.fromEntries(JSON.parse(fs.readFileSync(path.join(dir, RT, 'baseline.json'), 'utf8')).rows.map((r) => [r.id, `${r.decision} ${r.route}`]));
  const flips = Object.keys(decisions).filter((k) => prev[k] && prev[k] !== decisions[k]).map((k) => ({ cell: k, before: prev[k], after: decisions[k] }));
  const sha = sh('git', ['-C', REPO(), 'rev-parse', '--short', ref]).trim();
  const pub = { _id: 'router-table:lane-judge', as_of: new Date().toISOString(), main_sha: sha, evidence_added: added, decisions, flips,
    lane_evidence: Object.fromEntries(Object.entries(score.cells).map(([c, C]) => [c, Object.fromEntries(Object.entries(C.routes).map(([r, x]) => [r, { accept: x.accept, wrong_text: x.wrong_text_pages, books: x.books, ci: x.accept_ci.ci95 }]))])),
    rows: table.rows.map((r) => ({ id: r.id, decision: r.decision, route: r.route, before: r.before, routes: r.routes.map((x) => ({ id: x.id, k: x.k, n: x.n, wrong: x.wrong, mean: x.mean, ci90: x.ci90 })) })), table_md: md };
  fs.writeFileSync(path.join(pubDir, `${stamp}.json`), JSON.stringify(pub, null, 1));
  fs.writeFileSync(prevFile, JSON.stringify(pub, null, 1));
  if (!flag('no-publish')) { const { c, db } = await mongo(); try { await db.collection('ops_reports').replaceOne({ _id: pub._id }, pub, { upsert: true }); } finally { await c.close(); } }
  console.log(`rebuilt on ${ref} ${sha}: evidence added ${added.join(', ') || 'none'}; flips ${flips.length}`);
  if (flips.length && !flag('no-post')) {
    const body = [`**Router table, lane-judge sampler nightly (#7611)**: ${flips.length} cell decision(s) changed with the judged lane output (build.py on main ${sha}).`, '',
      '| cell | before | after | lane evidence |', '|---|---|---|---|',
      ...flips.map((f) => `| ${f.cell} | ${f.before} | ${f.after} | ${Object.entries(pub.lane_evidence[f.cell] ?? {}).map(([r, x]) => `${r} ${x.accept} (wrong text ${x.wrong_text}, ${x.books} books)`).join('; ') || 'none (other evidence moved)'} |`), '',
      'Published: ops_reports `router-table:lane-judge`. The routing tables do not change from this (hold list).'].join('\n');
    sh('gh', ['issue', 'comment', '7263', '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--body', body]);
  }
  // New containment candidates go on #7611, once each.
  const seenFile = path.join(OUT, 'contain-posted.json'), seen = new Set(fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, 'utf8')) : []);
  const fresh = score.contain_candidates.filter((x) => !seen.has(`${x.page_id}:${x.route}`));
  if (fresh.length && !flag('no-post')) {
    const body = [`**Containment candidates from the lane-judge sampler** (the judge says these served pages carry text not on the leaf; check by eye before containing, containment-on-finding.md):`, '',
      '| book:page | cell / route | defects |', '|---|---|---|',
      ...fresh.map((x) => `| ${x.book_id}:${x.page_number} | ${x.cell} / ${x.route} | ${x.defects.map((d) => `${cls(d)} "${String(d.quote || '').slice(0, 80).replace(/[|\n]/g, ' ')}"`).join('; ')} |`)].join('\n');
    sh('gh', ['issue', 'comment', '7611', '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--body', body]);
    for (const x of fresh) seen.add(`${x.page_id}:${x.route}`);
    fs.writeFileSync(seenFile, JSON.stringify([...seen]));
  }
  return { flips, added, sha };
}

/** The repo copy: a PR (never main) with the export and the rules.json entries. */
async function weeklyPr() {
  const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'lane-judge-sampler'));
  const stamp = new Date().toISOString().slice(0, 10), branch = `lane-judge/weekly-${stamp}`, wt = path.join(OUT, 'pr-worktree');
  const RT = 'scripts/eval/estimator/router-table';
  sh('git', ['-C', REPO(), 'fetch', '-q', 'origin', 'main']);
  if (fs.existsSync(wt)) sh('git', ['-C', REPO(), 'worktree', 'remove', '--force', wt]);
  sh('git', ['-C', REPO(), 'worktree', 'add', '-q', '-B', branch, wt, 'origin/main']);
  try {
    for (const f of ['src/lib/vendor/lamejs-bundle.js']) if (fs.existsSync(path.join(REPO(), f))) { fs.mkdirSync(path.dirname(path.join(wt, f)), { recursive: true }); fs.copyFileSync(path.join(REPO(), f), path.join(wt, f)); }
    const score = await doExport(null, wt);
    const rf = path.join(wt, RT, 'rules.json');
    let text = fs.readFileSync(rf, 'utf8'); const rules = JSON.parse(text), added = [];
    for (const { cell, route, entry } of evidenceEntries(score, rules)) { const t2 = addEvidence(text, cell, route, entry); if (t2 !== text) added.push(`${cell}/${route}`); text = t2; }
    fs.writeFileSync(rf, text);
    const changed = sh('git', ['-C', wt, 'status', '--porcelain', '--', EVIDENCE_PATH, BY_SCRIPT_PATH, `${RT}/rules.json`]).trim();
    if (!changed) { console.log('weekly-pr: no change against main'); return null; }
    sh('git', ['-C', wt, 'add', EVIDENCE_PATH, BY_SCRIPT_PATH, `${RT}/rules.json`]);
    sh('git', ['-C', wt, 'commit', '-s', '-q', '-m', `eval(#7611): lane-judge sampler weekly snapshot ${stamp}\n\nThe store's verdicts as router evidence (${EVIDENCE_PATH})${added.length ? `; rules.json entries added: ${added.join(', ')}` : ''}.`]);
    sh('git', ['-C', wt, 'push', '-q', '-f', '-u', 'origin', branch]);
    const lines = Object.entries(score.cells).flatMap(([c, C]) => Object.entries(C.routes).map(([r, x]) => `| ${c} | ${r} | ${x.accept} | ${x.accept_ci.ci95?.join('–') ?? ''} | ${x.wrong_text_pages} | ${x.books} |`));
    const body = [`Weekly snapshot of the lane-judge sampler store (#7611): the export as \`${EVIDENCE_PATH}\`${added.length ? ` and new rules.json evidence entries (${added.join(', ')})` : ''}. Made by \`lane-judge-sampler.mjs weekly-pr\`; the box rebuilds the table nightly either way (ops_reports \`router-table:lane-judge\`).`, '',
      '| cell | route | accepted | 95% CI (by book) | wrong text | books |', '|---|---|---|---|---|---|', ...lines, '',
      'Out of scope: the routing tables (hold list); no page text changes.', '', 'Part of #7611', '', '🤖 Generated with [Claude Code](https://claude.com/claude-code)'].join('\n');
    const existing = sh('gh', ['pr', 'list', '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--head', branch, '--json', 'number', '--jq', '.[0].number']).trim();
    if (!existing) sh('gh', ['pr', 'create', '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--base', 'main', '--head', branch, '--title', `eval(#7611): lane-judge sampler weekly snapshot ${stamp}`, '--body', body]);
    console.log(`weekly-pr: ${existing ? `updated #${existing}` : 'opened'} ${branch}`);
    return branch;
  } finally { sh('git', ['-C', REPO(), 'worktree', 'remove', '--force', wt]); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const STAGE = process.argv[2];
  const stages = {
    run, export: () => doExport(arg('file') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'lane-judge-sampler', 'lane-judge.score.json')),
    rebuild, annotate, 'weekly-pr': weeklyPr,
    nightly: async () => { const r = await run(); await annotate(); await rebuild(); return r; },
  };
  if (!stages[STAGE]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[STAGE]();
}
