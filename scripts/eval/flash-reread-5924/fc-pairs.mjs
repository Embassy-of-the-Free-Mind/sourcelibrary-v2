#!/usr/bin/env node
// PRIOR ART: ./oc-pairs.mjs (the Opus arm's C2/C3 packets) — same shape; this builds the Flash-correction arm's two
//   comparisons (PREREGISTRATION-flash-correct.md), and reads O from the committed results/oc-reads.jsonl.gz because
//   the Opus set dir lives on l7a.
// fc-pairs.mjs — Step C4 (FC vs L, pages where FC's served text differs from L; Mulberry32(1034)) and Step C5 (FC vs O,
//   pages where FC's and O's served texts differ; Mulberry32(1035)). Writes $JOB_SCRATCH/agents/C{4,5}-in-<book>.json
//   (no arm names), $JOB_SCRATCH/pairs{4,5}/ and $JOB_SCRATCH/keys/c{4,5}-key.json. Reads $JOB_SCRATCH/FC (the cli-ocr
//   read dir) and $JOB_SCRATCH/draw.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { parseAnswer } from '../../batch/ocr-convergence/correct.mjs';
const J = process.env.JOB_SCRATCH, HERE = path.dirname(new URL(import.meta.url).pathname);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'results/sample.json'), 'utf8'));
export const Oreads = new Map(zlib.gunzipSync(fs.readFileSync(path.join(HERE, 'results/oc-reads.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.page_id, r]));
export const lite = (slug) => fs.readFileSync(path.join(J, 'draw', `${slug}.lite.txt`), 'utf8');
export const servedO = (pageId, L) => { const o = Oreads.get(pageId); return o.outcome === 'corrected' ? o.text : L; };
/** The prereg's FC outcome: no-answer on an error, a marker problem or no text; else correct.mjs's parseAnswer. */
export function fcOutcome(pageId) {
  const mf = path.join(J, 'FC', `${pageId}.meta.json`);
  if (!fs.existsSync(mf)) return { outcome: 'no-answer', reason: 'not read' };
  const m = JSON.parse(fs.readFileSync(mf, 'utf8')), text = fs.readFileSync(path.join(J, 'FC', `${pageId}.txt`), 'utf8');
  if (m.error_class) return { outcome: 'no-answer', reason: `error: ${m.error_class}`, meta: m };
  if (m.wrapper) return { outcome: 'no-answer', reason: `markers: ${m.wrapper}`, meta: m };
  return { ...parseAnswer(text), meta: m };
}
export const servedFC = (pageId, L) => { const a = fcOutcome(pageId); return a.outcome === 'corrected' ? a.text : L; };
const build = (tag, seed, other, include) => {
  const rnd = mulberry32(seed), key = {}, pd = path.join(J, `pairs${tag}`); fs.mkdirSync(pd, { recursive: true });
  let shown = 0;
  sample.books.forEach((b, i) => {
    const pages = [];
    for (const p of b.pages) {
      const L = lite(p.slug), FC = servedFC(p.page_id, L), B = other(p, L);
      if (!include(FC, B)) continue;
      const fFirst = rnd() < 0.5; key[p.slug] = fFirst ? 'XFC' : 'YFC';
      const [x, y] = fFirst ? [FC, B] : [B, FC];
      const xp = path.join(pd, `${p.slug}.X.txt`), yp = path.join(pd, `${p.slug}.Y.txt`);
      fs.writeFileSync(xp, x); fs.writeFileSync(yp, y); shown++;
      pages.push({ slug: p.slug, page_number: p.page_number, img: path.join(J, 'draw', `${p.slug}.jpg`), full_img: path.join(J, 'draw', `${p.slug}.full.jpg`), X: xp, Y: yp });
    }
    fs.writeFileSync(path.join(J, 'agents', `C${tag}-in-${i}.json`), JSON.stringify({ book_id: b.book_id, title: b.title, year: b.year, pages }, null, 1));
  });
  fs.writeFileSync(path.join(J, 'keys', `c${tag}-key.json`), JSON.stringify(key));
  return { shown, fc_first: Object.values(key).filter(v => v === 'XFC').length };
};
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(path.join(J, 'keys'), { recursive: true }); fs.mkdirSync(path.join(J, 'agents'), { recursive: true });
  const c4 = build(4, 1034, (p, L) => L, (FC, L) => FC !== L);
  const c5 = build(5, 1035, (p, L) => servedO(p.page_id, L), (FC, O) => FC !== O);
  console.log(JSON.stringify({ c4, c5 }));
}
