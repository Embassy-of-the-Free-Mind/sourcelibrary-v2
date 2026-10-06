#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t1/dims-score.mjs and scripts/eval/xlref-t4/score-dims.mjs unblind an ours-vs-reference
// dimension pass, two columns, no noise-floor arm; scripts/eval/translation-vs-reference/score.mjs scores fidelity
// (its results file is read here, not recomputed). None applies PREREGISTRATION-translation-prompt-v17.md's rule:
// each v17 stance against v13-a, established only beyond the v13-b floor.
/** #5698 v17 results: unblind the dimension and note-fact passes, join fidelity and mechanical outcomes, apply the preregistered rule. */
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl } from '../translation-vs-reference/common.mjs';
import { ARMS, pairedCI, verdict } from './score.mjs';

const DIR = new URL('../results/translation-prompt-v17-2026-10/', import.meta.url).pathname;
const W = path.join(DIR, 'work');
const sample = new Map(readJsonl(path.join(DIR, 'sample.jsonl')).map((r) => [`${r.book_id}_${String(r.page_number).padStart(5, '0')}`, r]));
const DIMS = ['readability', 'register', 'terminology', 'ambiguity', 'transparency'];

// ── dimension pass ──
const key = JSON.parse(fs.readFileSync(path.join(W, 'dims', 'key.json'), 'utf8'));
const pages = new Map();
const dimRows = [];
for (const f of fs.readdirSync(path.join(W, 'dims', 'verdicts')).sort()) for (const v of readJsonl(path.join(W, 'dims', 'verdicts', f))) {
  const s = sample.get(v.id); const p = { id: v.id, lang: s.lang, set: s.set, confidence: v.confidence, reason: v.reason };
  for (const [label, arm] of Object.entries(key[v.id])) {
    const x = v.scores[label]; if (!x) throw new Error(`${v.id} missing ${label}`);
    p[arm] = { ...Object.fromEntries(DIMS.map((d) => [d, x[d]])), stance: x.stance, notes: x.notes || {}, alternatives: x.alternatives || [], silent: x.silent || [] };
    dimRows.push({ id: v.id, lang: s.lang, set: s.set, arm, ...p[arm] });
  }
  pages.set(v.id, p);
}
// ── fidelity pass (guards) ──
const fid = JSON.parse(fs.readFileSync(path.join(DIR, 'results-fidelity.json'), 'utf8'));
for (const pp of fid.per_page) {
  const p = pages.get(pp.id); if (!p) continue;
  for (const arm of ARMS) {
    const a = pp.arms[arm]; if (!a) continue; const js = Object.values(a.by_judge);
    Object.assign(p[arm], { fidelity: a.fidelity, omission: js.filter((j) => j.omission).length / js.length, reversal: js.filter((j) => j.reversal).length / js.length, reversal_any: js.some((j) => j.reversal) ? 1 : 0, reversal_quotes: js.map((j) => j.reversal).filter(Boolean) });
  }
  p.reference_fit = pp.reference_fit;
}
const mech = JSON.parse(fs.readFileSync(path.join(DIR, 'mechanical.json'), 'utf8'));
for (const m of mech.per_page) { const [b, n] = m.id.split('_'); const p = pages.get(`${b}_${n.padStart(5, '0')}`); if (p) for (const arm of ARMS) p[arm].mech = m[arm]; }

const all = [...pages.values()]; const main = all.filter((p) => p.set === 'main');
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const NUM = { ...Object.fromEntries(DIMS.map((d) => [d, (x) => x[d]])), fidelity: (x) => x.fidelity, omission: (x) => x.omission, reversal_pages: (x) => x.reversal_any,
  notes_source_or_clutter: (x) => (x.notes.source_printed || 0) + (x.notes.clutter || 0), notes_malformed: (x) => x.notes.malformed || 0,
  alternatives_real: (x) => x.alternatives.filter((a) => a.verdict === 'real').length, has_real_alternative: (x) => (x.alternatives.some((a) => a.verdict === 'real') ? 1 : 0),
  silent: (x) => x.silent.length };
const out = { generated: new Date().toISOString(), n_main: main.length, n_gallery_pool: all.length - main.length, measure: 'dimension scores: one blind Opus judge (agreement with a rubric, not accuracy); fidelity: two blind Opus judges against a human reference; mechanical: string checks',
  fidelity_gate: fid.gate, fidelity_agreement: fid.agreement, arms: {}, paired_vs_v13a: {}, verdicts: {}, by_lang: {} };
for (const arm of ARMS) {
  const alts = main.flatMap((p) => p[arm].alternatives);
  out.arms[arm] = { ...Object.fromEntries(Object.entries(NUM).map(([k, f]) => [k, mean(main.map((p) => f(p[arm])).filter((x) => x != null))])),
    stance: Object.fromEntries(['literal', 'balanced', 'free'].map((s) => [s, main.filter((p) => p[arm].stance === s).length])),
    note_audit: Object.fromEntries(['ours', 'source_printed', 'clutter', 'malformed'].map((k) => [k, main.reduce((s, p) => s + (p[arm].notes[k] || 0), 0)])),
    alternatives: { offered: alts.length, real: alts.filter((a) => a.verdict === 'real').length, spurious: alts.filter((a) => a.verdict === 'spurious').length, wrong: alts.filter((a) => a.verdict === 'wrong').length, pages: main.filter((p) => p[arm].alternatives.length).length, pages_real: main.filter((p) => p[arm].alternatives.some((a) => a.verdict === 'real')).length },
    silent_pages: main.filter((p) => p[arm].silent.length).length,
    reversal_pages_either_judge: main.filter((p) => p[arm].reversal_any).length, mechanical: mech.arms[arm] };
}
for (const arm of ARMS.slice(1)) out.paired_vs_v13a[arm] = Object.fromEntries(Object.entries(NUM).map(([k, f]) => [k, pairedCI(main, f, 'v13-a', arm)]));
for (const arm of ['v17-study', 'v17-reading']) out.verdicts[arm] = { ...Object.fromEntries(Object.keys(NUM).map((k) => [k, verdict(out.paired_vs_v13a[arm][k], out.paired_vs_v13a['v13-b'][k])])), mechanical: mech.verdicts[arm] };
const GROUPS = { 'Latin': ['Latin'], 'Greek': ['Greek'], 'vernaculars': ['German', 'French', 'Italian', 'Dutch'], 'Hebrew/Aramaic': ['Hebrew', 'Aramaic'], 'Arabic/Persian': ['Arabic', 'Persian'], 'Sanskrit/Pali': ['Sanskrit', 'Pali'], 'Chinese': ['Chinese'] };
for (const [g, langs] of Object.entries(GROUPS)) { const ps = main.filter((p) => langs.includes(p.lang)); out.by_lang[g] = { n: ps.length, ...Object.fromEntries(ARMS.map((a) => [a, { transparency: mean(ps.map((p) => p[a].transparency)), readability: mean(ps.map((p) => p[a].readability)), ambiguity: mean(ps.map((p) => p[a].ambiguity)), fidelity: mean(ps.map((p) => p[a].fidelity)), notes: mean(ps.map((p) => p[a].mech.notes)) }])) }; }

// ── note facts ──
const fkey = JSON.parse(fs.readFileSync(path.join(W, 'facts', 'key.json'), 'utf8'));
const fv = new Map(); for (const f of fs.readdirSync(path.join(W, 'facts', 'verdicts')).sort()) for (const v of readJsonl(path.join(W, 'facts', 'verdicts', f))) fv.set(v.id, v);
const seeds = fkey.filter((k) => k.seed); const caught = seeds.filter((k) => ['wrong', 'partly-wrong'].includes(fv.get(k.id)?.verdict)).length;
const facts = { seeds: { n: seeds.length, caught, valid: caught >= 6 }, arms: {}, errors: [] };
for (const arm of ARMS) for (const scope of ['lane', 'all']) {
  const ks = fkey.filter((k) => !k.seed && k.arms.includes(arm) && k.set === 'main' && (scope === 'all' || !k.extra));
  const c = {}; for (const k of ks) { const v = fv.get(k.id)?.verdict || 'missing'; c[v] = (c[v] || 0) + 1; }
  const checked = (c.correct || 0) + (c.wrong || 0) + (c['partly-wrong'] || 0);
  (facts.arms[arm] ||= {})[scope] = { notes: ks.length, ...c, checked, errors: (c.wrong || 0) + (c['partly-wrong'] || 0), error_rate: checked ? ((c.wrong || 0) + (c['partly-wrong'] || 0)) / checked : null };
}
for (const k of fkey) { const v = fv.get(k.id); if (!k.seed && v && ['wrong', 'partly-wrong'].includes(v.verdict)) facts.errors.push({ page: k.page, lang: k.lang, set: k.set, arms: k.arms, note: k.note.slice(0, 200), verdict: v.verdict, why: v.why }); }
out.note_facts = facts;
out.per_page = all;
fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(DIR, 'dimension-verdicts.jsonl'), dimRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(DIR, 'note-fact-verdicts.jsonl'), fkey.map((k) => JSON.stringify({ ...k, ...(fv.get(k.id) || {}) })).join('\n') + '\n');

const f2 = (x) => (x == null ? '—' : x.toFixed(2));
console.log(`main n=${main.length}; fidelity gate ${fid.gate.gate_pass}; κ ${fid.agreement.weighted_kappa}`);
console.log(`${'metric'.padEnd(24)}${ARMS.map((a) => a.padStart(12)).join('')}   study Δ [CI] (verdict) | reading Δ [CI] (verdict) | floor`);
for (const k of Object.keys(NUM)) { const e = (arm) => { const x = out.paired_vs_v13a[arm][k]; return `${f2(x.delta)} [${f2(x.ci?.[0])},${f2(x.ci?.[1])}]`; };
  console.log(`${k.padEnd(24)}${ARMS.map((a) => f2(out.arms[a][k]).padStart(12)).join('')}   ${e('v17-study')} (${out.verdicts['v17-study'][k]}) | ${e('v17-reading')} (${out.verdicts['v17-reading'][k]}) | ${e('v13-b')}`); }
for (const arm of ARMS) { const a = out.arms[arm]; console.log(arm.padEnd(12), 'stance', JSON.stringify(a.stance), 'audit', JSON.stringify(a.note_audit), 'alts', JSON.stringify(a.alternatives), 'silent pages', a.silent_pages, 'reversal pages', a.reversal_pages_either_judge); }
console.log('facts', JSON.stringify(facts.seeds)); for (const arm of ARMS) console.log(' ', arm.padEnd(12), JSON.stringify(facts.arms[arm]));
for (const e of facts.errors) console.log('  ERR', e.lang, e.arms.join('+'), '|', e.note.slice(0, 90), '=>', e.why.slice(0, 110));
for (const [g, v] of Object.entries(out.by_lang)) console.log(g.padEnd(16), v.n, ARMS.map((a) => `${a}: T ${f2(v[a].transparency)} R ${f2(v[a].readability)} A ${f2(v[a].ambiguity)} F ${f2(v[a].fidelity)}`).join(' | '));
