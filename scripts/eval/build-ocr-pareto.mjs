#!/usr/bin/env node
/**
 * build-ocr-pareto.mjs — cost against accuracy, one chart per script, for /quality (#5983).
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
 *   accuracy   scripts/eval/lib/benchmark-rows.mjs (the evidence table's own rows) and the Syriac
 *              ground-truth retest (results/benchmark/syriac-retest-2026-09-16/score.json)
 *   cost       Gemini: the latest results/ocr-cost/ocr-cost-<date>.json (ocr-cost-snapshot.mjs,
 *              metered Batch spend); self-hosted: ocr-engine-gpu-costs.json (each entry quotes
 *              its run's write-up, and this script refuses an entry whose quote is not in it)
 *   production scripts/lib/ocr-routing.mjs, the router that picks the model for new pages
 * Writes src/data/ocr-pareto.json. No timestamps: unchanged inputs give an identical file.
 *   node scripts/eval/build-ocr-pareto.mjs           # write
 *   node scripts/eval/build-ocr-pareto.mjs --check   # exit 1 if the committed file is stale
 *   node scripts/eval/build-ocr-pareto.mjs --dump-sets=<file>   # write each chart's most-pages page keys
 *                                                    # (stratum|slug) and engines, nothing else (#6011 wave 2)
 *   node scripts/eval/build-ocr-pareto.mjs --keep-dropped   # with the pages #6304 dropped (below) put back
 *   node scripts/eval/build-ocr-pareto.mjs --exclude=<file> --out=<file>
 *        # rebuild without the page keys listed in <file> (a JSON array of stratum|slug), for the #6304
 *        # sensitivity check; each panel keeps its engines, only pages drop. Never writes the committed file.
 *
 * The rules (.claude/docs/eval-design.md §7):
 *   - engines are compared ONLY on pages every plotted engine read, against a typed reference,
 *     and that no plotted engine refused (#5581); each page is one book in the sealed strata;
 *   - y = 1 − median CER on those pages, with a seeded bootstrap 95% CI;
 *   - per script up to two panels: the engine set that keeps the most pages, and (where more
 *     engines were run on a smaller sealed set) the set with the most engines on ≥ MIN_PAGES;
 *   - an engine with no measured cost is listed under the chart, never placed at a guessed x;
 *   - the frontier is drawn only with ≥ 3 placed engines; with fewer the chart says so.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBenchmarkRows, BENCHMARK_DIR } from './lib/benchmark-rows.mjs';
import { getOcrModelForBook } from '../lib/ocr-routing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const OUT = path.join(REPO, 'src', 'data', 'ocr-pareto.json');
const MIN_PAGES = 5;          // below this a bootstrap interval is decoration (as in the evidence table)
const FRONTIER_MIN = 3;       // the issue's rule: fewer engines than this → "too few for a frontier"
const WIDE_KEEP = 0.5;        // the most-pages panel keeps at least half the production engine's pages

// Engines the issue lists as never tested on any script here. Testing them is a separate, priced
// follow-up; this list only says so on the page.
// DeepSeek-OCR, Qwen3-VL-8B, Chandra 2, Mistral OCR 4.1 and Claude Opus / Sonnet 5.5 left this list with #6011 wave 1.
const NEVER_TESTED = ['Qwen3-VL 32B', 'GPT (vision)', 'Google Cloud Vision'];
// General-purpose engines we HAVE run somewhere. A script whose pages one of them never read lists it as
// not yet tested there. Script-specific models (a Kraken or Tesseract model for one script, NDL for
// classical Japanese) are left out: their absence from another script is not a gap.
const GENERAL = ['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'paddleocr-vl-1.6', 'olmocr-2-7b-fp8', 'surya2', 'dots-mocr', 'mineru',
  'deepseek-ocr', 'qwen3-vl-8b', 'chandra-ocr-2', 'mistral-ocr-4-1', 'claude-opus-5-5', 'claude-sonnet-5-5'];

const LABEL = {
  'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite', 'gemini-3-flash-preview': 'Gemini 3 Flash',
  'paddleocr-vl-1.6': 'PaddleOCR-VL 1.6', 'ndlkotenocr-v3': 'NDL Koten OCR v3', 'surya2': 'Surya 2', 'dots-mocr': 'dots.mocr',
  'cllg-qwen3vl-8b': 'Qwen3-VL 8B (CLLG)', 'kraken-greek-cllg': 'Kraken (CLLG Greek)', 'kraken-catmus': 'Kraken (CATMuS)',
  'kraken-austriannewspapers': 'Kraken (Austrian newspapers)', 'tesseract-lat': 'Tesseract (lat)', 'tesseract-grc': 'Tesseract (grc)',
  'tesseract-deu': 'Tesseract (deu)', 'tesseract-frk': 'Tesseract (frk)', 'tesseract-hye': 'Tesseract (hye)', 'tesseract-hye_calfa': 'Tesseract (hye, Calfa)',
  'tesseract-chi_tra_vert': 'Tesseract (chi_tra_vert)', omnisyr: 'Kraken (OmniSyr)', 'qoruyo-eastern': 'Kraken (Qoruyo East)',
  'qoruyo-estrangela': 'Kraken (Qoruyo Estrangela)', 'sophro-defaultseg': 'Kraken (Sophro)',
  'olmocr-2-7b-fp8': 'olmOCR 2 7B', mineru: 'MinerU',
  'deepseek-ocr': 'DeepSeek-OCR', 'qwen3-vl-8b': 'Qwen3-VL 8B', 'chandra-ocr-2': 'Chandra OCR 2', 'mistral-ocr-4-1': 'Mistral OCR 4.1',
  'claude-opus-5-5': 'Claude Opus 5.5', 'claude-sonnet-5-5': 'Claude Sonnet 5.5',
};
// What the typed reference is, by the stratum the page was sealed in (from each registry's reference_plan).
const REFERENCE = {
  'ref-ws': 'Wikisource transcriptions', 'ref-pinned': 'published e-texts pinned to the leaf',
  'eebo-tcp-5488': 'EEBO-TCP keyed transcriptions', 'latin-period-5126': 'Wikisource and corrected transcriptions matched to the leaf',
  greek: 'First1KGreek / Perseus TEI', 'greek-ext': 'First1KGreek / Perseus / el.wikisource TEI', 'greek-ext2': 'First1KGreek / Perseus / el.wikisource TEI',
  chinese: 'Kanripo (Siku Quanshu) and CBETA', 'chinese-ext': 'Kanripo (Siku Quanshu) and CBETA', 'chinese-cohort-5547': 'Kanripo Siku Quanshu witnesses',
  armenian: 'TITUS', 'syriac-gt': 'line-by-line ground truth for two manuscripts',
};

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
];
// Scripts with OCR runs but no typed reference the charts could score against. Said on the page so an
// absence reads as a gap in the evidence, not as a script nobody looked at.
const NO_REFERENCE = [
  { title: 'Tibetan', why: 'measured as syllable identity against the Derge e-text (a different measure from page CER): BDRC Yigdzin 0.949, Claude Opus 5.5 0.715, Mistral OCR 4.1 0.564, the three open VLMs ~0 (#6011)', source: 'scripts/eval/results/engine-wave1-6011/summary.json' },
  { title: 'Sanskrit', why: 'only repeat-read consistency has been measured (stability), not accuracy', source: 'scripts/eval/results/sanskrit-consistency-2026-04-24.json' },
  { title: 'Persian', why: 'scored as located windows against Ganjoor verse (a different measure from page CER); only Gemini has a measured cost', source: 'scripts/eval/results/persian-ganjoor-2026-10-01-stage1b/table.json' },
];

// ── small statistics (the evidence table's own, seeded so the file is byte-stable) ─────────────
const r3 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const median = xs => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
function bootstrapMedianCI(xs, seed, B = 2000) {
  if (xs.length < MIN_PAGES) return null;
  const rand = rng(seed), meds = [];
  for (let b = 0; b < B; b++) { const s = []; for (let i = 0; i < xs.length; i++) s.push(xs[Math.floor(rand() * xs.length)]); meds.push(median(s)); }
  meds.sort((a, b) => a - b);
  return [r3(meds[Math.floor(0.025 * B)]), r3(meds[Math.floor(0.975 * B)])];
}

// ── cost ─────────────────────────────────────────────────────────────────────────────────────
const costDir = path.join(__dirname, 'results', 'ocr-cost');
const costFile = fs.readdirSync(costDir).filter(f => /^ocr-cost-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1);
if (!costFile) throw new Error(`no metered cost snapshot in ${costDir} — run scripts/eval/ocr-cost-snapshot.mjs`);
const metered = JSON.parse(fs.readFileSync(path.join(costDir, costFile), 'utf8'));
const gpu = JSON.parse(fs.readFileSync(path.join(__dirname, 'ocr-engine-gpu-costs.json'), 'utf8'));
// COST[engine] = [{ charts|null, usd_per_1k, basis, detail, source }]; costOf picks the entry for a chart.
const COST = {};
for (const [engine, m] of Object.entries(metered.models)) COST[engine] = [{
  charts: null, usd_per_1k: r3(m.usd_per_1k_pages), basis: 'metered',
  detail: `Gemini Batch, ${m.pages.toLocaleString('en-US')} pages metered ${metered.window.from.slice(0, 10)} to ${metered.window.to.slice(0, 10)}`,
  source: `scripts/eval/results/ocr-cost/${costFile}`,
}];
const flat = t => t.replace(/\s+/g, ' ');   // write-ups wrap lines mid-sentence
for (const [engine, entries] of Object.entries(gpu.engines)) COST[engine] = entries.map(g => {
  const text = flat(fs.readFileSync(path.join(REPO, g.source), 'utf8'));
  for (const part of g.quote.split(' … ')) if (!text.includes(flat(part))) throw new Error(`ocr-engine-gpu-costs.json: ${engine}'s quote "${part}" is not in ${g.source}`);
  const eurPerPage = g.eur_per_page ?? (g.eur != null && g.pages ? g.eur / g.pages : null);
  const usd = g.usd_per_1k ?? (eurPerPage != null ? eurPerPage * 1000 * gpu.usd_per_eur.value : null);
  if (usd == null) throw new Error(`ocr-engine-gpu-costs.json: ${engine} entry has no eur+pages, eur_per_page or usd_per_1k`);
  return {
    charts: g.charts ?? null, usd_per_1k: r3(usd), basis: g.basis,
    detail: `${g.hardware}; ${g.basis === 'billed' ? 'whole billed rental' : g.basis === 'metered-api' ? 'metered API spend, realtime prices' : 'inference time only'}, measured ${g.measured_on}`,
    source: g.source,
  };
});
function costOf(engine, chartId) {
  const es = COST[engine] || [];
  const e = es.find(x => x.charts?.includes(chartId)) || es.find(x => !x.charts);
  if (!e) return null;
  const { charts, ...rest } = e;
  return rest;
}

// ── accuracy rows: one per page × engine, against a typed reference ─────────────────────────────
// The benchmark store first; then the #5660 open-engine run, scored by the same scorer against the same
// references, which adds PaddleOCR-VL and olmOCR to the print strata. Where both scored the same page ×
// engine, the benchmark store wins (they agree on 681 of 690 such pairs; the rest are separate runs).
// Then #6011 wave 1 (results/engine-wave1-6011/scored): the same scorer and references on a seeded subset of the
// sealed strata. Only its six new engines are taken; its re-scored comparator rows never override the store.
// Then #6011 wave 2 (results/engine-wave2-6011/scored): the same six engines on the rest of each chart's most-pages
// set (PREREGISTRATION-engine-wave2-6011.md); a page wave 1 already read keeps its wave-1 row.
const WAVE_ENGINES = new Set(['deepseek-ocr', 'qwen3-vl-8b', 'chandra-ocr-2', 'mistral-ocr-4-1', 'claude-opus-5-5', 'claude-sonnet-5-5']);
const OPEN_ENGINE_DIRS = ['open-engine-print-5660/scored', 'open-engine-print-5660/scored-olmocr', 'engine-wave1-6011/scored', 'engine-wave2-6011/scored'];
const DIR_ENGINES = { 'engine-wave1-6011/scored': WAVE_ENGINES, 'engine-wave2-6011/scored': WAVE_ENGINES };
const isRepeatArm = e => /-b$/.test(e); // the A-vs-A repeat of production; it is the noise floor, not an engine
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
const accRows = benchRows
  .filter(r => r.referenced && r.aligned && r.cer != null && !isRepeatArm(r.engine))
  .map(r => ({ page: `${r.stratum}|${r.slug}`, book: `${r.stratum}|${r.slug}`, stratum: r.stratum, engine: r.engine, cer: r.cer, refused: r.refused, invented: r.invention_ref, date: r.date, file: r.file, row: r }));

// Syriac: the ground-truth retest scores pages of two manuscripts, so pages are not books here. #6011 wave 2 scored
// the six wave engines with the same scorer against the same ground truth into its own file; only those engines are taken.
const SYRIAC_FILE = 'syriac-retest-2026-09-16/score.json';
const SYRIAC_SOURCES = [[path.join(BENCHMARK_DIR, SYRIAC_FILE), null, '2026-09-16'], [path.join(__dirname, 'results', 'engine-wave2-6011', 'syriac-gt-score.json'), WAVE_ENGINES, null]];
const syriacRows = [];
for (const [file, only, fixedDate] of SYRIAC_SOURCES) {
  if (!fs.existsSync(file)) continue;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'))['syriac-gt'];
  const date = fixedDate || j.date;
  for (const [slug, engines] of Object.entries(j.pages)) for (const [engine, e] of Object.entries(engines)) {
    if (typeof e.cer_n2 !== 'number' || (only && !only.has(engine))) continue;
    // An output longer than the page can score CER > 1; for accuracy it is simply 0.
    syriacRows.push({ page: `syriac-gt|${slug}`, book: slug.split('-')[0], stratum: 'syriac-gt', engine, cer: Math.min(1, e.cer_n2), refused: false, invented: null, date, file: path.relative(REPO, file) });
  }
}

// ── shared-page sets ─────────────────────────────────────────────────────────────────────────
function pagesOf(rows) { const m = new Map(); for (const r of rows) { if (!m.has(r.engine)) m.set(r.engine, new Map()); m.get(r.engine).set(r.page, r); } return m; }
const intersect = (a, b) => new Set([...a].filter(x => b.has(x)));
const answered = (byEngine, e) => new Set([...byEngine.get(e)].filter(([, r]) => !r.refused).map(([p]) => p));

/** Greedy: start from the production engine, add whichever engine keeps the most shared pages, while ≥ floor. */
function greedy(byEngine, start, floor) {
  let set = [start], shared = answered(byEngine, start);
  for (;;) {
    let best = null;
    for (const e of byEngine.keys()) {
      if (set.includes(e)) continue;
      const s = intersect(shared, answered(byEngine, e));
      if (s.size >= floor && (!best || s.size > best.s.size || (s.size === best.s.size && e < best.e))) best = { e, s };
    }
    if (!best) return { engines: set, pages: shared };
    set.push(best.e); shared = best.s;
  }
}

function panel(script, kind, byEngine, engines, pages, production) {
  const placed = [], unplaced = [];
  const strata = new Map(), books = new Set();
  const files = new Set();
  for (const p of pages) {
    const r = byEngine.get(production).get(p);
    const st = strata.get(r.stratum) || { pages: 0, date: '' };
    st.pages++;
    for (const e of engines) { const x = byEngine.get(e).get(p); if (x.date > st.date) st.date = x.date; files.add(x.file); }
    strata.set(r.stratum, st); books.add(r.book);
  }
  for (const e of engines) {
    const rs = [...pages].map(p => byEngine.get(e).get(p));
    const cers = rs.map(r => r.cer);
    const med = median(cers), ci = bootstrapMedianCI(cers, hash(`${script.id}|${kind}|${e}`));
    const inv = rs.filter(r => typeof r.invented === 'number').map(r => r.invented);
    const point = {
      engine: e, label: LABEL[e] || e, production: e === production,
      median_cer: r3(med), cer_ci95: ci,
      accuracy: r3(1 - med), accuracy_ci95: ci ? [r3(1 - ci[1]), r3(1 - ci[0])] : null,
      // share of the engine's words absent from the reference (benchmark-score.mjs invention_ref); sealed strata only
      invented: inv.length >= MIN_PAGES ? { median: r3(median(inv)), n: inv.length } : null,
      cost: costOf(e, script.id),
    };
    (point.cost ? placed : unplaced).push(point);
  }
  // Frontier: placed engines no other placed engine beats on both cost and accuracy.
  for (const a of placed) a.on_frontier = placed.length >= FRONTIER_MIN && !placed.some(b => b !== a
    && b.cost.usd_per_1k <= a.cost.usd_per_1k && b.accuracy >= a.accuracy
    && (b.cost.usd_per_1k < a.cost.usd_per_1k || b.accuracy > a.accuracy));
  placed.sort((a, b) => a.cost.usd_per_1k - b.cost.usd_per_1k || a.engine.localeCompare(b.engine));
  unplaced.sort((a, b) => a.engine.localeCompare(b.engine));
  const refs = [...strata].map(([s, st]) => ({ stratum: s, reference: REFERENCE[s] || `references sealed with ${s}`, pages: st.pages, date: st.date }))
    .sort((a, b) => b.pages - a.pages || a.stratum.localeCompare(b.stratum));
  return {
    kind, n_pages: pages.size, n_books: books.size,
    frontier: placed.length >= FRONTIER_MIN, frontier_note: placed.length >= FRONTIER_MIN ? null : `too few for a frontier: ${placed.length} engine${placed.length === 1 ? '' : 's'} with a measured cost on these pages`,
    references: refs, date: refs.map(r => r.date).sort().at(-1), files: [...files].sort(),
    placed, no_cost: unplaced,
  };
}

const argOf = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
// #6304: pages whose reference does not transcribe the page (no engine within 35% CER on print, or read
// so by eye) or that are in another script, and per-panel limits, generated by audit-pareto-samples.mjs.
const AUDIT_FILE = path.join(__dirname, 'results', 'pareto-sample-audit-6304', 'drops.json');
const AUDIT = !process.argv.includes('--keep-dropped') && fs.existsSync(AUDIT_FILE) ? JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')) : null;
const CLI_EXCLUDE = argOf('exclude') ? JSON.parse(fs.readFileSync(argOf('exclude'), 'utf8')) : [];
const EXCLUDE = new Set([...CLI_EXCLUDE, ...(AUDIT?.drops || []).filter(d => d.family === 'ocr').map(d => d.page)]);
const without = s => (EXCLUDE.size ? { ...s, pages: new Set([...s.pages].filter(p => !EXCLUDE.has(p))) } : s);
const charts = [], noChart = [], mostPagesSets = {};
for (const script of SCRIPTS) {
  const rows = script.source === 'syriac' ? syriacRows : accRows.filter(r => script.match(r.row));
  const byEngine = pagesOf(rows);
  const production = getOcrModelForBook({ language: script.language, visible: true });
  const tested = new Set(rows.map(r => r.engine));
  // Every engine run on the script at all, referenced or not — so "not yet tested" means exactly that.
  if (!script.source) for (const r of benchRows) if (!isRepeatArm(r.engine) && script.match(r)) tested.add(r.engine);
  const notTested = [...GENERAL.filter(e => !tested.has(e)).map(e => LABEL[e] || e), ...NEVER_TESTED];
  const nProd = byEngine.has(production) ? answered(byEngine, production).size : 0;
  if (nProd < MIN_PAGES) {
    noChart.push({ title: script.title, why: nProd ? `${nProd} page${nProd === 1 ? '' : 's'} with a typed reference; at least ${MIN_PAGES} are needed for an interval` : 'no page with a typed reference yet (scored only against another engine)', source: 'scripts/eval/results/benchmark/', not_tested: notTested });
    continue;
  }
  const wide = without(greedy(byEngine, production, Math.max(MIN_PAGES, Math.ceil(nProd * WIDE_KEEP))));
  const panels = [panel(script, 'most-pages', byEngine, wide.engines, wide.pages, production)];
  const notes = AUDIT?.notes?.ocr?.[`${script.id}|most-pages`];
  if (notes?.length) panels[0].notes = notes;
  mostPagesSets[script.id] = { engines: wide.engines, pages: [...wide.pages].sort() };
  const broad = without(greedy(byEngine, production, MIN_PAGES));
  // a panel the #6304 drops leave under MIN_PAGES has no interval, so it is not drawn
  if (broad.engines.length > wide.engines.length && broad.pages.size >= MIN_PAGES) panels.push(panel(script, 'most-engines', byEngine, broad.engines, broad.pages, production));
  // Engines run with a reference on this script but on too few of the same pages to join either panel.
  const shown = new Set(panels.flatMap(p => [...p.placed, ...p.no_cost].map(x => x.engine)));
  const elsewhere = [...byEngine.keys()].filter(e => !shown.has(e)).sort().map(e => ({ engine: e, label: LABEL[e] || e, pages: byEngine.get(e).size }));
  charts.push({ id: script.id, title: script.title, production_engine: production, production_label: LABEL[production] || production, panels, not_on_shared_pages: elsewhere, not_tested: notTested });
}

const out = {
  issue: 5983,
  generated_by: 'scripts/eval/build-ocr-pareto.mjs',
  measure: 'accuracy: 1 − median character error rate against a typed reference, on pages every engine in the panel read',
  production_rule: 'the engine scripts/lib/ocr-routing.mjs assigns to new pages in the script',
  cost_sources: { metered: `scripts/eval/results/ocr-cost/${costFile}`, self_hosted: 'scripts/eval/ocr-engine-gpu-costs.json', usd_per_eur: gpu.usd_per_eur },
  costs: COST,
  charts,
  no_chart: [...noChart, ...NO_REFERENCE],
};
const json = JSON.stringify(out, null, 1) + '\n';
const dumpTo = process.argv.find(a => a.startsWith('--dump-sets='))?.slice('--dump-sets='.length);
if (argOf('out')) { fs.writeFileSync(argOf('out'), json); console.log(`wrote ${argOf('out')} (${EXCLUDE.size} pages excluded)`); process.exit(0); }
if (CLI_EXCLUDE.length) throw new Error('--exclude needs --out: the committed file is never built without pages');
if (dumpTo) { fs.writeFileSync(dumpTo, JSON.stringify(mostPagesSets, null, 1) + '\n'); console.log(`wrote ${dumpTo}`); process.exit(0); }
// --check: fail when the committed file is not what the inputs give (CI test); writes nothing.
if (process.argv.includes('--check')) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have !== json) { console.error(`${path.relative(process.cwd(), OUT)} is stale — run node scripts/eval/build-ocr-pareto.mjs`); process.exit(1); }
  console.log('ocr-pareto.json is current');
  process.exit(0);
}
fs.writeFileSync(OUT, json);
for (const c of charts) for (const p of c.panels) console.log(`${c.title} [${p.kind}] ${p.n_pages} pages / ${p.n_books} books · ${p.placed.map(x => `${x.engine} ${x.accuracy}@$${x.cost.usd_per_1k}${x.on_frontier ? '*' : ''}`).join(', ')}${p.no_cost.length ? ` · no cost: ${p.no_cost.map(x => `${x.engine} ${x.accuracy}`).join(', ')}` : ''}`);
for (const n of out.no_chart) console.log(`no chart: ${n.title} — ${n.why}`);
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
