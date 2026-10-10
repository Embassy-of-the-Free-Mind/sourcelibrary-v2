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
 *              the #6295 Syriac print panel and the Syriac ground-truth retest; the #6293 CLI reads re-scored with
 *              the CLI's preamble removed (results/ocr-pareto-6293/plan-note-rescored.json)
 *   works      results/pareto-works.json (build-pareto-works.mjs: book → work_id), for the intervals
 *   cost       Gemini: the latest results/ocr-cost/ocr-cost-<date>.json (metered Batch spend); self-hosted and
 *              other APIs: ocr-engine-gpu-costs.json (each entry quotes its run's write-up); CLI arms: cli-cost*.json
 *   production scripts/lib/ocr-routing.mjs, the router that picks the model for new pages
 * Writes src/data/ocr-pareto.json. No timestamps: unchanged inputs give an identical file.
 *   node scripts/eval/build-ocr-pareto.mjs           # write
 *   node scripts/eval/build-ocr-pareto.mjs --check   # exit 1 if the committed file is stale
 *   node scripts/eval/build-ocr-pareto.mjs --dump-sets=<file>   # each chart's primary page keys and engines
 *   node scripts/eval/build-ocr-pareto.mjs --dump-rows=<file>   # every scored page × engine per chart
 *   node scripts/eval/build-ocr-pareto.mjs --keep-dropped   # with the pages #6304 dropped put back
 *   node scripts/eval/build-ocr-pareto.mjs --exclude=<file> --out=<file>   # sensitivity rebuilds; never the committed file
 *
 * The rules (#6386; .claude/docs/eval-design.md §7):
 *   - ONE FAILURE RULE for every engine: a read that is missing text, refused, or could not be placed against the
 *     reference scores CER 1.0, and the page stays in for every engine. CER is capped at 1. A page drops only when
 *     an engine was never run on it, or #6304 found its reference does not fit the page;
 *   - each engine: mean accuracy (1 − mean CER, each page capped at 1) with a 95% interval that resamples WORKS, and the share of pages
 *     with CER above 0.5;
 *   - each engine against the engine in use: the mean per-page accuracy difference on the same pages, with a
 *     work-clustered bootstrap interval; where a like-for-like second run of the engine in use covers the panel, its
 *     spread sets the noise band (lib/pareto-stats.mjs noiseOf). Verdict words only when the interval excludes 0 and clears it;
 *   - each panel gets a fitness grade (lib/pareto-stats.mjs gradePanel). Pages are split by how their reference was
 *     made, so a panel never pools two error measures, and the strata whose reference was located with the
 *     production engine's own reading get their own panel, graded not fit;
 *   - ONE COST BASIS: billed dollars (Gemini at its metered Batch rate; other APIs at their billed rate; GPU runs at
 *     the whole billed rental, shared by inference time); CLI runs at the API Batch price for the same requests,
 *     marked `quota` ($0 billed, subscription); an engine with no billed price sits on the "no price" strip.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBenchmarkRows, BENCHMARK_DIR } from './lib/benchmark-rows.mjs';
import { getOcrModelForBook } from '../lib/ocr-routing.mjs';
import { r3, median, mean, hash, clusterCI, pairedDiff, noiseOf, verdictOf, gradePanel, GRADE_RULES, MARGIN, markFrontier, verdictSentence } from './lib/pareto-stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const OUT = path.join(REPO, 'src', 'data', 'ocr-pareto.json');
const MIN_PAGES = 5;          // below this no interval at all
const FRONTIER_MIN = 3;       // fewer priced engines than this: no frontier
const WIDE_KEEP = 0.5;        // the primary panel keeps at least half the production engine's pages
const MIN_WORKS_EXTRA = 10;   // a second view of the same pages is shown only on 10 or more works

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
for (const [engine, m] of Object.entries(metered.models)) COST[engine] = [{
  charts: null, usd_per_1k: r3(m.usd_per_1k_pages), basis: 'billed',
  detail: `Gemini Batch, ${m.pages.toLocaleString('en-US')} pages metered ${metered.window.from.slice(0, 10)} to ${metered.window.to.slice(0, 10)}`,
  source: `scripts/eval/results/ocr-cost/${costFile}`,
}];
const flat = t => t.replace(/\s+/g, ' ');   // write-ups wrap lines mid-sentence
for (const [engine, entries] of Object.entries(gpu.engines)) {
  const billed = [];
  for (const g of entries) {
    const text = flat(fs.readFileSync(path.join(REPO, g.source), 'utf8'));
    for (const part of g.quote.split(' … ')) if (!text.includes(flat(part))) throw new Error(`ocr-engine-gpu-costs.json: ${engine}'s quote "${part}" is not in ${g.source}`);
    if (g.basis === 'compute') { NO_PRICE[engine] = 'priced on inference time only; no billed rental on record'; continue; }
    const eurPerPage = g.eur_per_page ?? (g.eur != null && g.pages ? g.eur / g.pages : null);
    const usd = g.usd_per_1k ?? (eurPerPage != null ? eurPerPage * 1000 * gpu.usd_per_eur.value : null);
    if (usd == null) throw new Error(`ocr-engine-gpu-costs.json: ${engine} entry has no eur+pages, eur_per_page or usd_per_1k`);
    billed.push({
      charts: g.charts ?? null, usd_per_1k: r3(usd), basis: 'billed',
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
  const { charts, ...rest } = e;
  return rest;
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
    label: `Gemini ${v} Flash (CLI${effort === 'low' ? '' : `, ${effort}`})`, costFile: path.join(__dirname, 'results', 'ocr-pareto-6293', f) }));
const CLI_6293_ENGINES = new Set(CLI_6293_TIERS.map(t => t.engine));
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
// The CLI's preamble ("I have created the transcription plan…") is the route talking, not the page being read; the
// #6293 reads that carried it are re-scored without it (rescore-plan-note.mjs, with its positive control).
const RESCORED = new Map(JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'ocr-pareto-6293', 'plan-note-rescored.json'), 'utf8'))
  .rows.map(r => [`${r.page}|${r.engine}`, r.stripped]));
// ONE FAILURE RULE: a refused, unaligned or unscored read is CER 1.0, for every engine alike; CER is capped at 1.
const toRow = (r, page, extra = {}) => {
  const fixed = RESCORED.get(`${page}|${r.engine}`);
  const aligned = fixed ? fixed.aligned : r.aligned, cer0 = fixed ? fixed.cer : r.cer;
  const failed = r.refused || !aligned || cer0 == null;
  return { page, stratum: r.stratum, engine: r.engine, cer: failed ? 1 : Math.min(1, cer0), failed, refused: !!r.refused,
    invented: failed ? null : r.invention_ref, date: r.date, file: r.file, row: r, ...extra };
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
    syriacRows.push({ page: `syriac-gt|${slug}`, stratum: 'syriac-gt', engine, cer: failed ? 1 : Math.min(1, e.cer_n2), failed, refused: false, invented: null, date, file: path.relative(REPO, file), work: `ms:${slug.split('-')[0]}` });
  }
}

// Syriac print (#6295): one sealed page per book, scored by scripts/eval/syriac-pareto-6295/analyze-ocr.mjs; the unit
// is the edition. L-ocr-b / C38-ocr-b are A-vs-A repeats (noise), not engines.
const SYRIAC_PRINT_FILE = path.join(__dirname, 'results', 'syriac-pareto-6295', 'ocr-summary.json');
const SYRIAC_CLI_COST_FILE = path.join(__dirname, 'results', 'syriac-pareto-6295', 'cli-cost.json');
const SYRIAC_CLI_TIERS = [['C38', '3.8'], ['C37', '3.7'], ['C36', '3.6']].map(([T, v]) => ({ T, v, key: `cli_${T.toLowerCase()}`, engine: `gemini-${v}-flash+antigravity-cli` }));
for (const t of SYRIAC_CLI_TIERS) LABEL[t.engine] = `Gemini ${t.v} Flash (CLI)`;
const SYRIAC_PRINT_ARMS = { omnisyr: 'omnisyr', 'omnisyr-nosplit': 'omnisyr-nosplit', 'sophro-mhiro': 'sophro-mhiro', 'qoruyo-eastern': 'qoruyo-eastern',
  'qoruyo-estrangela': 'qoruyo-estrangela', 'L-ocr': 'gemini-3.1-flash-lite', mineru: 'mineru', 'C38-ocr': SYRIAC_CLI_TIERS[0].engine, 'C37-ocr': SYRIAC_CLI_TIERS[1].engine, 'C36-ocr': SYRIAC_CLI_TIERS[2].engine };
const syriacPrint = fs.existsSync(SYRIAC_PRINT_FILE) ? JSON.parse(fs.readFileSync(SYRIAC_PRINT_FILE, 'utf8')) : null;
const syriacCliTiers = SYRIAC_CLI_TIERS.filter(t => syriacPrint?.[t.key]);
if (syriacCliTiers.length) {
  const cc = JSON.parse(fs.readFileSync(SYRIAC_CLI_COST_FILE, 'utf8'));
  for (const t of syriacCliTiers) {
    const c = t.T === 'C38' ? cc : cc.tiers[t.T];
    COST[t.engine] = [...(COST[t.engine] || []), { charts: ['syriac-print'], usd_per_1k: r3(c.ocr.usd_per_1k_batch), basis: 'quota',
      detail: `run through the Antigravity CLI on the Google subscription, $0 billed; placed at ${c.model}'s API Batch price for the same requests`,
      source: path.relative(REPO, SYRIAC_CLI_COST_FILE) }];
  }
}
const syriacPrintRows = [];
if (syriacPrint) for (const pg of syriacPrint.per_page) for (const [arm, engine] of Object.entries(SYRIAC_PRINT_ARMS)) {
  if (pg.cer[arm] == null) continue;
  syriacPrintRows.push({ page: `syriac-print-6295|${pg.slug}`, stratum: 'syriac-print-6295', engine, cer: Math.min(1, pg.cer[arm]), failed: false, refused: false, invented: null,
    date: syriacPrint.date, file: path.relative(REPO, SYRIAC_PRINT_FILE), work: `edition:${pg.edition || pg.slug.split('_')[0]}` });
}

// #6293's CLI arms: a chart keeps one only if it read every page of the chart's frozen set (minus the #6304 drops);
// placed at the API's Batch price for the same requests (cli-cost*.json), basis 'quota'.
const SEL_6293_FILE = path.join(__dirname, 'results', 'ocr-pareto-6293', 'pages.json');
const CAP_6293_FILE = path.join(__dirname, 'results', 'ocr-pareto-6293', 'capped-set.json');
const SEL_6293 = fs.existsSync(SEL_6293_FILE) ? JSON.parse(fs.readFileSync(SEL_6293_FILE, 'utf8')) : null;
const CAP_6293 = fs.existsSync(CAP_6293_FILE) ? new Set(JSON.parse(fs.readFileSync(CAP_6293_FILE, 'utf8')).uids) : null;
for (const t of CLI_6293_TIERS) {
  if (!fs.existsSync(t.costFile)) continue;
  const cc = JSON.parse(fs.readFileSync(t.costFile, 'utf8'));
  LABEL[t.engine] = t.label;
  for (const [chart, c] of Object.entries(cc.charts)) (COST[t.engine] ||= []).push({
    charts: [chart], usd_per_1k: r3(c.usd_per_1k_batch), basis: 'quota',
    detail: `run through the Antigravity CLI on the Google subscription, $0 billed; placed at ${cc.model}'s API Batch price by the #6293 preregistered formula (output scaled ×${c.r_out} by this arm's text length)`,
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
    noise = noiseOf(ps.map((p, i) => ({ d: prodRows[i].cer - repeat.get(p).cer, cluster: work(p) })), hash(`${script.id}|${kind}|aa`),
      { like, why: like ? null : `it ran on ${dB}, by another route than the read it repeats (${dA})` });
  }
  // ONE STATISTIC: accuracy is the MEAN over pages of 1 − CER (each page capped at 100% error, so failed reads count),
  // and the paired difference below is the mean of per-page differences: the two columns measure the same thing.
  const points = engines.map(e => {
    const rs = ps.map(p => byEngine.get(e).get(p));
    const items = rs.map((r, i) => ({ cer: r.cer, cluster: work(ps[i]) }));
    const mn = mean(rs.map(r => r.cer));
    const ci = clusterCI(items, x => x.cluster, xs => mean(xs.map(x => x.cer)), hash(`${script.id}|${kind}|${e}`));
    const inv = rs.filter(r => typeof r.invented === 'number').map(r => r.invented);
    const pt = {
      engine: e, label: LABEL[e] || e, production: e === production,
      mean_cer: r3(mn), accuracy: r3(1 - mn), accuracy_ci95: ci ? [r3(1 - ci[1]), r3(1 - ci[0])] : null,
      fail_share: r3(rs.filter(r => r.cer > 0.5).length / rs.length),
      failed_reads: rs.filter(r => r.failed).length,
      // share of the engine's words absent from the reference; only where the scorer computes it on most of the pages
      words_not_in_ref: inv.length >= Math.max(MIN_PAGES, rs.length / 2) ? r3(median(inv)) : null,
      cost: costOf(e, script.id),
    };
    if (!pt.cost) pt.no_price = NO_PRICE[e] || (/^(kraken|tesseract|omnisyr|qoruyo|sophro)/.test(e) || ['omnisyr-nosplit', 'mineru'].includes(e) ? 'runs on our own servers; no billed price on record' : 'no billed price on record');
    if (prodRows && e !== production) {
      pt.vs_in_use = pairedDiff(rs.map((r, i) => ({ d: prodRows[i].cer - r.cer, cluster: work(ps[i]) })), hash(`${script.id}|${kind}|vs|${e}`));
      pt.verdict = verdictOf(pt.vs_in_use, noise?.band ?? 0);
    }
    return pt;
  });
  const metricSet = new Set([...strata.keys()].map(s => fallbackStratum(s).metric));
  const editionPages = [...strata].filter(([s]) => fallbackStratum(s).edition).reduce((n, [, k]) => n + k, 0);
  const grade = gradePanel({
    works: works.size, unfit6304: UNFIT_6304.has(script.id), metrics: metricSet.size,
    productionAnchored: [...strata.keys()].some(s => fallbackStratum(s).anchored), modernEdition: editionPages > ps.length / 2,
  });
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
    references: refs, grade, frontier, noise,
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
};
// Per-chart caption: only what is specific to that chart, 40 words at most.
const CAPTION = {
  'syriac-print': 'Error is counted on consonants: vowel points and Syriac punctuation are folded, and a Latin column is ignored.',
  syriac: 'Two manuscripts only. The command-line reads here are scored as returned, with the route’s preamble left in.',
  'chinese-manuscript': 'On many pages the reference runs longer than the page, so every engine carries some unavoidable error.',
};

const charts = [], noChart = [], primarySets = {}, chartRows = {};
for (const script of SCRIPTS) {
  const rows0 = (script.source === 'syriac' ? syriacRows : script.source === 'syriac-print' ? syriacPrintRows : accRows.filter(r => script.match(r.row)))
    .filter(r => !EXCLUDE.has(r.page));
  const rows = script.source === 'syriac-print' ? rows0 : keepCli6293(script.id, rows0, EXCLUDE);
  chartRows[script.id] = rows0.map(r => ({ page: r.page, engine: r.engine, cer: r.cer, refused: r.refused }));
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
  measure: 'accuracy: 1 − mean character error rate (each page capped at 100% error) against a typed reference, on pages every engine in the panel was run on; a failed read counts as 100% error',
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
