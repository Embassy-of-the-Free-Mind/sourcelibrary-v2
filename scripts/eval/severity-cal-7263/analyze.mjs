#!/usr/bin/env node
// PRIOR ART: scripts/eval/sa-gr-served-7991/analyze.mjs (sense errors per 1,000 words, the book-cluster bootstrap,
// Wilson intervals, kindOf() error kinds — wilson and the bootstrap restated: that file computes on import, and this
// draw has no strata). scripts/eval/sanskrit-gex45-7243/score.mjs views/cer (the deva-n@1 CER, imported).
/**
 * #7263 severity calibration, stage 4: every table. Pure: reads OUT, writes scripts/eval/severity-cal-7263/results/
 * results.json (no page text from a licensed reference; quotes of OUR texts are kept short).
 *
 *   node scripts/eval/severity-cal-7263/analyze.mjs [--ref-dir=DIR]
 */
import fs from 'node:fs';
import path from 'node:path';
import { kindOf } from '../latin-strata-7947/lib.mjs';
import { words } from '../route-judge-6740/defect-rate.mjs';
import { views, cer } from '../sanskrit-gex45-7243/score.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { seriousSpans } from './judge.mjs';
import { OUT, RESULTS, SEED, LANGS, arg, jsonl, J, opusUsed } from './lib.mjs';

function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [+Math.max(0, c - h).toFixed(3), +Math.min(1, c + h).toFixed(3)];
}
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(2));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));
const first = (f) => { const m = new Map(); for (const r of jsonl(path.join(OUT, f))) if (r.verdict && !m.has(r.id)) m.set(r.id, r.verdict); return m; };
const SERIOUS = new Set(['misleads', 'wrong_text']);
const SEV = ['none', 'cosmetic', 'misleads', 'wrong_text'];
const worst = (v) => SEV[Math.max(0, ...(v?.defects || []).map((d) => SEV.indexOf(d.severity)))];
const nSer = (v) => (v?.defects || []).filter((d) => SERIOUS.has(d.severity)).length;
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.min(s.length - 1, Math.floor(p * s.length)))]; };
function boot(ps, stat, seed, B = 4000) {   // one page a book: the page is the cluster
  const rng = makeRng(seed), sims = [];
  for (let i = 0; i < B; i++) { const s = ps.map(() => ps[Math.floor(rng() * ps.length)]); const v = stat(s); if (v != null && Number.isFinite(v)) sims.push(v); }
  return sims.length ? [r2(pctl(sims, 0.025)), r2(pctl(sims, 0.975))] : null;
}
const per1k = (ps, f) => { const w = ps.reduce((a, p) => a + p.words, 0); return w ? (1000 * ps.reduce((a, p) => a + f(p), 0)) / w : null; };
const rate = (ps, f, seed) => ({ per_1k: r2(per1k(ps, f)), ci95: boot(ps, (s) => per1k(s, f), seed), errors: ps.reduce((a, p) => a + f(p), 0), words: ps.reduce((a, p) => a + p.words, 0) });
const kappa = (pairs) => {   // Cohen's kappa over categorical pairs
  const n = pairs.length; if (!n) return null;
  const cats = [...new Set(pairs.flat())], po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return pe === 1 ? null : r3((po - pe) / (1 - pe));
};
const xtab = (pairs) => { const t = {}; for (const [a, b] of pairs) { t[a] ??= {}; t[a][b] = (t[a][b] ?? 0) + 1; } return t; };
const short = (s, n = 80) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

const s = J('sample.json'), reads = J('reads.json'), key = J('key.json'), frame = J('frame.json');
const S1 = first('route-s1.jsonl'), S2 = first('route-s2.jsonl'), T = first('stept.jsonl'), SEC = first('second.jsonl'), MISS = first('miss.jsonl');
const stKey = fs.existsSync(path.join(OUT, 'stept-key.json')) ? J('stept-key.json') : [];
const secItems = new Map((fs.existsSync(path.join(OUT, 'second-items.json')) ? J('second-items.json') : []).map((x) => [x.id, x]));
const page = new Map(s.map((x) => [x.page_id, x]));

// The page's words: the stored text's, unless it is a loop (then the fresh read's) — amendment 1.
const pageWords = (x) => (reads[x.page_id].S.class === 'loop' && reads[x.page_id].F.class === 'ok' ? words(reads[x.page_id].F.text) : words(x.stored));

/** Second reader's verdict on each serious span of an item, keyed as seriousSpans() keys them. */
function spanVerdicts(id) {
  const sp = seriousSpans(id), v = SEC.get(id);
  return sp.map((p, k) => { const pt = v?.points?.find((q) => Number(q.n) === k + 1); return { ...p, second: pt ?? null, upheld: pt ? pt.different === 'yes' && pt.changes_sense === 'yes' : null }; });
}
/** One sitting's serious defects of an item, each with its span's second-reader verdict. */
function seriousOf(id, sitting) {
  const v = (sitting === 1 ? S1 : S2).get(id); if (!v) return [];
  const sv = spanVerdicts(id), tag = `s${sitting}`;
  return (v.defects || []).map((d, i) => ({ d, i })).filter(({ d }) => SERIOUS.has(d.severity)).map(({ d, i }) => ({ ...d, span: sv.find((p) => p.from.includes(`${tag}:${i}`)) }));
}

const items = key.filter((k) => k.kind === 'item').map((k) => {
  const x = page.get(k.page_id);
  return { ...k, words: pageWords(x), title: x.title, url: `https://sourcelibrary.org/book/${x.book_id}/page/${x.page_number}`, stored_model: x.stored_model, read_class: reads[k.page_id][k.arm].class,
    v1: S1.get(k.id) ?? null, v2: S2.get(k.id) ?? null, ser1: seriousOf(k.id, 1), ser2: seriousOf(k.id, 2) };
});

// ── per language × text ──
const table = {};
for (const lang of Object.keys(LANGS)) for (const arm of ['S', 'F']) {
  const ps = items.filter((p) => p.lang === lang && p.arm === arm && p.v1);
  if (!ps.length) continue;
  const seed = SEED + lang.charCodeAt(0) + arm.charCodeAt(0);
  const ser = ps.flatMap((p) => p.ser1), checked = ser.filter((d) => d.span?.second), up = checked.filter((d) => d.span.upheld);
  const bySev = Object.fromEntries(['misleads', 'wrong_text'].map((sv) => { const c = checked.filter((d) => d.severity === sv), u = c.filter((d) => d.span.upheld); return [sv, { checked: c.length, upheld: u.length, share: r3(c.length ? u.length / c.length : null), ci95: wilson(u.length, c.length) }]; }));
  const after = rate(ps, (p) => p.ser1.filter((d) => d.span?.upheld).length, seed + 1);
  const both = ps.filter((p) => p.v2);
  table[`${lang}/${arm}`] = {
    language: LANGS[lang], text: arm === 'S' ? 'stored, as served' : 'fresh agy Flash-low', unit: lang === 'zh' ? 'Han characters' : 'words', pages: ps.length,
    accepted_s1: ps.filter((p) => p.v1.accept).length, accept_ci95: wilson(ps.filter((p) => p.v1.accept).length, ps.length),
    sense_errors_before: rate(ps, (p) => p.ser1.length, seed), sense_errors_sitting2: rate(both, (p) => p.ser2.length, seed + 2),
    sense_errors_after_second_reader: after,
    words_per_error_before: r2(1000 / per1k(ps, (p) => p.ser1.length)), words_per_error_after: r2(1000 / per1k(ps, (p) => p.ser1.filter((d) => d.span?.upheld).length)),
    serious_calls: ser.length, second_read: checked.length, upheld: up.length, upheld_share: r3(checked.length ? up.length / checked.length : null), upheld_ci95: wilson(up.length, checked.length), by_severity: bySev,
    cannot_tell: checked.filter((d) => d.span.second.different === 'cannot_tell').length, not_different: checked.filter((d) => d.span.second.different === 'no').length,
    different_but_same_sense: checked.filter((d) => d.span.second.different === 'yes' && d.span.second.changes_sense !== 'yes').length,
    pages_clean_after: ps.filter((p) => !p.ser1.some((d) => d.span?.upheld)).length,
    retest: { pages: both.length, accept_agree: both.filter((p) => p.v1.accept === p.v2.accept).length, accept_kappa: kappa(both.map((p) => [p.v1.accept, p.v2.accept])),
      worst_agree: both.filter((p) => worst(p.v1) === worst(p.v2)).length, worst_kappa: kappa(both.map((p) => [worst(p.v1), worst(p.v2)])), worst_xtab: xtab(both.map((p) => [worst(p.v1), worst(p.v2)])),
      serious_page_agree: both.filter((p) => (nSer(p.v1) > 0) === (nSer(p.v2) > 0)).length },
  };
}

// ── controls ──
const controls = key.filter((k) => k.kind === 'wrong_page').map((k) => ({ lang: k.lang, arm: k.arm, s1: S1.get(k.id), s2: S2.get(k.id) })).map((c) => ({ ...c, pass1: c.s1 ? !c.s1.accept && c.s1.fidelity <= 2 : null, pass2: c.s2 ? !c.s2.accept && c.s2.fidelity <= 2 : null }));
const controlRows = Object.fromEntries(Object.keys(table).map((k) => { const [lang, arm] = k.split('/'); const c = controls.filter((x) => x.lang === lang && x.arm === arm); return [k, { n: c.length, pass_s1: c.filter((x) => x.pass1).length, pass_s2: c.filter((x) => x.pass2).length, fidelity_s1: c.map((x) => x.s1?.fidelity ?? null) }]; }));

// ── Step T × route judge ──
const rjClass = (v) => (!v ? 'unjudged' : `${v.accept ? 'accept' : 'reject'}/${worst(v)}`);
const stepRows = [];
for (const k of stKey) {
  const t = T.get(k.id); if (!t) continue;
  for (const [L, arm] of Object.entries(k.labels)) {
    const it = items.find((p) => p.page_id === k.page_id && p.arm === arm);
    stepRows.push({ lang: k.lang, arm, page_id: k.page_id, step_t: t[L]?.verdict ?? 'missing', not_this_leaf: !!t[L]?.not_this_leaf, material: (t[L]?.defects || []).filter((d) => d.material).length, route: arm.startsWith('W') ? 'control' : rjClass(it?.v1) });
  }
}
const crossTab = Object.fromEntries(Object.keys(LANGS).map((lang) => [lang, xtab(stepRows.filter((r) => r.lang === lang && !r.arm.startsWith('W')).map((r) => [r.step_t, r.route]))]));
const stepControls = Object.fromEntries(Object.keys(LANGS).map((lang) => { const w = stepRows.filter((r) => r.lang === lang && r.arm.startsWith('W')); return [lang, { n: w.length, misleading: w.filter((r) => r.step_t === 'misleading').length, not_this_leaf: w.filter((r) => r.not_this_leaf).length }]; }));
const stepMis = Object.fromEntries(Object.keys(table).map((k) => { const [lang, arm] = k.split('/'); const r = stepRows.filter((x) => x.lang === lang && x.arm === arm); return [k, { n: r.length, misleading: r.filter((x) => x.step_t === 'misleading').length, flawed: r.filter((x) => x.step_t === 'flawed').length, sound: r.filter((x) => x.step_t === 'sound').length, ci95_misleading: wilson(r.filter((x) => x.step_t === 'misleading').length, r.length) }]; }));
// Does Step T "misleading" track a second-reader-upheld serious span (the brief's question)?
const tVsUpheld = Object.fromEntries(Object.keys(LANGS).map((lang) => [lang, xtab(stepRows.filter((r) => r.lang === lang && !r.arm.startsWith('W')).map((r) => { const it = items.find((p) => p.page_id === r.page_id && p.arm === r.arm); return [r.step_t, !it?.v1 ? 'unjudged' : it.ser1.some((d) => d.span?.upheld) ? 'upheld serious span' : it.ser1.length ? 'serious calls, none upheld' : 'no serious call']; }))]));

// ── misses ──
const missItems = fs.existsSync(path.join(OUT, 'miss-items.json')) ? J('miss-items.json') : [];
const missRows = Object.fromEntries(Object.keys(LANGS).map((lang) => {
  const its = missItems.filter((m) => m.lang === lang && MISS.has(m.id)).map((m) => ({ ...m, errors: MISS.get(m.id).errors, words: items.find((p) => p.id === m.id).words }));
  return [lang, { items: its.length, with_any: its.filter((m) => m.errors.length).length, ci95: wilson(its.filter((m) => m.errors.length).length, its.length), errors: its.reduce((a, m) => a + m.errors.length, 0), per_1k: r2(per1k(its, (m) => m.errors.length)),
    examples: its.filter((m) => m.errors.length).slice(0, 5).map((m) => ({ page: items.find((p) => p.id === m.id).url, arm: items.find((p) => p.id === m.id).arm, error: { quote: short(m.errors[0].quote, 60), page_prints: short(m.errors[0].page_prints, 60), what: short(m.errors[0].what, 120) } })) }];
}));

// ── error kinds (upheld serious spans, sitting 1) ──
const kinds = {};
for (const p of items) for (const d of p.ser1) {
  const k = kindOf({ class: d.class, problem: d.what, ocr: d.quote }, 'ocr'), g = ((kinds[`${p.lang}/${p.arm}`] ??= {})[k] ??= { called: 0, upheld: 0 });
  g.called++; if (d.span?.upheld) g.upheld++;
}

// ── examples per severity ──
const ex = { wrong_text_upheld: [], wrong_text_not_upheld: [], misleads_upheld: [], misleads_not_upheld: [], cosmetic: [] };
for (const p of items) for (const d of (p.v1?.defects || [])) {
  const sp = d.severity === 'cosmetic' ? null : p.ser1.find((x) => x.quote === d.quote)?.span;
  const slot = d.severity === 'cosmetic' ? 'cosmetic' : `${d.severity}_${sp?.upheld ? 'upheld' : 'not_upheld'}`;
  if (!ex[slot] || ex[slot].length >= 5 || ex[slot].some((e) => e.book_id === p.book_id) || (slot !== 'cosmetic' && !sp?.second)) continue;
  ex[slot].push({ lang: p.lang, arm: p.arm, book_id: p.book_id, page: p.url, class: d.class, quote: short(d.quote, 60), judge_said: short(d.what, 120), second_reader: sp?.second ? { different: sp.second.different, changes_sense: sp.second.changes_sense, page_prints: short(sp.second.page_prints, 60), why: short(sp.second.why, 120) } : null });
}

// ── fresh beats stored (for a lane to apply later) ──
const beats = [];
for (const x of s) {
  const a = items.find((p) => p.page_id === x.page_id && p.arm === 'S'), b = items.find((p) => p.page_id === x.page_id && p.arm === 'F');
  if (!a?.v1 || !b?.v1) continue;
  const up = (p) => p.ser1.filter((d) => d.span?.upheld).length;
  const k = stKey.find((q) => q.page_id === x.page_id), t = k && T.get(k.id), lab = k && Object.fromEntries(Object.entries(k.labels).map(([L, arm]) => [arm, L]));
  const pair = lab && ['XY', 'XZ', 'YZ'].find((pp) => pp.includes(lab.S) && pp.includes(lab.F));
  const tPref = t && pair ? (t[pair].prefer === lab.F ? 'F' : t[pair].prefer === lab.S ? 'S' : 'tie') : null;
  const rjF = up(b) < up(a) || (b.v1.accept && !a.v1.accept);
  if (rjF && tPref === 'F') beats.push({ page_id: x.page_id, lang: x.lang, page: a.url, stored_model: x.stored_model, upheld_S: up(a), upheld_F: up(b), accept_S: a.v1.accept, accept_F: b.v1.accept, step_t_material: !!t[pair].loser_material, stored_class: reads[x.page_id].S.class });
}

// ── references ──
const refs = { zh: { kanripo: (() => { const f = path.join(OUT, 'kanripo-align.jsonl'); const r = jsonl(f); return { candidates: r.length, aligned: r.filter((x) => /^aligned/.test(x.status) || x.text).length, statuses: r.reduce((m, x) => ((m[x.status] = (m[x.status] ?? 0) + 1), m), {}) }; })() } };
if (arg('ref-dir') && fs.existsSync(path.join(OUT, 'refarm-key.json'))) {
  const R = first('refarm.jsonl'), rk = J('refarm-key.json');
  const out = { F: [], REF: [] };
  for (const k of rk) {
    const v = R.get(k.id); if (!v) continue;
    const refText = fs.readFileSync(path.join(path.resolve(arg('ref-dir')), 'refwork/final', `${k.slug}.txt`), 'utf8');
    const F = fs.readFileSync(path.join(path.resolve(arg('ref-dir')), 'arms/F.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((r) => r.uid === k.slug)?.text ?? '';
    const own = k.arm === 'F' ? F : refText, refN = views(refText, refText).R.N;
    const ser = (v.defects || []).filter((d) => SERIOUS.has(d.severity));
    // A serious span's words found unchanged in the reference: the judge flagged what the (near-clean) reference has.
    const inRef = ser.filter((d) => { const q = views(d.quote ?? '', d.quote ?? '').R.N; return q.length >= 3 && refN.includes(q); }).length;
    out[k.arm].push({ slug: k.slug, words: words(refText), accept: v.accept, fidelity: v.fidelity, serious: ser.length, serious_span_in_reference: inRef, cer_vs_ref: k.arm === 'F' ? r3(cer(views(refText, F).R.N, views(refText, F).H.Nr)) : 0 });
  }
  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  refs.sa = Object.fromEntries(Object.entries(out).map(([arm, a]) => [arm, { pages: a.length, accepted: a.filter((x) => x.accept).length, serious: sum(a, (x) => x.serious), per_1k: r2((1000 * sum(a, (x) => x.serious)) / Math.max(1, sum(a, (x) => x.words))),
    serious_span_in_reference: sum(a, (x) => x.serious_span_in_reference), median_cer: arm === 'F' ? r3([...a.map((x) => x.cer_vs_ref)].sort((p, q) => p - q)[a.length >> 1]) : null, rows: a }]));
}

// ── reads ──
const readTally = {};
for (const x of s) for (const a of ['S', 'F']) { const k = `${x.lang}/${a}`; (readTally[k] ??= {})[reads[x.page_id][a].class] = (readTally[k][reads[x.page_id][a].class] ?? 0) + 1; }
const notRead = s.filter((x) => reads[x.page_id].F.class !== 'ok').map((x) => ({ lang: x.lang, page: `https://sourcelibrary.org/book/${x.book_id}/page/${x.page_number}`, class: reads[x.page_id].F.class }));
const loops = s.filter((x) => reads[x.page_id].S.class === 'loop').map((x) => ({ lang: x.lang, book_id: x.book_id, page_number: x.page_number, page_id: x.page_id, model: x.stored_model, stored_words: words(x.stored), fresh_words: reads[x.page_id].F.class === 'ok' ? words(reads[x.page_id].F.text) : null }));

fs.mkdirSync(RESULTS, { recursive: true });
const res = { at: new Date().toISOString(), seed: SEED, opus_calls: opusUsed(), frame, reads: readTally, fresh_not_read: notRead, stored_loops: loops, table, controls: controlRows,
  step_t: { by_text: stepMis, cross_tab_vs_route_judge: crossTab, vs_second_reader: tVsUpheld, controls: stepControls }, misses: missRows, kinds, examples: ex, fresh_beats_stored: beats, references: refs };
fs.writeFileSync(path.join(RESULTS, 'results.json'), JSON.stringify(res, null, 1));
for (const [k, r] of Object.entries(table)) console.log(`${k}: n=${r.pages} accept ${r.accepted_s1} | before ${r.sense_errors_before.per_1k} [${r.sense_errors_before.ci95}] after ${r.sense_errors_after_second_reader.per_1k} [${r.sense_errors_after_second_reader.ci95}] | upheld ${r.upheld}/${r.second_read} | retest accept ${r.retest.accept_agree}/${r.retest.pages} κ ${r.retest.accept_kappa} worst ${r.retest.worst_agree}/${r.retest.pages} κ ${r.retest.worst_kappa}`);
console.log(JSON.stringify({ controls: controlRows, step_t: stepMis, stepControls, misses: Object.fromEntries(Object.entries(missRows).map(([k, v]) => [k, { items: v.items, with_any: v.with_any, per_1k: v.per_1k }])), beats: beats.length, refs: refs.sa ? Object.fromEntries(Object.entries(refs.sa).map(([k, v]) => [k, { ...v, rows: undefined }])) : null }, null, 1));
