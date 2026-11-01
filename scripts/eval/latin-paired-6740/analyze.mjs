#!/usr/bin/env node
// PRIOR ART: scripts/eval/queue-routes-7853/analyze.mjs (pagesOf with Horvitz-Thompson weights from the PPS draw, the
// stratified bootstrap, paired McNemar and severity contrasts with Wilcoxon, Holm, controlsBlock, rankKey and the
// write-back rule, the exportScore records and the router check; restated over this study's three arms, one cell, and
// arms that may write nothing) and scripts/eval/estimator/router-table/build.py decide_defects (#7862: the S1 rule,
// restated here over this study's paired data; the constants are read from rules.json decision_rule, not copied).
// Committed before any verdict exists (preregistration).
/**
 * The preregistered analysis of the Latin first-read paired test. Reads OUT; writes results/score.json,
 * results/writeback.json, results/router-evidence.score.json.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/latin-paired-6740/analyze.mjs score
 *   ... analyze.mjs router     what build.py decides with this export and these defect counts pooled in (on a copy)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT, OUT, RESULTS, J, jsonl, sha, SEED, AGY_CALL_USD, wrongText, words7824, ARMS, ROUTES, COST_ORDER, SEV, wilcoxon, GPU_SECS_PER_PAGE, GPU_USD_PER_SEC, ARM_NAMES } from './lib.mjs';
import { binomTwoSided, makeRng } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';
import { exportScore, PLANT_BAR } from '../lane-judge-sampler.mjs';

const RT = 'scripts/eval/estimator/router-table';
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, RT, 'rules.json'), 'utf8'));
const DR = RULES.decision_rule;
/** S1's re-check deflation (defect-rate-2026-10-30 RULE.md S1): misleads x 0.625, wrong text x 0.80. */
const CAL = JSON.parse(fs.readFileSync(path.join(ROOT, RT, 'defect-rates.json'), 'utf8')).recheck ?? { misleads: 0.625, wrong_text: 0.8 };
const R = (f, x) => { fs.mkdirSync(RESULTS, { recursive: true }); fs.writeFileSync(path.join(RESULTS, f), typeof x === 'string' ? x : JSON.stringify(x, null, 1) + '\n'); };
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));
const kn = (k, n) => ({ k, n, rate: n ? r3(k / n) : null, wilson95: n ? wilson(k, n).map(r3) : null });
const cnt = (v, s) => (v?.defects || []).filter((d) => d.severity === s).length;
const pts = (v) => Object.entries(SEV).reduce((a, [k, w]) => a + w * cnt(v, k), 0);
const textOf = (key, arm) => { const f = path.join(OUT, 'texts', `${key}.${arm}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
/** The live route is the bar; the two candidates are compared against it (primary), and with each other (secondary). */
export const LIVE = 'live';
export const PRIMARY = Object.freeze([['live', 'pero4'], ['live', 'read4']]);
export const SECONDARY = Object.freeze([['pero4', 'read4']]);
/** The brief's gate: weighted accept (every drawn page; a page not written is not accepted) no more than 5 points below live. */
export const ACCEPT_MARGIN = 0.05;
const BOOT = 4000;

function load() {
  const items = J('items.json'), vo = jsonl(path.join(OUT, 'verdicts-opus.jsonl'));
  const abs = new Map(vo.filter((r) => r.set === 'abs' && r.verdict).map((r) => [r.id, r]));
  return { items, vo, abs };
}
/**
 * Per page: its HT weight and, per arm, the verdict of the text it would write, the text, its words, the arm's log row.
 * w = owed / pi with pi = min(1, n_h * owed / M_h): the PPS inclusion probability of the book (the page is uniform in it).
 */
function pagesOf(items, abs) {
  const rows = jsonl(path.join(OUT, 'arms.jsonl')).filter((r) => !r.quota);
  return J('selected.json').selected.map((s) => {
    const pi = Math.min(1, s.stratum_n * s.owed / s.stratum_pages);
    const p = { key: s.key, page_id: s.page_id, book_id: s.book_id, page_number: s.page_number, face: s.face, stratum: s.stratum, year: s.year, w: s.owed / pi, arms: {} };
    for (const arm of ARMS) {
      const t = textOf(s.key, arm)?.trim();
      const it = t ? items.find((i) => i.key === s.key && i.text_sha === sha(t).slice(0, 16)) : null;
      const row = rows.filter((r) => r.key === s.key && r.arm === arm && !r.superseded).pop() ?? null;
      const calls = row && row.pages ? row.calls / row.pages : 0;
      const gpu_s = arm === 'read4' || !row || /^no draft/.test(row.why || '') ? 0 : GPU_SECS_PER_PAGE;
      p.arms[arm] = t ? { v: it ? abs.get(it.id)?.verdict ?? null : null, at: it ? abs.get(it.id)?.at ?? null : null, item: it?.id ?? null, text: t, words: Math.max(1, words7824(t)), row, calls, gpu_s }
        : { v: null, text: null, words: 0, row, none: true, calls, gpu_s };
    }
    return p;
  });
}
const acc = (x) => !!(x && !x.none && x.v?.accept);
const ran = (x) => !!x?.row;   // an arm that ran and wrote nothing counts (not accepted); one that never ran is not compared
const wt = (x) => !!x?.v && wrongText(x.v);

/** Stratified bootstrap of a weighted statistic f(pages): pages (= books, one page a book) resampled within their stratum. */
function sboot(ps, f, seed) {
  const by = {}; for (const p of ps) (by[p.stratum] ??= []).push(p);
  const S = Object.values(by), rnd = makeRng(seed), out = [];
  for (let b = 0; b < BOOT; b++) { const s = []; for (const g of S) for (let i = 0; i < g.length; i++) s.push(g[Math.floor(rnd() * g.length)]); out.push(f(s)); }
  const v = out.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? [r3(v[Math.floor(0.025 * v.length)]), r3(v[Math.floor(0.975 * v.length) - 1])] : null;
}
const wmean = (ps, f) => { const W = ps.reduce((a, p) => a + p.w, 0); return W ? ps.reduce((a, p) => a + p.w * f(p), 0) / W : null; };
/** Weighted defects per 1,000 words over the judged written pages: sum w*count / sum w*words (sev: a class, or 'points' = MQM 1/5/25). */
const wrate = (ps, arm, sev) => { const g = ps.filter((p) => p.arms[arm].v); const Wd = g.reduce((a, p) => a + p.w * p.arms[arm].words, 0); return Wd ? 1000 * g.reduce((a, p) => a + p.w * (sev === 'points' ? pts(p.arms[arm].v) : cnt(p.arms[arm].v, sev)), 0) / Wd : null; };
const sevRate = (x) => (x?.v ? 1000 * pts(x.v) / Math.max(1, x.words) : null);

function armBlock(ps, arm, seed) {
  const g = ps.filter((p) => ran(p.arms[arm])), n = g.length, written = g.filter((p) => !p.arms[arm].none), judged = g.filter((p) => p.arms[arm].v);
  const k = g.filter((p) => acc(p.arms[arm])).length;
  const wAcc = wmean(g, (p) => (acc(p.arms[arm]) ? 1 : 0)), wCalls = wmean(g, (p) => p.arms[arm].calls), wGpu = wmean(g, (p) => p.arms[arm].gpu_s);
  const usdRaw = (wCalls ?? 0) * AGY_CALL_USD;
  return { name: ARM_NAMES[arm], route: ROUTES[arm], pages_drawn: n, written: kn(written.length, n), judged: judged.length,
    accept_all_drawn: kn(k, n), accept_all_drawn_weighted: r3(wAcc), accept_all_drawn_weighted_ci95: sboot(g, (s) => wmean(s, (p) => (acc(p.arms[arm]) ? 1 : 0)), seed),
    accept_written: kn(judged.filter((p) => p.arms[arm].v.accept).length, judged.length),
    severity_per_1000: r3(wrate(ps, arm, 'points')), severity_per_1000_ci95: sboot(judged, (s) => wrate(s, arm, 'points'), seed + 1),
    severity_per_1000_page_mean: r3(wmean(judged, (p) => sevRate(p.arms[arm]))),
    defects_per_1000_weighted: Object.fromEntries(['wrong_text', 'misleads', 'cosmetic'].flatMap((s, i) => [[s, r3(wrate(ps, arm, s))], [`${s}_ci95`, sboot(judged, (x) => wrate(x, arm, s), seed + 2 + i)]])),
    defect_counts: { wrong_text: judged.reduce((a, p) => a + cnt(p.arms[arm].v, 'wrong_text'), 0), misleads: judged.reduce((a, p) => a + cnt(p.arms[arm].v, 'misleads'), 0), cosmetic: judged.reduce((a, p) => a + cnt(p.arms[arm].v, 'cosmetic'), 0), words: judged.reduce((a, p) => a + p.arms[arm].words, 0) },
    wrong_text_pages: judged.filter((p) => wt(p.arms[arm])).length,
    fidelity_mean_weighted: r3(wmean(judged, (p) => Number(p.arms[arm].v.fidelity))),
    median_words_per_page: judged.length ? judged.map((p) => p.arms[arm].words).sort((a, b) => a - b)[Math.floor(judged.length / 2)] : null,
    agy_calls_per_page: r3(wCalls), gpu_seconds_per_page: r3(wGpu), usd_per_raw_page: +usdRaw.toFixed(6), usd_per_raw_page_with_gpu: +(usdRaw + (wGpu ?? 0) * GPU_USD_PER_SEC).toFixed(6),
    usd_per_accepted_page: wAcc ? +(usdRaw / wAcc).toFixed(5) : null };
}
/** b against a, severity per 1,000 words, paired on the pages both wrote and the judge read: weighted ratio difference, bootstrap CI, Wilcoxon on per-page rates. */
function pairedSev(ps, a, b, seed) {
  const g = ps.filter((p) => p.arms[a].v && p.arms[b].v);
  const dm = (s) => { const x = wrate(s, b, 'points'), y = wrate(s, a, 'points'); return x == null || y == null ? null : x - y; };
  const ds = g.map((p) => sevRate(p.arms[b]) - sevRate(p.arms[a]));
  return { n: g.length, diff_weighted: r3(dm(g)), ci95: sboot(g, dm, seed), wilcoxon: wilcoxon(ds), fewer: ds.filter((x) => x < 0).length, more: ds.filter((x) => x > 0).length, same: ds.filter((x) => x === 0).length,
    wrong_text: { [a]: g.reduce((t, p) => t + cnt(p.arms[a].v, 'wrong_text'), 0), [b]: g.reduce((t, p) => t + cnt(p.arms[b].v, 'wrong_text'), 0) },
    misleads: { [a]: g.reduce((t, p) => t + cnt(p.arms[a].v, 'misleads'), 0), [b]: g.reduce((t, p) => t + cnt(p.arms[b].v, 'misleads'), 0) } };
}
/** b against a, accept over every drawn page both arms ran on (not written = not accepted): exact McNemar, weighted effect with CI. */
function pairedAcc(ps, a, b, seed) {
  const g = ps.filter((p) => ran(p.arms[a]) && ran(p.arms[b]));
  const gained = g.filter((p) => !acc(p.arms[a]) && acc(p.arms[b])).length, lost = g.filter((p) => acc(p.arms[a]) && !acc(p.arms[b])).length;
  const eff = (s) => wmean(s, (p) => (acc(p.arms[b]) ? 1 : 0) - (acc(p.arms[a]) ? 1 : 0));
  const both = g.filter((p) => p.arms[a].v && p.arms[b].v);
  return { n: g.length, both: g.filter((p) => acc(p.arms[a]) && acc(p.arms[b])).length, gained, lost, neither: g.filter((p) => !acc(p.arms[a]) && !acc(p.arms[b])).length,
    mcnemar_exact_p: +binomTwoSided(gained, gained + lost).toPrecision(3), effect_points_weighted: r3(100 * (eff(g) ?? 0)), effect_ci95_points: sboot(g, eff, seed)?.map((x) => r3(100 * x)),
    wrong_text_pages: { added: both.filter((p) => !wt(p.arms[a]) && wt(p.arms[b])).length, removed: both.filter((p) => wt(p.arms[a]) && !wt(p.arms[b])).length },
    wrong_text_added_list: both.filter((p) => cnt(p.arms[b].v, 'wrong_text') > cnt(p.arms[a].v, 'wrong_text')).map((p) => ({ page_id: p.page_id, defects: (p.arms[b].v.defects || []).filter((x) => x.severity === 'wrong_text').map((x) => `${x.class} "${String(x.quote || '').slice(0, 80)}" ${String(x.what || '').slice(0, 80)}`) })) };
}
const holmP = (ps0) => { const o = ps0.map((p, i) => ({ i, p })).sort((x, y) => x.p - y.p); let run = 0; const adj = []; o.forEach((x, r) => { run = Math.max(run, Math.min(1, (ps0.length - r) * x.p)); adj[x.i] = +run.toPrecision(3); }); return adj; };

// ── #7862's S1 rule, restated over this study's paired data (build.py decide_defects; constants from rules.json) ──
/** A gamma draw (Marsaglia-Tsang), for the paired Dirichlet of the acceptance floor (cheap-routes-7701 pairedP). */
function gammaOf(rnd) {
  const normal = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const g = (a) => { if (a < 1) return g(a + 1) * rnd() ** (1 / a); const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = normal(); v = 1 + c * x; } while (v <= 0); v = v ** 3; const u = rnd(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } };
  return g;
}
/** P(acc_b >= acc_a - within) under Dirichlet(1 + both, 1 + b_only, 1 + a_only, 1 + neither) on the paired pages. */
function pairedFloorP(c, within, seed) {
  const g = gammaOf(makeRng(seed)); let hit = 0; const N = 40000;
  for (let i = 0; i < N; i++) { const x = [c.both, c.gained, c.lost, c.neither].map((k) => g(1 + k)); const t = x.reduce((s, y) => s + y); if ((x[1] - x[2]) / t >= -within) hit++; }
  return +(hit / N).toFixed(3);
}
/**
 * S1 (RULE.md amendment S1; build.py decide_defects): bar = the live route. Rates per 1,000 words are gamma-Poisson
 * posterior means, one common prior for the three arms (the arms' pooled rate, worth A0 = 2,000 words: defect-rate.py
 * A0_WORDS), over the judged written pages; deflated by the re-check (misleads x CAL.misleads, wrong text x
 * CAL.wrong_text). Gate 1: wrong text <= the bar's + wrong_text_delta_per_1k. Gate 2: P(acc_route >= acc_live -
 * accept_floor.within) >= accept_floor.p, paired on every drawn page. Pick: the lowest price per raw page (agy calls x
 * the fee basis; GPU card time unpriced, as build.py prices the pero stages) + W/1000 x w_m x (misleads +
 * wrong_text_weight x wrong text), W = the median of the arms' median words a page; a pick that moves across
 * misleads_usd_sensitivity is HOLD (not switch).
 */
export function decideS1(ps, blocks, pairs, { gpuPriced = false } = {}) {
  const arms = ARMS.filter((a) => blocks[a]?.judged >= DR.min_books);
  if (!arms.includes(LIVE)) return { decision: 'not decided', why: `the live arm has ${blocks[LIVE]?.judged ?? 0} judged pages (< ${DR.min_books})` };
  const A0 = 2;   // thousand words
  const pool = (s) => arms.reduce((t, a) => t + blocks[a].defect_counts[s], 0) / Math.max(1, arms.reduce((t, a) => t + blocks[a].defect_counts.words, 0) / 1000);
  const post = (a, s) => (A0 * pool(s) + blocks[a].defect_counts[s]) / (A0 + blocks[a].defect_counts.words / 1000);
  const m = Object.fromEntries(arms.map((a) => [a, { misleads: r3(CAL.misleads * post(a, 'misleads')), wrong_text: r3(CAL.wrong_text * post(a, 'wrong_text')) }]));
  const W = arms.map((a) => blocks[a].median_words_per_page).sort((x, y) => x - y)[Math.floor(arms.length / 2)];
  const gates = {};
  for (const a of arms) {
    if (a === LIVE) { gates[a] = { wrong_text: true, accept: true }; continue; }
    const pa = pairedFloorP(pairs[`${a}_vs_${LIVE}`], DR.accept_floor.within, SEED.bootstrap + 900 + arms.indexOf(a));
    gates[a] = { wrong_text: m[a].wrong_text <= m[LIVE].wrong_text + DR.wrong_text_delta_per_1k, accept: pa >= DR.accept_floor.p, p_accept_floor: pa };
  }
  const ok = arms.filter((a) => gates[a].wrong_text && gates[a].accept);
  const err = Object.fromEntries(arms.map((a) => [a, W / 1000 * (m[a].misleads + DR.wrong_text_weight * m[a].wrong_text)]));
  const price = (a) => (gpuPriced ? blocks[a].usd_per_raw_page_with_gpu : blocks[a].usd_per_raw_page);
  const cost = (a, wm) => price(a) + wm * err[a];
  const wms = [...new Set([DR.misleads_usd, ...DR.misleads_usd_sensitivity])].sort((x, y) => x - y);
  const picks = Object.fromEntries(wms.map((wm) => [wm, ok.length ? ok.reduce((best, a) => (cost(a, wm) < cost(best, wm) ? a : best), ok[0]) : LIVE]));
  const pk = picks[DR.misleads_usd], moves = new Set(Object.values(picks)).size > 1;
  const decision = pk !== LIVE && moves ? `HOLD (the pick moves with the misleads weight: ${wms.map((wm) => `$${wm} → ${ROUTES[picks[wm]]}`).join(', ')})` : pk === LIVE ? 'keep' : 'switch';
  return { decision, route: ROUTES[pk], arm: pk, bar: ROUTES[LIVE], words_per_page: W, rates_per_1k_deflated: m, prior: { words_thousand: A0, pooled_per_1k: { misleads: r3(pool('misleads')), wrong_text: r3(pool('wrong_text')) } }, gates, passing: ok.map((a) => ROUTES[a]),
    defects_cost_per_page: Object.fromEntries(arms.map((a) => [ROUTES[a], r3(err[a])])), price_per_raw_page: Object.fromEntries(arms.map((a) => [ROUTES[a], price(a)])),
    picks: Object.fromEntries(wms.map((wm) => [String(wm), ROUTES[picks[wm]]])), gpu_priced: gpuPriced };
}

function controlsBlock(vo) {
  const wp = vo.filter((r) => r.set === 'wrong_page' && r.verdict), pl = vo.filter((r) => r.set === 'planted' && r.verdict);
  const pass = (r) => !r.verdict.accept && Number(r.verdict.fidelity) <= 2;
  const plC = pl.filter((r) => r.catch?.caught).length;
  const byArm = {}; for (const r of wp) { byArm[r.arm] ??= { n: 0, pass: 0 }; byArm[r.arm].n++; if (pass(r)) byArm[r.arm].pass++; }
  return { wrong_page: `${wp.filter(pass).length}/${wp.length}`, wrong_page_by_arm: byArm, planted: `${plC}/${pl.length}`, planted_detail: pl.map((r) => ({ kind: r.plant?.kind, caught: !!r.catch?.caught, accept: r.verdict.accept })),
    valid: wp.length > 0 && wp.every(pass) && pl.length > 0 && plC / pl.length >= PLANT_BAR, rule: `valid when every wrong-page control is refused at fidelity <= 2 and >= ${PLANT_BAR} of plants are caught`, noise_floor: 'reused from #7818: accept kappa 0.87, 29/30, same judge and prompt (no rerun)' };
}

/** CAMENA-matched pages (#6012 kgram-vote-v2, same edition, congruent): CER is computed only at >= 5 matched pages. */
function camena(ps) {
  const f = path.join(ROOT, 'scripts/eval/output/typed-refs-6012-2026-10-06.camena.aligned-pages.jsonl.gz');
  const rows = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === 'same-edition' && r.congruent);
  const key = new Set(rows.map((r) => `${r.book_id}:${r.page_number}`)), books = new Set(rows.map((r) => r.book_id));
  const pages = ps.filter((p) => key.has(`${p.book_id}:${p.page_number}`)).map((p) => p.page_id);
  return { file: path.basename(f), sampled_books_in_camena: ps.filter((p) => books.has(p.book_id)).length, pages, cer: pages.length >= 5 ? 'to compute' : `not available at this n (${pages.length} matched pages < 5): the aligned pages need a stored read to align, and the queue's books have none` };
}

/** Best judged arm on a page (accepted, then fidelity, then fewer wrong_text, misleads, cosmetic); ties to the cheaper. */
const rankKey = (x) => (x?.v ? [x.v.accept ? 1 : 0, Number(x.v.fidelity), -cnt(x.v, 'wrong_text'), -cnt(x.v, 'misleads'), -cnt(x.v, 'cosmetic')] : null);
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
function writebackRows(ps) {
  const out = [];
  for (const p of ps) {
    const ranked = COST_ORDER.filter((a) => p.arms[a]?.v).map((a) => ({ arm: a, key: rankKey(p.arms[a]) }));
    if (!ranked.length) continue;
    const top = ranked.reduce((m, x) => (cmp(x.key, m.key) > 0 ? x : m), ranked[0]);   // the first (cheapest) of the best
    if (!top.key[0] || !p.arms[top.arm].row?.written || p.arms[top.arm].row?.later_read) continue;
    out.push({ page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, arm: top.arm, route: ROUTES[top.arm], fidelity: top.key[1], same_text_arms: COST_ORDER.filter((a) => p.arms[a]?.text === p.arms[top.arm].text) });
  }
  return out;
}

/** Router evidence (exportScore): the judged written pages as route-judge records, cell latin-blank; plus the defect counts defect-rate.py pools. */
function evidence(ps, vo) {
  const recs = [], base = { cell: 'latin-blank', lane: 'latin-paired-6740', lang: 'Latin', task: 'ocr', script_type: 'print', script_source: 'the reader\'s own <script>printed</script> tag (--print-only)', cell_hand: 'print', run_id: 'latin-paired-6740' };
  const judge = (m) => ({ by: 'claude -p --model opus', model_reported: m ?? 'claude-opus-5-5', prompt_template_sha: null, instrument: 'route-judge-6740 judgePrompt' });
  const draw = (p) => ({ stratum: p.stratum, frame: 'latin-blank/print queue, PPS by pages owed (2026-11-01-latin-first-read-paired-6740.md)', weight: r3(p.w) });
  for (const p of ps) for (const arm of ARMS) {
    const x = p.arms[arm]; if (!x.v) continue;
    recs.push({ _id: `lp${sha(`${p.key}:${arm}`).slice(0, 14)}`, kind: 'item', route: ROUTES[arm], page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, ...base, judge: judge(), judged_at: x.at ?? new Date().toISOString(), verdict: x.v, write: { revision_id: `eval:${p.page_id}:${arm}` }, draw: draw(p) });
  }
  for (const r of vo.filter((x) => (x.set === 'wrong_page' || x.set === 'planted') && x.verdict)) {
    const p = ps.find((q) => q.page_id === r.page); if (!p) continue;
    for (const arm of r.set === 'wrong_page' ? [r.arm] : ARMS) recs.push({ _id: `lp${sha(`${r.set}:${r.id}:${arm}`).slice(0, 14)}`, kind: r.set, route: ROUTES[arm], page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, ...base, judge: judge(r.model), judged_at: r.at, verdict: r.verdict, write: { revision_id: `eval:${p.page_id}:${arm}` },
      ...(r.set === 'planted' && { plant: r.plant, planted_from: r.planted_from, catch: r.catch }), ...(r.set === 'wrong_page' && { other_page_id: r.other_page }), draw: draw(p) });
  }
  return { ...exportScore(recs), source: 'latin-paired-6740 (#6740)', file: 'scripts/eval/latin-paired-6740/results/router-evidence.score.json',
    frame: 'One unread interior page per book from the latin-blank/print queue (the first-read lane\'s Latin frame), books drawn by sequential Poisson PPS on pages owed inside century strata, every book a committed eval names excluded; every arm on the same page; a route\'s rows are the pages it WRITES (a page not written stays scans-only). Preregistered: 2026-11-01-latin-first-read-paired-6740.md.' };
}

function score() {
  const { items, vo, abs } = load();
  const ps = pagesOf(items, abs);
  const out = { generated_at: new Date().toISOString(), seeds: SEED, calls: { opus_abs: vo.filter((r) => r.set === 'abs').length, opus_controls: vo.filter((r) => r.set !== 'abs').length, unparsed: vo.filter((r) => !r.verdict).length, list_usd_equiv: +vo.reduce((a, r) => a + (r.list_usd || 0), 0).toFixed(2) },
    items: { total: items.length, judged: items.filter((i) => abs.has(i.id)).length } };
  out.instrument = controlsBlock(vo);
  out.pages = ps.length;
  out.arms = Object.fromEntries(ARMS.map((a, i) => [a, armBlock(ps, a, SEED.bootstrap + 10 * i)]));
  const sevP = PRIMARY.map(([a, b], i) => ({ contrast: `${b}_vs_${a}`, ...pairedSev(ps, a, b, SEED.bootstrap + 100 + i) }));
  const hs = holmP(sevP.map((c) => c.wilcoxon.p));
  out.primary_severity = sevP.map((c, i) => ({ ...c, holm_p: hs[i], supported: hs[i] < 0.05, direction: c.diff_weighted < 0 ? 'candidate fewer' : c.diff_weighted > 0 ? 'candidate more' : 'none' }));
  out.secondary_severity = Object.fromEntries(SECONDARY.map(([a, b], i) => [`${b}_vs_${a}`, pairedSev(ps, a, b, SEED.bootstrap + 200 + i)]));
  const pairs = Object.fromEntries([...PRIMARY, ...SECONDARY].map(([a, b], i) => [`${b}_vs_${a}`, pairedAcc(ps, a, b, SEED.bootstrap + 300 + i)]));
  out.paired_accept = pairs;
  out.gate = Object.fromEntries(ARMS.map((a) => [a, { accept_all_drawn_weighted: out.arms[a].accept_all_drawn_weighted, passes: a === LIVE || out.arms[a].accept_all_drawn_weighted >= out.arms[LIVE].accept_all_drawn_weighted - ACCEPT_MARGIN }]));
  const gated = ARMS.filter((a) => out.gate[a].passes);
  out.lowest_severity_gated = gated.reduce((m, a) => (out.arms[a].severity_per_1000 < out.arms[m].severity_per_1000 ? a : m), gated[0]);
  out.decision_s1 = decideS1(ps, out.arms, pairs);
  out.decision_s1_gpu_priced = decideS1(ps, out.arms, pairs, { gpuPriced: true });
  out.by_stratum = Object.fromEntries([...new Set(ps.map((p) => p.stratum))].sort().map((s) => { const h = ps.filter((p) => p.stratum === s); return [s, { pages: h.length, weight: r3(h.reduce((a, p) => a + p.w, 0) / ps.reduce((a, p) => a + p.w, 0)), accept: Object.fromEntries(ARMS.map((a) => [a, `${h.filter((p) => acc(p.arms[a])).length}/${h.length}`])), severity_per_1000: Object.fromEntries(ARMS.map((a) => [a, r3(wrate(h, a, 'points'))])) }]; }));
  out.by_face = Object.fromEntries([...new Set(ps.map((p) => p.face))].sort().map((f) => { const h = ps.filter((p) => p.face === f); return [f, { pages: h.length, accept: Object.fromEntries(ARMS.map((a) => [a, `${h.filter((p) => acc(p.arms[a])).length}/${h.length}`])) }]; }));
  out.arm_outcomes = Object.fromEntries(ARMS.map((a) => { const t = {}; for (const p of ps) { const r = p.arms[a].row; const k = r ? (r.written ? 'written' : String(r.why || 'unknown').replace(/\d+(\.\d+)?%/g, 'N%').slice(0, 80)) : 'not run'; t[k] = (t[k] ?? 0) + 1; } return [a, t]; }));
  out.camena = camena(ps);
  out.agy_calls_total = jsonl(path.join(OUT, 'arms.jsonl')).filter((r) => !r.quota && !r.superseded).reduce((a, r) => a + (r.calls || 0), 0) + jsonl(path.join(OUT, 'tags.jsonl')).length;
  // the defect counts defect-rate.py --add-pooled reads (one page a book: pages = books)
  out.pooled = Object.fromEntries(ARMS.map((a) => { const c = out.arms[a].defect_counts; return [a, { pages: out.arms[a].judged, misleads: { defects: c.misleads, words: c.words }, wrong_text: { defects: c.wrong_text, words: c.words } }]; }));
  const wb = writebackRows(ps);
  R('writeback.json', { rule: 'per page: the best judged arm (accepted; then fidelity; then fewer wrong_text, misleads, cosmetic; ties to the cheaper arm, read4 < pero4 < live), only where it was accepted and is the text its own dry apply would write, and the page was still unread when the arm read it.', pages: wb });
  out.writeback = { pages: wb.length, by_arm: wb.reduce((t, x) => ({ ...t, [x.arm]: (t[x.arm] ?? 0) + 1 }), {}) };
  R('score.json', out);
  R('router-evidence.score.json', evidence(ps, vo));
  console.log(`${ps.length} pages; instrument ${JSON.stringify({ wp: out.instrument.wrong_page, planted: out.instrument.planted, valid: out.instrument.valid })}`);
  for (const a of ARMS) { const b = out.arms[a]; console.log(`  ${a.padEnd(6)} written ${b.written.k}/${b.written.n} | accept all ${b.accept_all_drawn.k}/${b.accept_all_drawn.n} w ${b.accept_all_drawn_weighted} ${JSON.stringify(b.accept_all_drawn_weighted_ci95)} | written ${b.accept_written.k}/${b.accept_written.n} | sev ${b.severity_per_1000} ${JSON.stringify(b.severity_per_1000_ci95)} | wt ${b.defects_per_1000_weighted.wrong_text} ml ${b.defects_per_1000_weighted.misleads} | fid ${b.fidelity_mean_weighted} | calls/pg ${b.agy_calls_per_page}`); }
  for (const c of out.primary_severity) console.log(`  severity ${c.contrast}: diff ${c.diff_weighted} ${JSON.stringify(c.ci95)} n ${c.n} wilcoxon p ${c.wilcoxon.p} holm ${c.holm_p}`);
  for (const [k, c] of Object.entries(pairs)) console.log(`  accept ${k}: +${c.gained}/-${c.lost} of ${c.n} p ${c.mcnemar_exact_p} eff ${c.effect_points_weighted} ${JSON.stringify(c.effect_ci95_points)}`);
  console.log(`  gate ${JSON.stringify(out.gate)}`);
  console.log(`  S1: ${out.decision_s1.decision} → ${out.decision_s1.route} ${JSON.stringify(out.decision_s1.picks)} gates ${JSON.stringify(out.decision_s1.gates)}`);
  console.log(`  S1 (GPU priced): ${out.decision_s1_gpu_priced.decision} → ${out.decision_s1_gpu_priced.route}`);
  console.log(JSON.stringify({ writeback: out.writeback, camena: out.camena.pages.length }));
}

/**
 * What build.py decides with this study pooled in, on a copy of origin/main: (1) rules.json evidence entries naming the
 * export for the three latin-blank routes (k/n), (2) this study's defect counts added to defect-rate.py's ADD and
 * --add-pooled run (the S1 rates). Nothing in the checkout's rules.json / defect-rates.json is changed by this stage.
 */
async function router() {
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const { rebuildInputs, addEvidence } = await import('../lane-judge-sampler.mjs');
  const EV = `${RT}/evidence/latin-paired-6740.score.json`;
  const sh = (cmd, args, o = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...o }); if (r.status) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${r.stderr}`); return r.stdout; };
  sh('git', ['-C', ROOT, 'fetch', '-q', 'origin', 'main']);
  const rulesText = sh('git', ['-C', ROOT, 'show', `origin/main:${RT}/rules.json`]), rules = JSON.parse(rulesText);
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'lp6740-router-'));
  const tar = spawnSync('git', ['-C', ROOT, 'archive', '--format=tar', 'origin/main', ...rebuildInputs(rules, RT), 'scripts/eval/route-judge-6740', 'scripts/eval/correction-pass-7818/results', 'scripts/eval/fraktur-paired-7835/results'], { maxBuffer: 1 << 30 });
  sh('tar', ['-x', '-C', dir], { input: tar.stdout, encoding: undefined });
  const ev = JSON.parse(fs.readFileSync(path.join(RESULTS, 'router-evidence.score.json'), 'utf8'));
  for (const base of [dir, ROOT]) { fs.mkdirSync(path.dirname(path.join(base, EV)), { recursive: true }); fs.writeFileSync(path.join(base, EV), JSON.stringify(ev, null, 1) + '\n'); }
  const sc = path.join(dir, 'scripts/eval/latin-paired-6740/results'); fs.mkdirSync(sc, { recursive: true }); fs.copyFileSync(path.join(RESULTS, 'score.json'), path.join(sc, 'score.json'));
  const py = (name, extra = []) => sh('python3', [`${RT}/build.py`, '--name', name, ...extra], { cwd: dir });
  py('baseline');
  // (1) k/n evidence
  let text = rulesText; const added = [];
  for (const arm of ARMS) { const route = ROUTES[arm]; if (!ev.cells['latin-blank']?.routes?.[route]) continue; text = addEvidence(text, 'latin-blank', route, { score: EV, cell: 'latin-blank', route }); added.push(route); }
  fs.writeFileSync(path.join(dir, RT, 'rules.json'), text);
  // (2) the defect counts pooled into defect-rates.json (defect-rate.py ADD, the #7818/#7835 path)
  const drp = path.join(dir, 'scripts/eval/route-judge-6740/defect-rate.py');
  const add = ARMS.map((a) => `    ('latin-blank', '${ROUTES[a]}', 'scripts/eval/latin-paired-6740/results/score.json', ('pooled', '${a}'), ('pooled', '${a}', 'pages'), 'latin-paired-6740 ${a}'),`).join('\n');
  fs.writeFileSync(drp, fs.readFileSync(drp, 'utf8').replace(/^ADD = \[\n/m, `ADD = [\n${add}\n`));
  sh('python3', [drp, '--add-pooled', 'scripts/eval/route-judge-6740/results/defect-rate-2026-10-30'], { cwd: dir });
  py('with-6740', ['--before', `${RT}/baseline.json`]);
  const rows = (n) => JSON.parse(fs.readFileSync(path.join(dir, RT, `${n}.json`), 'utf8')).rows;
  const pick = (rs) => rs.filter((r) => /^latin-blank/.test(r.id)).map((r) => ({ id: r.id, decision: r.decision, route: r.route, decision_kn: r.decision_kn, route_kn: r.route_kn, defects: r.defects ?? r.defect_rule ?? null, routes: r.routes.map((x) => ({ id: x.id, k: x.k, n: x.n, wrong: x.wrong, mean: x.mean })) }));
  const out = { main_sha: sh('git', ['-C', ROOT, 'rev-parse', '--short', 'origin/main']).trim(), evidence_added: added, defect_counts_pooled: ARMS.map((a) => ROUTES[a]), baseline: pick(rows('baseline')), with_6740: pick(rows('with-6740')), note: 'what build.py decides with this export and these defect counts pooled; the checkout\'s rules.json and defect-rates.json are NOT changed by this stage' };
  R('router-check.json', out);
  for (const k of ['baseline', 'with_6740']) for (const r of out[k]) console.log(`${k} ${r.id}: ${r.decision} ${r.route} (k/n ${r.decision_kn} ${r.route_kn})`);
}

const stages = { score, router };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
