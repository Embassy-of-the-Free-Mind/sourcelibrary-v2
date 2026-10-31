#!/usr/bin/env node
// PRIOR ART: scripts/eval/correction-pass-7818/analyze.mjs (wilcoxon, the page-bootstrap ci, kn, the pooled defects per
// 1,000 words with its CI, exportScore records, imported or restated with the same rules), scripts/eval/lib/
// {paired-stats,agreement-stats}.mjs (exact sign test, Wilson, kappa, AUC). Committed before any verdict exists or any
// CER is scored (#7835 preregistration).
/**
 * The preregistered analysis of #7835. Reads OUT and writes results/: score.json (T1–T4), tables.md,
 * router-evidence.score.json (T1 and T2 verdicts as route-judge evidence; no rules.json entry), writeback.json.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/fraktur-paired-7835/analyze.mjs score
 */
import fs from 'node:fs';
import path from 'node:path';
import { OUT, RESULTS, J, jsonl, sha, SEED, AGY_CALL_USD, wrongText, words7824, defectCounts, scoreText, spanSeverity, fca, levelCers, errorKinds, nameErrors, ARMS, centuryOf } from './lib.mjs';
import { binomTwoSided, makeRng } from '../lib/paired-stats.mjs';
import { wilson, binaryAgreement, aucLowerIsPositive } from '../lib/agreement-stats.mjs';
import { clusterCI } from '../route-judge-6740/judge.mjs';
import { exportScore, PLANT_BAR } from '../lane-judge-sampler.mjs';

const R = (f, x) => { fs.mkdirSync(RESULTS, { recursive: true }); fs.writeFileSync(path.join(RESULTS, f), typeof x === 'string' ? x : JSON.stringify(x, null, 1) + '\n'); };
const kn = (k, n) => ({ k, n, rate: n ? +(k / n).toFixed(3) : null, wilson95: n ? wilson(k, n).map((x) => +x.toFixed(3)) : null });
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));
function phi(z) { const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2); return z >= 0 ? (1 + y) / 2 : (1 - y) / 2; }
/** Wilcoxon signed-rank, two-sided, zeros dropped, normal approximation (#7818 analyze.mjs, unchanged). */
function wilcoxon(d) {
  const nz = d.filter((x) => x !== 0), n = nz.length;
  if (n === 0) return { n: 0, w_plus: 0, z: 0, p: 1 };
  const abs = nz.map((x) => ({ a: Math.abs(x), s: Math.sign(x) })).sort((x, y) => x.a - y.a);
  let tie = 0;
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && abs[j + 1].a === abs[i].a) j++; const rk = (i + j + 2) / 2, t = j - i + 1; for (let k = i; k <= j; k++) abs[k].r = rk; tie += t ** 3 - t; i = j + 1; }
  const wp = abs.filter((x) => x.s > 0).reduce((a, x) => a + x.r, 0);
  const mu = n * (n + 1) / 4, v = n * (n + 1) * (2 * n + 1) / 24 - tie / 48;
  const z = v > 0 ? (wp - mu - 0.5 * Math.sign(wp - mu)) / Math.sqrt(v) : 0;
  return { n, w_plus: wp, z: r3(z), p: +(2 * (1 - phi(Math.abs(z)))).toPrecision(3) };
}
const ci = (vals, seed) => (vals.length ? clusterCI(vals.map((v, i) => ({ book: `u${i}`, v })), seed).ci95 : null);
function pooled(rows, k, seed) {
  const D = rows.reduce((a, r) => a + r[k], 0), Wd = rows.reduce((a, r) => a + r.w, 0);
  const rnd = makeRng(seed), boots = [];
  for (let b = 0; b < 4000; b++) { let d = 0, w = 0; for (let i = 0; i < rows.length; i++) { const r = rows[Math.floor(rnd() * rows.length)]; d += r[k]; w += r.w; } boots.push(w ? 1000 * d / w : 0); }
  boots.sort((a, b) => a - b);
  return { per_1000: Wd ? r3(1000 * D / Wd) : null, defects: D, words: Wd, ci95: rows.length ? [r3(boots[100]), r3(boots[3899])] : null };
}
const cnt = (v, s) => (v?.defects || []).filter((d) => d.severity === s).length;
const textOf = (key, arm) => { const f = path.join(OUT, 'texts', `${key}.${arm}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };

function load() {
  const items = J('items.json');
  const vo = jsonl(path.join(OUT, 'verdicts-opus.jsonl'));
  const abs = new Map(vo.filter((r) => r.set === 'abs' && r.verdict).map((r) => [r.id, r]));
  return { items, vo, abs };
}
/** Per page of a test: { arm -> {v, text, words} } (null when the arm served no text: the page is not accepted). */
function pagesOf(set, items, abs) {
  if (!fs.existsSync(path.join(OUT, set, 'selected.json'))) return [];
  const arms = jsonl(path.join(OUT, set, 'arms.jsonl')).filter((r) => !r.quota);
  return J(`${set}/selected.json`).selected.map((s) => {
    const p = { key: s.key, page_id: s.page_id, book_id: s.book_id, page_number: s.page_number, face: s.face, year: s.year, arms: {} };
    for (const arm of ARMS[set]) {
      const t = textOf(s.key, arm)?.trim();
      const it = t ? items.find((i) => i.key === s.key && i.text_sha === sha(t).slice(0, 16)) : null;
      const row = arms.filter((r) => r.key === s.key && r.arm === arm).pop() ?? null;
      p.arms[arm] = t ? { v: it ? abs.get(it.id)?.verdict ?? null : null, at: it ? abs.get(it.id)?.at ?? null : null, item: it?.id ?? null, text: t, words: Math.max(1, words7824(t)), row } : { v: null, item: null, text: null, words: 0, row, none: true };
    }
    return p;
  });
}
const acc = (x) => !!(x && !x.none && x.v?.accept);
const judged = (x) => x && (x.none || x.v);   // an arm with no text counts as judged (not accepted)
/** b vs a on the pages where both are judged: McNemar, effect, wrong text, defects per 1,000 words, made worse. */
function paired(ps, a, b, seed) {
  const g = ps.filter((p) => judged(p.arms[a]) && judged(p.arms[b]));
  const gained = g.filter((p) => !acc(p.arms[a]) && acc(p.arms[b])).length, lost = g.filter((p) => acc(p.arms[a]) && !acc(p.arms[b])).length;
  const d = g.map((p) => (acc(p.arms[b]) ? 1 : 0) - (acc(p.arms[a]) ? 1 : 0));
  const wt = (x) => !!x?.v && wrongText(x.v);
  const both = g.filter((p) => p.arms[a].v && p.arms[b].v);
  const rate = (x, s) => 1000 * cnt(x.v, s) / x.words;
  const dd = (s) => { const z = both.map((p) => rate(p.arms[b], s) - rate(p.arms[a], s)); return { mean: r3(mean(z)), ci95: ci(z, seed + 1)?.map(r3), wilcoxon: wilcoxon(z) }; };
  return { n: g.length, [`accept_${a}`]: kn(g.filter((p) => acc(p.arms[a])).length, g.length), [`accept_${b}`]: kn(g.filter((p) => acc(p.arms[b])).length, g.length),
    gained, lost, mcnemar_exact_p: +binomTwoSided(gained, gained + lost).toPrecision(3), effect_points: r3(100 * mean(d)), effect_ci95_points: ci(d, seed)?.map((x) => r3(100 * x)),
    supported: binomTwoSided(gained, gained + lost) < 0.05 && gained > lost,
    wrong_text_pages: { [a]: g.filter((p) => wt(p.arms[a])).length, [b]: g.filter((p) => wt(p.arms[b])).length, added: g.filter((p) => !wt(p.arms[a]) && wt(p.arms[b])).length, removed: g.filter((p) => wt(p.arms[a]) && !wt(p.arms[b])).length },
    defects_per_1000_paired: { pages: both.length, wrong_text: dd('wrong_text'), misleads: dd('misleads') },
    made_worse: { wrong_text: both.filter((p) => cnt(p.arms[b].v, 'wrong_text') > cnt(p.arms[a].v, 'wrong_text')).length, misleads: both.filter((p) => cnt(p.arms[b].v, 'misleads') > cnt(p.arms[a].v, 'misleads')).length, cosmetic: both.filter((p) => cnt(p.arms[b].v, 'cosmetic') > cnt(p.arms[a].v, 'cosmetic')).length,
      wrong_text_added_list: both.filter((p) => cnt(p.arms[b].v, 'wrong_text') > cnt(p.arms[a].v, 'wrong_text')).map((p) => ({ page_id: p.page_id, defects: (p.arms[b].v.defects || []).filter((x) => x.severity === 'wrong_text').map((x) => `${x.class} "${String(x.quote || '').slice(0, 80)}"`) })) } };
}
/** Per arm: accept, wrong text, pooled defects per 1,000 words, calls per page and $ per accepted page. */
function armBlock(ps, arm, seed, callsPerPage) {
  const n = ps.length, k = ps.filter((p) => acc(p.arms[arm])).length;
  const rows = ps.filter((p) => p.arms[arm].v).map((p) => ({ w: p.arms[arm].words, wrong_text: cnt(p.arms[arm].v, 'wrong_text'), misleads: cnt(p.arms[arm].v, 'misleads') }));
  const cpp = callsPerPage(arm);
  return { pages: n, served_text: ps.filter((p) => !p.arms[arm].none).length, judged: ps.filter((p) => p.arms[arm].v).length, accept: kn(k, n), wrong_text_pages: ps.filter((p) => p.arms[arm].v && wrongText(p.arms[arm].v)).length,
    defects_per_1000: { wrong_text: pooled(rows, 'wrong_text', seed), misleads: pooled(rows, 'misleads', seed + 1) },
    agy_calls_per_page: r3(cpp), usd_per_accepted_page: k && cpp != null ? +((cpp * AGY_CALL_USD) / (k / n)).toFixed(5) : null };
}
/** agy calls per judged page for an arm: the read's (or correction's) calls over the pages its calls covered, mean over books. */
function callsFn(set, ps) {
  const arms = jsonl(path.join(OUT, set, 'arms.jsonl')).filter((r) => !r.quota);
  const per = (arm) => { const rs = ps.map((p) => arms.filter((r) => r.key === p.key && r.arm === arm).pop()).filter((r) => r && r.pages); return rs.length ? mean(rs.map((r) => r.calls / r.pages)) : 0; };
  const own = Object.fromEntries(ARMS[set].map((a) => [a, per(a)]));
  if (set === 't1') return (arm) => (arm === 'a' ? own.a : own.a + own[arm]);
  if (set === 't2') return (arm) => (arm === 'a' ? 0 : own[arm]);
  return (arm) => (arm === 'lite' ? 0 : arm === 'b' ? own.a + own.b : own[arm]);
}

/** Best judged arm (accepted, then fidelity, then fewer wrong_text, misleads, cosmetic); ties go to the cheaper arm. */
const rankKey = (x) => (x?.v ? [x.v.accept ? 1 : 0, Number(x.v.fidelity), -cnt(x.v, 'wrong_text'), -cnt(x.v, 'misleads'), -cnt(x.v, 'cosmetic')] : null);
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const COST_ORDER = { t1: ['a', 'b', 'c'], t2: ['a', 'c', 'b'] };
function writebackRows(set, ps) {
  const out = [];
  for (const p of ps) {
    const ranked = COST_ORDER[set].filter((a) => p.arms[a]?.v).map((a) => ({ arm: a, key: rankKey(p.arms[a]) }));
    if (!ranked.length) continue;
    const top = ranked.reduce((m, x) => (cmp(x.key, m.key) > 0 ? x : m), ranked[0]);   // the first (cheapest) of the best
    if (!top.key[0]) continue;                                                         // not accepted: nothing written
    const sameText = COST_ORDER[set].filter((a) => p.arms[a]?.text && p.arms[a].text === p.arms[top.arm].text);
    let arm = top.arm, note = null;
    if (set === 't2' && sameText.includes('a')) continue;                              // the stored text is the best: nothing to write
    if (set === 't1' && arm === 'b') { if (sameText.includes('c')) { arm = 'c'; note = '(b) and (c) served the same text: written as (c)'; } else { out.push({ set, page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, face: p.face, arm: 'b', writable: false, note: 'a 4-page block correction over drafts on disk: the lane apply cannot take it; not written' }); continue; } }
    out.push({ set, page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, face: p.face, arm, writable: true, note, fidelity: top.key[1], same_text_arms: sameText });
  }
  return out;
}

function t1t2(set, items, abs, contrasts, primary) {
  const ps = pagesOf(set, items, abs);
  const res = {};
  for (const face of [...new Set(ps.map((p) => p.face))].sort().concat(['all'])) {
    const g = face === 'all' ? ps : ps.filter((p) => p.face === face); if (!g.length) continue;
    const cf = callsFn(set, g);
    res[face] = { pages: g.length, arms: Object.fromEntries(ARMS[set].map((a, i) => [a, armBlock(g, a, 7835 + 10 * i, cf)])),
      contrasts: Object.fromEntries(contrasts.map(([a, b], i) => [`${b}_vs_${a}`, paired(g, a, b, 7900 + 10 * i)])),
      arm_outcomes: Object.fromEntries(ARMS[set].map((a) => { const t = {}; for (const p of g) { const r = p.arms[a].row; const k = r ? (r.written ? 'written' : String(r.outcome || r.why || 'unknown').slice(0, 60)) : 'not run'; t[k] = (t[k] ?? 0) + 1; } return [a, t]; })) };
  }
  res.primary = primary;
  return { res, ps };
}

function t4() {
  if (!fs.existsSync(path.join(OUT, 't4', 'candidates.json'))) return null;
  const C = J('t4/candidates.json').candidates, tags = new Map(jsonl(path.join(OUT, 't4', 'tags.jsonl')).filter((r) => r.tag).map((r) => [r.key, r.tag.face]));
  const rows = C.filter((c) => tags.has(c.key)).map((c) => ({ ...c, face: tags.get(c.key) }));
  const text = rows.filter((r) => r.face !== 'none');
  const share = (g) => ({ n_with_text: g.length, fraktur: kn(g.filter((r) => r.face === 'fraktur').length, g.length), fraktur_or_mixed: kn(g.filter((r) => r.face !== 'antiqua').length, g.length), antiqua: kn(g.filter((r) => r.face === 'antiqua').length, g.length), mixed: g.filter((r) => r.face === 'mixed').length });
  const byC = {}; for (const r of text) (byC[centuryOf(r.year)] ??= []).push(r);
  const chk = jsonl(path.join(OUT, 't4', 'opus-check.jsonl')).filter((r) => r.tag);
  const pairs = chk.map((r) => [tags.get(r.key), r.tag.face]).filter(([a]) => a);
  const conf = {}; for (const [a, o] of pairs) conf[`${a}->${o}`] = (conf[`${a}->${o}`] ?? 0) + 1;
  return { drawn: C.length, tagged: rows.length, untagged: C.length - rows.length, no_text: rows.length - text.length, all: share(text),
    by_century: Object.fromEntries(Object.entries(byC).sort().map(([k, g]) => [k, share(g)])),
    opus_check: { n: pairs.length, agree: pairs.filter(([a, o]) => a === o).length, fraktur_kappa: pairs.length ? r3(binaryAgreement(pairs.map(([a, o]) => [a === 'fraktur', o === 'fraktur'])).kappa) : null, confusion_agy_to_opus: conf },
    weight_fraktur: text.length ? r3(text.filter((r) => r.face === 'fraktur').length / Math.max(1, text.filter((r) => r.face === 'fraktur' || r.face === 'antiqua').length)) : null };
}

const T3_ARMS = ['lite', 'a', 'b', 'c'];
function t3(items, abs) {
  if (!fs.existsSync(path.join(OUT, 't3', 'selected.json'))) return null;
  const S = J('t3/selected.json').selected;
  const freq = new Map(Object.entries(J('t3/work-freq.json')));
  const ps = pagesOf('t3', items, abs);
  const rows = [], excluded = [];
  for (const p of ps) {
    const s = S.find((x) => x.key === p.key), ref = textOf(p.key, 'ref');
    const row = { key: p.key, page_id: p.page_id, face: p.face, year: s.year, century: centuryOf(s.year), dta: s.dta.source_id };
    for (const arm of T3_ARMS) {
      const t = p.arms[arm]?.text; if (!t) continue;
      const fold = scoreText(ref, t), lv = levelCers(ref, t), ek = errorKinds(ref, t), nm = nameErrors(ref, t, freq);
      const draft = arm === 'b' ? textOf(p.key, 'a') : arm === 'c' ? `${textOf(p.key, 'lite')}\n${textOf(p.key, 'pero') ?? ''}` : null;
      const sp = spanSeverity(ref, t, { draft, lang: 'de' });
      const v = p.arms[arm].v;
      row[arm] = { cer_l2: r3(lv.l2.cer), cer_l1: r3(lv.l1.cer), cer_fold: r3(fold.cer), wer_fold: r3(fold.wer), aligned: fold.aligned, fca_fold: r3(fca(ref, t).fca), kinds: ek, names: nm, span: { counts: sp.counts, score: r3(sp.score) },
        accept: v ? v.accept : null, judge_wrong_text: v ? wrongText(v) : null, judge_defects_per_1000: v ? r3(1000 * (cnt(v, 'wrong_text') + cnt(v, 'misleads')) / p.arms[arm].words) : null };
    }
    // Leaf / edition check: the page is excluded when no arm's text aligns with the typed page (fold WER guard 0.35).
    if (!T3_ARMS.some((a) => row[a]?.aligned)) { excluded.push({ key: p.key, dta: row.dta, why: 'no arm aligns with the typed page (fold WER > 0.35): leaf or edition differs' }); continue; }
    rows.push(row);
  }
  const col = (g, a, f) => g.filter((r) => r[a]).map((r) => f(r[a]));
  const kindSum = (g, a) => {
    const t = {}; for (const r of g.filter((x) => x[a])) for (const [k, o] of Object.entries(r[a].kinds)) { t[k] ??= {}; for (const [kk, v] of Object.entries(o)) t[k][kk] = (t[k][kk] ?? 0) + v; }
    const nm = g.filter((r) => r[a]).reduce((s, r) => ({ names: s.names + r[a].names.names, errors: s.errors + r[a].names.errors }), { names: 0, errors: 0 });
    return { ...t, names: { ...nm, rate: nm.names ? r3(nm.errors / nm.names) : null },
      rates: { long_s_kept: t.long_s?.ref ? r3(t.long_s.kept / t.long_s.ref) : null, long_s_to_s: t.long_s?.ref ? r3(t.long_s.to_s / t.long_s.ref) : null, long_s_to_f: t.long_s?.ref ? r3(t.long_s.to_f / t.long_s.ref) : null,
        umlaut_e_kept: t.umlaut_e?.ref ? r3(t.umlaut_e.kept / t.umlaut_e.ref) : null, umlaut_e_to_diaeresis: t.umlaut_e?.ref ? r3(t.umlaut_e.to_diaeresis / t.umlaut_e.ref) : null,
        digit_errors_per_ref_digit: t.numbers?.ref_digits ? r3(t.numbers.errors / t.numbers.ref_digits) : null, ligatures_emitted_per_1000_chars: t.all?.ref ? r3(1000 * t.ligature.emitted / t.all.ref) : null, r_rotunda_emitted: t.r_rotunda?.emitted ?? 0, J_to_I: t.capital_ij?.ref_J ? r3(t.capital_ij.J_to_I / t.capital_ij.ref_J) : null } };
  };
  const summary = (g) => Object.fromEntries(T3_ARMS.map((a) => [a, { n: g.filter((r) => r[a]).length, cer_l2: r3(mean(col(g, a, (x) => x.cer_l2))), cer_l1: r3(mean(col(g, a, (x) => x.cer_l1))), cer_fold: r3(mean(col(g, a, (x) => x.cer_fold))), fca_fold: r3(mean(col(g, a, (x) => x.fca_fold).filter((x) => x != null))),
    cer_l1_median: (() => { const v = col(g, a, (x) => x.cer_l1).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; })(),
    judge_accept: `${col(g, a, (x) => x.accept).filter((x) => x === true).length}/${col(g, a, (x) => x.accept).filter((x) => x != null).length}`, span_wrong_text_pages: col(g, a, (x) => x.span.counts.wrong_text > 0).filter(Boolean).length, kinds: kindSum(g, a) }]));
  const contrast = (g, a, b, f, seed) => { const gg = g.filter((r) => r[a] && r[b]); const d = gg.map((r) => f(r[b]) - f(r[a])); return { n: gg.length, mean_diff: r3(mean(d)), ci95: ci(d, seed)?.map(r3), wilcoxon: wilcoxon(d), better: d.filter((x) => x < -0.001).length, worse: d.filter((x) => x > 0.001).length }; };
  const C = (g) => Object.fromEntries([['lite', 'a'], ['a', 'b'], ['lite', 'c'], ['b', 'c']].map(([a, b], i) => [`${b}_vs_${a}`, { cer_l2: contrast(g, a, b, (x) => x.cer_l2, 7950 + i), cer_l1: contrast(g, a, b, (x) => x.cer_l1, 7960 + i), cer_fold: contrast(g, a, b, (x) => x.cer_fold, 7970 + i) }]));
  // Judge severity against diff severity, every judged T3 text.
  const texts = rows.flatMap((r) => T3_ARMS.filter((a) => r[a] && r[a].accept != null).map((a) => ({ ...r[a], arm: a })));
  const sp = (t) => t.span.counts.wrong_text > 0;
  const judgeVsDiff = { texts: texts.length,
    confusion: { both: texts.filter((t) => sp(t) && t.judge_wrong_text).length, span_only: texts.filter((t) => sp(t) && !t.judge_wrong_text).length, judge_only: texts.filter((t) => !sp(t) && t.judge_wrong_text).length, neither: texts.filter((t) => !sp(t) && !t.judge_wrong_text).length },
    judge_recall_of_span_wrong_text: kn(texts.filter((t) => sp(t) && (t.judge_wrong_text || !t.accept)).length, texts.filter(sp).length),
    auc_accept_lower_cer_l1: texts.some((t) => t.accept) && texts.some((t) => !t.accept) ? r3(aucLowerIsPositive(texts, (t) => t.cer_l1, (t) => t.accept)) : null,
    auc_accept_lower_span: texts.some((t) => t.accept) && texts.some((t) => !t.accept) ? r3(aucLowerIsPositive(texts, (t) => t.span.score, (t) => t.accept)) : null,
    spearman_judge_defects_vs_span: spearman(texts.map((t) => t.judge_defects_per_1000), texts.map((t) => t.span.score)) };
  R('t3-pages.json', rows.map(({ key, face, year, dta, ...r }) => ({ key, face, year, dta, ...Object.fromEntries(T3_ARMS.filter((a) => r[a]).map((a) => [a, { cer_l2: r[a].cer_l2, cer_l1: r[a].cer_l1, cer_fold: r[a].cer_fold, fca_fold: r[a].fca_fold, accept: r[a].accept, span: r[a].span, names: { names: r[a].names.names, errors: r[a].names.errors } }])) })));
  const byFace = {}; for (const f of [...new Set(rows.map((r) => r.face))]) byFace[f] = summary(rows.filter((r) => r.face === f));
  return { pages_drawn: ps.length, excluded, pages: rows.length, faces: Object.fromEntries([...new Set(rows.map((r) => r.face))].map((f) => [f, rows.filter((r) => r.face === f).length])),
    arms: summary(rows), by_face: byFace, contrasts: C(rows), contrasts_fraktur: C(rows.filter((r) => r.face === 'fraktur')), judge_vs_diff: judgeVsDiff,
    pero: fs.existsSync(path.join(OUT, 't3', 'pero', 'collect.json')) ? J('t3/pero/collect.json') : null };
}
function spearman(x, y) {
  const ok = x.map((v, i) => [v, y[i]]).filter(([a, b]) => a != null && b != null); if (ok.length < 5) return null;
  const rank = (v) => { const s = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(v.length); for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const a = rank(ok.map((p) => p[0])), b = rank(ok.map((p) => p[1])), ma = mean(a), mb = mean(b);
  const num = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0), den = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0));
  return { n: ok.length, rho: den ? r3(num / den) : null };
}

function controlsBlock(vo) {
  const by = {};
  for (const r of vo.filter((x) => x.set === 'wrong_page' || x.set === 'planted')) {
    const k = `${r.test}/${r.set}`; by[k] ??= { n: 0, pass: 0 };
    if (!r.verdict) continue;
    by[k].n++;
    if (r.set === 'wrong_page' ? !r.verdict.accept && Number(r.verdict.fidelity) <= 2 : r.catch?.caught) by[k].pass++;
  }
  const wp = vo.filter((r) => r.set === 'wrong_page' && r.verdict), pl = vo.filter((r) => r.set === 'planted' && r.verdict);
  const wpPass = wp.filter((r) => !r.verdict.accept && Number(r.verdict.fidelity) <= 2).length, plC = pl.filter((r) => r.catch?.caught).length;
  return { by, wrong_page: `${wpPass}/${wp.length}`, planted: `${plC}/${pl.length}`, valid: wp.length > 0 && wpPass === wp.length && (pl.length === 0 || plC / pl.length >= PLANT_BAR), noise_floor: 'reused from #7818: accept kappa 0.87 (alpha 0.87), 29/30, same judge and prompt (no rerun)' };
}

/** T1 and T2 verdicts as route-judge evidence (exportScore). Routes named as in rules.json; no entry is added there. */
const ROUTES = { t1: { a: 'agy-flash-low@4-written', b: 'agy-flash-low@4>agy-flash-low@4-written', c: 'agy-flash-low@4>agy-flash-low-written' }, t2: { a: 'lite', b: 'lite>agy-flash-low', c: 'agy-flash-low@4-read' } };
function evidence(sets, vo) {
  const recs = [];
  for (const [set, ps] of Object.entries(sets)) for (const p of ps) {
    const cell = set === 't2' ? 'german-lite' : `german-blank-${p.face}`;
    for (const [arm, x] of Object.entries(p.arms)) {
      const v = x.v ?? (x.none ? { accept: false, fidelity: 1, defects: [], reader_note: 'no text served (the read was refused or not made)' } : null); if (!v) continue;
      recs.push({ _id: `fr${sha(`${set}:${p.key}:${arm}`).slice(0, 14)}`, kind: 'item', route: ROUTES[set][arm], page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, cell, lane: set === 't2' ? 'fraktur-7835-t2' : 'fraktur-7835-t1', lang: 'German', task: 'ocr', script_type: 'print', script_source: 'reader <script> tag (print-only apply)', cell_hand: 'print',
        judge: { by: 'claude -p --model opus', model_reported: 'claude-opus-5-5', prompt_template_sha: null, instrument: 'route-judge-6740 judgePrompt' }, run_id: 'fraktur-paired-7835', judged_at: x.at ?? new Date().toISOString(), verdict: v, write: { revision_id: `eval:${p.page_id}:${arm}` }, draw: { stratum: 'random', frame: `#7835 ${set}` } });
    }
  }
  for (const r of vo.filter((x) => (x.set === 'wrong_page' || x.set === 'planted') && x.verdict && x.test !== 't3')) {
    const ps = sets[r.test]; const p = ps?.find((q) => q.page_id === r.page); if (!p) continue;
    // A control tests the judge, not an arm: it is attached to every route of its cell (the same judge judged them all).
    const cell = r.test === 't2' ? 'german-lite' : `german-blank-${p.face}`;
    for (const arm of ARMS[r.test]) recs.push({ _id: `fr${sha(`${r.set}:${r.id}:${arm}`).slice(0, 14)}`, kind: r.set, route: ROUTES[r.test][arm], page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, cell, lane: `fraktur-7835-${r.test}`, lang: 'German', task: 'ocr', script_type: 'print', script_source: 'reader <script> tag (print-only apply)', cell_hand: 'print',
      judge: { by: 'claude -p --model opus', model_reported: r.model ?? 'claude-opus-5-5', prompt_template_sha: null, instrument: 'route-judge-6740 judgePrompt' }, run_id: 'fraktur-paired-7835', judged_at: r.at, verdict: r.verdict, write: { revision_id: `eval:${p.page_id}:${arm}` },
      ...(r.set === 'planted' && { plant: r.plant, planted_from: r.planted_from, catch: r.catch }), ...(r.set === 'wrong_page' && { other_page_id: r.other_page }), draw: { stratum: 'random', frame: `#7835 ${r.test}` } });
  }
  const s = exportScore(recs);
  return { ...s, source: 'fraktur-paired-7835 (#7835 T1, T2)', file: 'scripts/eval/fraktur-paired-7835/results/router-evidence.score.json', frame: 'T1: one interior unread page per book in the first-read lane\'s German frame, 40 Fraktur + 20 Antiqua by the agy face tag; T2: one Flash-Lite page per book in the #7558 lane\'s German frame, not yet processed, 40 Fraktur. Every arm on the same page; an arm that served no text counts as not accepted. Preregistered: 2026-10-31-fraktur-paired-7835.md.' };
}

function score() {
  const { items, vo, abs } = load();
  const out = { generated_at: new Date().toISOString(), seeds: SEED, calls: { opus_abs: vo.filter((r) => r.set === 'abs').length, opus_controls: vo.filter((r) => r.set !== 'abs').length, unparsed: vo.filter((r) => !r.verdict).length, opus_t4_check: jsonl(path.join(OUT, 't4', 'opus-check.jsonl')).length, list_usd_equiv: +vo.reduce((a, r) => a + (r.list_usd || 0), 0).toFixed(2) } };
  out.instrument = controlsBlock(vo);
  out.T4 = t4();
  const T1 = t1t2('t1', items, abs, [['a', 'b'], ['a', 'c'], ['c', 'b']], 'b_vs_a, Fraktur: exact McNemar');
  const T2 = t1t2('t2', items, abs, [['c', 'b'], ['a', 'b'], ['a', 'c']], 'b_vs_c, Fraktur: exact McNemar');
  out.T1 = T1.res; out.T2 = T2.res;
  // T4-weighted: what each T1 arm's acceptance would be over the German frame's face mix (Fraktur share among F + A).
  const w = out.T4?.weight_fraktur;
  if (w != null && out.T1.fraktur && out.T1.antiqua) out.T1.weighted_by_T4 = { fraktur_weight: w, accept: Object.fromEntries(ARMS.t1.map((a) => [a, r3(w * out.T1.fraktur.arms[a].accept.rate + (1 - w) * out.T1.antiqua.arms[a].accept.rate)])) };
  out.T3 = t3(items, abs);
  const wb = [...writebackRows('t1', T1.ps), ...writebackRows('t2', T2.ps)];
  R('writeback.json', { rule: 'T1/T2 page: the best judged arm (accepted; then fidelity; then fewer wrong_text, misleads, cosmetic defects; ties to the cheaper arm), only where it was accepted and no other arm was judged better; T2 pages where the stored text is the best are left alone. T3 and T4 are read-only.', pages: wb });
  out.writeback = { pages: wb.length, writable: wb.filter((x) => x.writable).length, by_arm: wb.reduce((t, x) => ({ ...t, [`${x.set}/${x.arm}${x.writable ? '' : ' (not writable)'}`]: (t[`${x.set}/${x.arm}${x.writable ? '' : ' (not writable)'}`] ?? 0) + 1 }), {}) };
  // The header's defect_rates file (experiments README): per study cell and arm, #7824's rates and the mean fidelity.
  const dr = { unit: 'defects per 1,000 words (#7824 words())', study_cells: {} };
  for (const [set, T] of [['t1', T1], ['t2', T2], ['t3', { ps: pagesOf('t3', items, abs) }]]) for (const face of ['fraktur', 'antiqua']) {
    const g = T.ps.filter((p) => p.face === face); if (!g.length) continue;
    for (const arm of ARMS[set]) {
      const rs = g.filter((p) => p.arms[arm]?.v); if (!rs.length) continue;
      const W = rs.reduce((a, p) => a + p.arms[arm].words, 0);
      dr.study_cells[`${set}-${face}/${arm}`] = { n: rs.length, misleads_per_1k: r3(1000 * rs.reduce((a, p) => a + cnt(p.arms[arm].v, 'misleads'), 0) / W), wrong_text_per_1k: r3(1000 * rs.reduce((a, p) => a + cnt(p.arms[arm].v, 'wrong_text'), 0) / W), fidelity_mean: r3(mean(rs.map((p) => Number(p.arms[arm].v.fidelity)))), accept: `${rs.filter((p) => p.arms[arm].v.accept).length}/${rs.length}` };
    }
  }
  R('defect-rates.json', dr);
  R('score.json', out);
  R('router-evidence.score.json', evidence({ t1: T1.ps, t2: T2.ps }, vo));
  console.log(JSON.stringify({ instrument: out.instrument, T4: out.T4 && { all: out.T4.all, check: out.T4.opus_check }, T1: Object.fromEntries(Object.entries(out.T1).filter(([k]) => k !== 'primary' && k !== 'weighted_by_T4').map(([f, x]) => [f, Object.fromEntries(Object.entries(x.contrasts).map(([c, y]) => [c, `${y.gained}/${y.lost} p ${y.mcnemar_exact_p} eff ${y.effect_points} ${JSON.stringify(y.effect_ci95_points)}`]))])), T2: Object.fromEntries(Object.entries(out.T2).filter(([k]) => k !== 'primary').map(([f, x]) => [f, Object.fromEntries(Object.entries(x.contrasts).map(([c, y]) => [c, `${y.gained}/${y.lost} p ${y.mcnemar_exact_p} eff ${y.effect_points}`]))])), writeback: out.writeback }, null, 1));
}

/**
 * What the router table would decide with this export pooled in (#7818 analyze.mjs router, the same method): build.py
 * on a copy of origin/main with and without evidence entries for it. rules.json in the repo is not changed (#7809).
 */
async function router() {
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const { ROOT } = await import('./lib.mjs');
  const { rebuildInputs, addEvidence, evidenceEntries } = await import('../lane-judge-sampler.mjs');
  const RT = 'scripts/eval/estimator/router-table', EV = `${RT}/evidence/fraktur-paired-7835.score.json`, BY = `${RT}/evidence/by-script/fraktur-paired-7835.score.json`;
  const sh = (cmd, args, o = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...o }); if (r.status) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${r.stderr}`); return r.stdout; };
  sh('git', ['-C', ROOT, 'fetch', '-q', 'origin', 'main']);
  const rulesText = sh('git', ['-C', ROOT, 'show', `origin/main:${RT}/rules.json`]), rules = JSON.parse(rulesText);
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'fr7835-router-'));
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
  py('with-7835', ['--before', `${RT}/baseline.json`]);
  const rows = (n) => JSON.parse(fs.readFileSync(path.join(dir, RT, `${n}.json`), 'utf8')).rows;
  const pick = (rs) => rs.filter((r) => /^german-(lite|blank)/.test(r.id)).map((r) => ({ id: r.id, decision: r.decision, route: r.route, routes: r.routes.map((x) => ({ id: x.id, k: x.k, n: x.n, wrong: x.wrong, mean: x.mean })) }));
  const out = { main_sha: sh('git', ['-C', ROOT, 'rev-parse', '--short', 'origin/main']).trim(), evidence_added: added, baseline: pick(rows('baseline')), with_7835: pick(rows('with-7835')), note: 'what build.py decides if rules.json named this export; rules.json is NOT changed by this PR' };
  R('router-check.json', out);
  for (const k of ['baseline', 'with_7835']) for (const r of out[k]) console.log(`${k} ${r.id}: ${r.decision} ${r.route} | ${r.routes.map((x) => `${x.id} ${x.k}/${x.n}`).join('; ')}`);
}

const stages = { score, router };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
