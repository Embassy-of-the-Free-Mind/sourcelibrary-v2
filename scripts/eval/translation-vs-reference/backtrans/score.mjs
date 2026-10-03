#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/score.mjs scores JUDGE verdicts against a packet key (fidelity, κ,
// bootstrap CIs); scripts/eval/tengyur-arms/score.py prints one detector's precision/recall for Tibetan with no CI and
// no case-control weights. Neither scores a page-level detector against judge labels across tracks.
/** Scores the reference-free detectors D1/D2/D3 against the judges' labels: recall, precision at the reference sets' base rate, flag rate, CIs, planted control, cost (#5695 extra test). */
/**
 *   node scripts/eval/translation-vs-reference/backtrans/score.mjs --set <dir>/set.jsonl --raw <dir>/raw --out <dir>/results.json [--max-order 60]
 * `measure`: agreement of a detector with two blind Opus judges who had a human reference. Not accuracy: a "false alarm"
 * can be a real fault the judges did not quote (the gallery reads some by eye).
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../../lib/paired-stats.mjs';
import { bleu4 } from '../../lib/metrics.mjs';
import { readJsonl } from '../common.mjs';
import { cleanSource } from './run-detectors.mjs';
import { negationScore } from './negation.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const SET = opt('set'); const RAW = opt('raw'); const OUT = opt('out'); const MAX_ORDER = Number(opt('max-order', 1e9));
if (!SET || !RAW || !OUT) { console.error('--set, --raw and --out are required'); process.exit(1); }
const load = (dir, id) => { const f = path.join(RAW, dir, `${id}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };

// chrF (character n-gram F-score, n = 1..6, β = 2) on letters only; lib/metrics.mjs has BLEU-4 but no chrF.
const norm = (t) => t.normalize('NFKC').replace(/ſ/g, 's').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
function chrF(hyp, ref, N = 6, beta = 2) {
  const h = [...norm(hyp)], r = [...norm(ref)]; if (!h.length || !r.length) return 0;
  let P = 0, R = 0, k = 0;
  for (let n = 1; n <= N; n++) {
    const grams = (a) => { const m = new Map(); for (let i = 0; i + n <= a.length; i++) { const g = a.slice(i, i + n).join(''); m.set(g, (m.get(g) || 0) + 1); } return m; };
    const hg = grams(h), rg = grams(r); let match = 0, ht = 0, rt = 0;
    for (const [g, c] of hg) { ht += c; match += Math.min(c, rg.get(g) || 0); } for (const c of rg.values()) rt += c;
    if (!ht || !rt) continue; P += match / ht; R += match / rt; k++;
  }
  if (!k) return 0; P /= k; R /= k; return P + R ? (1 + beta * beta) * P * R / (beta * beta * P + R) : 0;
}
const toks = (t) => String(t || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
/** Do two English quotes point at the same spot? Half of the shorter quote's content words are shared. */
const overlaps = (a, b) => { const A = new Set(toks(a)), B = toks(b); if (A.size < 2 || B.length < 2) return false; const hit = B.filter((w) => A.has(w)).length; return hit / Math.min(A.size, new Set(B).size) >= 0.5; };

const set = readJsonl(SET).filter((r) => r.order <= MAX_ORDER);
const pages = set.map((r) => {
  const d3 = load('d3', r.id)?.parsed, back = load('d2-back', r.id), d2 = load('d2-check', r.id)?.parsed;
  const c3 = d3?.contradictions || [], c2 = d2?.contradictions || [];
  const strong = (c) => c.filter((x) => x.certainty === 'high');
  const src = cleanSource(r.source_text);
  const neg = negationScore(r.lang, r.source_text, r.english);
  const judgeQuotes = r.labels.reversals.map((q) => q.english).filter(Boolean);
  return { id: r.id, order: r.order, track: r.track, lang: r.lang, url: r.url, weight: r.weight, labels: r.labels,
    target: { reversal: r.labels.reversal_judges > 0, reversal_both: r.labels.reversal_judges >= 2, omission: r.labels.omission_judges >= 2, fill: r.labels.fill_judges > 0,
      low: r.labels.fidelity != null && r.labels.fidelity <= 3 },
    d3: d3 ? { n: c3.length, n_high: strong(c3).length, omissions: (d3.omissions || []).length, additions: (d3.additions || []).length, items: c3,
      located: c3.some((c) => judgeQuotes.some((q) => overlaps(q, c.english))) } : null,
    d2: d2 && back?.text ? { n: c2.length, n_high: strong(c2).length, omissions: (d2.omissions || []).length, additions: (d2.additions || []).length, items: c2,
      chrf: chrF(back.text, src), bleu4: bleu4(back.text, src) } : null,
    d1: neg,
    cost: { d3: load('d3', r.id)?.cost_usd || 0, d2: (back?.cost_usd || 0) + (load('d2-check', r.id)?.cost_usd || 0) } };
});

// ── detectors: name → page flag ────────────────────────────────────────────────────────────────────────────────
const DET = {
  'D3 direct: any contradiction': (p) => p.d3 && p.d3.n >= 1,
  'D3 direct: a high-certainty contradiction': (p) => p.d3 && p.d3.n_high >= 1,
  'D3 direct: 2+ contradictions': (p) => p.d3 && p.d3.n >= 2,
  'D2 back-translation: any contradiction': (p) => p.d2 && p.d2.n >= 1,
  'D2 back-translation: a high-certainty contradiction': (p) => p.d2 && p.d2.n_high >= 1,
  'D2 and D3 both (high certainty)': (p) => p.d2 && p.d3 && p.d2.n_high >= 1 && p.d3.n_high >= 1,
  'D1 negation counts differ by 2+': (p) => p.d1 && p.d1.page_diff >= 2,
  'D1 negation counts differ by 3+ in a window': (p) => p.d1 && p.d1.window >= 3,
  'D3 lists an omission': (p) => p.d3 && p.d3.omissions >= 1,
  'D3 lists an addition': (p) => p.d3 && p.d3.additions >= 1,
};
const SCORES = { 'D3 contradictions (count)': (p) => p.d3?.n, 'D3 high-certainty (count)': (p) => p.d3?.n_high, 'D2 contradictions (count)': (p) => p.d2?.n, 'D2 chrF (lower = worse)': (p) => (p.d2 ? -p.d2.chrf : null),
  'D2 BLEU-4 (lower = worse)': (p) => (p.d2 ? -p.d2.bleu4 : null), 'D1 page_diff': (p) => p.d1?.page_diff, 'D1 window': (p) => p.d1?.window };

const wilson = (k, n) => { if (!n) return null; const z = 1.96, ph = k / n, d = 1 + z * z / n, c = ph + z * z / (2 * n), e = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)); return [Math.max(0, (c - e) / d), Math.min(1, (c + e) / d)].map((x) => +x.toFixed(3)); };
const r3 = (x) => (x == null || Number.isNaN(x) ? null : +x.toFixed(3));
function weighted(ps, flag, tgt) { let f = 0, tp = 0, pos = 0, all = 0; for (const p of ps) { all += p.weight; if (tgt(p)) pos += p.weight; if (flag(p)) { f += p.weight; if (tgt(p)) tp += p.weight; } } return { flag_rate: f / all, precision: f ? tp / f : null, base_rate: pos / all }; }
function evalDet(ps, flag, tgt, seed) {
  const tp = ps.filter((p) => flag(p) && tgt(p)).length, fp = ps.filter((p) => flag(p) && !tgt(p)).length, pos = ps.filter(tgt).length, neg = ps.length - pos;
  const w = weighted(ps, flag, tgt);
  // bootstrap within strata (track × label) so the case-control shape is kept
  const strata = {}; for (const p of ps) (strata[`${p.track}|${tgt(p)}`] ??= []).push(p);
  const rnd = makeRng(seed); const prec = [], fr = [];
  for (let b = 0; b < 2000; b++) { const s = []; for (const g of Object.values(strata)) for (let i = 0; i < g.length; i++) s.push(g[Math.floor(rnd() * g.length)]); const x = weighted(s, flag, tgt); if (x.precision != null) prec.push(x.precision); fr.push(x.flag_rate); }
  const q = (a, t) => (a.length ? r3([...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(t * a.length))]) : null);
  return { n: ps.length, positives: pos, tp, fp, recall: pos ? r3(tp / pos) : null, recall_ci: wilson(tp, pos), false_alarm_rate: neg ? r3(fp / neg) : null, false_alarm_ci: wilson(fp, neg),
    at_base_rate: { base_rate: r3(w.base_rate), flag_rate: r3(w.flag_rate), flag_rate_ci: [q(fr, 0.025), q(fr, 0.975)], precision: r3(w.precision), precision_ci: [q(prec, 0.025), q(prec, 0.975)], lift: w.precision != null && w.base_rate ? r3(w.precision / w.base_rate) : null },
    in_sample: { precision: tp + fp ? r3(tp / (tp + fp)) : null, base_rate: r3(pos / ps.length), flag_rate: r3((tp + fp) / ps.length) } };
}
function auc(ps, score, tgt) { const a = ps.filter((p) => tgt(p) && score(p) != null).map(score), b = ps.filter((p) => !tgt(p) && score(p) != null).map(score); if (!a.length || !b.length) return null; let s = 0; for (const x of a) for (const y of b) s += x > y ? 1 : x === y ? 0.5 : 0; return { auc: r3(s / (a.length * b.length)), pos: a.length, neg: b.length }; }

const TARGETS = { 'reversal (either judge)': (p) => p.target.reversal, 'reversal (both judges)': (p) => p.target.reversal_both, 'omission (both judges)': (p) => p.target.omission,
  'unreadable-fill invention (either judge)': (p) => p.target.fill, 'fidelity <= 3': (p) => p.target.low, 'any of: reversal, omission (both), fill': (p) => p.target.reversal || p.target.omission || p.target.fill };
const GROUP = { T1: 'Latin', T2: 'Greek', T3: 'German/French/Italian/Dutch/Spanish', T4: 'Hebrew/Aramaic/Arabic/Persian', T5: 'Sanskrit/Pali/Chinese', Tengyur: 'Tibetan' };
const out = { generated: new Date().toISOString(), measure: 'agreement of a reference-free detector with two blind Opus judges who had a human reference (not accuracy)', n: pages.length, max_order: MAX_ORDER === 1e9 ? null : MAX_ORDER,
  note: 'case-control sample: every judged reversal + random other pages; `at_base_rate` reweights to each track\'s own reference set', overall: {}, by_track: {}, by_lang: {}, auc: {}, planted: null, cost: null };
let seed = 5695;
for (const [tn, tgt] of Object.entries(TARGETS)) { out.overall[tn] = {}; for (const [dn, flag] of Object.entries(DET)) out.overall[tn][dn] = evalDet(pages, flag, tgt, seed++); out.auc[tn] = Object.fromEntries(Object.entries(SCORES).map(([sn, s]) => [sn, auc(pages, s, tgt)])); }
const REV = TARGETS['reversal (either judge)'];
for (const t of Object.keys(GROUP)) { const ps = pages.filter((p) => p.track === t); if (!ps.length) continue; out.by_track[`${t} ${GROUP[t]}`] = Object.fromEntries(Object.entries(DET).slice(0, 8).map(([dn, flag]) => [dn, evalDet(ps, flag, REV, seed++)])); out.by_track[`${t} ${GROUP[t]}`].auc = Object.fromEntries(Object.entries(SCORES).map(([sn, s]) => [sn, auc(ps, s, REV)])); }
for (const l of [...new Set(pages.map((p) => p.lang))].sort()) { const ps = pages.filter((p) => p.lang === l); out.by_lang[l] = Object.fromEntries(Object.entries(DET).slice(0, 8).map(([dn, flag]) => { const e = evalDet(ps, flag, REV, seed++); return [dn, { n: e.n, positives: e.positives, tp: e.tp, fp: e.fp, recall_ci: e.recall_ci, false_alarm_ci: e.false_alarm_ci }]; })); }
// of the reversal pages D3 flags, how many did it flag AT the judges' quoted spot?
{ const tps = pages.filter((p) => REV(p) && p.d3?.n >= 1); out.d3_true_positives_located = { flagged_reversal_pages: tps.length, at_the_judges_quote: tps.filter((p) => p.d3.located).length }; }

// ── planted control ────────────────────────────────────────────────────────────────────────────────────────────
const plantsF = path.join(RAW, 'plants.json');
if (fs.existsSync(plantsF)) {
  const key = JSON.parse(fs.readFileSync(plantsF, 'utf8')); const byId = new Map(pages.map((p) => [p.id, p]));
  const rows = key.map((k) => { const d3 = load('d3-plant', k.id)?.parsed, d2 = load('d2-check-plant', k.id)?.parsed, base = byId.get(k.id);
    const near = (q) => { const t = norm(q || ''); return t.length >= 8 && norm(k.after_context).includes(t.slice(0, Math.min(t.length, 40))) || overlaps(k.after_context, q) && toks(q).includes(k.to.toLowerCase().split(/\s+/)[0]); };
    return { id: k.id, lang: k.lang, op: k.op, from: k.from, to: k.to, after_context: k.after_context,
      d3: d3 ? { n: d3.contradictions?.length || 0, n_high: (d3.contradictions || []).filter((c) => c.certainty === 'high').length, located: (d3.contradictions || []).some((c) => near(c.english)), base_n: base?.d3?.n ?? null } : null,
      d2: d2 ? { n: d2.contradictions?.length || 0, n_high: (d2.contradictions || []).filter((c) => c.certainty === 'high').length, base_n: base?.d2?.n ?? null } : null }; });
  const rate = (f, g) => { const a = rows.filter(g); const k = a.filter(f).length; return { k, n: a.length, rate: a.length ? r3(k / a.length) : null, ci: wilson(k, a.length) }; };
  out.planted = { n: rows.length, by_op: rows.reduce((m, r) => { m[r.op] = (m[r.op] || 0) + 1; return m; }, {}),
    d3_flagged: rate((r) => r.d3.n >= 1, (r) => r.d3), d3_located: rate((r) => r.d3.located, (r) => r.d3), d3_same_pages_unplanted_flagged: rate((r) => r.d3.base_n >= 1, (r) => r.d3),
    d3_more_than_unplanted: rate((r) => r.d3.n > r.d3.base_n, (r) => r.d3),
    d2_flagged: rate((r) => r.d2.n >= 1, (r) => r.d2), d2_same_pages_unplanted_flagged: rate((r) => r.d2.base_n >= 1, (r) => r.d2), d2_more_than_unplanted: rate((r) => r.d2.n > r.d2.base_n, (r) => r.d2), rows };
}
const sum = (f) => pages.reduce((a, p) => a + f(p), 0);
out.cost = { model: 'gemini-3.1-flash-lite, thinking off', pages: pages.length, d3_usd_per_page: +(sum((p) => p.cost.d3) / pages.length).toFixed(5), d2_usd_per_page: +(sum((p) => p.cost.d2) / pages.length).toFixed(5),
  d3_usd_per_100k_pages: Math.round(sum((p) => p.cost.d3) / pages.length * 1e5), d2_usd_per_100k_pages: Math.round(sum((p) => p.cost.d2) / pages.length * 1e5), d1_usd_per_100k_pages: 0,
  note: 'realtime price; these reference pages are the corpus the tracks drew, mean page length may differ from the whole library' };
out.per_page = pages.map(({ cost, ...p }) => p);
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

const P = (e) => `recall ${e.tp}/${e.positives} ${JSON.stringify(e.recall_ci)} · false alarms ${e.fp}/${e.n - e.positives} · at base rate ${e.at_base_rate.base_rate}: flags ${e.at_base_rate.flag_rate}, precision ${e.at_base_rate.precision} ${JSON.stringify(e.at_base_rate.precision_ci)}, lift ${e.at_base_rate.lift}`;
for (const tn of Object.keys(TARGETS)) { console.log(`\n== ${tn}`); for (const dn of Object.keys(DET)) console.log(`  ${dn.padEnd(52)} ${P(out.overall[tn][dn])}`); console.log('  AUC', JSON.stringify(Object.fromEntries(Object.entries(out.auc[tn]).map(([k, v]) => [k, v?.auc])))); }
console.log('\nlocated', JSON.stringify(out.d3_true_positives_located)); if (out.planted) console.log('planted', JSON.stringify({ ...out.planted, rows: undefined })); console.log('cost', JSON.stringify(out.cost));
