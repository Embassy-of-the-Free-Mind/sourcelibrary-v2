#!/usr/bin/env node
// PRIOR ART: scripts/eval/flash-reread-5924/score.mjs (pairwise unblinding: preference, material loss, "worse" rule —
// reused below as `worse`), scripts/eval/lane-judge-sampler.mjs exportScore (the router evidence format, imported),
// scripts/eval/lib/{paired-stats,agreement-stats}.mjs (exact sign test, Wilson, kappa, AUC). Committed before any
// verdict is unblinded (#7818 PREREGISTRATION §A).
/**
 * The preregistered analysis of #7818. Reads OUT (verdicts, items, frame, Wikisource set) and writes results/:
 * score.json (every H), tables.md, router-evidence.score.json (Arm P as route-judge evidence), writeback.json.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/correction-pass-7818/analyze.mjs score
 *   ... analyze.mjs h4      (exploratory: router tests vs the lane, Mongo read-only)
 *   ... analyze.mjs h5      (exploratory: latin-blank in lane_judge_verdicts, Mongo read-only)
 */
import fs from 'node:fs';
import path from 'node:path';
import { OUT, RESULTS, ROOT, J, jsonl, sha, scoreText, unexplainedInsertions, wrongText, NORMALISATION, SEED } from './lib.mjs';
import { binomTwoSided, makeRng } from '../lib/paired-stats.mjs';
import { wilson, binaryAgreement, aucLowerIsPositive } from '../lib/agreement-stats.mjs';
import { clusterCI } from '../route-judge-6740/judge.mjs';
import { exportScore, PLANT_BAR } from '../lane-judge-sampler.mjs';
import { CORRECT_LANE } from '../../batch/cli-ocr-lane.mjs';

const R = (f, x) => { fs.mkdirSync(RESULTS, { recursive: true }); fs.writeFileSync(path.join(RESULTS, f), typeof x === 'string' ? x : JSON.stringify(x, null, 1) + '\n'); };
const kn = (k, n) => ({ k, n, rate: n ? +(k / n).toFixed(3) : null, wilson95: n ? wilson(k, n).map((x) => +x.toFixed(3)) : null });
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r3 = (x) => (x == null ? null : +x.toFixed(3));

/** Φ (standard normal CDF), Abramowitz–Stegun 7.1.26. */
function phi(z) { const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2); return z >= 0 ? (1 + y) / 2 : (1 - y) / 2; }
/** Wilcoxon signed-rank, two-sided, zeros dropped, normal approximation with tie and continuity correction. */
export function wilcoxon(d) {
  const nz = d.filter((x) => x !== 0), n = nz.length;
  if (n === 0) return { n: 0, w_plus: 0, z: 0, p: 1 };
  const abs = nz.map((x, i) => ({ a: Math.abs(x), s: Math.sign(x), i })).sort((x, y) => x.a - y.a);
  let tie = 0;
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && abs[j + 1].a === abs[i].a) j++; const rk = (i + j + 2) / 2, t = j - i + 1; for (let k = i; k <= j; k++) abs[k].r = rk; tie += t ** 3 - t; i = j + 1; }
  const wp = abs.filter((x) => x.s > 0).reduce((a, x) => a + x.r, 0);
  const mu = n * (n + 1) / 4, v = n * (n + 1) * (2 * n + 1) / 24 - tie / 48;
  const z = v > 0 ? (wp - mu - 0.5 * Math.sign(wp - mu)) / Math.sqrt(v) : 0;
  return { n, w_plus: wp, z: r3(z), p: +(2 * (1 - phi(Math.abs(z)))).toPrecision(3) };
}
/** Page bootstrap 95% CI of the mean (one page per book or work, so the page is the cluster). */
const ci = (vals, seed) => clusterCI(vals.map((v, i) => ({ book: `u${i}`, v })), seed).ci95;
/** Logistic regression y ~ x by IRLS; returns { b0, b1, x50 } (x at which P(y) = 0.5). */
export function logit(xs, ys) {
  let b0 = 0, b1 = 0;
  for (let it = 0; it < 100; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (let i = 0; i < xs.length; i++) { const p = 1 / (1 + Math.exp(-(b0 + b1 * xs[i]))), w = Math.max(p * (1 - p), 1e-9); g0 += ys[i] - p; g1 += (ys[i] - p) * xs[i]; h00 += w; h01 += w * xs[i]; h11 += w * xs[i] * xs[i]; }
    const det = h00 * h11 - h01 * h01; if (Math.abs(det) < 1e-12) break;
    const d0 = (h11 * g0 - h01 * g1) / det, d1 = (h00 * g1 - h01 * g0) / det;
    b0 += d0; b1 += d1; if (Math.abs(d0) + Math.abs(d1) < 1e-9) break;
    if (Math.abs(b1) > 1e4) break;   // separation: the slope runs off; x50 is then the boundary
  }
  return { b0, b1, x50: b1 ? -b0 / b1 : null };
}

function load() {
  const items = J('items.json');
  const vo = jsonl(path.join(OUT, 'verdicts-opus.jsonl'));
  const abs = new Map(vo.filter((r) => r.set === 'abs' && r.rep === 1 && r.verdict).map((r) => [r.id, r]));
  const pairs = new Map(jsonl(path.join(OUT, 'pairs-opus.jsonl')).filter((r) => r.answer).map((r) => [r.pair, r]));
  const agy = new Map(jsonl(path.join(OUT, 'verdicts-agy.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r]));
  const key = fs.existsSync(path.join(OUT, 'pairs-key.json')) ? J('pairs-key.json') : {};
  return { items, vo, abs, pairs, agy, key };
}
/** Per page: before (draft) and after (served) verdicts; a `same` item stands for both. */
function pagesOf(items, abs, arm) {
  const by = new Map();
  for (const it of items.filter((i) => i.arm === arm)) { if (!by.has(it.key)) by.set(it.key, { key: it.key, page: it.page, lang: it.lang }); const p = by.get(it.key); if (it.role === 'same') { p.draft = it; p.served = it; p.same = true; } else p[it.role] = it; }
  return [...by.values()].map((p) => ({ ...p, vb: abs.get(p.draft?.id)?.verdict, va: abs.get(p.served?.id)?.verdict }));
}
/** score.mjs's preference read, unblinded: who was preferred, verdicts by arm, and #5924's "worse". */
function unblind(pr, key) {
  const k = key[pr.pair], sIsX = k === 'X=served', a = pr.answer;
  const vS = sIsX ? a.X : a.Y, vD = sIsX ? a.Y : a.X;
  const prefer = a.prefer === 'tie' ? 'tie' : (a.prefer === 'X') === sIsX ? 'served' : 'draft';
  return { prefer, loser_material: !!a.loser_material, served: vS.verdict, draft: vD.verdict,
    worse: (vS.verdict === 'misleading' && vD.verdict !== 'misleading') || (prefer === 'draft' && !!a.loser_material),
    better: (vD.verdict === 'misleading' && vS.verdict !== 'misleading') || (prefer === 'served' && !!a.loser_material), why: a.why };
}
function pairBlock(rows) {
  const n = rows.length, c = (f) => rows.filter(f).length;
  return { n, prefer_served: c((r) => r.prefer === 'served'), prefer_draft: c((r) => r.prefer === 'draft'), tie: c((r) => r.prefer === 'tie'),
    served_misleading: kn(c((r) => r.served === 'misleading'), n), draft_misleading: kn(c((r) => r.draft === 'misleading'), n),
    worse: c((r) => r.worse), better: c((r) => r.better), sign_test_p: +binomTwoSided(c((r) => r.prefer === 'served'), c((r) => r.prefer !== 'tie')).toPrecision(3) };
}

function score() {
  const { items, vo, abs, pairs, agy, key } = load();
  const F = J('frame/frame.json');
  const frameOf = new Map(F.drawn.map((d) => [d.page_id, d]));
  const out = { generated_at: new Date().toISOString(), seeds: SEED, normalisation: NORMALISATION, calls: { opus_abs: vo.filter((r) => r.set === 'abs').length, opus_pairs: jsonl(path.join(OUT, 'pairs-opus.jsonl')).length, opus_controls: vo.filter((r) => r.set !== 'abs').length, unparsed: vo.filter((r) => !r.verdict).length, agy: jsonl(path.join(OUT, 'verdicts-agy.jsonl')).length, list_usd_equiv: +vo.reduce((a, r) => a + (r.list_usd || 0), 0).toFixed(2) } };

  // ── H3 first: the instrument ──
  const noise = fs.existsSync(path.join(OUT, 'noise.json')) ? J('noise.json') : null;
  const wp = vo.filter((r) => r.set === 'wrong_page' && r.verdict), pl = vo.filter((r) => r.set === 'planted' && r.verdict);
  const wpPass = wp.filter((r) => !r.verdict.accept && Number(r.verdict.fidelity) <= 2).length, plCaught = pl.filter((r) => r.catch?.caught).length;
  const both = items.filter((i) => abs.get(i.id) && agy.get(i.id));
  const agyAgree = both.length ? binaryAgreement(both.map((i) => [abs.get(i.id).verdict.accept, agy.get(i.id).verdict.accept])) : null;
  out.H3 = { noise_floor: noise && { n: noise.n, accept_kappa: r3(noise.accept.kappa), accept_observed: r3(noise.accept.observed), fidelity_exact: `${noise.fidelity_exact}/${noise.n}`, fidelity_wkappa: r3(noise.fidelity_wkappa), wrong_text_agree: `${noise.wrong_text_agree}/${noise.n}` },
    controls: { wrong_page: `${wpPass}/${wp.length} rejected at fidelity <= 2`, planted: `${plCaught}/${pl.length} caught`, planted_named: `${pl.filter((r) => r.catch?.named).length}/${pl.length}`,
      valid: wp.length > 0 && wpPass === wp.length && (pl.length === 0 || plCaught / pl.length >= PLANT_BAR) },
    second_judge: agyAgree && { judge: 'gemini-3.8-flash-low via agy (default model)', n: agyAgree.n, accept_kappa: r3(agyAgree.kappa), observed: r3(agyAgree.observed), opus_accept_rate: r3(agyAgree.positive_a), gemini_accept_rate: r3(agyAgree.positive_b),
      by_arm: Object.fromEntries(['P', 'W'].map((a) => { const g = both.filter((i) => i.arm === a); return [a, g.length ? { n: g.length, kappa: r3(binaryAgreement(g.map((i) => [abs.get(i.id).verdict.accept, agy.get(i.id).verdict.accept])).kappa) } : null]; })) } };

  // ── H1: Arm P ──
  out.H1 = {};
  const writeback = [];
  for (const lang of ['de', 'fr']) {
    const ps = pagesOf(items, abs, 'P').filter((p) => p.lang === lang && p.vb && p.va);
    const n = ps.length;
    const b = ps.filter((p) => !p.vb.accept && p.va.accept).length, c = ps.filter((p) => p.vb.accept && !p.va.accept).length;
    const diff = ps.map((p) => (p.va.accept ? 1 : 0) - (p.vb.accept ? 1 : 0));
    const fd = ps.map((p) => Number(p.va.fidelity) - Number(p.vb.fidelity));
    const changed = ps.filter((p) => frameOf.get(p.page)?.outcome === 'written');
    const dChanged = changed.map((p) => (p.va.accept ? 1 : 0) - (p.vb.accept ? 1 : 0));
    const pShare = F.frame[lang].changed_share_pages;
    const effC = mean(dChanged), ciC = dChanged.length ? ci(dChanged, 7818) : null;
    const pr = ps.filter((p) => !p.same).map((p) => pairs.get(`P|${p.key}`)).filter(Boolean).map((x) => unblind(x, key));
    const byOutcome = {};
    for (const o of ['written', 'unchanged', 'contain', 'other']) { const g = ps.filter((p) => frameOf.get(p.page)?.outcome === o); if (g.length) byOutcome[o] = { n: g.length, accept_before: `${g.filter((p) => p.vb.accept).length}/${g.length}`, accept_after: `${g.filter((p) => p.va.accept).length}/${g.length}` }; }
    out.H1[lang] = { pages: n, books: n, changed_in_sample: `${changed.length}/${n}`, frame: F.frame[lang],
      accept_before: kn(ps.filter((p) => p.vb.accept).length, n), accept_after: kn(ps.filter((p) => p.va.accept).length, n),
      gained: b, lost: c, mcnemar_exact_p: +binomTwoSided(b, b + c).toPrecision(3),
      effect_points: r3(100 * mean(diff)), effect_ci95_points: ci(diff, 7818).map((x) => r3(100 * x)),
      effect_of_interest_10pts: (() => { const [lo, hi] = ci(diff, 7818); return lo * 100 >= 10 ? 'CI above +10' : hi * 100 < 10 ? 'CI below +10' : 'CI contains +10'; })(),
      population_page_weighted: { changed_share: pShare, effect_on_changed_points: r3(100 * effC), ci95_on_changed: ciC?.map((x) => r3(100 * x)), effect_points: r3(100 * pShare * effC), ci95_points: ciC?.map((x) => r3(100 * pShare * x)) },
      fidelity: { mean_before: r3(mean(ps.map((p) => Number(p.vb.fidelity)))), mean_after: r3(mean(ps.map((p) => Number(p.va.fidelity)))), mean_diff: r3(mean(fd)), ci95: ci(fd, 7819).map(r3), wilcoxon: wilcoxon(fd) },
      wrong_text_before: kn(ps.filter((p) => wrongText(p.vb)).length, n), wrong_text_after: kn(ps.filter((p) => wrongText(p.va)).length, n),
      wrong_text_added: ps.filter((p) => !wrongText(p.vb) && wrongText(p.va)).length, wrong_text_removed: ps.filter((p) => wrongText(p.vb) && !wrongText(p.va)).length,
      by_outcome: byOutcome, pairwise: pr.length ? pairBlock(pr) : null,
      supported: binomTwoSided(b, b + c) < 0.05 && b > c };
    // Write-back (#7818): the draft accepted, the correction rejected, wrong text in the correction, and the lane wrote it.
    for (const p of ps) if (frameOf.get(p.page)?.outcome === 'written' && p.vb.accept && !p.va.accept && wrongText(p.va)) {
      const d = frameOf.get(p.page);
      writeback.push({ page_id: p.page, book_id: d.book_id, page_number: d.page_number, lang, run_id: d.revision?.run_id, revision_id: d.revision?.id,
        defects: (p.va.defects || []).filter((x) => x.severity === 'wrong_text').map((x) => ({ class: x.class, quote: String(x.quote || '').slice(0, 120) })) });
    }
  }
  R('writeback.json', { rule: 'Arm P page the lane wrote; judge accepted the draft AND rejected the correction AND tagged wrong_text in it -> restore the draft (revert-run.mjs on the lane run, this page only)', pages: writeback });

  // ── H2 + H3 (AUC): Arm W ──
  out.H2 = {};
  const set = fs.existsSync(path.join(OUT, 'ws', 'set.json')) ? J('ws/set.json').kept : [];
  const corr = new Map(jsonl(path.join(OUT, 'ws', 'corrections.jsonl')).filter((r) => !r.quota).map((r) => [r.slug, r]));
  const aucRows = [], perPage = [];
  for (const lang of ['de', 'fr']) {
    const rows = [];
    for (const p of set.filter((x) => x.lang === lang)) {
      const tf = (k) => { const f = path.join(OUT, 'texts', `W-${p.slug}.${k}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
      const d = tf('draft'), s = tf('served');
      if (d == null || s == null || !corr.has(p.slug)) continue;
      const sd = scoreText(p.reference, d), ss = scoreText(p.reference, s);
      const ins = corr.get(p.slug).outcome === 'written' ? unexplainedInsertions(p.reference, d, s) : { count: 0, runs3: 0, examples: [] };
      const its = items.filter((i) => i.arm === 'W' && i.page === p.slug);
      const vD = abs.get(its.find((i) => i.role === 'draft' || i.role === 'same')?.id)?.verdict, vS = abs.get(its.find((i) => i.role === 'served' || i.role === 'same')?.id)?.verdict;
      const row = { slug: p.slug, lang, year: p.year, level: p.quality_level, fidelity_ref: p.fidelity, outcome: corr.get(p.slug).outcome, aligned: sd.aligned, cer_draft: r3(sd.cer), cer_served: r3(ss.cer), wer_draft: r3(sd.wer), wer_served: r3(ss.wer), ref_chars: sd.ref_chars, unexplained: ins, accept_draft: vD?.accept ?? null, accept_served: vS?.accept ?? null };
      rows.push(row); perPage.push(row);
      if (sd.aligned) {
        if (vD) aucRows.push({ page: p.slug, cer: sd.cer, accept: vD.accept });
        if (vS && corr.get(p.slug).outcome === 'written') aucRows.push({ page: p.slug, cer: ss.cer, accept: vS.accept });
      }
    }
    const ok = rows.filter((r) => r.aligned);
    const dc = ok.map((r) => r.cer_served - r.cer_draft), dw = ok.map((r) => r.wer_served - r.wer_draft);
    const oc = {}; for (const r of rows) oc[r.outcome] = (oc[r.outcome] ?? 0) + 1;
    const wsP = rows.map((r) => pairs.get(`W|W-${r.slug}`)).filter(Boolean).map((x) => unblind(x, key));
    out.H2[lang] = { pages: rows.length, aligned: ok.length, not_aligned: rows.filter((r) => !r.aligned).map((r) => r.slug), outcomes: oc,
      cer_draft_mean: r3(mean(ok.map((r) => r.cer_draft))), cer_served_mean: r3(mean(ok.map((r) => r.cer_served))), cer_diff_mean: r3(mean(dc)), cer_diff_ci95: ok.length ? ci(dc, 7820).map(r3) : null, cer_wilcoxon: wilcoxon(dc),
      wer_draft_mean: r3(mean(ok.map((r) => r.wer_draft))), wer_served_mean: r3(mean(ok.map((r) => r.wer_served))), wer_diff_mean: r3(mean(dw)), wer_diff_ci95: ok.length ? ci(dw, 7821).map(r3) : null, wer_wilcoxon: wilcoxon(dw),
      pages_cer_better: dc.filter((x) => x < -0.001).length, pages_cer_worse: dc.filter((x) => x > 0.001).length,
      unexplained_words: { total: ok.reduce((a, r) => a + r.unexplained.count, 0), pages_with_any: ok.filter((r) => r.unexplained.count > 0).length, pages_with_run3: ok.filter((r) => r.unexplained.runs3 > 0).length },
      accept_draft: kn(ok.filter((r) => r.accept_draft).length, ok.filter((r) => r.accept_draft != null).length), accept_served: kn(ok.filter((r) => r.accept_served).length, ok.filter((r) => r.accept_served != null).length),
      pairwise: wsP.length ? pairBlock(wsP) : null,
      supported: ok.length > 0 && wilcoxon(dc).p < 0.05 && mean(dc) < 0 };
  }
  R('arm-w-pages.json', perPage);
  // H3: does acceptance track CER?
  if (aucRows.length >= 10 && aucRows.some((r) => r.accept) && aucRows.some((r) => !r.accept)) {
    const fit = logit(aucRows.map((r) => r.cer), aucRows.map((r) => (r.accept ? 1 : 0)));
    const rnd = makeRng(7822), pagesW = [...new Set(aucRows.map((r) => r.page))], boots = [];
    for (let b = 0; b < 2000; b++) { const s = []; for (let i = 0; i < pagesW.length; i++) { const pg = pagesW[Math.floor(rnd() * pagesW.length)]; s.push(...aucRows.filter((r) => r.page === pg)); } const f = logit(s.map((r) => r.cer), s.map((r) => (r.accept ? 1 : 0))); if (f.x50 != null && Number.isFinite(f.x50)) boots.push(f.x50); }
    boots.sort((a, b) => a - b);
    out.H3.cer_vs_accept = { n_texts: aucRows.length, pages: pagesW.length, auc_accepted_lower_cer: r3(aucLowerIsPositive(aucRows, (r) => r.cer, (r) => r.accept)),
      logit: { b0: r3(fit.b0), b1: r3(fit.b1) }, cer_at_50pct_accept: r3(fit.x50), cer50_ci95: boots.length > 100 ? [r3(boots[Math.floor(0.025 * boots.length)]), r3(boots[Math.floor(0.975 * boots.length)])] : null,
      accept_by_cer_band: Object.fromEntries([[0, 0.02], [0.02, 0.05], [0.05, 0.1], [0.1, 0.2], [0.2, 1.01]].map(([lo, hi]) => { const g = aucRows.filter((r) => r.cer >= lo && r.cer < hi); return [`${lo}-${hi}`, `${g.filter((r) => r.accept).length}/${g.length}`]; })) };
  }
  R('score.json', out);
  R('tables.md', tables(out));
  // Router evidence (Arm P) in the route-judge format the router pools, built by the sampler's own exportScore.
  R('router-evidence.score.json', evidence(items, vo, frameOf));
  console.log(JSON.stringify({ H1: Object.fromEntries(Object.entries(out.H1).map(([l, x]) => [l, { before: x.accept_before, after: x.accept_after, gained: x.gained, lost: x.lost, p: x.mcnemar_exact_p, eff: x.effect_points, ci: x.effect_ci95_points }])), H2: Object.fromEntries(Object.entries(out.H2).map(([l, x]) => [l, { cer: [x.cer_draft_mean, x.cer_served_mean, x.cer_diff_ci95], p: x.cer_wilcoxon.p }])), H3: out.H3, writeback: writeback.length }, null, 1));
}

/** Store-shaped records for exportScore: the served verdict as `item` (route lite>agy-flash-low), the draft's as `draft`. */
function evidence(items, vo, frameOf) {
  const recs = [];
  const base = (r, it, d) => ({ page_id: it.page, book_id: d.book_id, page_number: d.page_number, cell: it.lang === 'de' ? 'german-lite' : 'french-lite', lane: CORRECT_LANE, lang: it.lang === 'de' ? 'German' : 'French',
    task: 'ocr', script_type: d.script_type, script_source: d.script_source, cell_hand: 'print', judge: { by: 'claude -p --model opus', model_reported: r.model, prompt_template_sha: null, instrument: 'route-judge-6740 judgePrompt' },
    run_id: 'correction-pass-7818', judged_at: r.at, verdict: r.verdict, write: { revision_id: d.revision?.id ?? `unchanged:${it.page}` }, draw: { stratum: 'random', frame: 'lane ledger (processed pages), #7818' } });
  for (const r of vo.filter((x) => x.verdict && x.arm === 'P')) {
    // abs: the item itself; planted: the item it was planted in; wrong_page: the item whose IMAGE was shown.
    const it = items.find((i) => i.id === r.id) ?? items.find((i) => i.id === r.planted_from) ?? items.find((i) => i.arm === 'P' && i.page === r.page && i.role !== 'draft');
    const d = frameOf.get(r.page); if (!it || !d) continue;
    if (r.set === 'abs' && r.rep === 1) {
      if (it.role !== 'draft') recs.push({ _id: `cp${sha(`item:${it.id}`).slice(0, 14)}`, kind: 'item', route: 'lite>agy-flash-low', ...base(r, it, d) });
      if (it.role !== 'served') recs.push({ _id: `cp${sha(`draft:${it.id}`).slice(0, 14)}`, kind: 'draft', route: 'lite', ...base(r, it, d) });
    } else if (r.set === 'wrong_page') recs.push({ _id: `cp${sha(`wp:${r.id}`).slice(0, 14)}`, kind: 'wrong_page', route: 'lite>agy-flash-low', other_page_id: r.other_page, ...base(r, it, d) });
    else if (r.set === 'planted') recs.push({ _id: `cp${sha(`pl:${r.id}`).slice(0, 14)}`, kind: 'planted', route: 'lite>agy-flash-low', plant: r.plant, planted_from: r.planted_from, catch: r.catch, ...base(r, it, d) });
  }
  const s = exportScore(recs);
  return { ...s, source: 'correction-pass-7818 (#7818 Arm P)', file: 'scripts/eval/correction-pass-7818/results/router-evidence.score.json',
    frame: 'one page per book from every page the #7558 lane PROCESSED (its gex45 ledger, changed or not), German and French print; the served verdict is the route lite>agy-flash-low as readers get it (an unchanged page serves its draft), the draft verdict is route lite. Seeded, PREREGISTRATION 2026-10-31-correction-pass-paired-7818.md.' };
}

function tables(o) {
  const L = [];
  L.push('| language | pages | changed (sample) | accepted before | accepted after | gained | lost | McNemar p | effect (points, 95% CI) | fidelity diff (95% CI) | wrong text before → after |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [l, x] of Object.entries(o.H1)) L.push(`| ${l} | ${x.pages} | ${x.changed_in_sample} | ${x.accept_before.k}/${x.pages} | ${x.accept_after.k}/${x.pages} | ${x.gained} | ${x.lost} | ${x.mcnemar_exact_p} | ${x.effect_points} (${x.effect_ci95_points?.join(' to ')}) | ${x.fidelity.mean_diff} (${x.fidelity.ci95?.join(' to ')}) | ${x.wrong_text_before.k} → ${x.wrong_text_after.k} |`);
  L.push('', '| language | pages (aligned) | CER draft | CER served | diff (95% CI) | Wilcoxon p | WER draft | WER served | better / worse pages | unexplained words (pages with a 3-word run) |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const [l, x] of Object.entries(o.H2)) L.push(`| ${l} | ${x.aligned}/${x.pages} | ${x.cer_draft_mean} | ${x.cer_served_mean} | ${x.cer_diff_mean} (${x.cer_diff_ci95?.join(' to ')}) | ${x.cer_wilcoxon.p} | ${x.wer_draft_mean} | ${x.wer_served_mean} | ${x.pages_cer_better} / ${x.pages_cer_worse} | ${x.unexplained_words.total} (${x.unexplained_words.pages_with_run3}) |`);
  return L.join('\n') + '\n';
}

/** H4 (exploratory): the router tests' de-lite / fr-lite pages against the lane's, on the covariates named in #7818. */
async function h4() {
  const { MongoClient } = await import('mongodb');
  const RT = path.join(ROOT, 'scripts/eval/route-judge-6740/results/router-tests-2026-10-26');
  const key = JSON.parse(fs.readFileSync(path.join(RT, 'key.json'), 'utf8')).filter((k) => ['de-lite', 'fr-lite'].includes(k.cell));
  const zlib = await import('node:zlib');
  const verd = new Map(zlib.gunzipSync(fs.readFileSync(path.join(RT, 'verdicts-opus.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  const F = J('frame/frame.json'), { items, abs } = load();
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const bookIds = [...new Set([...key.map((k) => k.book_id), ...F.drawn.map((d) => d.book_id)])];
  const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }, { projection: { id: 1, year: 1, typeface: 1, script: 1, font: 1 } }).toArray()).map((b) => [b.id, b]));
  await c.close();
  const century = (y) => (y ? `${Math.floor(Number(y) / 100) + 1}th` : 'unknown');
  const cov = (rows) => { const t = {}; for (const r of rows) t[r] = (t[r] ?? 0) + 1; return t; };
  const out = { note: 'exploratory (#7818 H4); the router tests drew from all Flash-Lite pages of visible idle books, the lane from the same frame (cli-ocr-lane.mjs correctablePages); the test pages were drawn for the test, the lane pages are what it served.' };
  for (const [cell, lang] of [['de-lite', 'de'], ['fr-lite', 'fr']]) {
    const t = key.filter((k) => k.cell === cell);
    const lite = t.filter((k) => k.route === 'lite'), corr = t.filter((k) => k.route === 'lite>agy-flash-low');
    const P = F.drawn.filter((d) => d.lang === lang);
    const draftLen = (d) => { const f = path.join(OUT, 'texts', `P-${d.page_id}.draft.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').length : null; };
    const pa = items.filter((i) => i.arm === 'P' && i.lang === lang && i.role !== 'served');
    out[cell] = {
      router_test: { pages: lite.length, draft_accept: `${lite.filter((k) => verd.get(k.judged_as)?.accept).length}/${lite.length}`, corrected_accept: `${corr.filter((k) => verd.get(k.judged_as)?.accept).length}/${corr.length}`, centuries: cov(lite.map((k) => century(books.get(k.book_id)?.year))) },
      lane: { pages: P.length, draft_accept: `${pa.filter((i) => abs.get(i.id)?.verdict.accept).length}/${pa.filter((i) => abs.get(i.id)).length}`, centuries: cov(P.map((d) => century(books.get(d.book_id)?.year))),
        draft_chars_median: (() => { const a = P.map(draftLen).filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; })(), outcomes: cov(P.map((d) => d.outcome)) },
      typeface_field: [...books.values()].some((b) => b.typeface || b.font) ? 'present on some books' : 'not recorded on books (Fraktur / Antiqua not measured)',
    };
  }
  const meta = fs.existsSync(path.join(OUT, 'lane-reads')) ? fs.readdirSync(path.join(OUT, 'lane-reads'), { recursive: true }).filter((f) => String(f).endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, 'lane-reads', f), 'utf8'))) : [];
  out.lane_reads = { n: meta.length, models: cov(meta.map((m) => m.model)), cli_versions: cov(meta.map((m) => m.cli_version)), modes: cov(meta.map((m) => m.mode)), lanes: cov(meta.map((m) => m.lane)), per_call: cov(meta.map((m) => m.call_pages ?? 1)), template_sha_by_prompt: 'see results/h4-templates.json (stage reads)' };
  R('h4.json', out);
  console.log(JSON.stringify(out, null, 1));
}

/** H5 (exploratory): latin-blank's k/n in the sampler store, split before anyone quotes it against arm c's 18/18. */
async function h5() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const rs = await c.db('bookstore').collection('lane_judge_verdicts').find({ cell: 'latin-blank', kind: 'item', verdict: { $ne: null } }, { projection: { route: 1, lane: 1, script_type: 1, draw: 1, verdict: 1, book_id: 1, judged_at: 1 } }).toArray();
  await c.close();
  const split = (f) => { const t = {}; for (const r of rs) { const k = f(r); (t[k] ??= []).push(r); } return Object.fromEntries(Object.entries(t).map(([k, g]) => [k, { accept: `${g.filter((r) => r.verdict.accept).length}/${g.length}`, wilson95: wilson(g.filter((r) => r.verdict.accept).length, g.length).map(r3), wrong_text: `${g.filter((r) => wrongText(r.verdict)).length}/${g.length}`, books: new Set(g.map((r) => r.book_id)).size }])); };
  const out = { at: new Date().toISOString(), n: rs.length, all: split(() => 'all').all, by_stratum: split((r) => r.draw?.stratum ?? 'random'), by_route: split((r) => r.route), by_lane: split((r) => r.lane), by_script: split((r) => r.script_type ?? 'unknown'),
    by_route_and_stratum: split((r) => `${r.route} | ${r.draw?.stratum ?? 'random'}`) };
  R('h5.json', out);
  console.log(JSON.stringify(out, null, 1));
}

const stages = { score, h4, h5 };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
