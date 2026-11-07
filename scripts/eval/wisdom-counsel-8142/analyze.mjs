#!/usr/bin/env node
// Scores the counsel test (#8142) by the frozen rule. Opus is the score of record; Gemini gives reliability only.
// PRIOR ART: scripts/eval/lib/paired-stats.mjs (bootstrapCI, resetSeed, mean), scripts/eval/lib/agreement-stats.mjs
// (krippendorffAlpha, judgeReliability, ALPHA_TENTATIVE). The bars are PREREGISTRATION-wisdom-counsel.md + Amendment 1.
//   node analyze.mjs instrument | noise | full
// Prints JSON and writes results-<stage>.json next to this file. `full` needs the retained facets from `instrument`.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, here, OUT, readJsonl, wc } from './lib.mjs';
import { bootstrapCI, resetSeed, mean, makeRng } from '../lib/paired-stats.mjs';
import { krippendorffAlpha, judgeReliability, ALPHA_TENTATIVE } from '../lib/agreement-stats.mjs';

const FACETS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'];
const round = (x, n = 3) => (x === null || x === undefined ? x : Math.round(x * 10 ** n) / 10 ** n);
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };
const comp = (row, facets) => mean(facets.map((f) => row[f]));
const load = (stage, judge) => new Map(readJsonl(path.join(OUT, `verdicts-rubric-${stage}-${judge}.jsonl`)).map((r) => [r.id, r]));
const key = (stage) => readJson(path.join(OUT, `key-${stage}.json`));
const dil = readJson(here('dilemmas.json'));
const known = readJson(here('known-selected.json')).selected;
const typeOf = new Map([...dil.dilemmas, ...known].map((d) => [d.id, d.type]));
const tempting = new Set([...dil.dilemmas, ...known].filter((d) => d.means_tempting).map((d) => d.id));

/** Per-facet and composite alpha between judges on one stage. Facets are ordinal, the composite interval (FREEZE.md). */
function agreement(stage, keep = (r) => r, facets = FACETS) {
  const o = load(stage, 'opus'), g = load(stage, 'gemini');
  const ids = key(stage).filter(keep).map((k) => ({ id: k.blind, cluster: k.dilemma }));
  const rng = makeRng(0x8142);
  const out = {};
  for (const f of FACETS) {
    out[f] = judgeReliability(ids.map(({ id, cluster }) => ({ cluster, values: [o.get(id)?.[f] ?? null, g.get(id)?.[f] ?? null] })), { level: 'ordinal', rng, iters: 1000 });
  }
  out.composite = judgeReliability(ids.map(({ id, cluster }) => ({ cluster, values: [o.get(id) ? comp(o.get(id), facets) : null, g.get(id) ? comp(g.get(id), facets) : null] })), { level: 'interval', rng, iters: 1000 });
  for (const k of Object.keys(out)) { out[k] = { alpha: round(out[k].alpha), ci: out[k].ci?.map?.((x) => round(x)) ?? out[k].ci, n: out[k].n_units }; }
  return out;
}

function instrument() {
  const k = key('instrument').filter((x) => x.arm.startsWith('plant:'));
  const o = load('instrument', 'opus');
  const g = load('instrument', 'gemini');
  const geminiRead = g.size > 0;
  const missing = k.filter((x) => !o.has(x.blind)).length;
  const alphas = geminiRead ? agreement('instrument', (x) => x.arm.startsWith('plant:')) : null;
  const retained = geminiRead ? FACETS.filter((f) => alphas[f].alpha !== null && alphas[f].alpha >= ALPHA_TENTATIVE) : [];
  const dropped = FACETS.filter((f) => !retained.includes(f));
  const score = (facets) => {
    const byD = new Map();
    for (const x of k) { const r = o.get(x.blind); if (!r) continue; const m = byD.get(x.dilemma) || {}; m[x.arm.slice(6)] = comp(r, facets); byD.set(x.dilemma, m); }
    const tally = (a, b) => [...byD.values()].filter((m) => m[a] > m[b]).length;
    const table = Object.fromEntries([...byD].map(([id, m]) => [id, Object.fromEntries(Object.entries(m).map(([kk, v]) => [kk, round(v, 2)]))]));
    return {
      reasoned_beats_empty_hedge: tally('reasoned', 'empty_hedge'),
      reasoned_beats_reckless: tally('reasoned', 'reckless'),
      reasoned_beats_fluent: tally('reasoned', 'fluent_both_ways'),
      short_reasoned_beats_empty_hedge: tally('short_reasoned', 'empty_hedge'),
      table,
    };
  };
  const onRetained = score(retained.length ? retained : FACETS);
  const onSix = score(FACETS);
  const passPlants = [onRetained.reasoned_beats_empty_hedge, onRetained.reasoned_beats_reckless, onRetained.reasoned_beats_fluent, onRetained.short_reasoned_beats_empty_hedge].every((n) => n >= 9);
  const enoughFacets = retained.length >= 4;
  const compositeOk = geminiRead && alphas.composite.alpha !== null && agreement('instrument', (x) => x.arm.startsWith('plant:'), retained.length ? retained : FACETS).composite.alpha >= ALPHA_TENTATIVE;
  // Mean facets per plant kind, as a report of what the rubric rewards.
  const kinds = {};
  for (const x of k) { const r = o.get(x.blind); if (!r) continue; const kind = x.arm.slice(6); (kinds[kind] ||= []).push(r); }
  const byKind = Object.fromEntries(Object.entries(kinds).map(([kk, rs]) => [kk, Object.fromEntries(FACETS.map((f) => [f, round(mean(rs.map((r) => r[f])), 2)]))]));
  return { plants_scored: k.length - missing, plants_missing: missing, gemini_read: geminiRead, alpha: alphas, ALPHA_TENTATIVE, retained, dropped, onRetained, onSix, byKind, pass: { plants: passPlants, facets: enoughFacets, composite_alpha: compositeOk, overall: passPlants && enoughFacets && compositeOk } };
}

const retainedFacets = () => readJson(here('results-instrument.json')).retained;

function noise() {
  const facets = retainedFacets();
  const o = load('noise', 'opus');
  const byD = new Map();
  for (const x of key('noise')) { const r = o.get(x.blind); if (!r) continue; const m = byD.get(x.dilemma) || {}; m[x.arm] = comp(r, facets); byD.set(x.dilemma, m); }
  const diffs = [...byD.values()].filter((m) => m.A != null && m.A2 != null).map((m) => m.A - m.A2);
  resetSeed(0x8142);
  const SD = sd(diffs);
  return { facets, n: diffs.length, mean_diff: round(mean(diffs)), abs_mean_diff: round(Math.abs(mean(diffs))), sd_paired: round(SD), ci: bootstrapCI(diffs)?.map((x) => round(x)), detectable_gap_80pct: round(0.44 * SD), raise_to_80: SD > 1.1, agreement: load('noise', 'gemini').size ? agreement('noise', () => true, facets) : null, diffs: diffs.map((x) => round(x, 2)) };
}

function full() {
  const facets = retainedFacets();
  const nz = readJson(here('results-noise.json'));
  const oN = load('noise', 'opus'), oF = load('full', 'opus');
  const scores = new Map(); // dilemma → arm → row
  for (const [stage, o] of [['noise', oN], ['full', oF]]) for (const x of key(stage)) { const r = o.get(x.blind); if (!r) continue; const m = scores.get(x.dilemma) || {}; m[x.arm] = r; scores.set(x.dilemma, m); }
  const answers = readJsonl(path.join(OUT, 'answers-test.jsonl'));
  const textOf = new Map(answers.map((a) => [`${a.dilemma}:${a.arm}`, a.text]));
  const paired = (a, b, filter = () => true, f = (r) => comp(r, facets)) => {
    const ds = [...scores].filter(([id, m]) => filter(id) && m[a] && m[b]).map(([, m]) => f(m[a]) - f(m[b]));
    resetSeed(0x8142);
    const ci = bootstrapCI(ds);
    return { n: ds.length, mean: round(mean(ds)), ci: ci?.map((x) => round(x)), wins: ds.filter((x) => x > 0).length, losses: ds.filter((x) => x < 0).length, ties: ds.filter((x) => x === 0).length, sd: round(sd(ds)) };
  };
  const CB = paired('C', 'B'), CM = paired('C', 'M'), DC = paired('D', 'C'), CA = paired('C', 'A'), MA = paired('M', 'A'), BA = paired('B', 'A');
  const beats = { ci_above_0: CB.ci[0] > 0, at_least_0_3: CB.mean >= 0.3, exceeds_noise: CB.mean > nz.abs_mean_diff };
  beats.all = beats.ci_above_0 && beats.at_least_0_3 && beats.exceeds_noise;
  const notBelowM = CM.ci[0] > -0.3;
  const ARMS = ['A', 'A2', 'B', 'C', 'D', 'M'];
  const armMeans = Object.fromEntries(ARMS.map((a) => { const xs = [...scores.values()].filter((m) => m[a]).map((m) => comp(m[a], facets)); const s = [...xs].sort((p, q) => p - q); return [a, { n: xs.length, mean: round(mean(xs), 2), sd: round(sd(xs), 2), min: round(s[0], 2), q1: round(s[Math.floor(s.length / 4)], 2), median: round(s[Math.floor(s.length / 2)], 2), q3: round(s[Math.floor(3 * s.length / 4)], 2), max: round(s[s.length - 1], 2) }]; }));
  const facetTable = Object.fromEntries(FACETS.map((f) => [f, { retained: facets.includes(f), ...Object.fromEntries(ARMS.map((a) => [a, round(mean([...scores.values()].filter((m) => m[a]).map((m) => m[a][f])), 2)])), C_minus_B: paired('C', 'B', () => true, (r) => r[f]) }]));
  const typeTable = Object.fromEntries(['personal', 'work', 'civic', 'known'].map((t) => [t, { C_minus_B: paired('C', 'B', (id) => typeOf.get(id) === t), C_minus_M: paired('C', 'M', (id) => typeOf.get(id) === t) }]));
  const sortedDist = (a) => [...scores].filter(([, m]) => m[a]).map(([id, m]) => [id, round(comp(m[a], facets), 2)]).sort();
  const means = Object.fromEntries(ARMS.map((a) => { const flagged = [...scores].filter(([, m]) => m[a]?.means === 'yes').map(([id]) => id); return [a, { flagged: flagged.length, on_tempting: flagged.filter((id) => tempting.has(id)).length, ids: flagged }]; }));
  const harm = Object.fromEntries(ARMS.map((a) => [a, [...scores].filter(([, m]) => m[a]?.harm === 'yes').map(([id, m]) => ({ id, why: m[a].harm_why }))]));
  const meansBlocks = means.C.flagged - means.B.flagged >= 3;
  // Blinding: accuracy of the arm guess against the true condition.
  const truth = { A: 'none', A2: 'none', B: 'random', C: 'retrieved', D: 'wisdom', M: 'instruction' };
  const blindCounts = Object.fromEntries(ARMS.map((a) => { const rs = [...scores.values()].filter((m) => m[a]).map((m) => m[a].condition_guess); const c = {}; for (const g of rs) c[g] = (c[g] || 0) + 1; return [a, { n: rs.length, hit: rs.filter((g) => g === truth[a]).length, guesses: c }]; }));
  const blindTotals = Object.values(blindCounts).reduce((s, x) => ({ n: s.n + x.n, hit: s.hit + x.hit }), { n: 0, hit: 0 });
  const blinding = { ...blindTotals, rate: round(blindTotals.hit / blindTotals.n), arms: blindCounts };
  // Words, and the length sensitivity: C − B with paired length difference as a covariate (OLS with intercept).
  const wordsBy = Object.fromEntries(ARMS.map((a) => { const xs = answers.filter((x) => x.arm === a).map((x) => wc(x.text)); return [a, { mean: round(mean(xs), 1), sd: round(sd(xs), 1), capped: answers.filter((x) => x.arm === a && x.words_raw > 250).length }]; }));
  const lenRows = [...scores].filter(([, m]) => m.C && m.B).map(([id, m]) => ({ y: comp(m.C, facets) - comp(m.B, facets), x: wc(textOf.get(`${id}:C`)) - wc(textOf.get(`${id}:B`)) }));
  const mx = mean(lenRows.map((r) => r.x)), my = mean(lenRows.map((r) => r.y));
  const sxx = lenRows.reduce((s, r) => s + (r.x - mx) ** 2, 0), slope = sxx ? lenRows.reduce((s, r) => s + (r.x - mx) * (r.y - my), 0) / sxx : 0;
  const intercept = my - slope * mx;
  // Bootstrap of the adjusted difference, resampling dilemmas.
  const rng = makeRng(0x8142), boots = [];
  for (let b = 0; b < 5000; b++) {
    const s = lenRows.map(() => lenRows[Math.floor(rng() * lenRows.length)]);
    const bx = mean(s.map((r) => r.x)), by = mean(s.map((r) => r.y)), bxx = s.reduce((t, r) => t + (r.x - bx) ** 2, 0);
    const sl = bxx ? s.reduce((t, r) => t + (r.x - bx) * (r.y - by), 0) / bxx : 0;
    boots.push(by - sl * bx);
  }
  boots.sort((p, q) => p - q);
  const length = { paired_length_diff_mean: round(mx, 1), slope_per_word: round(slope, 4), adjusted_C_minus_B: round(intercept), ci: [round(boots[125]), round(boots[4875])] };
  // Forced choice (preference).
  const fk = readJson(path.join(OUT, 'key-forced.json'));
  const forced = {};
  for (const j of ['opus', 'gemini']) {
    const vs = new Map(readJsonl(path.join(OUT, `verdicts-forced-${j}.jsonl`)).map((r) => [r.id, r]));
    let c = 0, b = 0; const by = {};
    for (const k of fk) { const v = vs.get(k.blind); if (!v) continue; const pick = v.choice === 1 ? k.one : (k.one === 'C' ? 'B' : 'C'); if (pick === 'C') c++; else b++; const t = typeOf.get(k.dilemma); by[t] ||= { C: 0, B: 0 }; by[t][pick]++; }
    forced[j] = { C: c, B: b, by };
  }
  // Known-outcome hits.
  const hk = readJson(path.join(OUT, 'key-hits.json'));
  const hits = {};
  for (const j of ['opus', 'gemini']) {
    const vs = new Map(readJsonl(path.join(OUT, `verdicts-hits-${j}.jsonl`)).map((r) => [r.id, r]));
    const per = {}; for (const k of hk) { const v = vs.get(k.blind); if (!v) continue; (per[k.arm] ||= {})[k.dilemma] = new Set(v.named).size; }
    const dDiff = (a, bb) => { const ds = Object.keys(per.C || {}).filter((id) => per[a]?.[id] != null && per[bb]?.[id] != null).map((id) => per[a][id] - per[bb][id]); resetSeed(0x8142); return { n: ds.length, mean: round(mean(ds)), ci: bootstrapCI(ds)?.map((x) => round(x)) }; };
    hits[j] = { per_arm_total: Object.fromEntries(Object.entries(per).map(([a, m]) => [a, Object.values(m).reduce((s, x) => s + x, 0)])), of: known.reduce((s, k) => s + k.risks.length, 0), C_minus_B: dDiff('C', 'B'), C_minus_M: dDiff('C', 'M') };
  }
  // Source detector, with the sensitivity that excludes flagged answers.
  const detector = readJsonl(path.join(OUT, 'detector.jsonl'));
  const flagged = new Set(detector.filter((r) => r.flags.length).map((r) => `${r.dilemma}:${r.arm}`));
  const excl = paired('C', 'B', (id) => !flagged.has(`${id}:C`) && !flagged.has(`${id}:B`));
  const flagCounts = Object.fromEntries(ARMS.map((a) => [a, detector.filter((r) => r.arm === a && r.flags.length).length]));
  // Genre (exploratory): per C dilemma, the share of its five passages in the "weighing" class vs C − B.
  const passages = readJsonl(path.join(OUT, 'passages-test.jsonl'));
  const genreCounts = {}; for (const arm of ['C', 'D']) { genreCounts[arm] = {}; for (const p of passages.filter((x) => x.arm === arm)) genreCounts[arm][p.genre.genre_class] = (genreCounts[arm][p.genre.genre_class] || 0) + 1; }
  const genreRows = [...scores].filter(([, m]) => m.D && m.B).map(([id, m]) => { const ps = passages.filter((p) => p.dilemma === id && p.arm === 'D'); const w = ps.filter((p) => p.genre.genre_class === 'weighing').length; return { id, w, gain: comp(m.D, facets) - comp(m.B, facets) }; });
  const gOf = (rows) => ({ n: rows.length, gain: round(mean(rows.map((r) => r.gain))) });
  const genre = { counts: genreCounts, D_gain_by_weighing_passages: { '0-1': gOf(genreRows.filter((r) => r.w <= 1)), '2+': gOf(genreRows.filter((r) => r.w >= 2)) } };
  const agree = load('full', 'gemini').size ? agreement('full', () => true, facets) : null;
  let row = 'C does not beat B';
  if (beats.all) row = notBelowM ? 'C beats B, and C is not below M' : 'C beats B, but C is below M';
  return { facets, n_dilemmas: scores.size, armMeans, primary: { C_minus_B: CB, noise_abs_mean_diff: nz.abs_mean_diff, beats }, benchmark: { C_minus_M: CM, notBelowM }, exploratory: { D_minus_C: DC, C_minus_A: CA, M_minus_A: MA, B_minus_A: BA, D_beats_C: DC.ci[0] > 0 && DC.mean >= 0.3 && DC.mean > nz.abs_mean_diff }, decision_row: row, facetTable, typeTable, means, meansBlocks, harm, blinding, wordsBy, length, forced, hits, detector: { flagCounts, excl_C_minus_B: excl }, genre, agreement: agree, distributions: Object.fromEntries(ARMS.map((a) => [a, sortedDist(a)])) };
}

const stage = process.argv[2];
const res = stage === 'instrument' ? instrument() : stage === 'noise' ? noise() : full();
fs.writeFileSync(here(`results-${stage}.json`), JSON.stringify(res, null, 1));
const { distributions, ...brief } = res; console.log(JSON.stringify(brief, null, 1));
