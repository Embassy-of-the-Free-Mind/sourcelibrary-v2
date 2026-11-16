#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/paired-arm.mjs score (accept / wrong text k/n, controls, repeats, rates per
// 1,000 words as a simple ratio: it runs too, and its paired-score.json is the router evidence) and
// scripts/eval/ocr-doubt-image-8358/score_t2.py (carried / repaired spots, leaf claims). Neither scores the #106 rule:
// a serious-defect rate per arm against the text arm, beyond the T vs T2 gap, with a paired page bootstrap, plus the
// planted-misread repair and the judge plants. This does only that, over judge.mjs's files. No model calls.
/**
 *   node score.mjs --run=DIR      reads DIR/judge/{key.json,packet.json,verdicts-opus.jsonl}, DIR/out-*, DIR/plants.json
 *                                 writes DIR/judge/score-106.json and prints the tables
 */
import fs from 'node:fs'; import path from 'node:path';
import { resetSeed, seededRand } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';
import { ROUTES } from './judge.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const RUN = path.resolve(arg('run', '.'));
const JD = path.join(RUN, 'judge');
const key = JSON.parse(fs.readFileSync(path.join(JD, 'key.json'), 'utf8'));
const items = new Map(JSON.parse(fs.readFileSync(path.join(JD, 'packet.json'), 'utf8')).items.map((it) => [it.id, it]));
const V = new Map();
for (const l of fs.readFileSync(path.join(JD, 'verdicts-opus.jsonl'), 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.verdict && !V.has(r.id)) V.set(r.id, r.verdict); }
const words = (t) => String(t || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const SER = new Set(['misleads', 'wrong_text']);
const r2 = (x) => (x == null || Number.isNaN(x) ? null : +x.toFixed(2));
const kn = (k, n) => `${k}/${n}`;
const A = { T: ROUTES.T, T2: ROUTES.T2, I: ROUTES.I, S: ROUTES.S };

function row(k) {
  const v = V.get(k.judged_as); if (!v) return null;
  const ds = v.defects || [];
  return { page: k.page_id, book: k.book_id, lang: k.cell, route: k.route, accept: v.accept, fidelity: Number(v.fidelity), words: words(items.get(k.judged_as).text),
    serious: ds.filter((d) => SER.has(d.severity)).length, misleads: ds.filter((d) => d.severity === 'misleads').length, wrong_text: ds.filter((d) => d.severity === 'wrong_text').length,
    false_leaf: (v.leaf_claims || []).filter((c) => c.true_of_page === false).length, leaf: (v.leaf_claims || []).length,
    spots: (v.spots || []).map((s) => s.outcome), classes: ds.filter((d) => SER.has(d.severity)).map((d) => d.class) };
}
const items_ = key.filter((k) => k.kind === 'item').map(row).filter(Boolean);
const by = (lang, route) => items_.filter((r) => (lang === 'all' || r.lang === lang) && r.route === route);

function arm(rs) {
  const W = rs.reduce((a, r) => a + r.words, 0), s = rs.reduce((a, r) => a + r.serious, 0);
  return { n: rs.length, accept: kn(rs.filter((r) => r.accept).length, rs.length), accept_wilson: rs.length ? wilson(rs.filter((r) => r.accept).length, rs.length).map((x) => +x.toFixed(3)) : null,
    words: W, serious: s, serious_per_1k: r2((1000 * s) / W), misleads_per_1k: r2((1000 * rs.reduce((a, r) => a + r.misleads, 0)) / W), wrong_text_per_1k: r2((1000 * rs.reduce((a, r) => a + r.wrong_text, 0)) / W),
    wrong_text_pages: kn(rs.filter((r) => r.wrong_text).length, rs.length), false_leaf_pages: rs.filter((r) => r.false_leaf).length, fidelity_mean: r2(rs.reduce((a, r) => a + r.fidelity, 0) / rs.length) };
}
/** Paired: pages both arms have; rate difference a − b (per 1,000 words), page bootstrap (one page per book). */
function paired(lang, a, b, seed) {
  const B = new Map(by(lang, b).map((r) => [r.page, r]));
  const pp = by(lang, a).filter((r) => B.has(r.page)).map((r) => [r, B.get(r.page)]);
  const rate = (ps, i) => { const W = ps.reduce((x, p) => x + p[i].words, 0); return W ? (1000 * ps.reduce((x, p) => x + p[i].serious, 0)) / W : 0; };
  const d = rate(pp, 0) - rate(pp, 1);
  resetSeed(seed); const xs = [];
  for (let it = 0; it < 10000; it++) { const s = Array.from(pp, () => pp[Math.floor(seededRand() * pp.length)]); xs.push(rate(s, 0) - rate(s, 1)); }
  xs.sort((x, y) => x - y);
  const per = pp.map(([x, y]) => x.serious - y.serious);
  return { pages: pp.length, diff_per_1k: r2(d), ci95: [r2(xs[250]), r2(xs[9749])], pages_a_more: per.filter((x) => x > 0).length, pages_b_more: per.filter((x) => x < 0).length,
    mean_diff_per_page: r2(per.reduce((s, x) => s + x, 0) / (per.length || 1)), sd_diff_per_page: r2(Math.sqrt(per.reduce((s, x) => s + x * x, 0) / (per.length || 1) - (per.reduce((s, x) => s + x, 0) / (per.length || 1)) ** 2)) };
}
/** Spots on the shared pages: of the spots arm `a` carried, how many `b` repaired. */
function spots(lang, a, b) {
  const B = new Map(by(lang, b).map((r) => [r.page, r]));
  let carriedA = 0, repairedB = 0, carriedB = 0, total = 0, outA = {}, outB = {};
  for (const r of by(lang, a)) {
    const o = B.get(r.page); if (!o) continue;
    r.spots.forEach((x, i) => { total++; outA[x] = (outA[x] ?? 0) + 1; const y = o.spots[i]; outB[y] = (outB[y] ?? 0) + 1; if (x === 'carried') { carriedA++; if (y === 'repaired') repairedB++; if (y === 'carried') carriedB++; } });
  }
  return { spots: total, [a]: outA, [b]: outB, [`carried_by_${a}`]: carriedA, [`of_those_repaired_by_${b}`]: repairedB, [`of_those_still_carried_by_${b}`]: carriedB };
}

const LANGS = ['Latin', 'German', 'French'];
const out = { generated_by: 'scripts/eval/image-translate-106/score.mjs', verdicts: V.size, cells: {}, rule: {} };
LANGS.concat('all').forEach((lang, li) => {
  const C = out.cells[lang] = { arms: {}, paired: {}, spots: {} };
  for (const [a, r] of Object.entries(A)) C.arms[a] = arm(by(lang, r));
  C.paired['T-I'] = paired(lang, A.T, A.I, 106 + li);
  C.paired['T-T2'] = paired(lang, A.T, A.T2, 206 + li);
  C.paired['T-S'] = paired(lang, A.T, A.S, 306 + li);
  C.spots['T->I'] = spots(lang, A.T, A.I);
  C.spots['T->T2'] = spots(lang, A.T, A.T2);
  const t = C.arms.T, t2 = C.arms.T2, i = C.arms.I;
  const gap = t.serious_per_1k - i.serious_per_1k, noise = Math.abs(t.serious_per_1k - t2.serious_per_1k);
  const leafNoise = Math.abs(t.false_leaf_pages - t2.false_leaf_pages);
  out.rule[lang] = { a_gap_T_minus_I: r2(gap), a_noise_T_vs_T2: r2(noise), a: gap > noise, b_ci95_T_minus_I: C.paired['T-I'].ci95, b: C.paired['T-I'].ci95[0] > 0,
    c_false_leaf_pages: `I ${i.false_leaf_pages} vs T ${t.false_leaf_pages} (allowed ${t.false_leaf_pages + Math.max(1, leafNoise)})`, c: i.false_leaf_pages <= t.false_leaf_pages + Math.max(1, leafNoise) };
  out.rule[lang].I_better = out.rule[lang].a && out.rule[lang].b && out.rule[lang].c;
});

// Planted OCR misreads (spot 1 of each planted_ocr item).
const pl = key.filter((k) => k.kind === 'planted_ocr').map((k) => ({ k, v: V.get(k.judged_as) })).filter((x) => x.v);
out.planted_ocr = {};
for (const a of ['T', 'I']) { const xs = pl.filter((x) => x.k.route === A[a]); const o = {}; for (const x of xs) { const s = x.v.spots?.[0]?.outcome; o[s] = (o[s] ?? 0) + 1; } out.planted_ocr[a] = { n: xs.length, ...o, rows: xs.map((x) => ({ page: x.k.page_id, lang: x.k.cell, plant: `${x.k.plant.true} -> ${x.k.plant.planted}`, outcome: x.v.spots?.[0]?.outcome, quote: x.v.spots?.[0]?.english_quote })) }; }

// Controls.
const wp = key.filter((k) => k.kind === 'wrong_page').map((k) => ({ k, v: V.get(k.judged_as) }));
out.wrong_page = { n: wp.length, judged: wp.filter((x) => x.v).length, rejected: wp.filter((x) => x.v && !x.v.accept).length, fidelity: wp.map((x) => x.v?.fidelity ?? null),
  passed: wp.length > 0 && wp.every((x) => x.v && !x.v.accept) };
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ');
const jp = key.filter((k) => k.kind === 'planted').map((k) => {
  const v = V.get(k.judged_as); if (!v) return { page: k.page_id, judged: false };
  const tail = norm(k.plant.span).split(' ').filter((w) => w.length > 2).slice(-3).join(' ');
  const hit = (v.defects || []).find((d) => SER.has(d.severity) && norm(d.quote).includes(norm(k.plant.after)) && (norm(d.quote).includes(norm(tail).split(' ')[0] || '') || norm(k.plant.span).includes(norm(d.quote).slice(0, 20))));
  return { page: k.page_id, lang: k.cell, kind: k.plant.kind, plant: `${k.plant.before} -> ${k.plant.after}`, span: k.plant.span, caught: !!hit, severity: hit?.severity ?? null, quote: hit?.quote ?? null, judged: true,
    all_quotes: (v.defects || []).map((d) => `${d.severity}: ${d.quote}`).slice(0, 8) };
});
// The matcher above is a heuristic; a by-hand reading of every plant (judge/judge-plants-by-hand.json,
// { page_id: { caught, why } }) overrides it where present, and both counts are kept.
const HAND = path.join(JD, 'judge-plants-by-hand.json');
const hand = fs.existsSync(HAND) ? JSON.parse(fs.readFileSync(HAND, 'utf8')) : null;
for (const x of jp) if (hand?.[x.page] && x.judged) { x.caught_heuristic = x.caught; x.caught = hand[x.page].caught; x.by_hand = hand[x.page].why; }
out.judge_plants = { n: jp.length, caught: jp.filter((x) => x.caught).length, caught_heuristic: jp.filter((x) => x.caught_heuristic ?? x.caught).length, by_hand: !!hand, rows: jp, passed: jp.filter((x) => x.caught).length >= 8 };
out.void = !(out.wrong_page.passed && out.judge_plants.passed);
// Judge noise: repeats.
const rp = key.filter((k) => k.kind === 'repeat').map((k) => { const a = key.find((x) => x.kind === 'item' && x.route === k.route && x.page_id === k.page_id); const r1 = a && row(a), r2_ = row(k); return r1 && r2_ ? [r1, r2_] : null; }).filter(Boolean);
out.repeats = { pairs: rp.length, accept_flips: rp.filter(([a, b]) => a.accept !== b.accept).length, serious_abs_diff: rp.map(([a, b]) => Math.abs(a.serious - b.serious)), serious: rp.map(([a, b]) => [a.serious, b.serious]) };

// Cost per usable page: agy calls and tokens from the arms' outputs.
const tok = (u) => (u || []).reduce((s, x) => s + (x?.input ?? 0) + (x?.cache_read ?? 0) + (x?.output ?? 0) + (x?.thinking ?? 0), 0);
out.cost = {};
for (const a of ['T', 'T2', 'I']) for (const lang of LANGS.concat('all')) {
  const rs = by(lang, A[a]); let calls = 0, tokens = 0;
  for (const r of rs) { const o = JSON.parse(fs.readFileSync(path.join(RUN, `out-${a}`, `${r.page}.json`), 'utf8')); calls += o.calls; tokens += tok(o.usage); }
  const ok = rs.filter((r) => r.accept).length;
  (out.cost[lang] ??= {})[a] = { pages: rs.length, calls, tokens, tokens_per_page: Math.round(tokens / (rs.length || 1)), usable: ok, calls_per_usable: r2(calls / (ok || NaN)), tokens_per_usable: ok ? Math.round(tokens / ok) : null };
}
fs.writeFileSync(path.join(JD, 'score-106.json'), JSON.stringify(out, null, 1) + '\n');
for (const lang of LANGS.concat('all')) {
  const C = out.cells[lang];
  console.log(`\n== ${lang}`);
  for (const [a, x] of Object.entries(C.arms)) console.log(`${a.padEnd(3)} n ${x.n} accept ${x.accept} serious/1k ${x.serious_per_1k} (misleads ${x.misleads_per_1k}, wrong ${x.wrong_text_per_1k}) wt pages ${x.wrong_text_pages} false-leaf pages ${x.false_leaf_pages} fid ${x.fidelity_mean}`);
  console.log('paired', JSON.stringify(C.paired)); console.log('spots', JSON.stringify(C.spots)); console.log('rule', JSON.stringify(out.rule[lang]));
}
console.log('\nplanted_ocr', JSON.stringify({ T: { ...out.planted_ocr.T, rows: undefined }, I: { ...out.planted_ocr.I, rows: undefined } }));
console.log('wrong_page', JSON.stringify(out.wrong_page)); console.log('judge_plants', out.judge_plants.caught, '/', out.judge_plants.n, 'void', out.void);
console.log('repeats', JSON.stringify(out.repeats)); console.log('cost', JSON.stringify(out.cost.all));
