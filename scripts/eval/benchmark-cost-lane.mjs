#!/usr/bin/env node
// PRIOR ART: benchmark-score.mjs (per-stratum roll-up, paired sign test vs the production engine)
// and benchmark-dashboard-data.mjs (per-cell grade + bootstrap CI of the median Δ) — neither pools
// pages ACROSS strata by observed script class, and neither applies a non-inferiority (cost-lane)
// rule: they answer "is the specialist better", not "is it no worse than the margin". This script
// applies the preregistered cost-lane rule of PREREGISTRATION-chinese-ext-4925.md verbatim.
/**
 * benchmark-cost-lane.mjs — the preregistered COST-LANE decision per observed page class.
 *
 *   node scripts/eval/benchmark-cost-lane.mjs --strata=chinese,chinese-ext \
 *        --engine=paddleocr-vl-1.6 [--ref=gemini-3.1-flash-lite] [--repeat=gemini-3.1-flash-lite-b] \
 *        [--classes=manuscript-regular,woodblock,typeset] [--min-n=50] [--out=<json>]
 *
 * Reads the LATEST scorer results file per stratum (scripts/eval/results/benchmark/<stratum>-<date>.json),
 * pools referenced pages across strata by `script_class` (the by-eye class, never the draw), and per class:
 *   Δ  = CER(engine) − CER(ref) per page; median, bootstrap 95 % CI of the median (seeded);
 *   Δ₀ = CER(repeat) − CER(ref) on the same pages (the A-vs-A noise floor);
 *   catastrophic (CER > 0.5), median invention vs reference, loop pages — engine vs ref;
 *   the paired sign test and the "better reader" rule of #4743.
 * Rule (evaluated only when the class holds ≥ --min-n referenced pages):
 *   adopted  ⇔ median Δ ≤ +0.02 ∧ CI-upper(median Δ) ≤ +0.05 ∧ |median Δ₀| < 0.02
 *              ∧ catastrophic(engine) ≤ catastrophic(ref)+1 ∧ median invention(engine) ≤ ref ∧ loops(engine) ≤ ref
 *   better reader ⇔ sign test p < 0.05 on ≥ 50 untied pairs ∧ Δ ≤ −0.05 on ≥ 60 % of pages
 *   otherwise rejected; under --min-n the class is DIRECTIONAL with its interval and no decision.
 * Pages the scorer demoted to proxy (`ref_mismatch`) are not referenced and do not enter.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { binomTwoSided, resetSeed, seededRand } from './lib/paired-stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const STRATA = argOf('strata', 'chinese,chinese-ext').split(',');
const ENGINE = argOf('engine', 'paddleocr-vl-1.6');
const REF = argOf('ref', 'gemini-3.1-flash-lite');
const REPEAT = argOf('repeat', 'gemini-3.1-flash-lite-b');
const CLASSES = argOf('classes') ? argOf('classes').split(',') : null;
// --leaf=zh: keep only pages whose by-eye leaf language is this (the prereg excludes non-Chinese leaves from both cells).
// For --leaf=grc a page that carries a by-eye `greek_share` (Greek strata, tenths) is judged by that
// instead: it enters at ≥ 0.5 — a parallel Greek–Latin leaf is `mixed` by language and still a Greek
// cell member when Greek holds the majority (PREREGISTRATION-greek-ext-4925.md, cell membership).
const LEAF = argOf('leaf');
// --script-class=typeset-print: keep only pages of this by-eye class (the Greek prereg counts print
// only; the 18 Greek codices with edition-era catalogue years are reported apart, never in a print cell).
const SCRIPT_CLASS = argOf('script-class');
// --min-share=0.9: the prereg's pure-Greek robustness slice (parallel and apparatus leaves carry Greek
// inside their Latin that the Greek-letters-only scorer charges to every engine alike).
const MIN_SHARE = parseFloat(argOf('min-share', '0.5'));
const leafOk = p => !LEAF || (LEAF === 'grc' && typeof p.greek_share === 'number' ? p.greek_share >= MIN_SHARE : (!p.leaf_language || p.leaf_language === LEAF));
const MIN_N = parseInt(argOf('min-n', '50'), 10);
const MARGIN = parseFloat(argOf('margin', '0.02')), CI_MAX = parseFloat(argOf('ci-max', '0.05')), NOISE = parseFloat(argOf('noise', '0.02'));
const DIR = argOf('results', path.join(__dirname, 'results', 'benchmark'));
const OUT = argOf('out');

const r3 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function bootstrapMedianCI(xs, B = 5000) {
  if (xs.length < 2) return null;
  resetSeed(0x4925);
  const meds = [];
  for (let b = 0; b < B; b++) { const s = []; for (let j = 0; j < xs.length; j++) s.push(xs[Math.floor(seededRand() * xs.length)]); meds.push(median(s)); }
  meds.sort((a, b) => a - b);
  return [r3(meds[Math.floor(B * 0.025)]), r3(meds[Math.floor(B * 0.975)])];
}

// latest results file per stratum
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
const pages = [];
const sources = [];
for (const st of STRATA) {
  const mine = files.filter(f => f.startsWith(`${st}-`) && /^\S+-\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(st.length + 1).match(/^\d{4}-\d{2}-\d{2}\.json$/)).sort();
  if (!mine.length) throw new Error(`no results file for stratum ${st} in ${DIR}`);
  const f = mine[mine.length - 1];
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  sources.push({ stratum: st, file: f, n_pages: j.pages.length, n_with_ref: j.summary?.n_with_ref });
  for (const p of j.pages) pages.push({ ...p, stratum: st });
}

// --by=period: group by the catalogue century of the page's book instead of the observed script
// class (#4925 step 2: the Greek decision is per PERIOD of print; the by-eye leaf filter --leaf=grc
// still applies). The period is the edition's catalogue year — read with #4884 in mind.
const BY = argOf('by', 'script_class');
const periodOf = y => (typeof y !== 'number' || !Number.isFinite(y) ? null : y < 1500 ? 'before 1500' : y < 1600 ? '1500–1599' : y < 1700 ? '1600–1699' : y < 1800 ? '1700–1799' : y < 1900 ? '1800–1899' : '1900 on');
const PERIOD_GROUPS = { '1450–1699': ['before 1500', '1500–1599', '1600–1699'], '1700–1799': ['1700–1799'], '1800–1899': ['1800–1899'] };
const groupOf = p => BY === 'period' ? (Object.entries(PERIOD_GROUPS).find(([, ps]) => ps.includes(periodOf(p.year)))?.[0] || null) : p.script_class;
for (const p of pages) p._group = groupOf(p);
const classes = CLASSES || [...new Set(pages.map(p => p._group).filter(Boolean))].sort();
const result = { engine: ENGINE, ref: REF, repeat: REPEAT, min_n: MIN_N, rule: { margin: MARGIN, ci_max: CI_MAX, noise: NOISE }, sources, classes: {} };
const cerOf = (p, e) => (p.engines?.[e] && !p.engines[e].missing && typeof p.engines[e].cer === 'number') ? p.engines[e].cer : null;

for (const c of classes) {
  const inClass = pages.filter(p => p._group === c && leafOk(p) && (!SCRIPT_CLASS || p.script_class === SCRIPT_CLASS));
  const referenced = inClass.filter(p => p.has_ref && !p.ref_mismatch);
  const paired = referenced.filter(p => cerOf(p, ENGINE) != null && cerOf(p, REF) != null);
  const deltas = paired.map(p => cerOf(p, ENGINE) - cerOf(p, REF));
  const withRepeat = paired.filter(p => cerOf(p, REPEAT) != null);
  const deltas0 = withRepeat.map(p => cerOf(p, REPEAT) - cerOf(p, REF));
  const wins = deltas.filter(d => d < -1e-9).length, losses = deltas.filter(d => d > 1e-9).length, ties = deltas.length - wins - losses;
  const untied = wins + losses;
  const cata = e => paired.filter(p => cerOf(p, e) > 0.5).length;
  const inv = e => median(paired.map(p => p.engines?.[e]?.invention_ref).filter(x => typeof x === 'number'));
  const loops = e => paired.filter(p => p.engines?.[e]?.loop === true).length;
  const medD = median(deltas), ci = bootstrapMedianCI(deltas), medD0 = median(deltas0);
  const bigWinShare = deltas.length ? deltas.filter(d => d <= -0.05).length / deltas.length : null;
  const p_sign = untied ? binomTwoSided(Math.max(wins, losses), untied) : null;
  const checks = {
    median_delta_le_margin: medD != null && medD <= MARGIN,
    ci_upper_le_max: ci != null && ci[1] <= CI_MAX,
    noise_floor_below_margin: medD0 != null && Math.abs(medD0) < NOISE,
    catastrophic_le_ref_plus_1: cata(ENGINE) <= cata(REF) + 1,
    invention_le_ref: inv(ENGINE) != null && inv(REF) != null && inv(ENGINE) <= inv(REF),
    loops_le_ref: loops(ENGINE) <= loops(REF),
  };
  const better = untied >= MIN_N && p_sign != null && p_sign < 0.05 && wins > losses && bigWinShare >= 0.6;
  let verdict;
  if (paired.length < MIN_N) verdict = `directional (n=${paired.length} < ${MIN_N}) — no lane decision`;
  else if (!checks.noise_floor_below_margin) verdict = 'engine noise exceeds the margin — no lane decision';
  else if (Object.values(checks).every(Boolean)) verdict = better ? 'cost lane ADOPTED; also the better reader' : 'cost lane ADOPTED';
  else verdict = 'REJECTED';
  // ── PREREGISTRATION-greek-ext-4925.md rules (a)–(c), reported as written, alongside the generic
  // cost-lane verdict above (which is the #4925 step-1 rule and mislabels a 3×-cost arm "cost lane").
  // Invention is given under three definitions because the prereg's literal one ("in neither the
  // reference nor any other engine") is structurally 0 for lite: its temperature-0 repeat vouches for it.
  const invOf = (e, f) => median(paired.map(p => p.engines?.[e]?.[f]).filter(x => typeof x === 'number'));
  const invention3 = Object.fromEntries(['invention', 'invention_indep', 'invention_ref'].map(f => [f, { [ENGINE]: r3(invOf(ENGINE, f)), [REF]: r3(invOf(REF, f)) }]));
  const refMed = median(paired.map(p => cerOf(p, REF))), cataShare = paired.length ? cata(REF) / paired.length : null;
  const decidable = paired.length >= MIN_N;
  const leq = f => invOf(ENGINE, f) != null && invOf(REF, f) != null && invOf(ENGINE, f) <= invOf(REF, f);
  const bCore = p_sign != null && p_sign < 0.05 && wins > losses && medD <= -0.01 && ci && ci[1] < 0 && cata(ENGINE) <= cata(REF);
  const cCore = p_sign != null && p_sign < 0.05 && wins > losses && bigWinShare >= 0.6 && cata(ENGINE) <= cata(REF);
  const prereg = {
    decidable, note: decidable ? null : `directional (n=${paired.length} < ${MIN_N}) — rule (e): no routing decision`,
    a_lite: refMed == null ? null : (refMed <= 0.05 && cataShare <= 0.05 ? 'adequate' : (refMed > 0.10 || cataShare > 0.15 ? 'inadequate' : 'degraded')),
    b_preferred_over_lite: { core: !!bCore, with_invention_literal: !!(bCore && leq('invention')), with_invention_indep: !!(bCore && leq('invention_indep')), with_invention_ref: !!(bCore && leq('invention_ref')) },
    c_better_reader: { core: !!cCore, share_le_minus_005: r3(bigWinShare), with_invention_indep: !!(cCore && leq('invention_indep')), with_invention_ref: !!(cCore && leq('invention_ref')) },
    d_noise_floor: { median_delta0: r3(medD0), repeat_pages_identical: withRepeat.filter(p => Math.abs(cerOf(p, REPEAT) - cerOf(p, REF)) < 1e-9).length, n: withRepeat.length, caveat: 'arms run at temperature 0: Δ₀ measures API nondeterminism only, so this check cannot fail by design' },
  };
  result.classes[c] = {
    prereg, invention_three_ways: invention3,
    n_pages: inClass.length, n_referenced: referenced.length, n_paired: paired.length, n_by_stratum: Object.fromEntries(STRATA.map(s => [s, paired.filter(p => p.stratum === s).length])),
    median_cer: { [ENGINE]: r3(median(paired.map(p => cerOf(p, ENGINE)))), [REF]: r3(median(paired.map(p => cerOf(p, REF)))), [REPEAT]: r3(median(withRepeat.map(p => cerOf(p, REPEAT)))) },
    // the reference engine's own median with its interval — the Greek prereg's rule (a), "is lite good enough", reads this
    ref_median_cer_ci95: bootstrapMedianCI(paired.map(p => cerOf(p, REF))),
    delta: { median: r3(medD), ci95: ci, wins, losses, ties, untied, p_sign: r3(p_sign), share_le_minus_005: r3(bigWinShare) },
    noise_floor: { n: withRepeat.length, median_delta0: r3(medD0), ci95: bootstrapMedianCI(deltas0) },
    catastrophic: { [ENGINE]: cata(ENGINE), [REF]: cata(REF) },
    invention_median: { [ENGINE]: r3(inv(ENGINE)), [REF]: r3(inv(REF)) },
    loops: { [ENGINE]: loops(ENGINE), [REF]: loops(REF) },
    checks, better_reader: better, verdict,
  };
}

// markdown
console.log(`Cost-lane decision — ${ENGINE} vs ${REF} (noise floor ${REPEAT}); strata ${STRATA.join(', ')}; rule: median Δ ≤ +${MARGIN}, CI-upper ≤ +${CI_MAX}, |Δ₀| < ${NOISE}, n ≥ ${MIN_N}\n`);
console.log(`| class | ref pages (by stratum) | median CER ${ENGINE} / ${REF} | median Δ [95 % CI] | W/L/T (p) | Δ ≤ −0.05 share | noise Δ₀ | catastrophic | invention | loops | verdict |`);
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const [c, v] of Object.entries(result.classes)) {
  const bs = Object.entries(v.n_by_stratum).map(([s, n]) => `${s} ${n}`).join(' + ');
  console.log(`| ${c} | ${v.n_paired} (${bs}) | ${v.median_cer[ENGINE] ?? '—'} / ${v.median_cer[REF] ?? '—'} | ${v.delta.median ?? '—'} [${v.delta.ci95 ? v.delta.ci95.join(', ') : '—'}] | ${v.delta.wins}/${v.delta.losses}/${v.delta.ties} (${v.delta.p_sign ?? '—'}) | ${v.delta.share_le_minus_005 ?? '—'} | ${v.noise_floor.median_delta0 ?? '—'} (n=${v.noise_floor.n}) | ${v.catastrophic[ENGINE]} vs ${v.catastrophic[REF]} | ${v.invention_median[ENGINE] ?? '—'} vs ${v.invention_median[REF] ?? '—'} | ${v.loops[ENGINE]} vs ${v.loops[REF]} | ${v.verdict} |`);
}
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(result, null, 2)); console.log(`\nwrote ${OUT}`); }
