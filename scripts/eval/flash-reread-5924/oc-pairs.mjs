#!/usr/bin/env node
// PRIOR ART: ./pairs.mjs (the original Step C packets, one Mulberry32 draw per page) — reused shape; this adds the
//   Opus-correction arm's two comparisons (PREREGISTRATION-opus-correct.md).
// oc-pairs.mjs — Step C2 (O vs L, pages where O's served text differs from L; Mulberry32(1024)) and Step C3 (O vs F,
//   all pages; Mulberry32(1025)). O's served text: the correction where correct.mjs answered `corrected`, else the
//   stored lite text. Writes $JOB_SCRATCH/agents/C{2,3}-in-<book>.json (no arm names), $JOB_SCRATCH/pairs{2,3}/ and
//   $JOB_SCRATCH/keys/c{2,3}-key.json. Needs SET_DIR (the correct.mjs set dir) and FLASH_JOB (the draw/ images).
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const J = process.env.JOB_SCRATCH, SET = process.env.SET_DIR || path.join(J, 'set'), FL = process.env.FLASH_JOB || '/data/scratch/sl/jobs/flash-reread-test-5924';
const HERE = path.dirname(new URL(import.meta.url).pathname);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'results/sample.json'), 'utf8'));
const F = new Map(zlib.gunzipSync(fs.readFileSync(path.join(HERE, 'results/F-reads.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => [r.page_id, r]));
export function servedO(pageId, lite) {
  const m = JSON.parse(fs.readFileSync(path.join(SET, 'reads', `${pageId}.meta.json`), 'utf8'));
  return { outcome: m.outcome, reason: m.reason, text: m.outcome === 'corrected' ? fs.readFileSync(path.join(SET, 'reads', `${pageId}.txt`), 'utf8') : lite };
}
const build = (tag, seed, other, include) => {
  const rnd = mulberry32(seed), key = {}, pd = path.join(J, `pairs${tag}`); fs.mkdirSync(pd, { recursive: true });
  let shown = 0;
  sample.books.forEach((b, i) => {
    const pages = [];
    for (const p of b.pages) {
      const L = fs.readFileSync(path.join(FL, 'draw', `${p.slug}.lite.txt`), 'utf8'), O = servedO(p.page_id, L).text, B = other(p, L);
      if (!include(O, L)) continue;
      const oFirst = rnd() < 0.5; key[p.slug] = oFirst ? 'XO' : 'YO';
      const [x, y] = oFirst ? [O, B] : [B, O];
      const xp = path.join(pd, `${p.slug}.X.txt`), yp = path.join(pd, `${p.slug}.Y.txt`);
      fs.writeFileSync(xp, x); fs.writeFileSync(yp, y); shown++;
      pages.push({ slug: p.slug, page_number: p.page_number, img: path.join(FL, 'draw', `${p.slug}.jpg`), full_img: path.join(FL, 'draw', `${p.slug}.full.jpg`), X: xp, Y: yp });
    }
    fs.writeFileSync(path.join(J, 'agents', `C${tag}-in-${i}.json`), JSON.stringify({ book_id: b.book_id, title: b.title, year: b.year, pages }, null, 1));
  });
  fs.writeFileSync(path.join(J, 'keys', `c${tag}-key.json`), JSON.stringify(key));
  return { shown, o_first: Object.values(key).filter(v => v === 'XO').length };
};
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(path.join(J, 'keys'), { recursive: true }); fs.mkdirSync(path.join(J, 'agents'), { recursive: true });
  const c2 = build(2, 1024, (p, L) => L, (O, L) => O !== L);
  const c3 = build(3, 1025, (p) => F.get(p.page_id)?.text || '', () => true);
  console.log(JSON.stringify({ c2, c3 }));
}
