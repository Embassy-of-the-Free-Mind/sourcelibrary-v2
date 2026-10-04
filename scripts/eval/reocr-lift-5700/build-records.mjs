#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/from-ab-sample.mjs builds harness records from ONE #5606-style
// sample; each #5695 track has its own build-records (t2/build-records.mjs, xlref-t4/build-records.mjs) reading its
// own layout. None takes the unified track table plus the pilot's translation arms. The record shape is the
// harness's, unchanged, so build-packet.mjs / score.mjs run as they are.
/** Harness records for #5700 A5: source = the by-eye corrected transcription, candidates = Lite and Flash on the served OCR, on the fresh read(s), and on the corrected text. */
/**
 *   node scripts/eval/reocr-lift-5700/build-records.mjs --out <work>/records.jsonl [--private <jsonl with reference_text>]...
 * Pages kept: a corrected transcription exists, the fresh read returned text, and the served OCR is the image's leaf
 * (ocr-score.json `different_leaf`). --private files (each track's local records.jsonl) supply the in-copyright
 * reference texts the public track files withhold; the output then belongs OUTSIDE the repo.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const many = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []));
const DIR = opt('dir', 'scripts/eval/results/reocr-lift-2026-10'); const OUT = opt('out');
const rl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const priv = {}; for (const f of many('private')) for (const r of rl(f)) if (r.reference_text) priv[`${r.book_id}_${String(r.page_number).padStart(5, '0')}`] = r.reference_text;
const score = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(DIR, 'ocr-score.json'), 'utf8')).pages.map((p) => [p.id, p]));
const tr = {}; for (const t of rl(path.join(DIR, 'translations.jsonl'))) (tr[t.id] ||= {})[t.arm] = t;
const ARMS = ['lite-ocr', 'lite-reocr', 'lite-corr', 'flash-ocr', 'flash-reocr', 'flash-corr', 'lite-reocr2', 'flash-reocr2'];
const out = []; const skipped = [];
for (const r of rl(path.join(DIR, 'track-pages.jsonl'))) {
  const s = score[r.id]; if (!r.has_corrected) continue;
  if (s.reocr_outcome !== 'text') { skipped.push({ id: r.id, why: `fresh read ${s.reocr_outcome}` }); continue; }
  if (s.different_leaf) { skipped.push({ id: r.id, why: 'served OCR is another leaf than the image' }); continue; }
  const reference_text = r.reference_text || priv[r.id]; if (!reference_text) { skipped.push({ id: r.id, why: 'private reference text not on this machine' }); continue; }
  const m = r.reference_meta; const style = ['literal', 'free', 'early-modern'].includes(m.style) ? m.style : 'literal';
  out.push({ track: r.track, lang: r.lang, book_id: r.book_id, page_number: r.page_number, source_text: r.corrected_text, source_is: 'corrected transcription (by eye, #5695)',
    reference_text, reference_meta: { ...m, title: m.title, translator: m.translator || 'unknown', licence: m.private ? 'in-copyright' : (m.licence || 'unrecorded'), private: !!m.private, style, canonical: !!m.canonical },
    candidates: ARMS.filter((a) => tr[r.id]?.[a]?.text?.trim()).map((a) => ({ arm: a, text: tr[r.id][a].text, model: tr[r.id][a].model })) });
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out.map((x) => JSON.stringify(x)).join('\n') + '\n');
fs.writeFileSync(path.join(DIR, 'judged-pages.json'), JSON.stringify({ judged: out.map((r) => `${r.book_id}_${String(r.page_number).padStart(5, '0')}`), skipped }, null, 1));
console.log(`${out.length} records (${out.filter((r) => r.reference_meta.private).length} private references, ${out.filter((r) => r.candidates.length > 6).length} with A-vs-A arms) → ${OUT}; skipped ${JSON.stringify(skipped)}`);
