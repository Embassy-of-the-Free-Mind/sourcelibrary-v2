#!/usr/bin/env node
// PRIOR ART: scripts/eval/notes-layer/measure-parser.mts (#5942, PR #5958) tabulates a one-page-per-book draw by
// parser outcome; scripts/eval/translation-corpus-audit/score.mjs tabulates Opus verdicts. Neither reads this
// detector's rows. This tabulates them by translating model and prompt version and writes the by-eye sheet.
/** #5982 step 3: the detector's flags on the seeded draw, by model and translation.prompt_version, and the by-eye sample. */
/**   node scripts/eval/untagged-additions/analyze-draw.mjs [--model gemini-3-flash-preview] [--sheet] */
import fs from 'node:fs';
import path from 'node:path';
import { countedFlags, wilson } from './detector.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const MODEL = opt('model', 'gemini-3-flash-preview');
const OTHER = MODEL === 'gemini-3-flash-preview' ? 'gemini-3.1-flash-lite' : 'gemini-3-flash-preview';
const DIR = new URL('../results/untagged-additions-2026-10/', import.meta.url).pathname;
const jl = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const draw = jl('draw.jsonl');
const src = Object.fromEntries(jl('work/draw-items.jsonl').map((x) => [x.id, x.source]));
const load = (m) => Object.fromEntries(jl(`work/draw.${m}.jsonl`).filter((r) => !r.error).map((r) => [r.id, r]));
const A = load(MODEL), B = load(OTHER);
const pv = (v) => (v == null ? 'none' : String(v).replace(/^v/i, ''));
const pages = draw.map((d) => {
  const r = A[d.id]; if (!r) return { ...d, answered: false };
  const f = countedFlags(r, src[d.id]); const fb = B[d.id] ? countedFlags(B[d.id], src[d.id]) : null;
  return { ...d, answered: true, n_units: r.n_units, checkable: r.checkable, additions: f.additions, continuation: f.continuation, other_additions: fb ? fb.additions : null, units: r.units };
});
const ans = pages.filter((p) => p.answered);
const rate = (ps, f) => { const k = ps.filter(f).length; const ci = wilson(k, ps.length); return { k, n: ps.length, pct: ps.length ? +(100 * k / ps.length).toFixed(1) : null, ci: ci.map((x) => (x == null ? null : +(100 * x).toFixed(1))) }; };
const flagged = (p) => p.additions.length > 0;
const res = { detector_model: MODEL, drawn: draw.length, answered: ans.length, no_running_text: ans.filter((p) => p.n_units === 0).length, uncheckable: ans.filter((p) => p.checkable === false && p.n_units > 0).length, sentences: ans.reduce((s, p) => s + p.n_units, 0), flagged_sentences: ans.reduce((s, p) => s + p.additions.length, 0), pages_flagged: rate(ans, flagged), pages_continuation: rate(ans, (p) => p.continuation.length > 0), by_kind: {}, by_model: {}, by_prompt_version: {}, by_model_and_version: {}, by_language: {}, both_detectors: rate(ans.filter((p) => p.other_additions), (p) => flagged(p) && p.other_additions.length > 0), other_detector: rate(ans.filter((p) => p.other_additions), (p) => p.other_additions.length > 0) };
for (const p of ans) for (const f of p.additions) { res.by_kind[f.kind] ||= { sentences: 0, pages: new Set() }; res.by_kind[f.kind].sentences++; res.by_kind[f.kind].pages.add(p.id); }
for (const k of Object.keys(res.by_kind)) res.by_kind[k] = { sentences: res.by_kind[k].sentences, pages: res.by_kind[k].pages.size };
const group = (key, into) => { for (const g of [...new Set(ans.map(key))].sort()) into[g] = rate(ans.filter((p) => key(p) === g), flagged); };
group((p) => p.model || 'none', res.by_model); group((p) => pv(p.prompt_version), res.by_prompt_version); group((p) => `${p.model || 'none'} · v${pv(p.prompt_version)}`, res.by_model_and_version); group((p) => p.language || 'none', res.by_language);
// by-eye sample: 40 flagged sentences (at most 2 per page) and 20 unflagged pages, seeded
const rng = makeRng(59820);
const sh = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const flagPool = sh(ans.filter(flagged)).flatMap((p) => sh(p.additions).slice(0, 2).map((f) => ({ id: p.id, n: f.n, kind: f.kind, words: f.words, source_has: f.source_has, reason: f.reason, sentence: p.units[f.n - 1], language: p.language, model: p.model, prompt_version: pv(p.prompt_version) })));
const eyeFlags = flagPool.slice(0, 40);
const eyeClean = sh(ans.filter((p) => !flagged(p) && p.n_units >= 5)).slice(0, 20).map((p) => ({ id: p.id, language: p.language, model: p.model, prompt_version: pv(p.prompt_version), n_units: p.n_units }));
fs.writeFileSync(path.join(DIR, `draw.${MODEL}.results.json`), JSON.stringify(res, null, 1));
fs.writeFileSync(path.join(DIR, `draw.${MODEL}.flags.jsonl`), ans.filter((p) => p.additions.length || p.continuation.length).map((p) => JSON.stringify({ id: p.id, language: p.language, model: p.model, prompt_version: pv(p.prompt_version), n_units: p.n_units, additions: p.additions.map((f) => ({ ...f, sentence: p.units[f.n - 1] })), continuation: p.continuation.map((f) => ({ ...f, sentence: p.units[f.n - 1] })), other_detector_flags_too: p.other_additions ? p.other_additions.length > 0 : null })).join('\n') + '\n');
if (MODEL === 'gemini-3-flash-preview') fs.writeFileSync(path.join(DIR, 'by-eye-sample.json'), JSON.stringify({ seed: 59820, flags: eyeFlags, unflagged_pages: eyeClean }, null, 1));
const show = (label, r) => console.log(`${label.padEnd(44)} ${String(r.k).padStart(4)} / ${String(r.n).padEnd(4)} ${String(r.pct).padStart(5)}%  [${r.ci.join(', ')}]`);
console.log(`detector ${MODEL}: ${res.answered}/${res.drawn} answered; ${res.no_running_text} with no running text; ${res.uncheckable} uncheckable; ${res.flagged_sentences} flagged sentences of ${res.sentences}`);
show('pages with ≥ 1 addition flag', res.pages_flagged); show('pages with a continuation flag', res.pages_continuation); show(`also flagged by ${OTHER}`, res.both_detectors); show(`${OTHER} alone, any flag`, res.other_detector);
console.log('by kind', JSON.stringify(res.by_kind));
for (const [t, o] of [['model', res.by_model], ['prompt_version', res.by_prompt_version], ['model · version', res.by_model_and_version], ['language', res.by_language]]) { console.log(`-- by ${t}`); for (const [g, r] of Object.entries(o)) if (r.n >= 8 || t !== 'language') show(`  ${g}`, r); }
