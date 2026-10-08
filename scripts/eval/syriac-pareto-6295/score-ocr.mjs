#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/edition-window.mjs (cutEditionWindow — used as is to locate each arm's read in the
// matched e-text); scripts/eval/benchmark-score.mjs (one engine against a reference window it cut itself, which
// lets the probe set the boundaries — the preregistration forbids that here, so windows are voted across arms).
/**
 * score-ocr.mjs — Step 1 of #6295. Read-only, $0. For each sealed page: cut the reference window from the
 * book's Digital Syriac Corpus texts by the preregistered vote (every arm whose fitted span has word error < 0.5
 * votes; window = union of their spans, 3 e-text words each side), then score every arm with syriac-cer.
 *
 *   node scripts/eval/syriac-pareto-6295/score-ocr.mjs --work <dir> [--fixed-refs] [--out scripts/eval/results/syriac-pareto-6295/ocr-score.json]
 *
 * Writes the reference windows to <work>/refs/<slug>.txt (they stay on the box), and a results file with CER
 * per page × arm, the window's offsets in the e-text, and no reference text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cutEditionWindow, foldedWords } from '../lib/edition-window.mjs';
import { syriacCer, SYRIAC_CER_VERSION } from './syriac-cer.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const W = opt('work');
const OUT = opt('out', 'scripts/eval/results/syriac-pareto-6295/ocr-score.json');
const FIXED = args.includes('--fixed-refs');
const pages = JSON.parse(fs.readFileSync(path.join(W, 'seal', 'pages.json'), 'utf8'));
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// The TEI body as text: notes dropped (an editor's apparatus is not on our page), tags removed (fold.py tei_text).
const teiText = (s) => { const b = s.includes('<body') ? s.slice(s.indexOf('<body')) : s; return b.replace(/<note\b[\s\S]*?<\/note>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' '); };
const editions = new Map();
// A page can run from the end of one corpus text into the next (NT p271: Romans → 1 Corinthians), so a book's
// matched texts are aligned as ONE text, in corpus-id order, joined by a paragraph break.
const bookText = (p) => {
  const id = `book:${[...p.targets].sort((a, b) => Number(a) - Number(b)).join('+')}`;
  if (!editions.has(id)) { const text = [...p.targets].sort((a, b) => Number(a) - Number(b)).map((t) => edition(t).text).join('\n\n'); editions.set(id, { id, text, words: foldedWords(text, 'syriac') }); }
  return editions.get(id);
};
const edition = (id) => {
  if (!editions.has(id)) { const text = teiText(fs.readFileSync(path.join(W, 'dsc', 'data', 'tei', `${id}.xml`), 'utf8')); editions.set(id, { text, words: foldedWords(text, 'syriac') }); }
  return editions.get(id);
};

// Arms: files on disk. Kraken arms from ocr/out/<arm>; the served lane read; stored Gemini revisions (never
// regenerated); the Batch arms' jsonl; MinerU's markdown.
const KRAKEN = ['omnisyr', 'omnisyr-nosplit', 'sophro-mhiro', 'qoruyo-eastern', 'qoruyo-estrangela'];
const batchArms = {};
for (const f of fs.existsSync(path.join(W, 'arms')) ? fs.readdirSync(path.join(W, 'arms')) : []) {
  if (!f.endsWith('.jsonl') || /^T-/.test(f)) continue;
  for (const r of jl(path.join(W, 'arms', f))) (batchArms[f.slice(0, -6)] ||= {})[r.uid] = r;
}
const mineruText = (slug) => {
  const d = path.join(W, 'ocr', 'mineru', 'out', slug);
  if (!fs.existsSync(d)) return null;
  const hit = fs.readdirSync(d, { recursive: true }).map(String).find((f) => f.endsWith('.md'));
  return hit ? fs.readFileSync(path.join(d, hit), 'utf8') : null;
};
function armsFor(p) {
  const a = {};
  for (const k of KRAKEN) { const f = path.join(W, 'ocr', 'out', k, `${p.slug}.txt`); if (fs.existsSync(f)) a[k] = fs.readFileSync(f, 'utf8'); }
  a['served-lane'] = fs.readFileSync(path.join(W, 'seal', 'pages', p.slug, 'served-ocr.txt'), 'utf8');
  for (const s of p.stored) {
    const lab = /lite/.test(s.model) ? 'stored-gemini-lite' : /flash/.test(s.model) ? 'stored-gemini-flash' : `stored-${s.model}`;
    a[lab] = fs.readFileSync(path.join(W, 'seal', 'pages', p.slug, `rev-${s.rev}-${s.model.replace(/[^\w.-]+/g, '_')}.txt`), 'utf8');
  }
  for (const [arm, rows] of Object.entries(batchArms)) if (rows[p.slug]) a[arm] = rows[p.slug].text || '';
  const m = mineruText(p.slug); if (m != null) a.mineru = m;
  return a;
}

fs.mkdirSync(path.join(W, 'refs'), { recursive: true });
const out = [];
for (const p of pages) {
  const arms = armsFor(p);
  // Each arm locates itself in each of the book's matched texts; it keeps its best fit.
  const fits = {};
  for (const [arm, text] of Object.entries(arms)) {
    const e = bookText(p);
    const w = cutEditionWindow(e.words, e.text, text, 'syriac', { pad: 3 });
    fits[arm] = w && w.span_wer != null ? { target: e.id, ...w } : null;
  }
  const voters = Object.entries(fits).filter(([, f]) => f && f.span_wer < 0.5);
  const byTarget = {};
  for (const [arm, f] of voters) (byTarget[f.target] ||= []).push([arm, f]);
  const ranked = Object.entries(byTarget).sort((x, y) => y[1].length - x[1].length || x[1].reduce((s, [, f]) => s + f.span_wer, 0) / x[1].length - y[1].reduce((s, [, f]) => s + f.span_wer, 0) / y[1].length);
  const row = { slug: p.slug, book_id: p.bid, label: p.label, tier: p.tier, page_number: p.pn, edition: p.label.replace(/ \(copy [AB]\)$/, ''), arms_read: Object.keys(arms).sort() };
  if (!ranked.length) { out.push({ ...row, reference: null, why: 'no arm aligned with span word error < 0.5' }); console.log(p.slug, 'NO REFERENCE'); continue; }
  const [target, vs] = ranked[0];
  const e = editions.get(target);
  const from = Math.min(...vs.map(([, f]) => f.from_char)), to = Math.max(...vs.map(([, f]) => f.to_char));
  // --fixed-refs: an arm added later (the CLI arms) is scored against the windows the panel was built on, not a re-vote.
  const refFile = path.join(W, 'refs', `${p.slug}.txt`);
  const ref = FIXED && fs.existsSync(refFile) ? fs.readFileSync(refFile, 'utf8') : e.text.slice(from, to);
  if (!FIXED) fs.writeFileSync(refFile, ref);
  const scores = {};
  for (const [arm, text] of Object.entries(arms)) {
    const s = syriacCer(text, ref);
    scores[arm] = s && { cer: +s.cer.toFixed(4), cer_capped: +Math.min(1, s.cer).toFixed(4), hyp_chars: s.hyp_chars, length_ratio: +s.length_ratio.toFixed(3), fit_wer: fits[arm]?.span_wer ?? null, voted: vs.some(([a]) => a === arm) };
  }
  out.push({ ...row, reference: { dsc_text: target, from_char: from, to_char: to, ref_chars: syriacCer('', ref).ref_chars, voters: vs.map(([a]) => a).sort() }, scores });
  console.log(p.slug, `dsc ${target.slice(0, 24)}`, `voters ${vs.length}`, Object.entries(scores).map(([a, s]) => `${a} ${s ? s.cer_capped.toFixed(2) : '-'}`).join(' '));
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ issue: 6295, scorer: SYRIAC_CER_VERSION, generated_by: 'scripts/eval/syriac-pareto-6295/score-ocr.mjs', reference: 'Digital Syriac Corpus (srophe/syriac-corpus, CC BY 4.0) TEI, window voted across arms (PREREGISTRATION-syriac-pareto-6295.md)', date: new Date().toISOString().slice(0, 10), pages: out }, null, 1) + '\n');
console.log('wrote', OUT);
