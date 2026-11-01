#!/usr/bin/env node
// PRIOR ART: scripts/eval/fraktur-paired-7835/analyze.mjs (controls block, the exportScore record shape for router
// evidence), scripts/eval/lib/agreement-stats.mjs (wilson, aucLowerIsPositive: imported), route-judge-6740/
// defect-rate.mjs words() (#7824's word count: imported), correction-pass-7818 SEVERITY_WEIGHTS (MQM 1/5/25:
// imported). Spearman, a weighted AUC and the one-way ICC are small and restated here (none existed in scripts/eval/lib).
/**
 * #7866 analysis (experiment file §Analysis). Committed with the preregistration, before any judge call.
 *
 *   node scripts/eval/confidence-7866/analyze.mjs score       → results/score.json (+ bad-books.json)
 *   node --env-file=... scripts/eval/confidence-7866/analyze.mjs writeback [--apply]
 *        verdicts to lane_judge_verdicts (cell namespaced study-7866/<cell>: the nightly export pools the store by
 *        cell, and these must not move a route) and the router evidence file (real cell names, no rules.json entry)
 */
import fs from 'node:fs';
import path from 'node:path';
import { OUT, RESULTS, J, jsonl, SEED, makeRng, sha, flag, words, routeOf, scriptOf, routerLookup } from './lib.mjs';
import { wilson, aucLowerIsPositive, binaryAgreement } from '../lib/agreement-stats.mjs';
import { SEVERITY_WEIGHTS } from '../correction-pass-7818/lib.mjs';
import { scorePlant } from '../lib/plant-ocr-errors.mjs';

const VO = path.join(OUT, 'verdicts-opus.jsonl'), VG = path.join(OUT, 'verdicts-gemini.jsonl'), VA = path.join(OUT, 'verdicts-argon.jsonl');
const W8 = SEVERITY_WEIGHTS.main;
const STRATA = ['high', 'middle', 'low', 'unmeasured'];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));
const wrongTextV = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');
/** A page is BAD when the judge did not accept it or it carries a wrong_text defect. */
export const badPage = (v) => !v.accept || wrongTextV(v);
/** A book is BAD when at least 2 of its judged pages are bad (it needs >= 4 judged pages to be classified). */
export const BAD_BOOK_MIN = 2, MIN_JUDGED = 4;
/** Containment candidates: wrong_text defects of the classes that mean "not this leaf's text". */
const CONTAIN = /^(O1|O2|O3|I1|T17)$/;

// ── statistics ──
const rank = (xs) => { const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(xs.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
export function spearman(x, y) {
  if (x.length < 3) return null;
  const rx = rank(x), ry = rank(y), mx = mean(rx), my = mean(ry);
  let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? n / Math.sqrt(dx * dy) : null;
}
/** AUC with lower score = positive, each pair weighted by the product of the two books' design weights. */
export function weightedAuc(rows, score, isPos, w = () => 1) {
  const P = rows.filter(isPos), N = rows.filter((r) => !isPos(r));
  let c = 0, t = 0;
  for (const p of P) for (const q of N) { const ww = w(p) * w(q); t += ww; c += ww * (score(p) < score(q) ? 1 : score(p) === score(q) ? 0.5 : 0); }
  return t ? c / t : null;
}
/** Book-cluster bootstrap: resample books with replacement, 4,000 times; 95% percentile interval of stat(books). */
function boot(books, stat, seed, iters = 4000) {
  const rnd = makeRng(seed), vals = [];
  for (let i = 0; i < iters; i++) { const s = []; for (let j = 0; j < books.length; j++) s.push(books[Math.floor(rnd() * books.length)]); const v = stat(s); if (v != null && Number.isFinite(v)) vals.push(v); }
  vals.sort((a, b) => a - b);
  return vals.length > 100 ? [r3(vals[Math.floor(0.025 * vals.length)]), r3(vals[Math.floor(0.975 * vals.length) - 1])] : null;
}
/** One-way random-effects ICC(1), ANOVA estimator with unequal group sizes (n0). groups: arrays of page values. */
export function icc1(groups) {
  const g = groups.filter((x) => x.length >= 2), k = g.length, N = g.reduce((s, x) => s + x.length, 0);
  if (k < 3) return null;
  const grand = g.flat().reduce((a, b) => a + b, 0) / N;
  let ssb = 0, ssw = 0; for (const x of g) { const m = mean(x); ssb += x.length * (m - grand) ** 2; for (const v of x) ssw += (v - m) ** 2; }
  const msb = ssb / (k - 1), msw = ssw / (N - k), n0 = (N - g.reduce((s, x) => s + x.length ** 2, 0) / N) / (k - 1);
  return (msb - msw) / (msb + (n0 - 1) * msw);
}
const spearmanBrown = (icc, k) => (icc == null ? null : (k * icc) / (1 + (k - 1) * icc));

// ── load ──
function load() {
  const D = J('draw.json').drawn, items = J('items.json'), vo = jsonl(VO);
  const V = new Map(); for (const r of vo.filter((x) => x.set === 'abs' && x.verdict)) V.set(r.id, r);
  const books = D.map((b) => {
    const its = items.filter((i) => i.book === b.id);
    const pages = its.map((i) => {
      const r = V.get(i.id); if (!r) return { ...i, judged: false };
      const t = fs.readFileSync(path.join(OUT, 'texts', `${i.page}.txt`), 'utf8'), wds = words(t), v = r.verdict;
      const sev = { cosmetic: 0, misleads: 0, wrong_text: 0 }; for (const d of v.defects || []) if (sev[d.severity] != null) sev[d.severity]++;
      return { ...i, judged: true, v, words: wds, sev, points: sev.cosmetic * W8.cosmetic + sev.misleads * W8.misleads + sev.wrong_text * W8.wrong_text, bad: badPage(v), at: r.at, model: r.model };
    });
    const J_ = pages.filter((p) => p.judged), wsum = J_.reduce((s, p) => s + p.words, 0), psum = J_.reduce((s, p) => s + p.points, 0);
    const nBad = J_.filter((p) => p.bad).length;
    return { ...b, pages, judged: J_.length, words: wsum, points: psum,
      defect_rate: J_.length ? (1000 * psum) / Math.max(1, wsum) : null,       // MQM points per 1,000 words, pooled over the book's pages
      accept_rate: J_.length ? J_.filter((p) => p.v.accept).length / J_.length : null,
      n_bad: nBad, classified: J_.length >= MIN_JUDGED, bad: J_.length >= MIN_JUDGED ? nBad >= BAD_BOOK_MIN : null };
  });
  return { books, vo, items };
}

// ── the parts ──
function controlsBlock(vo) {
  const wp = vo.filter((r) => r.set === 'wrong_page' && r.verdict), pl = vo.filter((r) => r.set === 'planted' && r.verdict);
  const wpPass = wp.filter((r) => !r.verdict.accept && Number(r.verdict.fidelity) <= 2).length;
  const caught = pl.filter((r) => (r.catch ?? scorePlant(r.verdict, r.plant))?.caught).length;
  const valid = wp.length > 0 && wpPass === wp.length && pl.length > 0 && caught / pl.length >= 0.8;
  return { wrong_page: `${wpPass}/${wp.length} rejected at fidelity <= 2`, planted: `${caught}/${pl.length} caught`, planted_rate: pl.length ? r3(caught / pl.length) : null, valid,
    rule: 'valid when every wrong-page control is rejected at fidelity <= 2 and >= 0.80 of plants are caught (the sampler\'s bar)',
    by_stratum: Object.fromEntries(STRATA.map((s) => [s, { wrong_page: `${wp.filter((r) => r.stratum === s && !r.verdict.accept && r.verdict.fidelity <= 2).length}/${wp.filter((r) => r.stratum === s).length}`, planted: `${pl.filter((r) => r.stratum === s && (r.catch ?? scorePlant(r.verdict, r.plant))?.caught).length}/${pl.filter((r) => r.stratum === s).length}` }])) };
}

/** Signals evaluated one at a time: each a per-book number where a HIGHER value should mean a BETTER book. */
function signalTable(books, revs) {
  const R = new Map((revs || []).map((r) => [r.id, r]));
  const sig = {
    confidence_score: (b) => b.score,
    p_route: (b) => b.p_route,
    one_minus_flag_share: (b) => 1 - b.flag_share,
    route_wrong_text_per_1k_neg: (b) => (b.wrong_text_per_1k == null ? null : -b.wrong_text_per_1k),
    served_is_decided: (b) => (b.served_is_decided == null ? null : b.served_is_decided ? 1 : 0),
    cell_decided_keep_switch: (b) => (b.top_decision == null ? null : /^(keep|switch)\b/.test(b.top_decision) && !/UNTESTED/.test(b.top_decision) ? 1 : 0),
    route_measured: (b) => (b.measured ? 1 : 0),
    no_warning_share: (b) => 1 - b.flags.warn / Math.max(1, b.n_ocr),
    no_poor_fair_scan_tag_share: (b) => 1 - (b.flags.sq_poor + b.sq_fair) / Math.max(1, b.n_ocr),
    page_scan_score: (b) => b.page_scan_mean,
    book_scan_score: (b) => b.book_scan,
    language_tag_agrees: (b) => (b.lang_mismatch == null ? null : 1 - b.lang_mismatch),
    no_near_empty_share: (b) => 1 - b.flags.near_empty / Math.max(1, b.n_ocr),
    no_withheld_share: (b) => 1 - b.flags.withheld / Math.max(1, b.n_ocr),
    revisions_agree: (b) => { const r = R.get(b.id); return r?.disagreement_median == null ? null : 1 - r.disagreement_median; },
    human_read_count: (b) => b.human_read_count,
  };
  const out = {};
  for (const [name, f] of Object.entries(sig)) {
    const rows = books.filter((b) => b.classified && f(b) != null && Number.isFinite(f(b)));
    const bad = rows.filter((b) => b.bad).length;
    out[name] = { books: rows.length, bad, rho_vs_defect_rate: r3(spearman(rows.map(f), rows.map((b) => b.defect_rate))),
      auc_bad: rows.length && bad && bad < rows.length ? r3(aucLowerIsPositive(rows, f, (b) => b.bad)) : null,
      auc_ci95: rows.length >= 10 && bad && bad < rows.length ? boot(rows, (s) => { const nb = s.filter((b) => b.bad).length; return nb && nb < s.length ? aucLowerIsPositive(s, f, (b) => b.bad) : null; }, SEED.bootstrap + 11) : null };
  }
  return out;
}

function score() {
  const { books, vo } = load();
  const revs = fs.existsSync(path.join(OUT, 'draw-revisions.json')) ? J('draw-revisions.json') : null;
  const cls = books.filter((b) => b.classified), meas = cls.filter((b) => b.measured);
  const w = (b) => b.weight;
  const frame = J('scored.json.gz');
  const N = Object.fromEntries(STRATA.map((s) => [s, frame.filter((r) => r.stratum === s).length]));
  const out = { generated_at: new Date().toISOString(), seeds: SEED,
    calls: { opus_abs: vo.filter((r) => r.set === 'abs').length, opus_abs_parsed: vo.filter((r) => r.set === 'abs' && r.verdict).length, opus_controls: vo.filter((r) => r.set !== 'abs').length,
      unparsed_or_error: vo.filter((r) => !r.verdict).length, list_usd_equiv: +vo.reduce((a, r) => a + (r.list_usd || 0), 0).toFixed(2), models: [...new Set(vo.map((r) => r.model).filter(Boolean))] },
    instrument: controlsBlock(vo),
    books: { drawn: books.length, classified: cls.length, measured_classified: meas.length, pages_judged: books.reduce((s, b) => s + b.judged, 0) } };

  // Primary: on measured books, does the score rank books by their observed defect rate, and find the bad ones?
  out.primary = {
    spearman_score_vs_defect_rate: r3(spearman(meas.map((b) => b.score), meas.map((b) => b.defect_rate))),
    spearman_ci95: boot(meas, (s) => spearman(s.map((b) => b.score), s.map((b) => b.defect_rate)), SEED.bootstrap),
    auc_bad_weighted: r3(weightedAuc(meas, (b) => b.score, (b) => b.bad, w)),
    auc_bad_weighted_ci95: boot(meas, (s) => weightedAuc(s, (b) => b.score, (b) => b.bad, w), SEED.bootstrap + 1),
    auc_bad_unweighted: r3(weightedAuc(meas, (b) => b.score, (b) => b.bad)),
    auc_bad_unweighted_ci95: boot(meas, (s) => weightedAuc(s, (b) => b.score, (b) => b.bad), SEED.bootstrap + 2),
    bad_books_measured: `${meas.filter((b) => b.bad).length}/${meas.length}`,
    note: 'Spearman ρ < 0 means higher confidence goes with fewer defects. AUC = P(a bad book scores lower than a good one), pairs weighted by the books\' design weights (the primary); unweighted beside it.' };
  // Within one cell: where p_route is constant, does the rest of the score (the flag share) still rank books? Every
  // cell with >= 20 classified drawn books (preregistered; in this draw only zh-paddle-dice-lt090/manuscript).
  out.within_cell = {};
  for (const cell of [...new Set(meas.map((b) => `${b.top_cell} ${b.top_route}`))]) {
    const g = meas.filter((b) => `${b.top_cell} ${b.top_route}` === cell); if (g.length < 20) continue;
    const nb = g.filter((b) => b.bad).length;
    out.within_cell[cell] = { books: g.length, bad: nb, rho_score_vs_defect_rate: r3(spearman(g.map((b) => b.score), g.map((b) => b.defect_rate))),
      rho_ci95: boot(g, (x) => spearman(x.map((b) => b.score), x.map((b) => b.defect_rate)), SEED.bootstrap + 20),
      auc_bad: nb && nb < g.length ? r3(aucLowerIsPositive(g, (b) => b.score, (b) => b.bad)) : null };
  }
  // All four strata on one ordinal axis (unmeasured as its own group, reported apart): is "unmeasured" itself a risk?
  out.by_stratum = Object.fromEntries(STRATA.map((s) => {
    const g = cls.filter((b) => b.stratum === s), pages = g.flatMap((b) => b.pages.filter((p) => p.judged));
    const acc = pages.filter((p) => p.v.accept).length, nb = g.filter((b) => b.bad).length;
    const pred = mean(g.map((b) => b.p_route).filter((x) => x != null));
    const obs = boot(g, (x) => { const ps = x.flatMap((b) => b.pages.filter((p) => p.judged)); return ps.length ? ps.filter((p) => p.v.accept).length / ps.length : null; }, SEED.bootstrap + 3 + STRATA.indexOf(s));
    return [s, { books: g.length, pages: pages.length, frame_books: N[s],
      bad_books: `${nb}/${g.length}`, bad_share: r3(nb / Math.max(1, g.length)), bad_share_wilson: g.length ? wilson(nb, g.length).map(r3) : null,
      observed_accept: r3(acc / Math.max(1, pages.length)), observed_accept_ci95_by_book: obs, predicted_accept_p_route: r3(pred),
      calibrated: pred == null || !obs ? null : pred >= obs[0] && pred <= obs[1],
      wrong_text_pages: `${pages.filter((p) => wrongTextV(p.v)).length}/${pages.length}`,
      defect_rate_pooled: r3((1000 * pages.reduce((a, p) => a + p.points, 0)) / Math.max(1, pages.reduce((a, p) => a + p.words, 0))),
      defect_rate_median_book: r3([...g.map((b) => b.defect_rate)].sort((a, b) => a - b)[Math.floor(g.length / 2)]) }];
  }));
  // Corpus reweighting: bad share per stratum × the stratum's frame size.
  const corpusBad = (bs) => { let num = 0, den = 0; for (const s of STRATA) { const g = bs.filter((b) => b.stratum === s); if (!g.length) continue; num += N[s] * g.filter((b) => b.bad).length / g.length; den += N[s]; } return den ? num / den : null; };
  const strat = (seed) => { const rnd = makeRng(seed), vals = []; for (let i = 0; i < 4000; i++) { const s = []; for (const st of STRATA) { const g = cls.filter((b) => b.stratum === st); for (let j = 0; j < g.length; j++) s.push(g[Math.floor(rnd() * g.length)]); } vals.push(corpusBad(s)); } vals.sort((a, b) => a - b); return [r3(vals[100]), r3(vals[3899])]; };
  const cb = corpusBad(cls);
  out.corpus = { frame_books: N, bad_share: r3(cb), bad_share_ci95: strat(SEED.bootstrap + 9), bad_books_est: Math.round(cb * Object.values(N).reduce((a, b) => a + b, 0)),
    by_stratum_est: Object.fromEntries(STRATA.map((s) => [s, Math.round(N[s] * (out.by_stratum[s].bad_share ?? 0))])) };
  // Calibration across the measured strata: predicted p_route against observed accept.
  out.calibration = Object.fromEntries(['high', 'middle', 'low'].map((s) => [s, { predicted: out.by_stratum[s].predicted_accept_p_route, observed: out.by_stratum[s].observed_accept, ci95: out.by_stratum[s].observed_accept_ci95_by_book, calibrated: out.by_stratum[s].calibrated }]));
  out.signals = signalTable(cls, revs);
  // ICC: page outcomes clustered in books. Bad page (0/1) and the page's MQM points per 1,000 words (log1p).
  const groupsBad = cls.map((b) => b.pages.filter((p) => p.judged).map((p) => (p.bad ? 1 : 0)));
  const groupsSev = cls.map((b) => b.pages.filter((p) => p.judged).map((p) => Math.log1p((1000 * p.points) / Math.max(1, p.words))));
  const iccB = icc1(groupsBad), iccS = icc1(groupsSev);
  out.icc = { bad_page: r3(iccB), bad_page_ci95: boot(groupsBad, icc1, SEED.bootstrap + 7, 2000), severity_log1p: r3(iccS), severity_ci95: boot(groupsSev, icc1, SEED.bootstrap + 8, 2000),
    reliability_of_book_mean: Object.fromEntries([3, 5, 8].map((k) => [k, { bad_page: r3(spearmanBrown(iccB, k)), severity: r3(spearmanBrown(iccS, k)) }])),
    rule: 'pages per book for a future sweep = the smallest of 3 / 5 / 8 whose Spearman-Brown reliability of the book mean (bad-page share) is >= 0.70; if none, 8 and the book-level call is reported as not reliable from a sample' };
  const k = [3, 5, 8].find((n) => spearmanBrown(iccB, n) >= 0.7) ?? null;
  out.icc.pages_per_book = k ?? 8; out.icc.reliable_at_8 = k != null;
  // Decision rule (preregistered).
  const aucW = out.primary.auc_bad_weighted, calOk = Object.values(out.calibration).filter((c) => c.calibrated != null);
  out.decision = { auc_ge_075: aucW != null && aucW >= 0.75, calibrated_all_measured_strata: calOk.length === 3 && calOk.every((c) => c.calibrated), instrument_valid: out.instrument.valid };
  out.decision.verdict = !out.decision.instrument_valid ? 'INVALID: the judge failed its controls; no result' : out.decision.auc_ge_075 && out.decision.calibrated_all_measured_strata ? 'TRIAGE: confidence discriminates and is calibrated' : 'MORE TESTING: confidence does not meet the bar';
  // Bad books and containment candidates.
  const bad = cls.filter((b) => b.bad).sort((a, b) => b.defect_rate - a.defect_rate).map((b) => ({ id: b.id, title: b.title, language: b.language, stratum: b.stratum, score: b.score, top_route: `${b.top_cell} ${b.top_route}`,
    defect_rate: r3(b.defect_rate), bad_pages: b.pages.filter((p) => p.judged && p.bad).map((p) => p.page_number),
    top_defects: Object.entries(b.pages.filter((p) => p.judged).flatMap((p) => (p.v.defects || []).filter((d) => d.severity !== 'cosmetic').map((d) => `${String(d.class).slice(0, 3)}:${d.severity}`)).reduce((m, k) => (m[k] = (m[k] ?? 0) + 1, m), {})).sort((a, c) => c[1] - a[1]).slice(0, 4).map(([k2, n]) => `${k2}×${n}`) }));
  const contain = books.flatMap((b) => b.pages.filter((p) => p.judged && (p.v.defects || []).some((d) => d.severity === 'wrong_text' && CONTAIN.test(String(d.class).toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? ''))).map((p) => ({ book: b.id, page: p.page_number, page_id: p.page, fidelity: p.v.fidelity, defects: p.v.defects.filter((d) => d.severity === 'wrong_text').map((d) => `${d.class}: ${String(d.quote).slice(0, 60)} (${d.what ?? ''})`), note: p.v.reader_note })));
  out.gemini_secondary = geminiBlock(books, vo);
  out.argon_secondary = geminiBlock(books, vo, { file: VA, label: 'gemini-4-argon-low (agy)' }); // Amendment 1
  out.bad_books_n = bad.length; out.containment_candidates_n = contain.length;
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'score.json'), JSON.stringify(out, null, 1));
  // Defect rates per stratum and per served route (the experiment header's defect_rates file; #7824's rates).
  const rate = (ps) => { const w2 = ps.reduce((a, p) => a + p.words, 0), per = (k) => r3((1000 * ps.reduce((a, p) => a + p.sev[k], 0)) / Math.max(1, w2));
    return { pages: ps.length, books: new Set(ps.map((p) => p.book)).size, words: w2, cosmetic_per_1k: per('cosmetic'), misleads_per_1k: per('misleads'), wrong_text_per_1k: per('wrong_text'),
      fidelity_mean: r3(mean(ps.map((p) => p.v.fidelity))), accept: `${ps.filter((p) => p.v.accept).length}/${ps.length}` }; };
  const jp = books.flatMap((b) => b.pages.filter((p) => p.judged).map((p) => ({ ...p, cellroute: `${b.top_cell} ${b.top_route}` })));
  const byRoute = {}; for (const cr of [...new Set(jp.map((p) => p.cellroute))]) byRoute[cr] = rate(jp.filter((p) => p.cellroute === cr));
  fs.writeFileSync(path.join(RESULTS, 'defect-rates.json'), JSON.stringify({ generated_at: out.generated_at, words: '#7824 words() (route-judge-6740/defect-rate.mjs)', weights: W8,
    note: 'the STORED text of drawn books, judged blind by Opus; a stratified draw (weights in draw.json), not a random sample of any cell',
    by_stratum: Object.fromEntries(STRATA.map((st) => [st, rate(jp.filter((p) => p.stratum === st))])), study_cells: byRoute }, null, 1));
  fs.writeFileSync(path.join(RESULTS, 'bad-books.json'), JSON.stringify({ bad, containment_candidates: contain }, null, 1));
  console.log(JSON.stringify({ instrument: out.instrument, books: out.books, primary: out.primary, by_stratum: out.by_stratum, corpus: out.corpus, icc: out.icc, decision: out.decision }, null, 1));
}

/** Store-shaped records (lane_judge_verdicts, the sampler's schema). `cellReal` is the page's router cell. */
function records() {
  const { books, vo } = load(), R = routerLookup(), recs = [];
  const byPage = new Map(books.flatMap((b) => b.pages.map((p) => [p.page, { b, p }])));
  for (const r of vo.filter((x) => x.verdict)) {
    const e = byPage.get(r.page); if (!e) continue;
    const dp = e.b.pages.find((q) => q.page === r.page), src = J('draw.json').drawn.find((x) => x.id === e.b.id).pages.find((q) => q.page_id === r.page);
    const { base, route } = routeOf({ model: src.model, pipeline: src.pipeline, source: src.source, at4: false }, e.b.language);
    const script = scriptOf(src.script_type);
    const look = R.get(base, script, route);
    const kind = r.set === 'abs' ? 'item' : r.set;
    recs.push({ _id: `cv${sha(`${kind}:${r.id}`).slice(0, 14)}`, kind, page_id: r.page, book_id: e.b.id, page_number: dp?.page_number ?? null,
      cell_real: look.cell ?? `${base}/${script}`, cell: `study-7866/${base ?? 'none'}`, route, lane: 'confidence-7866', lang: e.b.language, task: 'ocr',
      judge: { by: 'claude -p --model opus', model_reported: r.model ?? 'claude-opus-5-5', prompt_sha: r.prompt_sha ?? null, instrument: 'route-judge-6740 judgePrompt' },
      run_id: 'confidence-validation-7866', judged_at: r.at, verdict: r.verdict, usage: r.usage ?? null, list_usd: r.list_usd ?? null,
      draw: { stratum: e.b.stratum, frame: '#7866 live OCR\'d books, stratified by confidence', score: e.b.score, weight: e.b.weight, fifth: dp?.fifth ?? null, seed: SEED.draw },
      write: { revision_id: `stored:${r.page}`, text_sha: dp?.text_sha ?? null },
      ...(r.set === 'planted' && { plant: r.plant, planted_from: r.planted_from, catch: r.catch }), ...(r.set === 'wrong_page' && { other_page_id: r.other_page }) });
  }
  return recs;
}

async function writeback() {
  const recs = records();
  const ev = await import('../lane-judge-sampler.mjs');
  // Router evidence: the same records under their REAL cell names, exported as a file; rules.json does not name it.
  const toReal = (r) => { const [cell, script] = r.cell_real.split('/'); return { ...r, cell, script_type: script, cell_hand: script }; };
  const items = recs.filter((r) => r.kind === 'item' && r.cell_real && !r.cell_real.startsWith('null')).map(toReal);
  // A control tests the judge, not a route: every control is attached to every (cell, route) the items reached, as
  // #7835 did (one judge, one prompt, judged them all).
  const pairs = [...new Map(items.map((r) => [`${r.cell}|${r.route}|${r.cell_hand}`, r])).values()];
  const ctl = recs.filter((r) => r.kind !== 'item');
  const real = [...items, ...pairs.flatMap((p) => ctl.map((c) => ({ ...c, _id: `cv${sha(`${c._id}:${p.cell}:${p.route}:${p.cell_hand}`).slice(0, 14)}`, cell: p.cell, route: p.route, script_type: p.cell_hand, cell_hand: p.cell_hand })))];
  const s = ev.exportScore(real);
  const file = path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../estimator/router-table/evidence'), 'confidence-validation-7866.score.json');
  fs.writeFileSync(file, JSON.stringify({ ...s, source: 'confidence-validation-7866 (#7866)', file: 'scripts/eval/estimator/router-table/evidence/confidence-validation-7866.score.json',
    frame: 'Live OCR\'d books stratified by a confidence score (high 30 / middle 30 / low 50 / unmeasured 50 books, low and unmeasured oversampled), 5 pages a book, one from each fifth; the STORED text judged. Not a random draw of any cell: weights in draw.json. Preregistered: 2026-10-31-confidence-validation-7866.md. Not named in rules.json.' }, null, 1) + '\n');
  console.log(`evidence: ${file} (${real.length} records)`);
  if (!flag('apply')) { console.log(`DRY: ${recs.length} records would go to lane_judge_verdicts (cell study-7866/<cell>); --apply to write`); return; }
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  try {
    const col = c.db('bookstore').collection('lane_judge_verdicts');
    let n = 0; for (const r of recs) { const res = await col.updateOne({ _id: r._id }, { $setOnInsert: r }, { upsert: true }); n += res.upsertedCount; }
    console.log(`lane_judge_verdicts: ${n} inserted, ${recs.length - n} already there`);
  } finally { await c.close(); }
}

/**
 * The secondary judge (Derek, 2026-10-31): agy gemini-3.8-flash-low against Opus on the same texts. Never changes a
 * primary outcome, a bad-book call or containment. Preregistered screen bar: a book flagged when Gemini calls >= 1 of
 * its pages bad; GOOD ENOUGH AS A FIRST SCREEN when it flags >= 0.90 of the Opus-bad books and clears >= 30% of books.
 */
function geminiBlock(books, vo, { file = VG, label = 'gemini-3.8-flash-low (agy)' } = {}) {
  const G = new Map(jsonl(file).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  if (!G.size) return null;
  const pages = books.flatMap((b) => b.pages.filter((p) => p.judged && G.has(p.id)).map((p) => ({ ...p, g: G.get(p.id), b })));
  const modelOf = new Map(J('draw.json').drawn.flatMap((b) => b.pages.map((q) => [q.page_id, q.model || ''])));
  const gem = (p) => /^gemini/i.test(modelOf.get(p.page) || '');
  const pr = (ps) => { if (!ps.length) return null; const a = binaryAgreement(ps.map((p) => [p.v.accept, p.g.accept])); const wt = binaryAgreement(ps.map((p) => [wrongTextV(p.v), wrongTextV(p.g)]));
    const opusBad = ps.filter((p) => p.bad), missed = opusBad.filter((p) => !badPage(p.g));
    return { pages: ps.length, accept_agree: r3(a.observed), accept_kappa: r3(a.kappa), opus_accept: r3(a.positive_a), gemini_accept: r3(a.positive_b), wrong_text_agree: r3(wt.observed), wrong_text_kappa: r3(wt.kappa),
      gemini_misses_opus_bad: `${missed.length}/${opusBad.length}`, miss_rate: opusBad.length ? r3(missed.length / opusBad.length) : null,
      defect_rate_rho: r3(spearman(ps.map((p) => p.points / Math.max(1, p.words)), ps.map((p) => { let x = 0; for (const d of p.g.defects || []) x += W8[d.severity] ?? 0; return x / Math.max(1, p.words); }))) }; };
  const ctl = jsonl(file).filter((r) => r.verdict && r.set !== 'abs');
  const wp = ctl.filter((r) => r.set === 'wrong_page'), pl = ctl.filter((r) => r.set === 'planted');
  // Book level: Gemini's bad-page share as a screen for the Opus bad-book call.
  const bk = books.filter((b) => b.classified).map((b) => { const ps = pages.filter((p) => p.b.id === b.id); return { ...b, g_n: ps.length, g_bad: ps.filter((p) => badPage(p.g)).length }; }).filter((b) => b.g_n >= MIN_JUDGED);
  const flagged = bk.filter((b) => b.g_bad >= 1), opusBad = bk.filter((b) => b.bad);
  const sens = opusBad.filter((b) => b.g_bad >= 1).length;
  const meas = bk.filter((b) => b.measured);
  const gShare = (b) => -(b.g_bad / b.g_n), comb = (b) => b.score * (1 - b.g_bad / b.g_n);
  const out = { model: label, texts_judged: G.size, unparsed: jsonl(file).filter((r) => !r.verdict).length,
    pages_all: pr(pages), self_preference: { stored_text_gemini: pr(pages.filter(gem)), stored_text_other: pr(pages.filter((p) => !gem(p))) },
    controls: { wrong_page: `${wp.filter((r) => !r.verdict.accept && r.verdict.fidelity <= 2).length}/${wp.length}`, planted: `${pl.filter((r) => r.catch?.caught).length}/${pl.length}` },
    screen: { books: bk.length, opus_bad: opusBad.length, flagged_by_gemini: flagged.length, sensitivity: `${sens}/${opusBad.length}`, sensitivity_wilson: opusBad.length ? wilson(sens, opusBad.length).map(r3) : null,
      cleared_share: r3(1 - flagged.length / Math.max(1, bk.length)), good_enough: opusBad.length ? sens / opusBad.length >= 0.9 && 1 - flagged.length / bk.length >= 0.3 : null },
    // Amendment 1, exploratory: the screen at the Opus bad-book rule (>= 2 judged pages bad). Not the bar.
    screen_ge2: (() => { const f2 = bk.filter((b) => b.g_bad >= 2), s2 = opusBad.filter((b) => b.g_bad >= 2).length;
      return { flagged: f2.length, sensitivity: `${s2}/${opusBad.length}`, sensitivity_wilson: opusBad.length ? wilson(s2, opusBad.length).map(r3) : null, cleared_share: r3(1 - f2.length / Math.max(1, bk.length)) }; })(),
    auc_measured_books: { books: meas.length, confidence_score: meas.length ? r3(aucLowerIsPositive(meas, (b) => b.score, (b) => b.bad)) : null,
      gemini_bad_share: meas.length ? r3(aucLowerIsPositive(meas, gShare, (b) => b.bad)) : null, score_x_gemini: meas.length ? r3(aucLowerIsPositive(meas, comb, (b) => b.bad)) : null },
    auc_all_books_gemini_bad_share: bk.length ? r3(aucLowerIsPositive(bk, gShare, (b) => b.bad)) : null };
  return out;
}

const stages = { score, writeback };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
