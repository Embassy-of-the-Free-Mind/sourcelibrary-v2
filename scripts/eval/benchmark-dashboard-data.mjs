#!/usr/bin/env node
/**
 * benchmark-dashboard-data.mjs — fold every scored benchmark file into ONE evidence table,
 * and grade each cell by how much it can carry (#4735 plan of 2026-09-17).
 *
 * PRIOR ART: scripts/eval/benchmark-score.mjs — it SCORES engine outputs per stratum and writes
 * results/benchmark/<stratum>-<date>.json; it does not pool strata, put intervals on anything, or
 * say whether n is enough to decide on. This script only READS its output (no model calls, no
 * Mongo, $0) and reuses its definitions: catastrophic = CER > 0.5, a tie = equal CER.
 * The sign test and bootstrap also exist in stats-cross-model.mjs and benchmark-score.mjs, but
 * as unexported functions inside scripts; the self-check below pins this copy to the scorer's
 * numbers. Hoisting all three into scripts/eval/lib is a separate, one-concern PR.
 *
 * Who runs it: anyone, on a laptop, after benchmark-score.mjs has written new results.
 *   node scripts/eval/benchmark-dashboard-data.mjs            # writes src/data/ocr-benchmark-evidence.json
 * Slices: sealed stratum, period substratum, observed script class, and — pooled across strata
 * and reference tiers — script, language, period (catalogue year), script × period, language × period.
 * Also carried, as their own `measure` and never mixed into a CER cell: image-preprocessing arms (#5250) and
 * translation-fidelity cells (#5695 served English vs published translations; #5700 A5 re-read lift).
 * How it fails: loudly. A results file it cannot parse, or a cell whose recomputed numbers
 * disagree with the scorer's own summary, is an error — never a silently thinner table.
 *
 * Evidence grades (fixed before further runs; one page per book, so n pages = n books):
 *   exploratory     no reference (proxy-scored against another engine), or n < 30
 *   directional     30–49 referenced pages
 *   decision-grade  ≥ 50 referenced pages — and for the paired comparison ≥ 50 UNTIED pairs
 *   Rates (loop / catastrophic) are graded separately: ≥ 150 pages for ±5 pp at a 10 % rate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_ENGINE } from './lib/refusals.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, 'results', 'benchmark');
// Written under src/ on purpose: /platform/admin/ocr-evidence imports it, and the Vercel
// ignored-build step skips commits that touch only scripts/ — a table kept under results/
// would update in git and never reach the page.
const OUT = path.join(__dirname, '..', '..', 'src', 'data', 'ocr-benchmark-evidence.json');
const PRODUCTION_ENGINE = 'gemini-3.1-flash-lite';
const CATASTROPHIC_CER = 0.5;
const N_DIRECTIONAL = 30, N_DECISION = 50, N_RATE = 150;

// ── small statistics ─────────────────────────────────────────────────────────
const r3 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const median = xs => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// Seeded so the file is byte-stable between runs on unchanged inputs.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function bootstrapMedianCI(xs, seed, B = 2000) {
  if (xs.length < 5) return null; // an interval from four pages is decoration
  const rand = rng(seed), meds = [];
  for (let b = 0; b < B; b++) { const s = []; for (let i = 0; i < xs.length; i++) s.push(xs[Math.floor(rand() * xs.length)]); meds.push(median(s)); }
  meds.sort((a, b) => a - b);
  return [r3(meds[Math.floor(0.025 * B)]), r3(meds[Math.floor(0.975 * B)])];
}
function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [r3(Math.max(0, (c - h) / d)), r3(Math.min(1, (c + h) / d))];
}
function binomTwoSided(k, n) { // exact sign test, k = max(wins, losses)
  if (!n) return null;
  let logC = 0, tail = 0;
  for (let i = 0; i <= n; i++) { if (i > 0) logC += Math.log(n - i + 1) - Math.log(i); if (i >= k) tail += Math.exp(logC - n * Math.LN2); }
  return r3(Math.min(1, 2 * tail));
}
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// ── read: one row per page × engine ──────────────────────────────────────────
const files = fs.readdirSync(DIR).filter(f => /^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json$/.test(f) && !f.startsWith('summary-')).sort();
if (!files.length) throw new Error(`no scored benchmark files in ${DIR}`);
// Latest file per stratum wins; older dates stay on disk as history.
const latest = new Map();
for (const f of files) latest.set(f.replace(/-\d{4}-\d{2}-\d{2}\.json$/, ''), f);

// The sealed registry (scripts/eval/benchmark/<stratum>.json) carries what the result files drop:
// catalogue year, language, provider. Joined by slug.
const REGISTRY_DIR = path.join(__dirname, 'benchmark');
const registry = new Map();
for (const f of fs.readdirSync(REGISTRY_DIR).filter(f => f.endsWith('.json'))) {
  // Not every file here is a page registry: numbers-en-5224.json keeps `pages` as a COUNT.
  const pages = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, f), 'utf8')).pages;
  for (const p of Array.isArray(pages) ? pages : []) registry.set(p.slug, p);
}
// First named language only: "Japanese; Chinese" → Japanese, "Ancient Greek" → Greek.
const cleanLanguage = l => { if (!l) return null; const first = String(l).split(/[;,]/)[0].trim().replace(/^Ancient /, ''); return first || null; };
const SCRIPT_OF = { Latin: 'Latin', English: 'Latin', French: 'Latin', Italian: 'Latin', Spanish: 'Latin', Dutch: 'Latin', German: 'Latin', Greek: 'Greek', Hebrew: 'Hebrew', Armenian: 'Armenian', Syriac: 'Syriac', Chinese: 'Han', Japanese: 'Japanese (kana + kanji)' };
// German is Latin SCRIPT; the Fraktur stratum is a typeface class within it, kept visible as its own level.
const scriptOf = (language, stratum) => (stratum === 'german-fraktur' ? 'Latin (Fraktur)' : SCRIPT_OF[language] || null);
// CATALOGUE year: for a reprint or a modern edition this is the WORK's date, not the scan's
// (#4884 — a "1716" Hagakure was a typeset reprint). Read period cells with that in mind.
const periodOf = y => (typeof y !== 'number' || !Number.isFinite(y) ? null : y < 1500 ? 'before 1500' : y < 1600 ? '1500–1599' : y < 1700 ? '1600–1699' : y < 1800 ? '1700–1799' : y < 1900 ? '1800–1899' : '1900 on');

// REFUSALS (#5581): a page the engine declined (Gemini RECITATION …) is not a misread. Three sources,
// best first: the result file's own `refused` (scored after #5581); the refusal record
// benchmark-score.mjs --refusals-only reads off the run meters (results/benchmark/refusals/), for
// result files scored earlier; else an API engine with no content on a referenced page, labelled
// inferred. Never inferred on an unreferenced page: Gemini returns genuinely empty STOP outputs.
const REFUSAL_DIR = path.join(DIR, 'refusals');
const refusalFiles = fs.existsSync(REFUSAL_DIR) ? fs.readdirSync(REFUSAL_DIR).filter(f => /^refusals-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : [];
const refusalRecord = refusalFiles.length ? JSON.parse(fs.readFileSync(path.join(REFUSAL_DIR, refusalFiles.at(-1)), 'utf8')) : null;
function refusalOfRow(stratum, slug, engine, e, referenced, isTier) {
  if (typeof e.refused === 'boolean') return e.refused ? (e.refusal_source || 'finishReason') : null;
  const rec = refusalRecord?.strata?.[stratum]?.[engine];
  if (rec?.meter) return rec.refused?.[slug] ? 'finishReason' : (rec.inferred?.includes(slug) ? 'inferred' : null);
  if (!referenced || !API_ENGINE.test(engine)) return null;
  return (isTier ? e.chars === 0 : e.n_content === 0) ? 'inferred' : null;
}

const rows = [];
const sources = [];
for (const [stratum, file] of latest) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  if (!Array.isArray(j.pages) || !j.summary) throw new Error(`${file}: expected {summary, pages[]}`);
  const isTier = stratum.startsWith('ref-');
  sources.push({ stratum, file, date: j.summary.date, n_pages: j.pages.length, issue: j.summary.issue ?? null });
  for (const p of j.pages) {
    for (const [engine, e] of Object.entries(p.engines)) {
      if (e.missing) continue; // the engine was never run on this page — not a failure of the engine
      const referenced = isTier ? true : !!p.has_ref;
      const refusal = refusalOfRow(stratum, p.slug, engine, e, referenced, isTier);
      // In a reference tier an unaligned page has no CER: the engine ran and could not be placed
      // against the reference. That is COVERAGE, and it must not vanish into a smaller n.
      const aligned = isTier ? !!e.aligned : true;
      const reg = registry.get(p.slug) || {};
      // A reference that is a CORRECTION of a served read (the #5695 T1 transcriptions sealed beside
      // latin-period-5126) leans toward the engine it was corrected from. It stays visible in its own
      // stratum/substratum rows and never enters a pooled language or period cell (#5126 prereg).
      const correctedRef = /corrected-OCR reference/.test(p.substratum ?? reg.substratum ?? '');
      const language = correctedRef ? null : cleanLanguage(p.language ?? reg.language);
      const year = correctedRef ? null : (p.year ?? reg.year ?? null);
      rows.push({
        stratum, slug: p.slug, engine, referenced, aligned,
        substratum: p.substratum ?? null,
        script_class: p.script_class ?? null,
        language, year,
        script: scriptOf(language, stratum),
        period: periodOf(year),
        // vs reference if `referenced`, else vs the proxy engine. Unchanged by #5581: a sealed stratum
        // scores a refusal as CER 1.0, a reference tier leaves it unplaced (coverage). The
        // answered-only median below drops it either way.
        cer: aligned && typeof e.cer === 'number' ? e.cer : null,
        refused: !!refusal, refusal_inferred: refusal === 'inferred',
        loop: e.loop === true, empty: e.empty === true,
        invention: typeof e.invention_ref === 'number' ? e.invention_ref : (typeof e.invention === 'number' ? e.invention : null),
      });
    }
  }
}

// ── cells ────────────────────────────────────────────────────────────────────
// A cell = one factor level × one engine. Factors available in the data today:
//   stratum, stratum × substratum, stratum × script_class, reference tier × language.
const cellKeys = r => {
  const k = [['stratum', r.stratum]];
  if (r.substratum) k.push(['substratum', `${r.stratum} / ${r.substratum}`]);
  if (r.script_class) k.push(['script_class', `${r.stratum} / ${r.script_class}`]);
  // Pooled across strata by OBSERVED class (#4925: chinese + chinese-ext both hold Siku Quanshu manuscript).
  if (r.script && r.script_class) k.push(['script_class_pooled', `${r.script} / ${r.script_class}`]);
  // Pooled ACROSS strata and reference tiers (each book is drawn once, so pooling adds books):
  if (r.script) k.push(['script', r.script]);
  if (r.language) k.push(['language', r.language]);
  if (r.period) k.push(['period', r.period]);
  if (r.script && r.period) k.push(['script_period', `${r.script} · ${r.period}`]);
  if (r.language && r.period) k.push(['language_period', `${r.language} · ${r.period}`]);
  return k;
};
const groups = new Map();
for (const r of rows) for (const [factor, level] of cellKeys(r)) {
  const id = `${factor}|${level}|${r.engine}`;
  if (!groups.has(id)) groups.set(id, { factor, level, engine: r.engine, rows: [] });
  groups.get(id).rows.push(r);
}
const bySlugEngine = new Map(rows.map(r => [`${r.stratum}|${r.slug}|${r.engine}`, r]));

const grade = n => (n >= N_DECISION ? 'decision-grade' : n >= N_DIRECTIONAL ? 'directional' : 'exploratory');
const cells = [];
for (const g of groups.values()) {
  const run = g.rows.length;
  const refRows = g.rows.filter(r => r.referenced);
  const refCer = refRows.filter(r => r.cer != null).map(r => r.cer);
  const refCerAnswered = refRows.filter(r => r.cer != null && !r.refused).map(r => r.cer);
  const refused = g.rows.filter(r => r.refused);
  const proxyCer = g.rows.filter(r => !r.referenced && r.cer != null).map(r => r.cer);
  const seed = hash(`${g.factor}|${g.level}|${g.engine}`);
  const loops = g.rows.filter(r => r.loop).length;
  const cata = refRows.filter(r => r.cer != null && r.cer > CATASTROPHIC_CER).length;

  // Paired against the production engine on referenced pages both engines could be scored on.
  let paired = null;
  if (g.engine !== PRODUCTION_ENGINE) {
    let wins = 0, losses = 0, ties = 0, excludedRefused = 0; const deltas = [];
    for (const r of refRows) {
      const base = bySlugEngine.get(`${r.stratum}|${r.slug}|${PRODUCTION_ENGINE}`);
      if (!base || base.cer == null || r.cer == null) continue;
      // on pages BOTH engines answered (#5581): a refusal is counted in `refused`, not as a loss
      if (base.refused || r.refused) { excludedRefused++; continue; }
      const d = base.cer - r.cer; deltas.push(d);
      if (d > 1e-9) wins++; else if (d < -1e-9) losses++; else ties++;
    }
    const untied = wins + losses;
    paired = {
      n: deltas.length, excluded_refused: excludedRefused, wins, losses, ties, untied,
      median_delta_cer: r3(median(deltas)), delta_ci95: bootstrapMedianCI(deltas, seed + 1),
      p_sign: untied ? binomTwoSided(Math.max(wins, losses), untied) : null,
      grade: grade(untied),
      // books still needed before the comparison can carry a routing decision
      untied_pairs_needed: Math.max(0, N_DECISION - untied),
    };
  }

  cells.push({
    factor: g.factor, level: g.level, engine: g.engine,
    n_run: run,
    n_referenced: refRows.length,
    coverage: refRows.length ? { aligned: refRows.filter(r => r.aligned).length, of: refRows.length, ci95: wilson(refRows.filter(r => r.aligned).length, refRows.length) } : null,
    cer_vs_reference: refCer.length ? { n: refCer.length, median: r3(median(refCer)), ci95: bootstrapMedianCI(refCer, seed), refusals: 'sealed strata: CER 1.0; reference tiers: unplaced' } : null,
    cer_vs_reference_answered: refCerAnswered.length ? { n: refCerAnswered.length, median: r3(median(refCerAnswered)), ci95: bootstrapMedianCI(refCerAnswered, seed) } : null,
    refused: { k: refused.length, n: run, inferred: refused.filter(r => r.refusal_inferred).length },
    // Shown so the gap is visible, never graded: a proxy cannot see the proxy engine's own errors.
    cer_vs_proxy: proxyCer.length ? { n: proxyCer.length, median: r3(median(proxyCer)), proxy_engine: PRODUCTION_ENGINE } : null,
    catastrophic: refCer.length ? { k: cata, n: refCer.length, ci95: wilson(cata, refCer.length) } : null,
    loop: { k: loops, n: run, ci95: wilson(loops, run), grade: run >= N_RATE ? 'decision-grade' : 'exploratory' },
    paired_vs_production: paired,
    grade: refCer.length ? grade(refCer.length) : 'exploratory',
    referenced_pages_needed: Math.max(0, N_DECISION - refCer.length),
  });
}
// Periods read in time order, not alphabetically ("before 1500" would otherwise sort last).
const PERIODS = ['before 1500', '1500–1599', '1600–1699', '1700–1799', '1800–1899', '1900 on'];
const levelKey = l => { const parts = l.split(' · '); const pi = PERIODS.indexOf(parts[parts.length - 1]); return pi < 0 ? l : `${parts.length > 1 ? parts[0] : ''}|${pi}`; };
cells.sort((a, b) => a.factor.localeCompare(b.factor) || levelKey(a.level).localeCompare(levelKey(b.level)) || a.engine.localeCompare(b.engine));

// ── "do we have enough?" — one line per factor level, read off the PRODUCTION engine ──────
// (the engine every comparison is against; if it has no referenced pages, nothing in the level
// can be decided). `books` counts sealed pages any engine was run on.
const sufficiency = [];
for (const key of [...new Set(cells.map(c => `${c.factor}|${c.level}`))]) {
  const [factor, level] = key.split('|');
  const inLevel = cells.filter(c => c.factor === factor && c.level === level);
  const prod = inLevel.find(c => c.engine === PRODUCTION_ENGINE);
  const referenced = prod?.cer_vs_reference?.n ?? 0;
  sufficiency.push({ factor, level, books: Math.max(...inLevel.map(c => c.n_run)), referenced, grade: referenced ? grade(referenced) : 'exploratory', referenced_books_needed: Math.max(0, N_DECISION - referenced) });
}

// ── self-check against the scorer's own summary ──────────────────────────────
// If the two disagree, one of them misreads the files, and a dashboard built on it is wrong.
const mismatches = [];
for (const [stratum, file] of latest) {
  if (stratum.startsWith('ref-')) continue;
  const s = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')).summary;
  const scoredWithRefusals = !!s.refusal_source;   // scored after #5581: its paired test already excludes refusals
  for (const [engine, es] of Object.entries(s.engines || {})) {
    const c = cells.find(x => x.factor === 'stratum' && x.level === stratum && x.engine === engine);
    if (!c) { if (es.pages_run) mismatches.push(`${stratum}/${engine}: in the summary, absent from the table`); continue; }
    const want = es.ref?.n ? es.ref.median_cer : null, got = c.cer_vs_reference?.median ?? null;
    if (want != null && Math.abs(want - got) > 0.0015) mismatches.push(`${stratum}/${engine}: median CER ${got} here vs ${want} in the scorer's summary`);
    const pw = es.paired_vs_ref, pg = c.paired_vs_production;
    // A file scored before #5581 paired refusals as losses; the table no longer does, so the two can
    // only be compared where no refusal entered the pairs.
    const comparable = scoredWithRefusals || !pg?.excluded_refused;
    if (comparable && pw?.n && pg && (pw.wins !== pg.wins || pw.losses !== pg.losses)) mismatches.push(`${stratum}/${engine}: paired ${pg.wins}/${pg.losses} here vs ${pw.wins}/${pw.losses}`);
  }
}
if (mismatches.length) { console.error('SELF-CHECK FAILED:\n  ' + mismatches.join('\n  ')); process.exit(1); }

// ── Image-preprocessing arms (#5250): same engine, same pages, only the image differs. ──
// Read from results/ocr-preprocessing-<date>.json (ocr-preprocessing/build-results.py). Every delta here is a GAIN
// (positive = the arm is better than its baseline), already paired by the stratum's scorer; nothing is recomputed.
const imageArms = [];
for (const f of fs.readdirSync(path.join(__dirname, 'results')).filter(f => /^ocr-preprocessing-\d{4}-\d{2}-\d{2}(-r\d+)?\.json$/.test(f)).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', f), 'utf8'));
  const push = (stratum, s, metric, table, baseline, floor, sub = null) => {
    for (const [arm, c] of Object.entries(table)) {
      imageArms.push({ cell_id: `image-arms/${stratum}${sub ? `/${sub}` : ''}/${metric}/${arm}`, file: f, run_id: s.run_id, stratum, sub, engine: s.engine,
        measure: s.measure, metric, arm, baseline: c.baseline || 'none', baseline_median: baseline, n: c.n, wins: c.wins, losses: c.losses, ties: c.ties,
        median_gain: c.median_delta ?? c.median_gain, ci95: c.ci95, p_sign: c.sign_p, counts: c.counts,
        floor_p90: (typeof floor === 'function' ? floor(c) : floor)?.p90_abs ?? null, grade: s.grade,
        // confirmatory rounds (round 3+) carry the pre-registered prediction and the verdict; earlier rounds have neither
        prediction: c.prediction ?? null, verdict: c.verdict ?? null });
    }
  };
  for (const [stratum, s] of Object.entries(r.strata)) {
    if (s.tables && s.tables.identity) {            // Tibetan: identity, matched syllables, lines
      for (const [metric, t] of Object.entries(s.tables)) push(stratum, s, metric, t.paired, null, c => (c.baseline === 'leafcrop' ? t.noise_floor?.leaf : t.noise_floor?.whole));
    } else if (s.paired) {                         // Syriac
      push(stratum, s, 'line_cer_n2', s.paired, s.baseline_median, s.noise_floor);
    } else if (s.tables) {                         // Gemini strata, pooled + per script
      for (const [sub, t] of Object.entries(s.tables)) push(stratum, s, 'windowed_cer', t.paired, t.baseline_median, s.noise_floor, sub === 'all' ? null : sub);
    }
  }
  sources.push({ file: `results/${f}` });
}

// ── Translation fidelity (#5695, #5700 A5; added by #5828). ──
// The OCR table above stops at the transcription. Two studies measured what the reader gets: the served
// English against published human translations, per language, with the paired flash − lite difference
// (xlref-synthesis-2026-10/summary.json), and what a fresh flash OCR re-read does to that English, by the
// engine that made the served read (reocr-lift-2026-10/lift.json). Read as written, nothing recomputed.
// Their `measure` is their own — a judge's 1–5 rating against a human reference, on one page per book —
// and is never mixed into a CER cell. Graded by books on the same thresholds as the OCR cells.
const translationFidelity = [];
{
  const RES = path.join(__dirname, 'results');
  const ci = c => (Array.isArray(c) ? c : null);
  const served = path.join(RES, 'xlref-synthesis-2026-10', 'summary.json');
  if (fs.existsSync(served)) {
    const j = JSON.parse(fs.readFileSync(served, 'utf8'));
    for (const l of j.languages) translationFidelity.push({
      cell_id: `translation-fidelity/served/${l.lang}`, measure: 'translation-fidelity', measure_note: j.measure, kind: 'served',
      run_id: 'xlref-synthesis-2026-10', issue: j.issue, track: l.track, language: l.lang, n: l.n,
      fidelity_mean: l.mean, fidelity_ci95: ci(l.mean_ci), share_ge4: l.ge4_pct == null ? null : l.ge4_pct / 100,
      reversals_per_100: l.reversals_per_100 ?? null,
      flash_minus_lite: l.flash_minus_lite ? { n: l.flash_minus_lite.n, delta: l.flash_minus_lite.delta, ci95: ci(l.flash_minus_lite.ci), better: l.flash_minus_lite.better, worse: l.flash_minus_lite.worse } : null,
      grade: grade(l.n),
    });
    sources.push({ file: 'results/xlref-synthesis-2026-10/summary.json' });
  }
  const lift = path.join(RES, 'reocr-lift-2026-10', 'lift.json');
  if (fs.existsSync(lift)) {
    const j = JSON.parse(fs.readFileSync(lift, 'utf8'));
    for (const [level, v] of Object.entries(j.by_script_and_engine)) {
      const [language, servedBy] = level.split(' | ');
      translationFidelity.push({
        cell_id: `translation-fidelity/reocr-lift/${language}/${servedBy.replace(/^served /, '')}`, measure: 'translation-fidelity', measure_note: j.measure, kind: 'reocr_lift',
        run_id: j.run_id, issue: 5700, language, served_ocr_engine: servedBy.replace(/^served /, ''), n: v.n,
        // fidelity of the lite translation on the served OCR, then on a fresh flash re-read of the same page
        fidelity_served_ocr: v.lite_ocr ?? null, fidelity_reread: v.lite_reocr ?? null,
        reread_lift: v.lift_lite ? { mean: v.lift_lite.mean, ci95: ci(v.lift_lite.ci), better: v.lift_lite.better, same: v.lift_lite.same, worse: v.lift_lite.worse } : null,
        a_vs_a_floor: j.a_vs_a?.lite ? { n: j.a_vs_a.lite.n, mean: j.a_vs_a.lite.mean, ci95: ci(j.a_vs_a.lite.ci) } : null,
        grade: grade(v.n),
      });
    }
    sources.push({ file: 'results/reocr-lift-2026-10/lift.json' });
  }
  for (const c of translationFidelity) if (!c.measure || typeof c.n !== 'number') throw new Error(`translation-fidelity cell ${c.cell_id} has no measure or n`);
}

const gradeCount = cells.reduce((m, c) => ((m[c.grade] = (m[c.grade] || 0) + 1), m), {});
const out = {
  generated_from: sources,
  production_engine: PRODUCTION_ENGINE,
  thresholds: { catastrophic_cer: CATASTROPHIC_CER, directional_n: N_DIRECTIONAL, decision_n: N_DECISION, rate_n: N_RATE },
  refusals_from: refusalRecord ? `results/benchmark/refusals/${refusalFiles.at(-1)}` : null,
  totals: { page_engine_rows: rows.length, refused_rows: rows.filter(r => r.refused).length, refused_inferred_rows: rows.filter(r => r.refusal_inferred).length, pages: new Set(rows.map(r => `${r.stratum}|${r.slug}`)).size, cells: cells.length, cells_by_grade: gradeCount },
  sufficiency,
  cells,
  image_arms: imageArms,
  translation_fidelity: translationFidelity,
};
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`rows ${rows.length} · pages ${out.totals.pages} · cells ${cells.length} · ${JSON.stringify(gradeCount)}`);
console.log(`self-check vs scorer summary: OK · wrote ${path.relative(process.cwd(), OUT)}`);

// --html=<path>: inline the table into the dashboard template (a single self-contained page).
const htmlArg = process.argv.find(a => a.startsWith('--html='));
if (htmlArg) {
  const tpl = fs.readFileSync(path.join(__dirname, 'benchmark-dashboard.template.html'), 'utf8');
  const MARK = '/*__DATA__*/null';
  if (!tpl.includes(MARK)) throw new Error('dashboard template has no DATA placeholder');
  // `</` must not appear raw inside a <script> block.
  const dest = htmlArg.slice('--html='.length);
  fs.writeFileSync(dest, tpl.replace(MARK, () => JSON.stringify(out).replace(/<\//g, '<\\/')));
  console.log(`wrote ${dest}`);
}
