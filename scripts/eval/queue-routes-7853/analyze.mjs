#!/usr/bin/env node
// PRIOR ART: scripts/eval/fraktur-paired-7835/analyze.mjs (pagesOf, paired: exact McNemar, effect with page-bootstrap
// CI, wrong-text pages added/removed, made worse by severity; armBlock's pooled defects per 1,000 words; rankKey and the
// write-back rule; the exportScore records; the router check; restated over this study's five arms and two languages),
// scripts/eval/lib/{paired-stats,agreement-stats}.mjs (exact sign test, Wilson), route-judge-6740 defect-rate.mjs words()
// (#7824's count). New here: Horvitz-Thompson page weights from the PPS draw (every estimate is weighted to the queue's
// owed pages), a stratified bootstrap, Holm over the two primary contrasts, and the accepted-pages-per-agy-call rule.
// Committed before any verdict exists (#7853 preregistration).
/**
 * The preregistered analysis of #7853. Reads OUT; writes results/score.json, results/writeback.json,
 * results/defect-rates.json, results/router-evidence.score.json.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/queue-routes-7853/analyze.mjs score
 *   ... analyze.mjs router     what build.py would decide with the export pooled in (rules.json is not changed)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT, OUT, RESULTS, J, jsonl, sha, SEED, AGY_CALL_USD, wrongText, words7824, ARMS, ROUTES, COST_ORDER, gpuEngine, SEV, wilcoxon } from './lib.mjs';
import { binomTwoSided, makeRng } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';
import { exportScore, PLANT_BAR } from '../lane-judge-sampler.mjs';

const R = (f, x) => { fs.mkdirSync(RESULTS, { recursive: true }); fs.writeFileSync(path.join(RESULTS, f), typeof x === 'string' ? x : JSON.stringify(x, null, 1) + '\n'); };
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const kn = (k, n) => ({ k, n, rate: n ? r3(k / n) : null, wilson95: n ? wilson(k, n).map(r3) : null });
const cnt = (v, s) => (v?.defects || []).filter((d) => d.severity === s).length;
const textOf = (key, arm) => { const f = path.join(OUT, 'texts', `${key}.${arm}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
/** The route arms (the stored text is the reference, not a candidate). */
export const ROUTE_ARMS = Object.freeze(['corr', 'gpu', 'read4', 'read1']);
/** Primary contrasts (German): arm 2 against arm 3, arm 1 against arm 3; exact McNemar, Holm over the two. */
export const PRIMARY = Object.freeze([['read4', 'gpu'], ['read4', 'corr']]);
export const SECONDARY = Object.freeze([['read4', 'read1'], ['corr', 'gpu'], ['lite', 'corr'], ['lite', 'gpu'], ['lite', 'read4'], ['lite', 'read1']]);
/** Decision rule constants (experiment file §Decision rule). */
export const ACCEPT_MARGIN = 0.05, WRONG_TEXT_LINE = 2, TIE_SHARE = 0.10;
const BOOT = 4000;
/** Severity-weighted defects per 1,000 words of the served text (#7824 words()); weights SEV (Amendment 1). */
export const sevRate = (v, words) => (v ? 1000 * Object.entries(SEV).reduce((a, [k, w]) => a + w * cnt(v, k), 0) / Math.max(1, words) : null);

function load() {
  const items = J('items.json'), vo = jsonl(path.join(OUT, 'verdicts-opus.jsonl'));
  const abs = new Map(vo.filter((r) => r.set === 'abs' && r.verdict).map((r) => [r.id, r]));
  return { items, vo, abs };
}
/**
 * Per page: its HT weight and, per arm, the verdict of the text it served, the text, its words and the arm's log row.
 * w = owed / pi with pi = min(1, n_h * owed / M_h): the PPS inclusion probability of the book (the page is uniform in it).
 */
function pagesOf(items, abs) {
  const rows = jsonl(path.join(OUT, 'arms.jsonl')).filter((r) => !r.quota);
  return J('selected.json').selected.map((s) => {
    const pi = Math.min(1, s.stratum_n * s.owed / s.stratum_pages);
    const p = { key: s.key, page_id: s.page_id, book_id: s.book_id, page_number: s.page_number, lang: s.lang, face: s.face, stratum: s.stratum, year: s.year, w: s.owed / pi, arms: {} };
    for (const arm of ARMS) {
      const t = textOf(s.key, arm)?.trim();
      const it = t ? items.find((i) => i.key === s.key && i.text_sha === sha(t).slice(0, 16)) : null;
      const row = rows.filter((r) => r.key === s.key && r.arm === arm && !r.superseded).pop() ?? null;
      p.arms[arm] = t ? { v: it ? abs.get(it.id)?.verdict ?? null : null, at: it ? abs.get(it.id)?.at ?? null : null, item: it?.id ?? null, text: t, words: Math.max(1, words7824(t)), row, same_as_lite: arm !== 'lite' && t === textOf(s.key, 'lite')?.trim() } : { v: null, text: null, words: 0, row, none: true };
    }
    return p;
  });
}
const acc = (x) => !!(x && !x.none && x.v?.accept);
// an arm that ran and served no text counts as judged (not accepted); an arm that did not run is not compared
const judged = (x) => x && ((x.none && x.row) || x.v);
const wt = (x) => !!x?.v && wrongText(x.v);
/** agy calls this arm spent on the page: the read's (or correction's) calls over the pages its calls covered. */
const callsOf = (x) => (x.row && x.row.pages ? x.row.calls / x.row.pages : 0);

/** Stratified bootstrap of a weighted statistic f(pages): pages resampled within their stratum. */
function sboot(ps, f, seed) {
  const by = {}; for (const p of ps) (by[p.stratum] ??= []).push(p);
  const S = Object.values(by), rnd = makeRng(seed), out = [];
  for (let b = 0; b < BOOT; b++) { const s = []; for (const g of S) for (let i = 0; i < g.length; i++) s.push(g[Math.floor(rnd() * g.length)]); out.push(f(s)); }
  const v = out.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? [r3(v[Math.floor(0.025 * v.length)]), r3(v[Math.floor(0.975 * v.length) - 1])] : null;
}
const wmean = (ps, f) => { const W = ps.reduce((a, p) => a + p.w, 0); return W ? ps.reduce((a, p) => a + p.w * f(p), 0) / W : null; };
/** Weighted defects per 1,000 words: sum w*defects / sum w*words. */
const wrate = (ps, arm, sev) => { const g = ps.filter((p) => p.arms[arm].v); const Wd = g.reduce((a, p) => a + p.w * p.arms[arm].words, 0); return Wd ? 1000 * g.reduce((a, p) => a + p.w * cnt(p.arms[arm].v, sev), 0) / Wd : null; };

function armBlock(ps, arm, seed) {
  const n = ps.length, k = ps.filter((p) => acc(p.arms[arm])).length;
  const wAcc = wmean(ps, (p) => (acc(p.arms[arm]) ? 1 : 0)), wCalls = wmean(ps, (p) => callsOf(p.arms[arm]));
  const perCall = (g) => { const a = wmean(g, (p) => (acc(p.arms[arm]) ? 1 : 0)), c = wmean(g, (p) => callsOf(p.arms[arm])); return c ? a / c : null; };
  return { pages: n, served_own_text: ps.filter((p) => !p.arms[arm].none && !p.arms[arm].same_as_lite).length, judged: ps.filter((p) => p.arms[arm].v).length,
    accept: kn(k, n), accept_weighted: r3(wAcc), accept_weighted_ci95: sboot(ps, (g) => wmean(g, (p) => (acc(p.arms[arm]) ? 1 : 0)), seed),
    wrong_text_pages: ps.filter((p) => wt(p.arms[arm])).length, wrong_text_pages_weighted: r3(wmean(ps.filter((p) => p.arms[arm].v), (p) => (wt(p.arms[arm]) ? 1 : 0))),
    defects_per_1000_weighted: { wrong_text: r3(wrate(ps, arm, 'wrong_text')), wrong_text_ci95: sboot(ps, (g) => wrate(g, arm, 'wrong_text'), seed + 1), misleads: r3(wrate(ps, arm, 'misleads')), misleads_ci95: sboot(ps, (g) => wrate(g, arm, 'misleads'), seed + 2) },
    agy_calls_per_page: r3(wCalls), accepted_per_agy_call: wCalls ? r3(wAcc / wCalls) : null, accepted_per_agy_call_ci95: wCalls ? sboot(ps, perCall, seed + 3) : null,
    agy_calls_per_accepted_page: wAcc ? r3(wCalls / wAcc) : null, usd_per_accepted_page: wAcc && wCalls ? +((wCalls * AGY_CALL_USD) / wAcc).toFixed(5) : null,
    // Amendment 1: severity-weighted defects per 1,000 words (per-page rate, HT-weighted mean), fidelity, and the
    // severity removed from the stored text per agy call (the decision rule's measure)
    severity_per_1000: r3(sevMean(ps, arm)), severity_per_1000_ci95: sboot(ps.filter((p) => p.arms[arm].v), (g) => sevMean(g, arm), seed + 4),
    fidelity_mean_weighted: r3(wmean(ps.filter((p) => p.arms[arm].v), (p) => Number(p.arms[arm].v.fidelity))) };
}
/** HT-weighted mean of the per-page severity rate over pages where the arm's text was judged. */
const sevMean = (ps, arm) => wmean(ps.filter((p) => p.arms[arm].v), (p) => sevRate(p.arms[arm].v, p.arms[arm].words));
/** Amendment 1 co-primary: b against a on severity per 1,000 words, paired per page; weighted mean difference, book-cluster (= page) stratified bootstrap CI, Wilcoxon. */
function pairedSev(ps, a, b, seed) {
  const g = ps.filter((p) => p.arms[a].v && p.arms[b].v);
  const d = (p) => sevRate(p.arms[b].v, p.arms[b].words) - sevRate(p.arms[a].v, p.arms[a].words);
  const dm = (s) => wmean(s, d);
  const ds = g.map(d);
  return { n: g.length, mean_diff_weighted: r3(dm(g)), ci95: sboot(g, dm, seed), wilcoxon: wilcoxon(ds), better: ds.filter((x) => x < 0).length, worse: ds.filter((x) => x > 0).length, same: ds.filter((x) => x === 0).length };
}
/** b against a: exact McNemar (unweighted, paired), weighted effect with stratified-bootstrap CI, wrong text, made worse. */
function paired(ps, a, b, seed) {
  const g = ps.filter((p) => judged(p.arms[a]) && judged(p.arms[b]));
  const gained = g.filter((p) => !acc(p.arms[a]) && acc(p.arms[b])).length, lost = g.filter((p) => acc(p.arms[a]) && !acc(p.arms[b])).length;
  const both = g.filter((p) => p.arms[a].v && p.arms[b].v);
  const eff = (s) => wmean(s, (p) => (acc(p.arms[b]) ? 1 : 0) - (acc(p.arms[a]) ? 1 : 0));
  return { n: g.length, gained, lost, mcnemar_exact_p: +binomTwoSided(gained, gained + lost).toPrecision(3),
    effect_points_weighted: r3(100 * (eff(g) ?? 0)), effect_ci95_points: sboot(g, eff, seed)?.map((x) => r3(100 * x)),
    wrong_text_pages: { [a]: g.filter((p) => wt(p.arms[a])).length, [b]: g.filter((p) => wt(p.arms[b])).length, added: g.filter((p) => !wt(p.arms[a]) && wt(p.arms[b])).length, removed: g.filter((p) => wt(p.arms[a]) && !wt(p.arms[b])).length },
    made_worse: Object.fromEntries(['wrong_text', 'misleads', 'cosmetic'].map((s) => [s, both.filter((p) => cnt(p.arms[b].v, s) > cnt(p.arms[a].v, s)).length])),
    wrong_text_added_list: both.filter((p) => cnt(p.arms[b].v, 'wrong_text') > cnt(p.arms[a].v, 'wrong_text')).map((p) => ({ page_id: p.page_id, defects: (p.arms[b].v.defects || []).filter((x) => x.severity === 'wrong_text').map((x) => `${x.class} "${String(x.quote || '').slice(0, 80)}"`) })) };
}
/** Holm over the primary contrasts: supported when the Holm-adjusted p < 0.05 and gained > lost. */
function holm(cs) {
  const ord = cs.map((c, i) => ({ i, p: c.mcnemar_exact_p })).sort((x, y) => x.p - y.p);
  let run = 0; const adj = [];
  ord.forEach((o, r) => { run = Math.max(run, Math.min(1, (cs.length - r) * o.p)); adj[o.i] = +run.toPrecision(3); });
  return cs.map((c, i) => ({ ...c, holm_p: adj[i], supported: adj[i] < 0.05 && c.gained !== c.lost, direction: c.gained > c.lost ? 'b better' : c.gained < c.lost ? 'a better' : 'none' }));
}

/**
 * The decision rule (experiment file §Decision rule), per language, over the route arms that ran:
 *  1. best = the arm with the highest weighted accept;
 *  2. eligible = within ACCEPT_MARGIN (5 points) of best's weighted accept, and, paired against best, wrong-text pages
 *     added minus removed under WRONG_TEXT_LINE (2) (best itself is eligible);
 *  3. the eligible arm with the most accepted pages per agy call; an arm within TIE_SHARE (10%) of that is a tie, and a
 *     tie goes to the cheaper arm in COST_ORDER (read4, corr, read1, gpu).
 */
export function decide(blocks, pairedVsBest, armsRan) {
  const arms = ROUTE_ARMS.filter((a) => armsRan.includes(a) && blocks[a]?.accept_weighted != null);
  if (!arms.length) return { route: null, why: 'no arm ran' };
  const best = arms.reduce((m, a) => (blocks[a].accept_weighted > blocks[m].accept_weighted ? a : m), arms[0]);
  const elig = arms.filter((a) => a === best || (blocks[a].accept_weighted >= blocks[best].accept_weighted - ACCEPT_MARGIN && (pairedVsBest[a].wrong_text_pages.added - pairedVsBest[a].wrong_text_pages.removed) < WRONG_TEXT_LINE));
  const top = Math.max(...elig.map((a) => blocks[a].accepted_per_agy_call ?? 0));
  const tied = elig.filter((a) => (blocks[a].accepted_per_agy_call ?? 0) >= top * (1 - TIE_SHARE));
  const route = COST_ORDER.find((a) => tied.includes(a));
  return { route, best_accept: best, eligible: elig, tied, why: `best accept ${best} (${blocks[best].accept_weighted}); eligible ${elig.join(', ')}; most accepted per agy call among them ${tied.join(', ')} (top ${r3(top)}); tie order ${COST_ORDER.join(' < ')}`,
    excluded: arms.filter((a) => !elig.includes(a)).map((a) => ({ arm: a, accept_weighted: blocks[a].accept_weighted, wrong_text_net_vs_best: pairedVsBest[a].wrong_text_pages.added - pairedVsBest[a].wrong_text_pages.removed })) };
}

/**
 * Amendment 1's decision rule (Derek 2026-10-31), per language, over the route arms that ran:
 *  1. gate: weighted accept no more than ACCEPT_MARGIN (5 points) below the best arm's;
 *  2. among arms through the gate, the most severity removed per agy call: (stored text's weighted severity per 1,000
 *     words - the arm's) / the arm's agy calls a page. Read as "the lowest weighted defect rate per agy call": with agy
 *     quota binding, it is the route that takes the most weighted defects out of the queue for a fixed number of calls;
 *     a literal rate / calls would reward spending more calls. If no gated arm removes any severity, the lowest rate;
 *  3. an arm within TIE_SHARE (10%) of the top is a tie; a tie goes to the cheaper arm in COST_ORDER.
 */
export function decideV2(blocks, armsRan) {
  const arms = ROUTE_ARMS.filter((a) => armsRan.includes(a) && blocks[a]?.accept_weighted != null && blocks[a]?.severity_per_1000 != null);
  if (!arms.length) return { route: null, why: 'no arm ran' };
  const best = Math.max(...arms.map((a) => blocks[a].accept_weighted));
  const gated = arms.filter((a) => blocks[a].accept_weighted >= best - ACCEPT_MARGIN);
  const lite = blocks.lite?.severity_per_1000;
  const removedPerCall = Object.fromEntries(gated.map((a) => [a, lite != null && blocks[a].agy_calls_per_page ? r3((lite - blocks[a].severity_per_1000) / blocks[a].agy_calls_per_page) : null]));
  const anyRemoves = gated.some((a) => (removedPerCall[a] ?? 0) > 0);
  const score = (a) => (anyRemoves ? removedPerCall[a] ?? -Infinity : -blocks[a].severity_per_1000);
  const top = Math.max(...gated.map(score));
  const tied = gated.filter((a) => (top >= 0 ? score(a) >= top * (1 - TIE_SHARE) : score(a) >= top * (1 + TIE_SHARE)));
  const route = COST_ORDER.find((a) => tied.includes(a));
  const lowestRate = gated.reduce((m, a) => (blocks[a].severity_per_1000 < blocks[m].severity_per_1000 ? a : m), gated[0]);
  return { route, gate_best_accept: best, gated, not_gated: arms.filter((a) => !gated.includes(a)), stored_severity_per_1000: lite, severity_removed_per_agy_call: removedPerCall, measure: anyRemoves ? 'severity removed per agy call' : 'lowest severity (no gated arm removed any)', tied, lowest_severity_arm: lowestRate,
    why: `gate: accept >= ${r3(best - ACCEPT_MARGIN)} -> ${gated.join(', ')}; severity removed per agy call ${JSON.stringify(removedPerCall)}; tied ${tied.join(', ')}; tie order ${COST_ORDER.join(' < ')}; lowest severity rate among the gated: ${lowestRate}` };
}

function langBlock(ps, lang) {
  const g = ps.filter((p) => p.lang === lang); if (!g.length) return null;
  const armsRan = ARMS.filter((a) => g.some((p) => p.arms[a].row || a === 'lite'));
  const blocks = Object.fromEntries(ARMS.map((a, i) => [a, armBlock(g, a, SEED.bootstrap + 10 * i)]));
  const primary = holm(PRIMARY.map(([a, b], i) => ({ contrast: `${b}_vs_${a}`, ...paired(g, a, b, SEED.bootstrap + 100 + i) })));
  const secondary = Object.fromEntries(SECONDARY.map(([a, b], i) => [`${b}_vs_${a}`, paired(g, a, b, SEED.bootstrap + 200 + i)]));
  // Amendment 1: severity co-primary (Holm over its two contrasts; Holm over all four primary tests reported too)
  const sevPrim = PRIMARY.map(([a, b], i) => ({ contrast: `${b}_vs_${a}`, ...pairedSev(g, a, b, SEED.bootstrap + 400 + i) }));
  const holmP = (ps0) => { const o = ps0.map((p, i) => ({ i, p })).sort((x, y) => x.p - y.p); let run = 0; const adj = []; o.forEach((x, r) => { run = Math.max(run, Math.min(1, (ps0.length - r) * x.p)); adj[x.i] = +run.toPrecision(3); }); return adj; };
  const hs = holmP(sevPrim.map((c) => c.wilcoxon.p));
  const primarySeverity = sevPrim.map((c, i) => ({ ...c, holm_p: hs[i], supported: hs[i] < 0.05, direction: c.mean_diff_weighted < 0 ? 'b fewer' : c.mean_diff_weighted > 0 ? 'b more' : 'none' }));
  const all4 = holmP([...primary.map((c) => c.mcnemar_exact_p), ...sevPrim.map((c) => c.wilcoxon.p)]);
  const secondarySeverity = Object.fromEntries(SECONDARY.map(([a, b], i) => [`${b}_vs_${a}`, pairedSev(g, a, b, SEED.bootstrap + 500 + i)]));
  const best = ROUTE_ARMS.filter((a) => armsRan.includes(a)).reduce((m, a) => (blocks[a].accept_weighted > (blocks[m]?.accept_weighted ?? -1) ? a : m), null);
  const vsBest = Object.fromEntries(ROUTE_ARMS.map((a, i) => [a, paired(g, best, a, SEED.bootstrap + 300 + i)]));
  // by stratum (unweighted inside a stratum: the PPS draw is self-weighting there) and by face (weighted)
  const strata = {}; for (const s of [...new Set(g.map((p) => p.stratum))].sort()) { const h = g.filter((p) => p.stratum === s); strata[s] = { pages: h.length, weight: r3(h.reduce((a, p) => a + p.w, 0) / g.reduce((a, p) => a + p.w, 0)), accept: Object.fromEntries(ARMS.map((a) => [a, `${h.filter((p) => acc(p.arms[a])).length}/${h.length}`])) }; }
  const faces = {}; for (const f of [...new Set(g.map((p) => p.face))].sort()) { const h = g.filter((p) => p.face === f); faces[f] = { pages: h.length, queue_share: r3(h.reduce((a, p) => a + p.w, 0) / g.reduce((a, p) => a + p.w, 0)), accept_weighted: Object.fromEntries(ARMS.map((a) => [a, r3(wmean(h, (p) => (acc(p.arms[a]) ? 1 : 0)))])), accept: Object.fromEntries(ARMS.map((a) => [a, `${h.filter((p) => acc(p.arms[a])).length}/${h.length}`])) }; }
  const outcomes = Object.fromEntries(ARMS.filter((a) => a !== 'lite').map((a) => { const t = {}; for (const p of g) { const r = p.arms[a].row; const k = r ? (r.written ? 'written' : String(r.why || 'unknown').replace(/\d+%/g, 'N%').slice(0, 70)) : 'not run'; t[k] = (t[k] ?? 0) + 1; } return [a, t]; }));
  return { pages: g.length, arms_ran: armsRan, arms: blocks, primary, primary_severity: primarySeverity, holm_over_all_four: { accept: all4.slice(0, 2), severity: all4.slice(2) }, secondary, secondary_severity: secondarySeverity, paired_vs_best: { best, ...vsBest },
    decision: decideV2(blocks, armsRan), decision_as_first_preregistered: decide(blocks, vsBest, armsRan), by_stratum: strata, by_face: faces, arm_outcomes: outcomes,
    gpu_engines: Object.fromEntries(['pero', 'lightonocr'].map((e) => [e, g.filter((p) => gpuEngine(p.face) === e).length])) };
}

/** Best judged arm on a page (accepted, then fidelity, then fewer wrong_text, misleads, cosmetic); ties to the cheaper, lite first. */
const rankKey = (x) => (x?.v ? [x.v.accept ? 1 : 0, Number(x.v.fidelity), -cnt(x.v, 'wrong_text'), -cnt(x.v, 'misleads'), -cnt(x.v, 'cosmetic')] : null);
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const WB_ORDER = ['lite', ...COST_ORDER];
function writebackRows(ps) {
  const out = [];
  for (const p of ps) {
    const ranked = WB_ORDER.filter((a) => p.arms[a]?.v).map((a) => ({ arm: a, key: rankKey(p.arms[a]) }));
    if (!ranked.length) continue;
    const top = ranked.reduce((m, x) => (cmp(x.key, m.key) > 0 ? x : m), ranked[0]);   // the first (cheapest) of the best
    if (!top.key[0] || top.arm === 'lite' || p.arms[top.arm].same_as_lite) continue;  // not accepted, or the stored text is (one of) the best
    if (!p.arms[top.arm].row?.written) continue;                                       // the arm's own text was not what its apply would write
    out.push({ page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, lang: p.lang, face: p.face, arm: top.arm, fidelity: top.key[1], same_text_arms: WB_ORDER.filter((a) => p.arms[a]?.text === p.arms[top.arm].text) });
  }
  return out;
}

function controlsBlock(vo) {
  const wp = vo.filter((r) => r.set === 'wrong_page' && r.verdict), pl = vo.filter((r) => r.set === 'planted' && r.verdict);
  const wpPass = wp.filter((r) => !r.verdict.accept && Number(r.verdict.fidelity) <= 2).length, plC = pl.filter((r) => r.catch?.caught).length;
  const by = {}; for (const r of [...wp, ...pl]) { const k = `${r.lang}/${r.set}`; by[k] ??= { n: 0, pass: 0 }; by[k].n++; if (r.set === 'wrong_page' ? !r.verdict.accept && Number(r.verdict.fidelity) <= 2 : r.catch?.caught) by[k].pass++; }
  return { by, wrong_page: `${wpPass}/${wp.length}`, planted: `${plC}/${pl.length}`, valid: wp.length > 0 && wpPass === wp.length && pl.length > 0 && plC / pl.length >= PLANT_BAR, noise_floor: 'reused from #7818: accept kappa 0.87 (alpha 0.87), 29/30, same judge and prompt (no rerun)' };
}

/** DTA-matched pages (#6012 kgram-vote-v2, same edition, congruent): which sampled pages have a typed reference. */
function dtaMatches(ps) {
  const f = path.join(ROOT, 'scripts/eval/output/typed-refs-6012-2026-10-06.dta.aligned-pages.jsonl.gz');
  if (!fs.existsSync(f)) return { file: null, pages: [] };
  const rows = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === 'same-edition' && r.congruent);
  const key = new Set(rows.map((r) => `${r.book_id}:${r.page_number}`));
  return { file: path.basename(f), pages: ps.filter((p) => key.has(`${p.book_id}:${p.page_number}`)).map((p) => p.page_id) };
}

/** Router evidence (exportScore): the verdicts as route-judge records, cells german-lite / french-lite; no rules.json entry. */
function evidence(ps, vo) {
  const recs = [], cellOf = (p) => (p.lang === 'de' ? 'german-lite' : 'french-lite');
  const routeOf = (p, arm) => (arm === 'gpu' ? (gpuEngine(p.face) === 'pero' ? 'pero>agy-flash-low' : 'lighton>agy-flash-low') : ROUTES[arm]);
  for (const p of ps) for (const [arm, x] of Object.entries(p.arms)) {
    if (!x.row && arm !== 'lite') continue;
    const v = x.v ?? (x.none ? { accept: false, fidelity: 1, defects: [], reader_note: 'no text served' } : null); if (!v) continue;
    recs.push({ _id: `qr${sha(`${p.key}:${arm}`).slice(0, 14)}`, kind: 'item', route: routeOf(p, arm), page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, cell: cellOf(p), lane: 'queue-routes-7853', lang: p.lang === 'de' ? 'German' : 'French', task: 'ocr', script_type: 'print', script_source: 'the stored read is print (correctablePages: not handwritten)', cell_hand: 'print',
      judge: { by: 'claude -p --model opus', model_reported: 'claude-opus-5-5', prompt_template_sha: null, instrument: 'route-judge-6740 judgePrompt' }, run_id: 'queue-routes-7853', judged_at: x.at ?? new Date().toISOString(), verdict: v, write: { revision_id: `eval:${p.page_id}:${arm}` },
      draw: { stratum: p.stratum, frame: '#7853: the #7558 correction queue, PPS by pages owed', weight: r3(p.w) } });
  }
  for (const r of vo.filter((x) => (x.set === 'wrong_page' || x.set === 'planted') && x.verdict)) {
    const p = ps.find((q) => q.page_id === r.page); if (!p) continue;
    for (const arm of ARMS) recs.push({ _id: `qr${sha(`${r.set}:${r.id}:${arm}`).slice(0, 14)}`, kind: r.set, route: routeOf(p, arm), page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, cell: cellOf(p), lane: 'queue-routes-7853', lang: p.lang === 'de' ? 'German' : 'French', task: 'ocr', script_type: 'print', script_source: 'the stored read is print', cell_hand: 'print',
      judge: { by: 'claude -p --model opus', model_reported: r.model ?? 'claude-opus-5-5', prompt_template_sha: null, instrument: 'route-judge-6740 judgePrompt' }, run_id: 'queue-routes-7853', judged_at: r.at, verdict: r.verdict, write: { revision_id: `eval:${p.page_id}:${arm}` },
      ...(r.set === 'planted' && { plant: r.plant, planted_from: r.planted_from, catch: r.catch }), ...(r.set === 'wrong_page' && { other_page_id: r.other_page }), draw: { stratum: p.stratum, frame: '#7853' } });
  }
  return { ...exportScore(recs), source: 'queue-routes-7853 (#7853)', file: 'scripts/eval/queue-routes-7853/results/router-evidence.score.json',
    frame: 'One page per book from the #7558 correction queue (German and French, stored Flash-Lite print), books drawn by sequential Poisson PPS on pages owed inside century x scan strata; every arm on the same page; a refused arm serves the stored text. Preregistered: 2026-10-31-queue-routes-7853.md.' };
}

function score() {
  const { items, vo, abs } = load();
  const ps = pagesOf(items, abs);
  const out = { generated_at: new Date().toISOString(), seeds: SEED, calls: { opus_abs: vo.filter((r) => r.set === 'abs').length, opus_controls: vo.filter((r) => r.set !== 'abs').length, unparsed: vo.filter((r) => !r.verdict).length, list_usd_equiv: +vo.reduce((a, r) => a + (r.list_usd || 0), 0).toFixed(2) },
    items: { total: items.length, judged: items.filter((i) => abs.has(i.id)).length, tier1_unjudged: items.filter((i) => i.tier === 1 && !abs.has(i.id)).length } };
  out.instrument = controlsBlock(vo);
  out.de = langBlock(ps, 'de'); out.fr = langBlock(ps, 'fr');
  out.dta = dtaMatches(ps);
  out.agy_calls_total = jsonl(path.join(OUT, 'arms.jsonl')).filter((r) => !r.quota && !r.superseded).reduce((a, r) => a + (r.calls || 0), 0) + jsonl(path.join(OUT, 'tags.jsonl')).reduce((a, r) => a + (r.calls || 0), 0);
  const wb = writebackRows(ps);
  R('writeback.json', { rule: 'per page: the best judged arm (accepted; then fidelity; then fewer wrong_text, misleads, cosmetic; ties to the cheaper arm, the stored text first), only where it was accepted, no other arm (the stored text included) was judged better, its text is not the stored text, and it is the text its own dry apply would write.', pages: wb });
  out.writeback = { pages: wb.length, by_arm: wb.reduce((t, x) => ({ ...t, [`${x.lang}/${x.arm}`]: (t[`${x.lang}/${x.arm}`] ?? 0) + 1 }), {}) };
  const dr = { unit: 'defects per 1,000 words (#7824 words()), weighted to the queue', study_cells: {} };
  for (const lang of ['de', 'fr']) for (const arm of ARMS) { const b = out[lang]?.arms[arm]; if (b) dr.study_cells[`${lang}-lite-print/${arm}`] = { n: b.judged, wrong_text_per_1k: b.defects_per_1000_weighted.wrong_text, misleads_per_1k: b.defects_per_1000_weighted.misleads, severity_per_1k: b.severity_per_1000, fidelity_mean: b.fidelity_mean_weighted, accept_weighted: b.accept_weighted }; }
  R('defect-rates.json', dr);
  R('score.json', out);
  R('router-evidence.score.json', evidence(ps, vo));
  for (const lang of ['de', 'fr']) { const L = out[lang]; if (!L) continue;
    console.log(`\n${lang}: ${L.pages} pages`);
    for (const a of ARMS) { const b = L.arms[a]; console.log(`  ${a.padEnd(6)} accept ${b.accept.k}/${b.accept.n} w ${b.accept_weighted} ${JSON.stringify(b.accept_weighted_ci95)} | sev ${b.severity_per_1000} ${JSON.stringify(b.severity_per_1000_ci95)} | fid ${b.fidelity_mean_weighted} | calls/page ${b.agy_calls_per_page} | acc/call ${b.accepted_per_agy_call} | wt pages ${b.wrong_text_pages}`); }
    for (const c of L.primary) console.log(`  primary ${c.contrast}: ${c.gained}/${c.lost} p ${c.mcnemar_exact_p} holm ${c.holm_p} eff ${c.effect_points_weighted} ${JSON.stringify(c.effect_ci95_points)}`);
    for (const c of L.primary_severity) console.log(`  severity ${c.contrast}: diff ${c.mean_diff_weighted} ${JSON.stringify(c.ci95)} wilcoxon p ${c.wilcoxon.p} holm ${c.holm_p}`);
    console.log(`  decision (A1): ${L.decision.route} — ${L.decision.why}`);
    console.log(`  decision (as first preregistered): ${L.decision_as_first_preregistered.route}`); }
  console.log(JSON.stringify({ instrument: out.instrument, writeback: out.writeback, dta: out.dta.pages.length }));
}

/** What build.py would decide if rules.json named this export (#7835 analyze.mjs router, the same method). */
async function router() {
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const { rebuildInputs, addEvidence, evidenceEntries } = await import('../lane-judge-sampler.mjs');
  const RT = 'scripts/eval/estimator/router-table', EV = `${RT}/evidence/queue-routes-7853.score.json`, BY = `${RT}/evidence/by-script/queue-routes-7853.score.json`;
  const sh = (cmd, args, o = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...o }); if (r.status) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${r.stderr}`); return r.stdout; };
  sh('git', ['-C', ROOT, 'fetch', '-q', 'origin', 'main']);
  const rulesText = sh('git', ['-C', ROOT, 'show', `origin/main:${RT}/rules.json`]), rules = JSON.parse(rulesText);
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'qr7853-router-'));
  const tar = spawnSync('git', ['-C', ROOT, 'archive', '--format=tar', 'origin/main', ...rebuildInputs(rules, RT)], { maxBuffer: 1 << 30 });
  sh('tar', ['-x', '-C', dir], { input: tar.stdout, encoding: undefined });
  const score = JSON.parse(fs.readFileSync(path.join(RESULTS, 'router-evidence.score.json'), 'utf8'));
  for (const [f, body] of [[EV, score], [BY, { source: score.source, generated_at: score.generated_at, of: EV, cells: score.by_script_cells ?? {} }]]) {
    for (const base of [dir, ROOT]) { fs.mkdirSync(path.dirname(path.join(base, f)), { recursive: true }); fs.writeFileSync(path.join(base, f), JSON.stringify(body, null, 1) + '\n'); }
  }
  const py = (name, extra = []) => sh('python3', [`${RT}/build.py`, '--name', name, ...extra], { cwd: dir });
  py('baseline');
  let text = rulesText; const added = [];
  for (const { cell, route } of evidenceEntries(score, rules)) { text = addEvidence(text, cell, route, { score: EV, cell, route }); added.push(`${cell}/${route}`); }
  fs.writeFileSync(path.join(dir, RT, 'rules.json'), text);
  py('with-7853', ['--before', `${RT}/baseline.json`]);
  const rows = (n) => JSON.parse(fs.readFileSync(path.join(dir, RT, `${n}.json`), 'utf8')).rows;
  const pick = (rs) => rs.filter((r) => /^(german|french)-lite/.test(r.id)).map((r) => ({ id: r.id, decision: r.decision, route: r.route, routes: r.routes.map((x) => ({ id: x.id, k: x.k, n: x.n, wrong: x.wrong, mean: x.mean })) }));
  const out = { main_sha: sh('git', ['-C', ROOT, 'rev-parse', '--short', 'origin/main']).trim(), evidence_added: added, baseline: pick(rows('baseline')), with_7853: pick(rows('with-7853')), note: 'what build.py decides if rules.json named this export; rules.json is NOT changed by this PR' };
  R('router-check.json', out);
  for (const k of ['baseline', 'with_7853']) for (const r of out[k]) console.log(`${k} ${r.id}: ${r.decision} ${r.route} | ${r.routes.map((x) => `${x.id} ${x.k}/${x.n}`).join('; ')}`);
}

const stages = { score, router };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
