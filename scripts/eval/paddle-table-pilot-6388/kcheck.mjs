// PRIOR ART: score.mjs here (the Kanripo over-count). This asks a narrower question of the same leaf: is each span
// the reviewer called INVENTED printed on the aligned Kanripo leaf (`own` alignment only)? Spans under 3 characters
// are not checked. Usage (cwd = scratch, after score.mjs): node kcheck.mjs > kanripo-check-invented.jsonl
import fs from 'fs';
import { foldHan } from '../ground-truth-5935/lib.mjs';
const D = JSON.parse(fs.readFileSync('pilot-score.json', 'utf8')).pages;
const A = new Map(fs.readFileSync('pil-align.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse).map((a) => [a.key, a]));
const out = [];
for (const p of D) {
  if (p.review?.verdict !== 'invented' || !p.kanripo_own) continue;
  const leaf = foldHan(A.get(p.uid).kanripo_text);
  for (const x of p.review.invented) {
    const w = foldHan(String(x.what).replace(/[｜丨\s□]/g, ''));
    if ([...w].length < 3) { out.push({ uid: p.uid, what: x.what, check: 'too-short' }); continue; }
    out.push({ uid: p.uid, what: x.what, in_leaf: leaf.includes(w), in_leaf_half: leaf.includes([...w].slice(0, Math.ceil([...w].length / 2)).join('')) });
  }
}
console.log(out.map((o) => JSON.stringify(o)).join('\n'));
