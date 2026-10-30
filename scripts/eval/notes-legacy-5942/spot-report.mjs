#!/usr/bin/env node
// PRIOR ART: spot-judge.mjs (this folder) writes the verdicts; this only counts them. scripts/eval/lib/paired-stats.mjs
// has the Wilson interval used for every rate.
/**
 * #5942 legacy syntaxes — the image-grounded spot check, counted. Read-only.
 *
 *   node scripts/eval/notes-legacy-5942/spot-report.mjs --work $JOB_SCRATCH/spot > $JOB_SCRATCH/spot-report.md
 *
 * Per span: origin (Opus, with the image) × what annotation-layer/3 does with it:
 *   text      the stored clean text — marks and interpolations keep their words, commentary and page blocks leave;
 *   notes-off the reader's view with notes off (= notesOffText) — as `text`, minus interpolations.
 *   LEAK = a "model" span left in; LOSS = a "printed" span taken out. "mixed" and "unclear" are counted apart.
 */
import fs from 'node:fs';
import { splitAnnotations } from '../../lib/annotation-layer.mjs';

const args = process.argv.slice(2);
const W = args[args.indexOf('--work') + 1];
const rows = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const pages = new Map(JSON.parse(fs.readFileSync(`${W}/pages.json`, 'utf8')).map((p) => [p.id, p]));
const opus = rows(`${W}/opus.jsonl`).filter((r) => r.verdict);
// Removed spans are scored from the second pass (opus-removed.jsonl), which showed the removed words alone.
const removed = new Map(rows(`${W}/opus-removed.jsonl`).filter((r) => r.verdict).map((r) => [r.id, r]));
for (const r of opus) {
  const r2 = removed.get(r.id);
  if (!r2) continue;
  for (const sp of r.spans) if (!sp.kept && r2.verdict.spans?.[sp.id]) r.verdict.spans[sp.id] = r2.verdict.spans[sp.id];
}
const agy = new Map(rows(`${W}/agy.jsonl`).filter((r) => r.verdict).map((r) => [r.id, r]));
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const link = (p) => `https://sourcelibrary.org/book/${p.book?.slug || p.book_id}/page/${p.id}`;

const per = {};
const examples = {};
let leafBad = [];
const agreeBy = { kept: [0, 0], removed: [0, 0] };
for (const r of opus) {
  const p = pages.get(r.id);
  const s = (per[r.syntax] ??= { pages: 0, spans: 0, printed: 0, model: 0, mixed: 0, unclear: 0, brackets_printed: 0, brackets_judged: 0, leak_text: 0, leak_off: 0, loss_text: 0, loss_off: 0 });
  s.pages++;
  if (r.verdict.leaf && r.verdict.leaf !== 'yes') leafBad.push({ p, leaf: r.verdict.leaf, why: r.verdict.leaf_why });
  // /3 with the page's OCR: which interpolations it flags as printed (notes-off keeps those).
  const printed = new Set(splitAnnotations(p.data, { ocr: p.ocr }).annotations.filter((a) => a.type === 'interp' && a.printed).map((a) => a.anchor.exact));
  for (const sp of r.spans) {
    const v = r.verdict.spans?.[sp.id];
    if (!v) continue;
    s.spans++;
    const o = ['printed', 'model', 'mixed', 'unclear'].includes(v.origin) ? v.origin : 'unclear';
    s[o]++;
    if (v.brackets_printed != null && sp.type === 'interp') { s.brackets_judged++; if (v.brackets_printed) s.brackets_printed++; }
    const inText = sp.kept;
    const inOff = sp.kept && (sp.type !== 'interp' || printed.has(sp.words));
    const ex = (kind) => ((examples[r.syntax] ??= {})[kind] ??= []).length < 3 && examples[r.syntax][kind].push(`${link(p)} — “${String(sp.words).replace(/\s+/g, ' ').slice(0, 90)}” — ${v.why ?? ''}`);
    if (o === 'model' && inText) { s.leak_text++; ex('leak (text)'); }
    if (o === 'model' && inOff) { s.leak_off++; ex('leak (notes off)'); }
    if (o === 'printed' && !inText) { s.loss_text++; ex('loss (text)'); }
    if (o === 'printed' && !inOff) { s.loss_off++; ex('loss (notes off)'); }
    const a = agy.get(r.id)?.verdict?.spans?.[sp.id];
    // The second reader saw the first-pass prompt; on removed spans that prompt was ambiguous (see spot-judge.mjs).
    if (a) { const k = sp.kept ? 'kept' : 'removed'; agreeBy[k][1]++; if ((a.origin === 'printed') === (o === 'printed')) agreeBy[k][0]++; }
  }
}
let md = `| syntax | pages | spans | printed | model | mixed | unclear | /3 text: leak · loss | notes off (reader): leak · loss |\n|---|---:|---:|---:|---:|---:|---:|---|---|\n`;
for (const [k, s] of Object.entries(per)) {
  md += `| ${k} | ${s.pages} | ${s.spans} | ${pct(s.printed, s.spans)} | ${pct(s.model, s.spans)} | ${pct(s.mixed, s.spans)} | ${pct(s.unclear, s.spans)} | ${s.leak_text} · ${s.loss_text} | ${s.leak_off} · ${s.loss_off} |\n`;
}
md += `\nInterpolations with the brackets printed in the source: ${per['[interpolation]']?.brackets_printed ?? 0} of ${per['[interpolation]']?.brackets_judged ?? 0} judged.\n`;
md += `\nSecond reader (Gemini 3.8 Flash low, with the image, ${agy.size} pages) agrees with Opus on printed vs not: kept spans ${agreeBy.kept[0]} of ${agreeBy.kept[1]} (${pct(...agreeBy.kept)}); removed spans ${agreeBy.removed[0]} of ${agreeBy.removed[1]} (${pct(...agreeBy.removed)}; Gemini saw the first, ambiguous prompt there).\n`;
md += `\nPages whose translation does not match the leaf (Opus): ${leafBad.length}\n`;
for (const b of leafBad) md += `- ${b.leaf}: ${link(b.p)} — ${b.why}\n`;
md += '\n### Examples\n';
for (const [k, kinds] of Object.entries(examples)) {
  md += `\n**${k}**\n`;
  for (const [kind, list] of Object.entries(kinds)) for (const e of list) md += `- ${kind}: ${e}\n`;
}
console.log(md);
