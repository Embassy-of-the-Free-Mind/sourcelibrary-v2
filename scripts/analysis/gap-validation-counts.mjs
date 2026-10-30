#!/usr/bin/env node
/**
 * Absolute counts, Source Library's share, and a pace with catalogue capture,
 * from the n=1000 translation-gap validation (#7778, on #2684).
 *
 * PRIOR ART: scripts/analysis/gap-validation-estimate.mjs — gives only RATES over the
 * 1480–1620 window; this reuses its strata, weights, era classes and bootstrap and adds
 * counts, the SL comparison and the pace. gap-validation-score.mjs — its consensus rows
 * are the "paper" variant here, unchanged.
 *
 * Three variants, so every figure carries the instrument spread:
 *   paper   — the published consensus (gap-validation-n250-results.json rows).
 *   strict  — the same consensus, but a "translated" verdict whose relationship is
 *             `partial` counts as untranslated. The paper's rule says partial renderings
 *             do not count; score.mjs toBinary counts them (11 of the 32 Renaissance
 *             works the matcher missed rest on a Gemini `partial` alone).
 *   sonnet  — Claude Sonnet alone on all 1000 (#7691), its own eras.
 *
 * Two denominators:
 *   window  — clusters first printed 1480–1620 (165,481), where the sample was drawn.
 *   full    — all 366,205 Latin clusters printed 1400–1700. EXTRAPOLATED: the window's
 *             per-stratum rates and era shares applied to the full pools (9,830 matched /
 *             356,375 unmatched). Outside the window the era mix differs (more medieval
 *             incunabula before 1480, more early-modern after 1620).
 *
 * Pace: the sample itself dates each translated work's first English translation
 * (eval-data/gap-validation-translation-years.json). Works whose first translation
 * appeared 1980–2025, weighted to the population and divided by 46 years, give first
 * translations per year with no catalogue in the loop. Capture = the share of those
 * the matcher found (pipeline-translated stratum), i.e. what a catalogue-based count sees.
 *
 * Reads:  eval-data/gap-validation-n250-{results,frame}.json, -gemini/-claude/-sonnet/
 *         -tiebreak verdicts, -translation-years.json
 * Writes: eval-data/gap-validation-counts.json
 * Usage:  node scripts/analysis/gap-validation-counts.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dir, 'eval-data');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(EVAL, f), 'utf8'));
const rdl = (f) => fs.readFileSync(path.join(EVAL, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

// --- inputs ---------------------------------------------------------------
const frame = rd('gap-validation-n250-frame.json');
const results = rd('gap-validation-n250-results.json');
const YEARS = rd('gap-validation-translation-years.json').years;
const FRAME = new Map(frame.works.map((w) => [w.key, w]));
// clustering audit (gap-validation-cluster-audit.mjs): k = clusters holding this work (a floor),
// m = distinct works inside the cluster. Absent rows count as k=1, m=1.
// flash-lite judged all 1000; Sonnet judged 131 before the box's Claude account hit its pace guard
// (agreement on the overlap is reported in the paper).
const AUDIT_FILE = 'gap-validation-cluster-audit-flash-lite.jsonl';
const AUDIT = new Map();
if (fs.existsSync(path.join(EVAL, AUDIT_FILE)))
  for (const r of rdl(AUDIT_FILE)) if (!r.fail) AUDIT.set(r.key, { k: 1 + (r.same_work_groups || []).length, m: Math.max(1, r.member_works || 1) });
const EDITIONS = { window: 238696, full: 499507 };   // editions in the window's clusters / in all clusters (ustc-latin-editions.jsonl, 2026-10-29)
const lastGood = (rows) => { const m = new Map(); for (const v of rows) if (v.translation_verdict !== 'FAIL' || !m.has(v.key)) m.set(v.key, v); return m; };
const gem = lastGood(rdl('gap-validation-gemini-verdicts.jsonl'));
const cla = lastGood(rdl('gap-validation-claude-verdicts.jsonl'));
const son = lastGood(rdl('gap-validation-sonnet-verdicts.jsonl'));
const tie = new Map(rdl('gap-validation-tiebreak-verdicts.jsonl').map((r) => [r.key, r]));

const POOL = {  // clusters
  window: { T: frame.pool_sizes.translated, G: frame.pool_sizes.gap },   // 6,744 / 158,737
  full: { T: 9830, G: 366205 - 9830 },                                   // phase 03, #7751
};
const SL = { readable: 6420, sl_first: 5766, readable_works: 5234, sl_first_works: 4837 };   // #7751: cluster table; phase-11 work table
const FT_NOT_FIRST = { k: 83, n: 462 };   // ft-first-translation-paper.md §5.1: ~18% of 462 badged firsts have a real prior
const RECENT = [1980, 2025];
const B = 5000;

// --- binaries -------------------------------------------------------------
const eraClass = (e) => (e === 'antiquity' || e === 'medieval') ? 'ancmed' : (e === 'renaissance_early_modern' ? 'ren' : 'unk');
const binLenient = (v) => !v || v.relationship === 'container' ? null
  : v.translation_verdict === 'translated' ? true : v.translation_verdict === 'untranslated' ? false : null;
const binStrict = (v) => { const b = binLenient(v); return b === true && v.relationship === 'partial' ? false : b; };
const tieBin = (v) => { if (!v || v.relationship === 'container') return null; if (v.complete_prior_exists != null) return v.complete_prior_exists; return binLenient(v); };

function consensusRows(bin) {
  return results.rows.map((r) => {
    const c = bin(cla.get(r.key)), g = bin(gem.get(r.key));
    let cons;
    if (c != null && g != null) cons = c === g ? c : tieBin(tie.get(r.key));
    else cons = c ?? g ?? null;
    return { key: r.key, label: r.label, era: eraClass(r.era), trans: cons };
  });
}
const VARIANTS = {
  paper: results.rows.map((r) => ({ key: r.key, label: r.label, era: eraClass(r.era), trans: r.consensus })),
  strict: consensusRows(binStrict),
  sonnet: [...son.values()].map((v) => ({ key: v.key, label: v.key.startsWith('T') ? 'translated' : 'gap', era: eraClass(v.composition_era), trans: binLenient(v) })),
};

// year of first English translation for a translated row
function priorYear(key) {
  if (YEARS[key]) return YEARS[key];
  const txt = [gem.get(key), cla.get(key), son.get(key), tie.get(key)].filter((v) => v && v.translation_verdict === 'translated' || v?.complete_prior_exists).map((v) => v.prior || '').join(' ');
  const ys = [...txt.matchAll(/\b(1[4-9]\d\d|20[0-2]\d)\b/g)].map((m) => +m[1]).filter((y) => y >= 1475 && y <= 2026);
  return ys.length ? Math.min(...ys) : null;
}

// --- one estimate from resampled strata -------------------------------------
function estimate(T, G) {
  const out = {};
  const mean = (arr, f) => arr.length ? arr.reduce((a, x) => a + f(x), 0) / arr.length : 0;
  const share = (arr, pred) => arr.length ? arr.filter(pred).length / arr.length : 0;
  for (const [den, pool] of Object.entries(POOL)) {
    const N = pool.T + pool.G;
    const cnt = (pred) => pool.T * share(T, pred) + pool.G * share(G, pred);   // population count of rows matching pred
    const ren = cnt((x) => x.era === 'ren');
    const renTr = cnt((x) => x.era === 'ren' && x.trans);
    const allTr = cnt((x) => x.trans);
    const isRecent = (x) => x.year != null && x.year >= RECENT[0] && x.year <= RECENT[1];
    const recentRen = cnt((x) => x.era === 'ren' && x.trans && isRecent(x));
    const recentRenMatched = pool.T * share(T, (x) => x.era === 'ren' && x.trans && isRecent(x));
    const years = RECENT[1] - RECENT[0] + 1;
    const pace = recentRen / years;
    out[den] = {
      clusters: N,
      ren_composed: ren,
      ren_share: ren / N,
      translated_all: allTr,
      translated_all_share: allTr / N,
      translated_ren: renTr,
      translated_ren_share: ren ? renTr / ren : null,
      untranslated_ren: ren - renTr,
      capture_ren: renTr ? (pool.T * share(T, (x) => x.era === 'ren' && x.trans)) / renTr : null,
      recent_ren_first_translations_per_year: pace,
      capture_ren_recent: recentRen ? recentRenMatched / recentRen : null,
      years_to_finish_ren: pace ? (ren - renTr) / pace : null,
    };
    // (b) edition level: each sampled cluster weighted by its edition count, so the share does not
    // depend on how editions were grouped (only on the adjudicated work, which is per text)
    const ed = (pred) => pool.T * mean(T, (x) => pred(x) ? x.ned : 0) + pool.G * mean(G, (x) => pred(x) ? x.ned : 0);
    const edAll = ed(() => true), edRen = ed((x) => x.era === 'ren');
    Object.assign(out[den], {
      editions_model: edAll,
      editions_translated_share: ed((x) => x.trans) / edAll,
      editions_ren_translated_share: edRen ? ed((x) => x.era === 'ren' && x.trans) / edRen : null,
    });
    // (a) clustering-corrected works: a cluster is m/k works (m works inside it, its work spread
    // over k clusters); a translated cluster is 1/k translated works
    const wk = (f) => pool.T * mean(T, f) + pool.G * mean(G, f);
    const works = wk((x) => x.m / x.k), worksRen = wk((x) => x.era === 'ren' ? x.m / x.k : 0);
    const worksNoMerge = wk((x) => 1 / x.k);   // flash-lite over-calls over-merge (13 vs Sonnet's 2 of 131)
    const worksTr = wk((x) => x.trans ? 1 / x.k : 0), worksRenTr = wk((x) => x.era === 'ren' && x.trans ? 1 / x.k : 0);
    const paceW = wk((x) => x.era === 'ren' && x.trans && x.year >= RECENT[0] && x.year <= RECENT[1] ? 1 / x.k : 0) / (RECENT[1] - RECENT[0] + 1);
    Object.assign(out[den], {
      years_to_finish_ren_works: paceW ? (worksRen - worksRenTr) / paceW : null,
      works_corrected: works, works_corrected_no_overmerge: worksNoMerge, works_translated: worksTr, works_translated_share: worksTr / works,
      works_translated_share_no_overmerge: worksTr / worksNoMerge,
      works_ren: worksRen, works_ren_translated: worksRenTr, works_ren_translated_share: worksRen ? worksRenTr / worksRen : null,
      // pace and years-to-finish in WORK units: a first translation of a work spread over k clusters is one event
      recent_ren_first_translations_per_year_works: wk((x) => x.era === 'ren' && x.trans && x.year >= RECENT[0] && x.year <= RECENT[1] ? 1 / x.k : 0) / (RECENT[1] - RECENT[0] + 1),
      over_merge_rate: wk((x) => x.m > 1 ? 1 : 0) / N, split_rate: wk((x) => x.k > 1 ? 1 : 0) / N,
      mean_k_translated: wk((x) => x.trans ? x.k : 0) / wk((x) => x.trans ? 1 : 0),
      mean_k_untranslated: wk((x) => !x.trans ? x.k : 0) / wk((x) => !x.trans ? 1 : 0),
    });
  }
  // SL against the validated prior total (full denominator: #7751 counts are over all 366,205 clusters)
  const missAll = share(G, (x) => x.trans);
  out.sl = {
    readable_share_of_prior: SL.readable / out.full.translated_all,
    readable_works_share_of_prior_works: SL.readable_works / out.full.works_translated,
    sl_first_expected_with_uncatalogued_translation: SL.sl_first * missAll,
    gap_stratum_missed_rate: missAll,
  };
  return out;
}

const resample = (a) => a.map(() => a[(Math.random() * a.length) | 0]);
const q = (s, p) => s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))];
function walk(obj, f, pre = '') { for (const [k, v] of Object.entries(obj)) { if (v && typeof v === 'object') walk(v, f, pre + k + '.'); else f(pre + k, v); } }
function setPath(o, p, v) { const ks = p.split('.'); let c = o; for (const k of ks.slice(0, -1)) c = c[k] ??= {}; c[ks.at(-1)] = v; }

const out = { generated: new Date().toISOString().slice(0, 10), recent_window: RECENT, pools: POOL, editions_counted: EDITIONS, audited_clusters: AUDIT.size, sl_inputs: SL, variants: {} };
for (const [name, rows] of Object.entries(VARIANTS)) {
  const wp = rows.filter((r) => r.trans === true || r.trans === false).map((r) => ({ ...r, year: r.trans ? priorYear(r.key) : null,
    ned: FRAME.get(r.key).n_editions, k: AUDIT.get(r.key)?.k ?? 1, m: AUDIT.get(r.key)?.m ?? 1, audited: AUDIT.has(r.key) }));
  const T = wp.filter((r) => r.label === 'translated'), G = wp.filter((r) => r.label === 'gap');
  const point = estimate(T, G);
  const draws = {};
  for (let b = 0; b < B; b++) walk(estimate(resample(T), resample(G)), (k, v) => { if (v != null && Number.isFinite(v)) (draws[k] ??= []).push(v); });
  const res = {};
  walk(point, (k, v) => {
    const s = (draws[k] || []).sort((a, b) => a - b);
    setPath(res, k, v == null ? null : { point: +v.toFixed(4), lo: s.length ? +q(s, 0.025).toFixed(4) : null, hi: s.length ? +q(s, 0.975).toFixed(4) : null });
  });
  const ren = (arr) => arr.filter((x) => x.era === 'ren' && x.trans);
  const recent = (arr) => ren(arr).filter((x) => x.year >= RECENT[0] && x.year <= RECENT[1]);
  res.sample = {
    well_posed: { T: T.length, G: G.length },
    ren_translated: { T: ren(T).length, G: ren(G).length },
    ren_recent_first_translations: { T: recent(T).map((x) => x.key), G: recent(G).map((x) => x.key) },
    ren_years_missing: ren([...T, ...G]).filter((x) => x.year == null).map((x) => x.key),
  };
  out.variants[name] = res;
}
// FT-audit bound for (d): share of SL's badged firsts with a real prior
{
  const { k, n } = FT_NOT_FIRST, z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  out.ft_audit_bound = { rate: { point: +p.toFixed(4), lo: +((c - m) / d).toFixed(4), hi: +((c + m) / d).toFixed(4) },
    sl_first_expected_with_prior: { point: Math.round(SL.sl_first * p), lo: Math.round(SL.sl_first * (c - m) / d), hi: Math.round(SL.sl_first * (c + m) / d) } };
}
fs.writeFileSync(path.join(EVAL, 'gap-validation-counts.json'), JSON.stringify(out, null, 2));

// --- console table ---
const n = (c) => c == null ? 'n/a' : `${Math.round(c.point).toLocaleString()} [${Math.round(c.lo).toLocaleString()}–${Math.round(c.hi).toLocaleString()}]`;
const pc = (c) => c == null ? 'n/a' : `${(100 * c.point).toFixed(1)}% [${(100 * c.lo).toFixed(1)}–${(100 * c.hi).toFixed(1)}]`;
const f1 = (c) => c == null ? 'n/a' : `${c.point.toFixed(1)} [${c.lo.toFixed(1)}–${c.hi.toFixed(1)}]`;
for (const [name, r] of Object.entries(out.variants)) {
  console.log(`\n=== ${name} === well-posed T=${r.sample.well_posed.T} G=${r.sample.well_posed.G}; Renaissance translated T=${r.sample.ren_translated.T} G=${r.sample.ren_translated.G}; recent (${RECENT.join('–')}) T=${r.sample.ren_recent_first_translations.T.length} G=${r.sample.ren_recent_first_translations.G.length}`);
  for (const den of ['window', 'full']) {
    const d = r[den];
    console.log(` ${den}: Renaissance-composed ${n(d.ren_composed)} (${pc(d.ren_share)}); translated all-print ${n(d.translated_all)} (${pc(d.translated_all_share)}); translated Renaissance ${n(d.translated_ren)} (${pc(d.translated_ren_share)}); untranslated Renaissance ${n(d.untranslated_ren)}`);
    console.log(`        editions: translated ${pc(d.editions_translated_share)}, Renaissance ${pc(d.editions_ren_translated_share)} (model total ${n(d.editions_model)} vs ${EDITIONS[den].toLocaleString()} counted)`);
    console.log(`        works (clustering-corrected): ${n(d.works_corrected)} (no over-merge ${n(d.works_corrected_no_overmerge)}, translated share ${pc(d.works_translated_share_no_overmerge)}); translated ${n(d.works_translated)} (${pc(d.works_translated_share)}); Renaissance ${n(d.works_ren)}, translated ${n(d.works_ren_translated)} (${pc(d.works_ren_translated_share)}); over-merge ${pc(d.over_merge_rate)}, split ${pc(d.split_rate)}, mean k translated ${f1(d.mean_k_translated)} vs untranslated ${f1(d.mean_k_untranslated)}`);
    console.log(`        capture (Renaissance, matcher) ${pc(d.capture_ren)}; recent capture ${pc(d.capture_ren_recent)}; first translations/yr ${f1(d.recent_ren_first_translations_per_year)}; years to finish ${n(d.years_to_finish_ren)}; in works: ${f1(d.recent_ren_first_translations_per_year_works)}/yr, ${n(d.years_to_finish_ren_works)} years`);
  }
  console.log(` SL readable / validated prior: ${pc(r.sl.readable_share_of_prior)} (work units: ${SL.readable_works} / corrected translated works ${pc(r.sl.readable_works_share_of_prior_works)}); SL-first with an uncatalogued translation: ${n(r.sl.sl_first_expected_with_uncatalogued_translation)} (miss rate ${pc(r.sl.gap_stratum_missed_rate)})`);
}
const fb = out.ft_audit_bound;
console.log(`\nFT-audit bound: ${(100 * fb.rate.point).toFixed(1)}% [${(100 * fb.rate.lo).toFixed(1)}–${(100 * fb.rate.hi).toFixed(1)}] → ${fb.sl_first_expected_with_prior.point} [${fb.sl_first_expected_with_prior.lo}–${fb.sl_first_expected_with_prior.hi}] of ${SL.sl_first}`);
console.log('\nwrote eval-data/gap-validation-counts.json');
