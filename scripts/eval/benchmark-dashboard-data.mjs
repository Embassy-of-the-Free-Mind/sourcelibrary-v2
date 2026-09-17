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
 *   node scripts/eval/benchmark-dashboard-data.mjs            # writes results/benchmark/dashboard-data.json
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, 'results', 'benchmark');
const OUT = path.join(DIR, 'dashboard-data.json');
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
      // In a reference tier an unaligned page has no CER: the engine ran and could not be placed
      // against the reference. That is COVERAGE, and it must not vanish into a smaller n.
      const aligned = isTier ? !!e.aligned : true;
      rows.push({
        stratum, slug: p.slug, engine, referenced, aligned,
        substratum: p.substratum ?? null,
        script_class: p.script_class ?? null,
        language: p.language ?? null,
        year: p.year ?? null,
        cer: aligned && typeof e.cer === 'number' ? e.cer : null, // vs reference if `referenced`, else vs the proxy engine
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
  if (r.language && r.stratum.startsWith('ref-')) k.push(['language', `${r.stratum} / ${r.language}`]);
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
  const proxyCer = g.rows.filter(r => !r.referenced && r.cer != null).map(r => r.cer);
  const seed = hash(`${g.factor}|${g.level}|${g.engine}`);
  const loops = g.rows.filter(r => r.loop).length;
  const cata = refRows.filter(r => r.cer != null && r.cer > CATASTROPHIC_CER).length;

  // Paired against the production engine on referenced pages both engines could be scored on.
  let paired = null;
  if (g.engine !== PRODUCTION_ENGINE) {
    let wins = 0, losses = 0, ties = 0; const deltas = [];
    for (const r of refRows) {
      const base = bySlugEngine.get(`${r.stratum}|${r.slug}|${PRODUCTION_ENGINE}`);
      if (!base || base.cer == null || r.cer == null) continue;
      const d = base.cer - r.cer; deltas.push(d);
      if (d > 1e-9) wins++; else if (d < -1e-9) losses++; else ties++;
    }
    const untied = wins + losses;
    paired = {
      n: deltas.length, wins, losses, ties, untied,
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
    cer_vs_reference: refCer.length ? { n: refCer.length, median: r3(median(refCer)), ci95: bootstrapMedianCI(refCer, seed) } : null,
    // Shown so the gap is visible, never graded: a proxy cannot see the proxy engine's own errors.
    cer_vs_proxy: proxyCer.length ? { n: proxyCer.length, median: r3(median(proxyCer)), proxy_engine: PRODUCTION_ENGINE } : null,
    catastrophic: refCer.length ? { k: cata, n: refCer.length, ci95: wilson(cata, refCer.length) } : null,
    loop: { k: loops, n: run, ci95: wilson(loops, run), grade: run >= N_RATE ? 'decision-grade' : 'exploratory' },
    paired_vs_production: paired,
    grade: refCer.length ? grade(refCer.length) : 'exploratory',
    referenced_pages_needed: Math.max(0, N_DECISION - refCer.length),
  });
}
cells.sort((a, b) => a.factor.localeCompare(b.factor) || a.level.localeCompare(b.level) || a.engine.localeCompare(b.engine));

// ── self-check against the scorer's own summary ──────────────────────────────
// If the two disagree, one of them misreads the files, and a dashboard built on it is wrong.
const mismatches = [];
for (const [stratum, file] of latest) {
  if (stratum.startsWith('ref-')) continue;
  const s = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')).summary;
  for (const [engine, es] of Object.entries(s.engines || {})) {
    const c = cells.find(x => x.factor === 'stratum' && x.level === stratum && x.engine === engine);
    if (!c) { if (es.pages_run) mismatches.push(`${stratum}/${engine}: in the summary, absent from the table`); continue; }
    const want = es.ref?.n ? es.ref.median_cer : null, got = c.cer_vs_reference?.median ?? null;
    if (want != null && Math.abs(want - got) > 0.0015) mismatches.push(`${stratum}/${engine}: median CER ${got} here vs ${want} in the scorer's summary`);
    const pw = es.paired_vs_ref, pg = c.paired_vs_production;
    if (pw?.n && pg && (pw.wins !== pg.wins || pw.losses !== pg.losses)) mismatches.push(`${stratum}/${engine}: paired ${pg.wins}/${pg.losses} here vs ${pw.wins}/${pw.losses}`);
  }
}
if (mismatches.length) { console.error('SELF-CHECK FAILED:\n  ' + mismatches.join('\n  ')); process.exit(1); }

const gradeCount = cells.reduce((m, c) => ((m[c.grade] = (m[c.grade] || 0) + 1), m), {});
const out = {
  generated_from: sources,
  production_engine: PRODUCTION_ENGINE,
  thresholds: { catastrophic_cer: CATASTROPHIC_CER, directional_n: N_DIRECTIONAL, decision_n: N_DECISION, rate_n: N_RATE },
  totals: { page_engine_rows: rows.length, pages: new Set(rows.map(r => `${r.stratum}|${r.slug}`)).size, cells: cells.length, cells_by_grade: gradeCount },
  cells,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
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
