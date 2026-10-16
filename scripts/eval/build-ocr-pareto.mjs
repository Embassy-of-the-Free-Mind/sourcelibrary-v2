#!/usr/bin/env node
/**
 * build-ocr-pareto.mjs — cost against accuracy, one chart per script, for /quality and /quality/pareto (#5983,
 * rebuilt in #6386 after "I don't trust the data or the sampling").
 *
 * PRIOR ART: scripts/eval/benchmark-dashboard-data.mjs — grades every engine cell and pairs it
 * against the production engine, but carries no cost and never puts three engines on the SAME
 * pages. scripts/eval/build-routing-table.mjs — one routing row per language, from the same
 * evidence, without cost. scripts/eval/bench2-escalation-report.mjs — a blended-cost table for
 * one 11-page bench with its prices typed into the script. None draws a frontier.
 *
 * Run by benchmark-dashboard-data.mjs after every re-score, so the charts move with the evidence
 * table in the same commit (the Vercel build cannot run it: .vercelignore drops scripts/eval/results).
 * tests/unit/ocr-pareto.test.ts runs --check, so CI refuses a stale file. Reads only committed files:
 *   accuracy   scripts/eval/lib/benchmark-rows.mjs (the evidence table's own rows), the #6011 / #6293 engine runs,
 *              the #6295 Syriac print panel and the Syriac ground-truth retest; every #6293 Latin-script read re-scored with
 *              the CLI's wrapper removed (results/ocr-pareto-6293/extract-rescored.json, #6523)
 *   works      results/pareto-works.json (build-pareto-works.mjs: book → work_id), for the intervals
 *   cost       Gemini: the latest results/ocr-cost/ocr-cost-<date>.json (metered Batch spend); self-hosted and
 *              other APIs: ocr-engine-gpu-costs.json (each entry quotes its run's write-up); CLI arms: cli-cost*.json
 *   production scripts/lib/ocr-routing.mjs, the router that picks the model for new pages
 *   time       seconds a page, the median of each arm's own meter on the panel's pages: the #6293 CLI meters
 *              (ocr-pareto-6293/meter-*.jsonl), the #6707 Gemini 4 Argon reads (g4-hard-6707/raw) and the #6731 cells.
 *              An engine with no per-page meter is "not measured", never estimated (#6776)
 *   hard hands #6731's Greek-manuscript and Rashi-type panels (results/hard-hands-6731/scored-*.json), graded by the
 *              same rules (#6776)
 * Writes src/data/ocr-pareto.json. No timestamps: unchanged inputs give an identical file.
 *   node scripts/eval/build-ocr-pareto.mjs           # write
 *   node scripts/eval/build-ocr-pareto.mjs --check   # exit 1 if the committed file is stale
 *   node scripts/eval/build-ocr-pareto.mjs --dump-sets=<file>   # each chart's primary page keys and engines
 *   node scripts/eval/build-ocr-pareto.mjs --dump-rows=<file>   # every scored page × engine per chart
 *   node scripts/eval/build-ocr-pareto.mjs --keep-dropped   # with the pages #6304 dropped put back
 *   node scripts/eval/build-ocr-pareto.mjs --exclude=<file> --out=<file>   # sensitivity rebuilds; never the committed file
 *
 * The rules (#6386; .claude/docs/eval-design.md §7):
 *   - ONE FAILURE RULE for every engine (#6523, replacing #6386's "a failed read is CER 1.0"): a read that failed
 *     (the copy filter cut or blocked it, another refusal, empty, a timeout, chat with no transcription;
 *     scripts/lib/read-failure.mjs) is NOT SCORED and is counted per engine × panel as `did_not_read` {k, n, kinds};
 *     above 20% unread the point is flagged `partly_measured`. A misread is scored, CER capped at 1; a read that could
 *     not be placed against the reference stays a scored 100% error. The page stays in the panel for every engine. A
 *     page drops only when an engine was never run on it, or #6304 found its reference does not fit the page;
 *   - each engine: mean accuracy over the pages it read (1 − mean CER, each page capped at 1) with a 95% interval that
 *     resamples WORKS, and the share of those pages with CER above 0.5;
 *   - each engine against the engine in use: the mean per-page accuracy difference on the pages both read, with a
 *     work-clustered bootstrap interval; where a like-for-like second run of the engine in use covers the panel, its
 *     spread sets the noise band (lib/pareto-stats.mjs noiseOf). Verdict words only when the interval excludes 0 and clears it;
 *   - each panel gets a fitness grade (lib/pareto-stats.mjs gradePanel). Pages are split by how their reference was
 *     made, so a panel never pools two error measures, and the strata whose reference was located with the
 *     production engine's own reading get their own panel, graded not fit;
 *   - ONE COST BASIS: billed dollars (Gemini at its metered Batch rate; other APIs at their billed rate; GPU runs at
 *     the whole billed rental, shared by inference time); CLI runs at the API Batch price for the same requests,
 *     marked `quota` ($0 billed, subscription); an engine with no billed price sits on the "no price" strip;
 *   - every point names its ROUTE (#6776): `api` (billed per request), `subscription` (a CLI on the subscription, $0
 *     billed), `gpu` (a rented GPU, billed whole) or `own` (our own server).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBenchmarkRows, BENCHMARK_DIR } from './lib/benchmark-rows.mjs';
import { getOcrModelForBook } from '../lib/ocr-routing.mjs';
import { r3, median, mean, hash, clusterCI, pairedDiff, noiseOf, verdictOf, gradePanel, toDecide, GRADE_RULES, MARGIN, markFrontier, verdictSentence } from './lib/pareto-stats.mjs';
import { readFailure, READ_FAILURE_KINDS } from '../lib/read-failure.mjs';
import { extractTranscription } from '../lib/cli-chatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const OUT = path.join(REPO, 'src', 'data', 'ocr-pareto.json');
const MIN_PAGES = 5;          // below this no interval at all
const FRONTIER_MIN = 3;       // fewer priced engines than this: no frontier
const WIDE_KEEP = 0.5;        // the primary panel keeps at least half the production engine's pages
const MIN_WORKS_EXTRA = 10;   // a second view of the same pages is shown only on 10 or more works
const PARTLY_MEASURED = 0.2;  // an engine that did not read more than this share of a panel is flagged (#6523)
const KIND_WORDS = { copy_filter: 'copy filter', refusal: 'refusal', empty: 'empty', timeout: 'timeout', other: 'other' };

const LABEL = {
  'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite', 'gemini-3-flash-preview': 'Gemini 3 Flash',
  'paddleocr-vl-1.6': 'PaddleOCR-VL 1.6', 'ndlkotenocr-v3': 'NDL Koten OCR v3', 'surya2': 'Surya 2', 'dots-mocr': 'dots.mocr',
  'cllg-qwen3vl-8b': 'Qwen3-VL 8B (CLLG)', 'kraken-greek-cllg': 'Kraken (CLLG Greek)', 'kraken-catmus': 'Kraken (CATMuS)',
  'kraken-austriannewspapers': 'Kraken (Austrian newspapers)', 'tesseract-lat': 'Tesseract (lat)', 'tesseract-grc': 'Tesseract (grc)',
  'tesseract-deu': 'Tesseract (deu)', 'tesseract-frk': 'Tesseract (frk)', 'tesseract-hye': 'Tesseract (hye)', 'tesseract-hye_calfa': 'Tesseract (hye, Calfa)',
  'tesseract-chi_tra_vert': 'Tesseract (chi_tra_vert)', omnisyr: 'Kraken (OmniSyr)', 'qoruyo-eastern': 'Kraken (Qoruyo East)',
  'qoruyo-estrangela': 'Kraken (Qoruyo Estrangela)', 'sophro-defaultseg': 'Kraken (Sophro)',
  'omnisyr-nosplit': 'Kraken (OmniSyr), no column split', 'sophro-mhiro': 'Kraken (Sophro Mhiro)',
  'olmocr-2-7b-fp8': 'olmOCR 2 7B', mineru: 'MinerU',
  'deepseek-ocr': 'DeepSeek-OCR', 'qwen3-vl-8b': 'Qwen3-VL 8B', 'chandra-ocr-2': 'Chandra OCR 2', 'mistral-ocr-4-1': 'Mistral OCR 4.1',
  'claude-opus-5-5': 'Claude Opus 5.5', 'claude-sonnet-5-5': 'Claude Sonnet 5.5',
};

// How each stratum's reference was made. `metric`: which error measure the scorer applies (pages of two measures are
// never pooled). `anchored`: the reference was located using the production engine's own stored reading (#6386
// audit, point 2), which favours the engine in use. `edition`: the reference is a modern edition of the work rather
// than a transcription of this page.
const STRATA = {
  'ref-ws': { reference: 'Wikisource proofread transcriptions of the page', metric: 'windowed' },
  'ref-pinned': { reference: 'published e-texts pinned to the page', metric: 'windowed', edition: true },
  'eebo-tcp-5488': { reference: 'EEBO-TCP keyed transcriptions', metric: 'whole', anchored: true },
  'latin-period-5126': { reference: 'transcriptions matched to the page with our own reading', metric: 'whole', anchored: true },
  greek: { reference: 'First1KGreek, Perseus and el.wikisource editions', metric: 'whole', edition: true },
  'greek-ext': { reference: 'First1KGreek, Perseus and el.wikisource editions', metric: 'whole', edition: true },
  'greek-ext2': { reference: 'First1KGreek, Perseus and el.wikisource editions', metric: 'whole', edition: true },
  chinese: { reference: 'Kanripo (Siku Quanshu) and CBETA e-texts', metric: 'whole', edition: true },
  'chinese-ext': { reference: 'Kanripo (Siku Quanshu) and CBETA e-texts', metric: 'whole', edition: true },
  'chinese-cohort-5547': { reference: 'Kanripo (Siku Quanshu) and CBETA e-texts', metric: 'whole', edition: true },
  armenian: { reference: 'TITUS e-texts keyed from the same edition', metric: 'whole' },
  'syriac-gt': { reference: 'line-by-line transcriptions of two manuscripts', metric: 'line' },
  'syriac-print-6295': { reference: 'Digital Syriac Corpus e-texts, located with our own reading', metric: 'consonant', anchored: true, edition: true },
  // #6731: CER by fitting alignment (text read outside the reference passage is free), a measure of its own
  'greek-ms-6731': { reference: 'Schneider and Berthelot–Ruelle editions, the span fitted to the page with Kraken', metric: 'fitting', edition: true },
  'greek-ms-6731-anchored': { reference: 'Schneider and Berthelot–Ruelle editions, the span fitted with our own reading', metric: 'fitting', anchored: true, edition: true },
  // the span is the median of every read that aligns, the stored production read among them: anchored on every page
  // (splitting on whether production's read aligned would split on production's own error)
  'rashi-6731': { reference: 'Sefaria texts, the span placed with every engine’s reads, our own among them', metric: 'fitting', anchored: true, edition: true },
};
const stratumOf = page => page.split('|')[0];
const fallbackStratum = s => STRATA[s] || { reference: `references sealed with ${s}`, metric: 'whole' };

// One chart per script. `language` is what the router is asked, to name the production engine.
const SCRIPTS = [
  { id: 'latin', title: 'Latin print', language: 'Latin', match: r => r.language === 'Latin' },
  { id: 'english', title: 'Early English print', language: 'English', match: r => r.language === 'English' },
  { id: 'latin-script-other', title: 'German, French and other Latin-script print', language: 'German', match: r => (r.script || '').startsWith('Latin') && r.language !== 'Latin' && r.language !== 'English' },
  { id: 'greek', title: 'Greek', language: 'Greek', match: r => r.script === 'Greek' },
  { id: 'chinese-manuscript', title: 'Chinese manuscript', language: 'Chinese', match: r => r.script === 'Han' && /^manuscript/.test(r.script_class || '') },
  { id: 'chinese-print', title: 'Chinese print (woodblock and type)', language: 'Chinese', match: r => r.script === 'Han' && /^(woodblock|typeset)/.test(r.script_class || '') },
  { id: 'japanese', title: 'Japanese (kana and kanji)', language: 'Japanese', match: r => r.script === 'Japanese (kana + kanji)' },
  { id: 'armenian', title: 'Armenian', language: 'Armenian', match: r => r.script === 'Armenian' },
  { id: 'hebrew', title: 'Hebrew', language: 'Hebrew', match: r => r.script === 'Hebrew' },
  { id: 'syriac', title: 'Syriac manuscript', language: 'Syriac', source: 'syriac' },
  // Production for printed Syriac is the Kraken lane (scripts/workers/syriac-kraken-lane.mjs, #4883), not the router.
  { id: 'syriac-print', title: 'Syriac print', language: 'Syriac', source: 'syriac-print', production: 'omnisyr' },
  // #6731: compared against the production OCR stored for these pages, not a fresh read by the router's engine
  { id: 'greek-manuscript', title: 'Greek manuscript', language: 'Greek', source: 'greek-ms', production: 'production-stored' },
  { id: 'rashi', title: 'Hebrew in Rashi type', language: 'Hebrew', source: 'rashi', production: 'production-stored' },
];
// #6304's verdicts: these charts' references were judged not fit to rank engines.
const UNFIT_6304 = new Set(['chinese-print', 'armenian']);
// Scripts with OCR runs but no typed reference the charts could score against.
const NO_REFERENCE = [
  { title: 'Tibetan', why: 'measured as syllable identity against the Derge e-text, a different measure from page error (#6011)', source: 'scripts/eval/results/engine-wave1-6011/summary.json' },
  { title: 'Sanskrit', why: 'only repeat-read consistency has been measured, not accuracy', source: 'scripts/eval/results/sanskrit-consistency-2026-04-24.json' },
  { title: 'Persian', why: 'scored as located windows against Ganjoor verse, a different measure from page error', source: 'scripts/eval/results/persian-ganjoor-2026-10-01-stage1b/table.json' },
];

// ── cost: one basis ──────────────────────────────────────────────────────────────────────────
// basis 'billed': dollars actually billed for these reads (Gemini metered at the Batch rate; Mistral and the Claude
// API arms at their billed realtime rate, as they have no Batch route here; GPU rentals billed whole and shared by
// inference time). basis 'quota': a CLI run on the subscription, $0 billed, placed at the API Batch price for the
// same requests. An engine priced only on its inference time (no billed rental on record) has no price.
const costDir = path.join(__dirname, 'results', 'ocr-cost');
const costFile = fs.readdirSync(costDir).filter(f => /^ocr-cost-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1);
if (!costFile) throw new Error(`no metered cost snapshot in ${costDir} — run scripts/eval/ocr-cost-snapshot.mjs`);
const metered = JSON.parse(fs.readFileSync(path.join(costDir, costFile), 'utf8'));
const gpu = JSON.parse(fs.readFileSync(path.join(__dirname, 'ocr-engine-gpu-costs.json'), 'utf8'));
const COST = {};      // engine → [{ charts|null, usd_per_1k, basis, detail, source }]
const NO_PRICE = {};  // engine → why it has no price
const NO_PRICE_ROUTE = {}; // engine → route of an engine priced on inference time only
for (const [engine, m] of Object.entries(metered.models)) COST[engine] = [{
  charts: null, usd_per_1k: r3(m.usd_per_1k_pages), basis: 'billed', route: 'api',
  detail: `Gemini Batch, ${m.pages.toLocaleString('en-US')} pages metered ${metered.window.from.slice(0, 10)} to ${metered.window.to.slice(0, 10)}`,
  source: `scripts/eval/results/ocr-cost/${costFile}`,
}];
const flat = t => t.replace(/\s+/g, ' ');   // write-ups wrap lines mid-sentence
for (const [engine, entries] of Object.entries(gpu.engines)) {
  const billed = [];
  for (const g of entries) {
    const text = flat(fs.readFileSync(path.join(REPO, g.source), 'utf8'));
    for (const part of g.quote.split(' … ')) if (!text.includes(flat(part))) throw new Error(`ocr-engine-gpu-costs.json: ${engine}'s quote "${part}" is not in ${g.source}`);
    if (g.basis === 'compute') { NO_PRICE[engine] = 'priced on inference time only; no billed rental on record'; NO_PRICE_ROUTE[engine] = /Scaleway/.test(g.hardware) ? 'gpu' : 'own'; continue; }
    const eurPerPage = g.eur_per_page ?? (g.eur != null && g.pages ? g.eur / g.pages : null);
    const usd = g.usd_per_1k ?? (eurPerPage != null ? eurPerPage * 1000 * gpu.usd_per_eur.value : null);
    if (usd == null) throw new Error(`ocr-engine-gpu-costs.json: ${engine} entry has no eur+pages, eur_per_page or usd_per_1k`);
    billed.push({
      charts: g.charts ?? null, usd_per_1k: r3(usd), basis: 'billed', route: g.basis === 'metered-api' ? 'api' : 'gpu',
      detail: `${g.hardware}; ${g.basis === 'metered-api' ? 'billed API spend, realtime rate' : 'whole billed rental'}, measured ${g.measured_on}`,
      source: g.source,
    });
  }
  if (billed.length) COST[engine] = billed;
}
function costOf(engine, chartId) {
  const es = COST[engine] || [];
  const e = es.find(x => x.charts?.includes(chartId)) || es.find(x => !x.charts);
  if (!e) return null;
  const { charts, route, ...rest } = e;
  return rest;
}
const isCli = e => /\+(antigravity|claude)-cli$/.test(e);
const OWN_SERVER = e => /^(kraken|tesseract|omnisyr|qoruyo|sophro)/.test(e) || ['omnisyr-nosplit', 'mineru'].includes(e);
/** How the engine was run for this chart: what a page costs in money or in time and quota (#6776). */
function routeOf(engine, chartId) {
  if (isCli(engine)) return 'subscription';
  const es = COST[engine] || [];
  const e = es.find(x => x.charts?.includes(chartId)) || es.find(x => !x.charts);
  if (e) return e.route;
  if (engine === STORED) return 'api';
  // an API arm priced only for other charts ran by the same route here; an engine of unknown route says so (null)
  return NO_PRICE_ROUTE[engine] || es[0]?.route || (OWN_SERVER(engine) ? 'own' : null);
}

// ── works: the unit the intervals resample ───────────────────────────────────────────────────
const WORKS = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'pareto-works.json'), 'utf8')).books;
const workOfBook = b => (b ? `work:${WORKS[b] || b}` : null);
const REGISTRY = new Map();
for (const f of fs.readdirSync(path.join(__dirname, 'benchmark')).filter(f => f.endsWith('.json'))) {
  const pages = JSON.parse(fs.readFileSync(path.join(__dirname, 'benchmark', f), 'utf8')).pages;
  if (Array.isArray(pages)) for (const p of pages) if (p.book_id) REGISTRY.set(p.slug, p.book_id);
}
const gtOf = (dir, slug) => { const f = path.join(__dirname, dir, `${slug}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
function workOfPage(page) {
  const [stratum, slug] = page.split('|');
  if (stratum === 'ref-ws') { const g = gtOf('ground-truth-ws', slug); return `scan:${g?.commons_file || g?.work || slug}`; }
  if (stratum === 'ref-pinned') { const g = gtOf('ground-truth', slug); return workOfBook(g?.book_id) || `text:${g?.work || slug}`; }
  return workOfBook(REGISTRY.get(slug)) || `page:${page}`;
}

// ── accuracy rows: one per page × engine, against a typed reference ─────────────────────────────
// The benchmark store first; then the #5660 open-engine run, #6011 waves 1 and 2, and #6293's CLI arms, each scored
// by the same scorer against the same references (a page × engine already read keeps its first row).
const WAVE_ENGINES = new Set(['deepseek-ocr', 'qwen3-vl-8b', 'chandra-ocr-2', 'mistral-ocr-4-1', 'claude-opus-5-5', 'claude-sonnet-5-5']);
const CLI_6293_TIERS = [['3.8', 'cli-cost.json'], ['3.7', 'cli-cost-gemini-3.7-flash.json'], ['3.6', 'cli-cost-gemini-3.6-flash.json'], ['3.8', 'cli-cost-gemini-3.8-flash-high.json', 'high']]
  .map(([v, f, effort = 'low']) => ({ v, effort, engine: `gemini-${v}-flash${effort === 'low' ? '' : `-${effort}`}+antigravity-cli`,
    label: `Gemini ${v} Flash (CLI${effort === 'low' ? '' : `, ${effort}`})`, costFile: path.join(__dirname, 'results', 'ocr-pareto-6293', f) }))
  // #6707 Amendment 4.1: Gemini 4 Argon low through the CLI on the hard panels. No API list price yet, so no cost file:
  // the arm is listed unplaced, never placed at a guessed price.
  .concat([{ v: '4-argon', effort: 'low', engine: 'gemini-4-argon-low+antigravity-cli', label: 'Gemini 4 Argon low (CLI)', costFile: null }]);
const CLI_6293_ENGINES = new Set(CLI_6293_TIERS.map(t => t.engine));
LABEL['gemini-4-argon-low+antigravity-cli'] = 'Gemini 4 Argon low (CLI)';
NO_PRICE['gemini-4-argon-low+antigravity-cli'] = 'no API list price; $0 billed on the Google subscription (Antigravity CLI, #6707)';
const OPEN_ENGINE_DIRS = ['open-engine-print-5660/scored', 'open-engine-print-5660/scored-olmocr', 'engine-wave1-6011/scored', 'engine-wave2-6011/scored', 'ocr-pareto-6293/scored'];
const DIR_ENGINES = { 'engine-wave1-6011/scored': WAVE_ENGINES, 'engine-wave2-6011/scored': WAVE_ENGINES, 'ocr-pareto-6293/scored': CLI_6293_ENGINES };
const isRepeatArm = e => /-b$/.test(e); // the A-vs-A repeat of production: the noise band, never a point
const benchRows = [];
{
  const seen = new Set();
  for (const [d, dir] of [[null, BENCHMARK_DIR], ...OPEN_ENGINE_DIRS.map(d => [d, path.join(__dirname, 'results', d)])]) {
    const { rows, latest } = readBenchmarkRows(dir);
    const only = DIR_ENGINES[d];
    const dateOf = new Map([...latest].map(([st, f]) => [st, f.match(/(\d{4}-\d{2}-\d{2})\.json$/)[1]]));
    const file = new Map([...latest].map(([st, f]) => [st, path.relative(REPO, path.join(dir, f))]));
    for (const r of rows) {
      const key = `${r.stratum}|${r.slug}|${r.engine}`;
      if (seen.has(key) || (only && !only.has(r.engine))) continue;
      seen.add(key);
      benchRows.push({ ...r, date: dateOf.get(r.stratum), file: file.get(r.stratum) });
    }
  }
}
// The CLI's wrapper (a plan note, trailing chat after a partial read, a restarted or doubled reply, ``` fences) is the
// route talking, not the page being read. Every engine's read in the Latin-script strata is re-scored with ONE
// extractor (rescore-extract.mjs, cli-chatter.mjs extractTranscription, with its positive control; #6523). It
// supersedes the #6386 plan-note re-score, which removed only the leading note.
const RESCORED = new Map(JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'ocr-pareto-6293', 'extract-rescored.json'), 'utf8'))
  .rows.map(r => [`${r.page}|${r.engine}`, r.extracted]));
// The CLI arms' replies and meters are committed (outputs-*.jsonl, meter-*.jsonl), so a CLI read's failure is told
// from its own words; every other engine's from what its scored cell recorded (finishReason, refusal, text length).
const CLI_REPLY = new Map();
// Seconds a page (#6776): page|engine → { secs, file }, from each arm's own meter only.
const SECS = new Map();
const meterSecs = (page, engine, secs, file) => { if (typeof secs === 'number') SECS.set(`${page}|${engine}`, { secs, file: path.relative(REPO, file) }); };
for (const f of fs.readdirSync(path.join(__dirname, 'results', 'ocr-pareto-6293')).filter(f => /^(outputs|meter)-.*\.jsonl$/.test(f) && !f.includes('-rep'))) {
  for (const line of fs.readFileSync(path.join(__dirname, 'results', 'ocr-pareto-6293', f), 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(line), k = `${o.stratum}|${o.slug}|${o.engine}`;
    CLI_REPLY.set(k, { ...CLI_REPLY.get(k), ...(f.startsWith('outputs') ? { text: o.text } : { finishReason: o.finishReason, error: o.error }) });
    if (f.startsWith('meter')) meterSecs(`${o.stratum}|${o.slug}`, o.engine, o.secs, path.join(__dirname, 'results', 'ocr-pareto-6293', f));
  }
}
// ONE FAILURE RULE (#6523, Derek 2026-10-11: "Count them but don't score them. We only want to know quality when it
// works."): a read that failed (copy filter, other refusal, empty, timeout, or chat with no transcription) is NOT
// SCORED and is counted as `failure`, for every engine alike (scripts/lib/read-failure.mjs). A real misread is scored,
// its CER capped at 1; a read the scorer could not place against the reference is text the engine produced for the
// page, so it stays a scored 100% error (`unplaced`).
const toRow = (r, page, extra = {}) => {
  const fixed = RESCORED.get(`${page}|${r.engine}`);
  const aligned = fixed ? fixed.aligned : r.aligned, cer0 = fixed ? fixed.cer : r.cer;
  const cli = CLI_6293_ENGINES.has(r.engine) ? CLI_REPLY.get(`${page}|${r.engine}`) : null;
  const fail = readFailure({
    text: cli?.text ?? null, extracted: cli?.text != null ? extractTranscription(cli.text).text : null,
    finishReason: cli?.finishReason ?? r.finish_reason, cli: !!cli, error: cli?.error ?? null,
    refused: r.refused, refusalSource: r.refusal_inferred ? 'inferred' : null, contentChars: r.content_chars,
  });
  const unplaced = !fail && (!aligned || cer0 == null);
  return { page, stratum: r.stratum, engine: r.engine, cer: fail ? null : unplaced ? 1 : Math.min(1, cer0), failure: fail?.kind ?? null, failure_why: fail?.why ?? null, unplaced,
    invented: fail ? null : r.invention_ref, date: r.date, file: r.file, row: r, ...extra };
};
const allRows = benchRows.filter(r => r.referenced).map(r => toRow(r, `${r.stratum}|${r.slug}`));
const accRows = allRows.filter(r => !isRepeatArm(r.engine));
const repeatRows = allRows.filter(r => isRepeatArm(r.engine));

// Syriac manuscript: the ground-truth retest scores pages of two manuscripts (the unit is the manuscript). Its CLI
// reads are scored as returned: their ground truth is on the scoring box only, so the preamble cannot be removed here.
const SYRIAC_FILE = 'syriac-retest-2026-09-16/score.json';
const SYRIAC_SOURCES = [[path.join(BENCHMARK_DIR, SYRIAC_FILE), null, '2026-09-16'], [path.join(__dirname, 'results', 'engine-wave2-6011', 'syriac-gt-score.json'), WAVE_ENGINES, null],
  [path.join(__dirname, 'results', 'ocr-pareto-6293', 'syriac-gt-score.json'), CLI_6293_ENGINES, null]];
const syriacRows = [];
for (const [file, only, fixedDate] of SYRIAC_SOURCES) {
  if (!fs.existsSync(file)) continue;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'))['syriac-gt'];
  const date = fixedDate || j.date;
  for (const [slug, engines] of Object.entries(j.pages)) for (const [engine, e] of Object.entries(engines)) {
    if (only && !only.has(engine)) continue;
    if (e.missing) continue;
    const failed = typeof e.cer_n2 !== 'number';
    syriacRows.push({ page: `syriac-gt|${slug}`, stratum: 'syriac-gt', engine, cer: failed ? null : Math.min(1, e.cer_n2), failure: failed ? 'other' : null, failure_why: failed ? 'no score' : null, invented: null, date, file: path.relative(REPO, file), work: `ms:${slug.split('-')[0]}` });
  }
}

// Syriac print (#6295): one sealed page per book, scored by scripts/eval/syriac-pareto-6295/analyze-ocr.mjs; the unit
// is the edition. L-ocr-b / C38-ocr-b are A-vs-A repeats (noise), not engines.
const SYRIAC_PRINT_FILE = path.join(__dirname, 'results', 'syriac-pareto-6295', 'ocr-summary.json');
const SYRIAC_CLI_COST_FILE = path.join(__dirname, 'results', 'syriac-pareto-6295', 'cli-cost.json');
const SYRIAC_CLI_TIERS = [['C38', '3.8'], ['C37', '3.7'], ['C36', '3.6']].map(([T, v]) => ({ T, v, key: `cli_${T.toLowerCase()}`, engine: `gemini-${v}-flash+antigravity-cli` }));
for (const t of SYRIAC_CLI_TIERS) LABEL[t.engine] = `Gemini ${t.v} Flash (CLI)`;
const SYRIAC_PRINT_ARMS = { omnisyr: 'omnisyr', 'omnisyr-nosplit': 'omnisyr-nosplit', 'sophro-mhiro': 'sophro-mhiro', 'qoruyo-eastern': 'qoruyo-eastern',
  'qoruyo-estrangela': 'qoruyo-estrangela', 'L-ocr': 'gemini-3.1-flash-lite', mineru: 'mineru', 'C38-ocr': SYRIAC_CLI_TIERS[0].engine, 'C37-ocr': SYRIAC_CLI_TIERS[1].engine, 'C36-ocr': SYRIAC_CLI_TIERS[2].engine,
  'G4L-syr-print': 'gemini-4-argon-low+antigravity-cli' };
const syriacPrint = fs.existsSync(SYRIAC_PRINT_FILE) ? JSON.parse(fs.readFileSync(SYRIAC_PRINT_FILE, 'utf8')) : null;
const syriacCliTiers = SYRIAC_CLI_TIERS.filter(t => syriacPrint?.[t.key]);
if (syriacCliTiers.length) {
  const cc = JSON.parse(fs.readFileSync(SYRIAC_CLI_COST_FILE, 'utf8'));
  for (const t of syriacCliTiers) {
    const c = t.T === 'C38' ? cc : cc.tiers[t.T];
    COST[t.engine] = [...(COST[t.engine] || []), { charts: ['syriac-print'], usd_per_1k: r3(c.ocr.usd_per_1k_batch), basis: 'quota', route: 'subscription',
      detail: `run through the Antigravity CLI on the Google subscription, $0 billed; placed at ${c.model}'s API Batch price for the same requests`,
      source: path.relative(REPO, SYRIAC_CLI_COST_FILE) }];
  }
}
const syriacPrintRows = [];
if (syriacPrint) for (const pg of syriacPrint.per_page) for (const [arm, engine] of Object.entries(SYRIAC_PRINT_ARMS)) {
  if (pg.cer[arm] == null) continue;
  syriacPrintRows.push({ page: `syriac-print-6295|${pg.slug}`, stratum: 'syriac-print-6295', engine, cer: Math.min(1, pg.cer[arm]), failure: null, failure_why: null, invented: null,
    date: syriacPrint.date, file: path.relative(REPO, SYRIAC_PRINT_FILE), work: `edition:${pg.edition || pg.slug.split('_')[0]}` });
}

// #6707: Gemini 4 Argon's own meter on the Syriac manuscript and print panels (its other panels are in the #6293 meter).
const ARGON = 'gemini-4-argon-low+antigravity-cli';
for (const [f, prefix] of [['G4L-syr-ms.raw.jsonl', ''], ['G4L-syr-print.raw.jsonl', 'syriac-print-6295|']]) {
  const file = path.join(__dirname, 'results', 'g4-hard-6707', 'raw', f);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) { const o = JSON.parse(line); meterSecs(`${prefix}${o.uid}`, ARGON, o.secs, file); }
}

// The hard hands (#6731, PR #6754): Greek manuscripts and Rashi-type Hebrew print, each read by Gemini 4 Argon low, 3.8
// Flash low and Opus 5.5 through a CLI, beside the production OCR stored for the page (and Kraken on the Greek). Scored
// by fitting alignment against an edition or Sefaria span. Pages split by how their reference was placed, as for every
// chart: the 4 Greek pages fitted with the production read are `anchored`, and so is every Rashi page (STRATA).
const STORED = 'production-stored';
LABEL[STORED] = 'Production OCR as stored';
LABEL['claude-opus-5-5+claude-cli'] = 'Claude Opus 5.5 (Claude CLI)';
const HARD_DIR = path.join(__dirname, 'results', 'hard-hands-6731');
const HARD_DATE = '2026-10-15'; // scripts/eval/experiments/2026-10-15-gemini-4-argon-hard-hands-greek-ms-rashi-6731.md
const HARD_ARMS = { G4L: ARGON, C38L: 'gemini-3.8-flash+antigravity-cli', OPUS: 'claude-opus-5-5+claude-cli', PROD: STORED, KRAKEN: 'kraken-greek-cllg' };
const HARD_KIND = { not_ocr: 'other' }; // the stored text on 3 Rashi pages is Sefaria's, not an OCR: counted, never scored
const hardRows = { 'greek-ms': [], rashi: [] }, hardProd = { 'greek-ms': {}, rashi: {} };
for (const [src, f] of [['greek-ms', 'scored-greek.json'], ['rashi', 'scored-rashi.json']]) {
  const file = path.join(HARD_DIR, f);
  if (!fs.existsSync(file)) continue;
  for (const p of JSON.parse(fs.readFileSync(file, 'utf8')).filter(x => x.kept)) {
    const stratum = `${src}-6731${src === 'greek-ms' && p.fit !== 'kraken' ? '-anchored' : ''}`;
    const page = `${stratum}|${p.uid.split('|')[1]}`;
    hardProd[src][p.prod_model] = (hardProd[src][p.prod_model] || 0) + 1;
    for (const [arm, c] of Object.entries(p.cells)) {
      const engine = HARD_ARMS[arm];
      if (!engine || c.unscored) continue;
      const failure = c.failure ? (HARD_KIND[c.failure] || c.failure) : typeof c.cer === 'number' ? null : 'other';
      hardRows[src].push({ page, stratum, engine, cer: failure ? null : Math.min(1, c.cer), failure, failure_why: c.why ?? null, invented: null,
        date: HARD_DATE, file: path.relative(REPO, file), work: `work:${p.work}` });
      meterSecs(page, engine, c.secs, file);
    }
  }
}
// The Rashi memorisation control: each arm asked to write out the reference passage with no image.
const MEMO_FILE = path.join(HARD_DIR, 'scored-memo.json');
const memo = fs.existsSync(MEMO_FILE) ? JSON.parse(fs.readFileSync(MEMO_FILE, 'utf8')) : [];
const memoAcc = Object.values(memo.reduce((m, r) => {
  const a = (m[r.arm] ||= { recall: [], image: [] });
  if (typeof r.recall?.cer === 'number') a.recall.push(Math.min(1, r.recall.cer));
  if (typeof r.image?.cer === 'number') a.image.push(Math.min(1, r.image.cer));
  return m;
}, {})).filter(a => a.recall.length).map(a => ({ recall: 1 - mean(a.recall), image: 1 - mean(a.image) }));
const pctRange = xs => `${Math.round(Math.min(...xs) * 100)}% to ${Math.round(Math.max(...xs) * 100)}%`;
const prodModels = src => Object.entries(hardProd[src]).sort((a, b) => b[1] - a[1]);

// #6293's CLI arms: a chart keeps one only if it read every page of the chart's frozen set (minus the #6304 drops);
// placed at the API's Batch price for the same requests (cli-cost*.json), basis 'quota'.
const SEL_6293_FILE = path.join(__dirname, 'results', 'ocr-pareto-6293', 'pages.json');
const CAP_6293_FILE = path.join(__dirname, 'results', 'ocr-pareto-6293', 'capped-set.json');
const SEL_6293 = fs.existsSync(SEL_6293_FILE) ? JSON.parse(fs.readFileSync(SEL_6293_FILE, 'utf8')) : null;
const CAP_6293 = fs.existsSync(CAP_6293_FILE) ? new Set(JSON.parse(fs.readFileSync(CAP_6293_FILE, 'utf8')).uids) : null;
// #6523 (scripts/eval/experiments/2026-10-12-cli-ocr-route-fix-6523.md): how the Latin / Early English CLI pages were read
const ROUTE_6523 = 'reply asked for between <<<BEGIN>>>/<<<END>>> markers; a PreToolUse hook allows view_file on the page image and refuses every other tool with a reason; plan mode; up to 2 attempts, on an empty reply only (1 of 573 reads retried); print timeout 300 s (120 s for the 3.8 low held-out pages)';
for (const t of CLI_6293_TIERS) {
  if (!t.costFile || !fs.existsSync(t.costFile)) continue;
  const cc = JSON.parse(fs.readFileSync(t.costFile, 'utf8'));
  LABEL[t.engine] = t.label;
  for (const [chart, c] of Object.entries(cc.charts)) (COST[t.engine] ||= []).push({
    charts: [chart], usd_per_1k: r3(c.usd_per_1k_batch), basis: 'quota', route: 'subscription',
    detail: `run through the Antigravity CLI on the Google subscription, $0 billed; placed at ${cc.model}'s API Batch price by the #6293 preregistered formula (output scaled ×${c.r_out} by this arm's text length)`
      + ((cc.charts_reread_6523 || []).includes(chart) ? `; these pages re-read with the #6523 route config (${ROUTE_6523})` : ''),
    source: path.relative(REPO, t.costFile) });
}
const cli6293Coverage = {}, cli6293Subsample = {};
function keepCli6293(scriptId, rows, exclude) {
  const set = SEL_6293?.charts?.[scriptId]?.pages;
  if (!set) return rows.filter(r => !CLI_6293_ENGINES.has(r.engine) || !r.file?.includes('ocr-pareto-6293'));
  const need = set.filter(p => !exclude.has(p));
  const capped = CAP_6293 ? need.filter(p => CAP_6293.has(p)) : need;
  const drop = new Set();
  for (const e of CLI_6293_ENGINES) {
    const have = new Set(rows.filter(r => r.engine === e).map(r => r.page));
    if (!have.size) continue;
    const missing = need.filter(p => !have.has(p));
    cli6293Coverage[`${scriptId}|${e}`] = { frozen: need.length, scored: need.length - missing.length, missing };
    if (!missing.length) continue;
    drop.add(e);
    if (capped.length < need.length && capped.every(p => have.has(p))) (cli6293Subsample[scriptId] ||= { pages: capped, of: need.length, engines: [] }).engines.push(e);
  }
  return drop.size ? rows.filter(r => !drop.has(r.engine)) : rows;
}

// ── shared-page sets ─────────────────────────────────────────────────────────────────────────
function pagesOf(rows) { const m = new Map(); for (const r of rows) { if (!m.has(r.engine)) m.set(r.engine, new Map()); m.get(r.engine).set(r.page, r); } return m; }
const intersect = (a, b) => new Set([...a].filter(x => b.has(x)));
const ran = (byEngine, e) => new Set(byEngine.get(e).keys());   // every page the engine was run on, failures included

/** Greedy: start from the production engine, add whichever engine keeps the most shared pages, while ≥ floor. */
function greedy(byEngine, start, floor, within) {
  let set = [start], shared = intersect(ran(byEngine, start), within);
  for (;;) {
    let best = null;
    for (const e of [...byEngine.keys()].sort()) {
      if (set.includes(e)) continue;
      const s = intersect(shared, ran(byEngine, e));
      if (s.size >= floor && (!best || s.size > best.s.size)) best = { e, s };
    }
    if (!best) return { engines: set, pages: shared };
    set.push(best.e); shared = best.s;
  }
}

function secsOf(engine, pages) {
  const xs = pages.map(p => SECS.get(`${p}|${engine}`)).filter(Boolean);
  if (xs.length < MIN_PAGES) return null;
  return { median: Math.round(median(xs.map(x => x.secs)) * 10) / 10, n: xs.length, files: [...new Set(xs.map(x => x.file))].sort() };
}

const numPts = d => `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}`;

/** One panel: every engine on the same pages, its own interval, its paired difference against the engine in use. */
function panel(script, kind, byEngine, engines, pages, production, repeat, extra = {}) {
  const ps = [...pages].sort();
  const work = p => byEngine.get(production)?.get(p)?.work || workOfPage(p);
  const works = new Set(ps.map(work));
  const strata = new Map();
  for (const p of ps) strata.set(stratumOf(p), (strata.get(stratumOf(p)) || 0) + 1);
  const files = new Set(), dates = [];
  for (const p of ps) for (const e of engines) { const x = byEngine.get(e).get(p); files.add(x.file); dates.push(x.date); }
  const prodRows = byEngine.has(production) && engines.includes(production) ? ps.map(p => byEngine.get(production).get(p)) : null;
  // The noise band: a second run of the engine in use on every page of the panel. Like-for-like only when the repeat
  // was scored in the same result file as the read it repeats (same run, date and route). The #5660 repeat of the
  // Wikisource pages ran on 3 Oct through the realtime API, 17 days after the stored read, and Gemini refused far more
  // of those pages (7 of 30 German against 1): it is not like-for-like, so it is not used.
  let noise = null;
  if (prodRows && repeat && ps.every(p => repeat.has(p))) {
    const like = ps.every((p, i) => repeat.get(p).file === prodRows[i].file);
    const dA = [...new Set(prodRows.map(r => r.date))].sort().join(', '), dB = [...new Set(ps.map(p => repeat.get(p).date))].sort().join(', ');
    // pages both runs read (#6523: a failed read is not scored, in the repeat too)
    noise = noiseOf(ps.flatMap((p, i) => (prodRows[i].failure || repeat.get(p).failure ? [] : [{ d: prodRows[i].cer - repeat.get(p).cer, cluster: work(p) }])), hash(`${script.id}|${kind}|aa`),
      { like, why: like ? null : `it ran on ${dB}, by another route than the read it repeats (${dA})` });
  }
  // ONE STATISTIC: accuracy is the MEAN over the pages the engine READ of 1 − CER (each page capped at 100% error), and
  // the paired difference below is the mean of per-page differences on the pages BOTH engines read: the two columns
  // measure the same thing. The pages it did not read are counted beside it (`did_not_read`, #6523), not scored.
  const points = engines.map(e => {
    const all = ps.map(p => byEngine.get(e).get(p));
    const read = all.map((r, i) => [r, ps[i]]).filter(([r]) => !r.failure);
    const rs = read.map(([r]) => r);
    if (!rs.length) throw new Error(`${script.id}/${kind}: ${e} read none of the panel's ${ps.length} pages`);
    const items = read.map(([r, p]) => ({ cer: r.cer, cluster: work(p) }));
    const mn = mean(rs.map(r => r.cer));
    const ci = clusterCI(items, x => x.cluster, xs => mean(xs.map(x => x.cer)), hash(`${script.id}|${kind}|${e}`));
    const kinds = Object.fromEntries(READ_FAILURE_KINDS.map(k => [k, all.filter(r => r.failure === k).length]).filter(([, n]) => n));
    const k = ps.length - rs.length;
    const inv = rs.filter(r => typeof r.invented === 'number').map(r => r.invented);
    const pt = {
      engine: e, label: LABEL[e] || e, production: e === production,
      mean_cer: r3(mn), accuracy: r3(1 - mn), accuracy_ci95: ci ? [r3(1 - ci[1]), r3(1 - ci[0])] : null,
      // over the pages it read
      fail_share: r3(rs.filter(r => r.cer > 0.5).length / rs.length),
      did_not_read: { k, n: ps.length, kinds },
      unplaced: rs.filter(r => r.unplaced).length,
      // above 20% unread, the accuracy rests on the pages the engine chose to answer
      ...(k / ps.length > PARTLY_MEASURED ? { partly_measured: `did not read ${k} of ${ps.length} pages (${Object.entries(kinds).map(([x, n]) => `${KIND_WORDS[x]} ${n}`).join(', ')}); its accuracy rests on the ${rs.length} it read` } : {}),
      // share of the engine's words absent from the reference; only where the scorer computes it on most of the pages
      words_not_in_ref: inv.length >= Math.max(MIN_PAGES, rs.length / 2) ? r3(median(inv)) : null,
      cost: costOf(e, script.id),
      route: routeOf(e, script.id),
      // median seconds a page from the arm's own meter, on this panel's pages (failed reads too: the time was spent)
      secs_per_page: secsOf(e, ps),
    };
    if (!pt.cost) pt.no_price = NO_PRICE[e] || (e === STORED ? 'the stored reads come from more than one model, so no one price applies'
      : isCli(e) ? 'run through a command-line tool on the subscription, $0 billed; no API price computed for these pages'
        : OWN_SERVER(e) ? 'runs on our own servers; no billed price on record' : 'no billed price on record');
    if (prodRows && e !== production) {
      const pairs = all.flatMap((r, i) => (r.failure || prodRows[i].failure ? [] : [{ d: prodRows[i].cer - r.cer, cluster: work(ps[i]) }]));
      pt.vs_in_use = pairs.length ? pairedDiff(pairs, hash(`${script.id}|${kind}|vs|${e}`)) : null;
      if (pt.vs_in_use) pt.verdict = verdictOf(pt.vs_in_use, noise?.band ?? 0);
    }
    return pt;
  });
  const metricSet = new Set([...strata.keys()].map(s => fallbackStratum(s).metric));
  const editionPages = [...strata].filter(([s]) => fallbackStratum(s).edition).reduce((n, [, k]) => n + k, 0);
  const gradeIn = {
    works: works.size, unfit6304: UNFIT_6304.has(script.id), metrics: metricSet.size,
    productionAnchored: [...strata.keys()].some(s => fallbackStratum(s).anchored), modernEdition: editionPages > ps.length / 2,
  };
  const grade = gradePanel(gradeIn);
  // a not_fit panel, or one whose engine in use did not reproduce itself, gives no verdict words
  if (grade.level === 'not_fit' || noise?.kind === 'not_reproduced') for (const pt of points) delete pt.verdict;
  const placed = points.filter(p => p.cost), noCost = points.filter(p => !p.cost);
  const frontier = grade.level !== 'not_fit' && placed.length >= FRONTIER_MIN;
  markFrontier(placed, p => p.accuracy, frontier);
  placed.sort((a, b) => b.accuracy - a.accuracy || a.engine.localeCompare(b.engine));
  noCost.sort((a, b) => b.accuracy - a.accuracy || a.engine.localeCompare(b.engine));
  const refs = [...strata].map(([s, n]) => ({ stratum: s, reference: fallbackStratum(s).reference, pages: n })).sort((a, b) => b.pages - a.pages || a.stratum.localeCompare(b.stratum));
  const p = {
    kind, n_pages: ps.length, n_works: works.size,
    reference: [...new Set(refs.map(r => r.reference))].slice(0, 2).join('; '),
    references: refs, grade, to_decide: grade.level === 'decide' ? null : toDecide(gradeIn), frontier, noise,
    date: dates.filter(Boolean).sort().at(-1) || null, files: [...files].filter(Boolean).sort(),
    placed, no_cost: noCost, ...extra,
  };
  p.verdict = verdictSentence(p, { num: numPts, unit: 'points a page', verb: 'reads', margin: MARGIN.ocr, marginText: '1 point a page' });
  return p;
}

const argOf = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
// #6304: pages whose reference does not transcribe the page, or that are in another script.
const AUDIT_FILE = path.join(__dirname, 'results', 'pareto-sample-audit-6304', 'drops.json');
const AUDIT = !process.argv.includes('--keep-dropped') && fs.existsSync(AUDIT_FILE) ? JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')) : null;
const CLI_EXCLUDE = argOf('exclude') ? JSON.parse(fs.readFileSync(argOf('exclude'), 'utf8')) : [];
const EXCLUDE = new Set([...CLI_EXCLUDE, ...(AUDIT?.drops || []).filter(d => d.family === 'ocr').map(d => d.page)]);

// Pages split by how the reference was made: one error measure each, and the production-anchored strata apart.
const familyOf = page => { const s = fallbackStratum(stratumOf(page)); return `${s.metric}|${s.anchored ? 'anchored' : 'independent'}`; };
const FAMILY_HEADING = {
  'windowed|independent': 'Transcriptions of the page', 'whole|independent': 'Typed editions of the text', 'line|independent': 'Line-by-line transcriptions',
  'whole|anchored': 'References located with our own reading', 'consonant|anchored': 'References located with our own reading',
  'fitting|independent': 'Editions fitted to the page', 'fitting|anchored': 'References located with our own reading',
};
// Per-chart caption: only what is specific to that chart, 40 words at most.
const CAPTION = {
  'syriac-print': 'Error is counted on consonants: vowel points and Syriac punctuation are folded, and a Latin column is ignored.',
  syriac: 'Two manuscripts only. The command-line reads here are scored as returned, with the route’s preamble left in.',
  'chinese-manuscript': 'On many pages the reference runs longer than the page, so every engine carries some unavoidable error.',
  // #6523: the route config of the 3.7 / 3.8 command-line reads on these two charts, and the scoring change
  latin: 'Gemini 3.7 and 3.8 command-line reads: answer between markers, tools refused by a hook (#6523); 1 of 573 retried after an empty reply. Every engine is scored with chat around the transcription removed.',
  english: 'Gemini 3.7 and 3.8 command-line reads: answer between markers, tools refused by a hook (#6523); 1 of 573 retried after an empty reply. Every engine is scored with chat around the transcription removed.',
  // #6731: the engine in use is the stored production OCR; which models wrote it is read from the scored file
  'greek-manuscript': `The engine in use is the production OCR stored for these pages (${prodModels('greek-ms').map(([m, n]) => `${LABEL[m.replace(/-preview$/, '')] || LABEL[m] || m} on ${n}`).join(', ')} of the ${prodModels('greek-ms').reduce((a, [, n]) => a + n, 0)} pages read). The edition's notes and other witnesses' readings count as error for every engine.`,
  rashi: memoAcc.length ? `Memorisation control: asked with no image, the engines recalled ${memo.filter(r => r.arm === memo[0].arm).length} of these passages at ${pctRange(memoAcc.map(a => a.recall))} accuracy, against ${pctRange(memoAcc.map(a => a.image))} when reading them, so these scores measure reading, not recitation.` : null,
};

const charts = [], noChart = [], primarySets = {}, chartRows = {};
for (const script of SCRIPTS) {
  const rows0 = (script.source === 'syriac' ? syriacRows : script.source === 'syriac-print' ? syriacPrintRows : hardRows[script.source] || accRows.filter(r => script.match(r.row)))
    .filter(r => !EXCLUDE.has(r.page));
  const rows = script.source && script.source !== 'syriac' ? rows0 : keepCli6293(script.id, rows0, EXCLUDE);
  chartRows[script.id] = rows0.map(r => ({ page: r.page, engine: r.engine, cer: r.cer, failure: r.failure, failure_why: r.failure_why }));
  const byEngine = pagesOf(rows);
  const production = script.production || getOcrModelForBook({ language: script.language, visible: true });
  const nProd = byEngine.has(production) ? byEngine.get(production).size : 0;
  if (nProd < MIN_PAGES) {
    noChart.push({ title: script.title, why: nProd ? `${nProd} page${nProd === 1 ? '' : 's'} with a typed reference; at least ${MIN_PAGES} are needed` : 'no page with a typed reference yet', source: 'scripts/eval/results/benchmark/' });
    continue;
  }
  const repeat = script.source ? null : new Map(repeatRows.filter(r => r.engine === `${production}-b` && script.match(r.row) && !EXCLUDE.has(r.page)).map(r => [r.page, r]));
  // one candidate panel per reference family; the primary is the independent family with the most works
  const prodPages = ran(byEngine, production);
  const families = new Map();
  for (const p of prodPages) { const f = familyOf(p); if (!families.has(f)) families.set(f, new Set()); families.get(f).add(p); }
  // The primary is the family whose panel is fittest to decide on: independent references first, then the better
  // grade, then more works. (Greek: the 24-work transcription panel grades `decide`, the 97-work edition panel only
  // `directional`, so the transcriptions lead.)
  const RANK = { decide: 0, directional: 1, not_fit: 2 };
  const fam = [...families].map(([f, ps]) => {
    const wide = greedy(byEngine, production, Math.max(MIN_PAGES, Math.ceil(ps.size * WIDE_KEEP)), ps);
    const probe = wide.pages.size >= MIN_PAGES ? panel(script, 'probe', byEngine, wide.engines, wide.pages, production, repeat) : null;
    return { f, ps, wide, probe };
  }).filter(x => x.probe)
    .sort((a, b) => Number(a.f.endsWith('|anchored')) - Number(b.f.endsWith('|anchored')) || RANK[a.probe.grade.level] - RANK[b.probe.grade.level]
      || b.probe.n_works - a.probe.n_works || b.probe.n_pages - a.probe.n_pages || a.f.localeCompare(b.f));
  if (!fam.length) { noChart.push({ title: script.title, why: `fewer than ${MIN_PAGES} pages share one kind of reference`, source: 'scripts/eval/results/benchmark/' }); continue; }
  const panels = [];
  fam.forEach((x, i) => {
    const heading = FAMILY_HEADING[x.f] || x.f;
    const pn = panel(script, i === 0 ? 'primary' : `family-${x.f.replace('|', '-')}`, byEngine, x.wide.engines, x.wide.pages, production, repeat, { role: i === 0 ? 'primary' : 'secondary', heading: i === 0 ? null : heading });
    panels.push(pn);
    if (i === 0) primarySets[script.id] = { engines: x.wide.engines, pages: [...x.wide.pages].sort() };
    // a second view: more engines on fewer pages of the same family, when it still has enough works
    const broad = greedy(byEngine, production, MIN_PAGES, x.ps);
    if (broad.engines.length > x.wide.engines.length) {
      const pb = panel(script, `${i === 0 ? 'primary' : x.f.replace('|', '-')}-more-engines`, byEngine, broad.engines, broad.pages, production, repeat, { role: 'secondary', heading: `${heading}: more engines, fewer pages` });
      if (pb.n_works >= MIN_WORKS_EXTRA) panels.push(pb);
    }
  });
  // #6293 Amendment 2: the CLI tiers that read only the capped subsample, on those pages of the primary set
  const sub = cli6293Subsample[script.id];
  if (sub) {
    const subRows = [...rows, ...rows0.filter(r => sub.engines.includes(r.engine))];
    const bySub = pagesOf(subRows), inSub = new Set(sub.pages);
    let ps = new Set(primarySets[script.id].pages.filter(p => inSub.has(p)));
    for (const e of sub.engines) ps = intersect(ps, ran(bySub, e));
    if (ps.size >= MIN_PAGES) panels.push(panel(script, 'cli-subsample', bySub, [...primarySets[script.id].engines, ...sub.engines], ps, production, repeat,
      { role: 'secondary', heading: `${ps.size} pages drawn at random, with ${sub.engines.map(e => LABEL[e]).join(' and ')}` }));
  }
  charts.push({ id: script.id, title: script.title, production_engine: production, production_label: LABEL[production] || production, caption: CAPTION[script.id] || null, panels });
}

const out = {
  issue: 6386,
  generated_by: 'scripts/eval/build-ocr-pareto.mjs',
  measure: 'accuracy: 1 − mean character error rate (each page capped at 100% error) against a typed reference, on the pages of the panel the engine read; a refused, empty, timed-out or copy-filtered read is not scored and is counted in did_not_read',
  production_rule: 'the engine scripts/lib/ocr-routing.mjs assigns to new pages in the script',
  grade_rules: GRADE_RULES,
  cost_sources: { metered: `scripts/eval/results/ocr-cost/${costFile}`, other: 'scripts/eval/ocr-engine-gpu-costs.json', usd_per_eur: gpu.usd_per_eur },
  charts,
  no_chart: [...noChart, ...NO_REFERENCE],
};
const json = JSON.stringify(out, null, 1) + '\n';
if (argOf('out')) { fs.writeFileSync(argOf('out'), json); console.log(`wrote ${argOf('out')} (${EXCLUDE.size} pages excluded)`); process.exit(0); }
if (CLI_EXCLUDE.length) throw new Error('--exclude needs --out: the committed file is never built without pages');
if (argOf('dump-rows')) { fs.writeFileSync(argOf('dump-rows'), JSON.stringify(chartRows) + '\n'); console.log(`wrote ${argOf('dump-rows')}`); process.exit(0); }
if (argOf('dump-sets')) { fs.writeFileSync(argOf('dump-sets'), JSON.stringify(primarySets, null, 1) + '\n'); console.log(`wrote ${argOf('dump-sets')}`); process.exit(0); }
if (process.argv.includes('--check')) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have !== json) { console.error(`${path.relative(process.cwd(), OUT)} is stale — run node scripts/eval/build-ocr-pareto.mjs`); process.exit(1); }
  console.log('ocr-pareto.json is current');
  process.exit(0);
}
fs.writeFileSync(OUT, json);
const pct = x => (x == null ? '-' : `${Math.round(x * 1000) / 10}`);
for (const c of charts) for (const p of c.panels) {
  console.log(`${c.title} [${p.kind}] ${p.grade.level} · ${p.n_pages} pages / ${p.n_works} works${p.noise ? ` · noise ${p.noise.band}` : ''}`);
  for (const x of [...p.placed, ...p.no_cost]) console.log(`   ${x.production ? '*' : ' '} ${x.label.padEnd(34)} acc ${pct(x.accuracy)} fail ${pct(x.fail_share)} ${x.vs_in_use ? `vs ${pct(x.vs_in_use.diff)} [${pct(x.vs_in_use.ci95?.[0])}, ${pct(x.vs_in_use.ci95?.[1])}] ${x.verdict}` : ''} ${x.cost ? `$${x.cost.usd_per_1k}/${x.cost.basis}` : 'no price'}${x.on_frontier ? ' F' : ''}`);
  console.log(`   => ${p.verdict}`);
}
for (const n of out.no_chart) console.log(`no chart: ${n.title} — ${n.why}`);
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
