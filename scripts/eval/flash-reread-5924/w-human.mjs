#!/usr/bin/env node
// PRIOR ART: ./w-score.mjs (the unblinded Step T rows this exports) and ./w-judge2.mjs (the second-family verdicts) —
//   neither writes anything a person can check the judge with. Derek's addendum to #7568 (2026-10-28, for #7573): per
//   language, one JSONL row per judged page with the reader URL, the image, the three arm texts and the judge's verdicts,
//   30 rows marked review:true for volunteer readers who read the language.
// w-human.mjs — LANG7568=<lang>. Writes scripts/eval/dataset/judge-human-check-7573/<language>.jsonl.
//   review:true goes to the 30 pages with the highest disagreement score, ties broken by Mulberry32(seed + 6):
//     score = (the three arms' verdicts span misleading..sound ? 2 : the span) + (C vs R tie ? 1 : 0)
//           + (the agy judge's C/R preference differs from the Opus reader's ? 2 : 0).
import fs from 'node:fs'; import path from 'node:path';
import { lite, servedC, readR } from './w-packets.mjs';
import { LANGS } from './w-draw.mjs';
const L = process.env.LANG7568, HERE = path.dirname(new URL(import.meta.url).pathname);
const NAME = { zh: 'chinese', de: 'german', el: 'greek', sa: 'sanskrit', ar: 'arabic' }[L];
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const RD = path.join(HERE, 'results-7568', L);
const sample = JSON.parse(fs.readFileSync(path.join(RD, 'sample.json'), 'utf8'));
const rows = new Map(JSON.parse(fs.readFileSync(path.join(RD, 'step-t.json'), 'utf8')).map(r => [r.slug, r]));
const j2 = new Map((JSON.parse(fs.readFileSync(path.join(RD, 'score.json'), 'utf8')).judge2?.pages || []).map(p => [p.slug, p]));
const SEV = { sound: 0, flawed: 1, misleading: 2 };
const out = [];
const rnd = mulberry32(LANGS[L].seed + 6);
for (const b of sample.books) for (const p of b.pages) {
  const r = rows.get(p.slug); if (!r) continue;
  const l = lite(p.slug), c = servedC(p.page_id, l), rr = readR(p.page_id), g = j2.get(p.slug);
  const sev = ['L', 'C', 'R'].map(a => SEV[r.V[a]] ?? 1), span = Math.max(...sev) - Math.min(...sev);
  const score = span + (r.CR.prefer === 'tie' ? 1 : 0) + (g && !g.unparsed && g.gemini !== g.opus ? 2 : 0);
  out.push({ book_id: b.book_id, title: b.title, page_number: p.page_number, page_id: p.page_id,
    reader_url: `https://sourcelibrary.org/book/${b.book_id}?page=${p.page_number}`, image_url: p.src,
    texts: { lite: l, corrected: c.text, reread: rr.text }, corrected_outcome: c.outcome, corrected_reason: c.reason ?? null,
    judge: { model: 'claude-opus-5-5 (blind, three texts, Step T)', verdict: { lite: r.V.L, corrected: r.V.C, reread: r.V.R },
      prefer: { corrected_vs_lite: r.CL, corrected_vs_reread: r.CR, reread_vs_lite: r.RL },
      defects: { lite: r.defects.L, corrected: r.defects.C, reread: r.defects.R }, rationale: r.why },
    second_judge: g && !g.unparsed ? { model: 'gemini-3.8-flash-low (agy)', prefer_corrected_vs_reread: g.gemini, verdict: { corrected: g.gemini_C, reread: g.gemini_R } } : null,
    disagreement_score: score, _tb: rnd(), review: false });
}
out.sort((a, b) => b.disagreement_score - a.disagreement_score || a._tb - b._tb).slice(0, 30).forEach(x => { x.review = true; });
const dir = path.join(HERE, '..', 'dataset', 'judge-human-check-7573'); fs.mkdirSync(dir, { recursive: true });
out.sort((a, b) => a.book_id.localeCompare(b.book_id) || a.page_number - b.page_number);
fs.writeFileSync(path.join(dir, `${NAME}.jsonl`), out.map(({ _tb, ...x }) => JSON.stringify(x)).join('\n') + '\n');
console.log(JSON.stringify({ lang: L, rows: out.length, review: out.filter(x => x.review).length }));
