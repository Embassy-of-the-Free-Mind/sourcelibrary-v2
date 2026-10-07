#!/usr/bin/env node
// PRIOR ART: none for this join — scripts/eval/benchmark-score.mjs compares OCR with a typed text by CER and never
// reads a translation; score-controls.mjs (this folder) scores planted sentences. This sets the detector's flags
// against the typed text beside its flags against our OCR, sentence by sentence.
/** #5982 step 3b: flags against the typed text vs flags against our OCR, per sentence and per page. */
/**   node scripts/eval/untagged-additions/analyze-typed.mjs [--model gemini-3-flash-preview] [--sheet] */
import fs from 'node:fs';
import path from 'node:path';
import { countedFlags, wilson } from './detector.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const MODEL = opt('model', 'gemini-3-flash-preview');
const DIR = new URL('../results/untagged-additions-2026-10/', import.meta.url).pathname;
const jl = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const meta = jl('typed.jsonl');
const items = Object.fromEntries(jl('work/typed-items.jsonl').map((x) => [x.id, x]));
const out = Object.fromEntries(jl(`work/typed.${MODEL}.jsonl`).filter((r) => !r.error).map((r) => [r.id, r]));
const pages = [];
for (const m of meta) {
  const t = out[`typed:${m.id}`], o = out[`ocr:${m.id}`];
  if (!t || (!o && !m.ocr_is_the_typed_text)) continue;
  const ft = countedFlags(t, items[`typed:${m.id}`].source), fo = o ? countedFlags(o, items[`ocr:${m.id}`].source) : { additions: [], continuation: [] };
  const nT = new Set(ft.additions.map((f) => f.n)), nO = new Set(fo.additions.map((f) => f.n));
  const sent = [...new Set([...nT, ...nO])].sort((a, b) => a - b).map((n) => ({ n, sentence: t.units[n - 1], where: nT.has(n) && nO.has(n) ? 'both' : nT.has(n) ? 'typed_only' : 'ocr_only', typed: ft.additions.find((f) => f.n === n) || null, ocr: fo.additions.find((f) => f.n === n) || null }));
  pages.push({ ...m, n_units: t.n_units, checkable_typed: t.checkable, checkable_ocr: o ? o.checkable : null, sentences: sent, continuation_typed: ft.continuation.length, continuation_ocr: fo.continuation.length });
}
const groups = { 'typed, not Tibetan': pages.filter((p) => !p.ocr_is_the_typed_text), 'same-edition transcription (Latin)': pages.filter((p) => /same-edition|ocr-same-text/.test(p.ref_kind)), 'e-text window or pinned passage': pages.filter((p) => /window|pinned/.test(p.ref_kind)), 'Tibetan (typed text is the stored text)': pages.filter((p) => p.ocr_is_the_typed_text) };
const res = { model: MODEL, groups: {} };
for (const [g, ps] of Object.entries(groups)) {
  const cnt = (w) => ps.filter((p) => p.sentences.some((s) => s.where === w)).length;
  const sc = (w) => ps.reduce((s, p) => s + p.sentences.filter((x) => x.where === w).length, 0);
  const any = (f) => ps.filter(f).length;
  res.groups[g] = { pages: ps.length, sentences: ps.reduce((s, p) => s + p.n_units, 0), pages_flagged_vs_typed: any((p) => p.sentences.some((s) => s.where !== 'ocr_only')), pages_flagged_vs_ocr: any((p) => p.sentences.some((s) => s.where !== 'typed_only')), pages_both: cnt('both'), pages_typed_only: cnt('typed_only'), pages_ocr_only: cnt('ocr_only'), sentences_both: sc('both'), sentences_typed_only: sc('typed_only'), sentences_ocr_only: sc('ocr_only'), uncheckable_typed: any((p) => p.checkable_typed === false), uncheckable_ocr: any((p) => p.checkable_ocr === false) };
  const r = res.groups[g];
  console.log(`${g}: ${r.pages} pages, ${r.sentences} sentences | flagged vs typed ${r.pages_flagged_vs_typed} [${wilson(r.pages_flagged_vs_typed, r.pages).map((x) => (100 * x).toFixed(0)).join(', ')}%], vs OCR ${r.pages_flagged_vs_ocr} | sentences both ${r.sentences_both}, typed-only ${r.sentences_typed_only} (${r.pages_typed_only} pages), OCR-only ${r.sentences_ocr_only} (${r.pages_ocr_only} pages) | uncheckable typed ${r.uncheckable_typed}, ocr ${r.uncheckable_ocr}`);
}
fs.writeFileSync(path.join(DIR, `typed.${MODEL}.flags.json`), JSON.stringify({ ...res, pages: pages.filter((p) => p.sentences.length).map((p) => ({ id: p.id, language: p.language, ref: p.ref, ref_kind: p.ref_kind, model: p.model, prompt_version: p.prompt_version, ocr_model: p.ocr_model, sentences: p.sentences })) }, null, 1));
if (args.includes('--sheet')) for (const p of pages) for (const s of p.sentences) console.log(`\n${p.id} ${p.language} ${p.ref_kind} [${s.where}] n=${s.n}\n  EN: ${s.sentence.slice(0, 400)}\n  typed: ${s.typed ? `${s.typed.kind} «${s.typed.words}» src:${s.typed.source_has} — ${s.typed.reason}` : '-'}\n  ocr:   ${s.ocr ? `${s.ocr.kind} «${s.ocr.words}» src:${s.ocr.source_has} — ${s.ocr.reason}` : '-'}`);
