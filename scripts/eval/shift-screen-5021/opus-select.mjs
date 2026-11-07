// PRIOR ART: none — turns screen flags into scripts/audit/leaf-shift-confirm-5021.mjs input (its flagged-book shape).
// Part of the #5021 shift screen (scripts/eval/experiments/2026-11-03-shift-screen-5021.md). Paths are under $JOB_SCRATCH.
// Seeded 300 screen flags for Opus (#5021): every random-below flag, the rest drawn from top flags; each drawn page
// widened to its contiguous run of flagged pages in the same book (<= 6 pages). Output: confirm-script input.
import fs from 'node:fs';
const S = process.env.JOB_SCRATCH, D = `${S}/screen/scale`;
const rd = f => fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(JSON.parse);
const req = new Map(rd(`${D}/requests.jsonl`).map(r=>[r.key,r]));
const flag = r => r === 'next' || r === 'prev' || r === 'none';
const flags = rd(`${D}/answers.jsonl`).filter(a => flag(a.role)).map(a => ({ ...req.get(a.key), role: a.role })).sort((a,b)=>a.key<b.key?-1:1);
function mulberry32(a){return()=>{a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const rnd = mulberry32(50214);
const shuffle = xs => { const a=[...xs]; for (let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const below = flags.filter(f => f.arm === 'random-below'), top = flags.filter(f => f.arm === 'top');
const drawn = [...below, ...shuffle(top).slice(0, 300 - below.length)];
const flagged = new Set(flags.map(f => `${f.book_id}:${f.page}`));
const books = new Map(); const seen = new Set();
for (const d of drawn) {
  if (seen.has(`${d.book_id}:${d.page}`)) continue;
  let s = d.page, e = d.page;
  while (e - s < 5 && flagged.has(`${d.book_id}:${s-1}`) && !seen.has(`${d.book_id}:${s-1}`)) s--;
  while (e - s < 5 && flagged.has(`${d.book_id}:${e+1}`) && !seen.has(`${d.book_id}:${e+1}`)) e++;
  for (let p = s; p <= e; p++) seen.add(`${d.book_id}:${p}`);
  if (!books.has(d.book_id)) books.set(d.book_id, { book_id: d.book_id, flagged: true, tier: d.arm === 'top' ? 'A' : 'B', frame: d.arm, runs: [] });
  books.get(d.book_id).runs.push({ dir: '?', start: s, end: e, strong: false, strict: false, voting: e - s + 1, drawn: d.page, arm: d.arm, score: d.score, screen: d.role });
}
fs.writeFileSync(`${S}/work/opus-flagged.jsonl`, [...books.values()].map(b=>JSON.stringify(b)).join('\n')+'\n');
fs.writeFileSync(`${S}/work/opus-drawn.json`, JSON.stringify(drawn.map(d=>({book_id:d.book_id,page:d.page,arm:d.arm,score:d.score,role:d.role,language:d.language}))));
const runs=[...books.values()].flatMap(b=>b.runs);
console.log(JSON.stringify({ flags: flags.length, below: below.length, top: top.length, drawn: drawn.length, books: books.size, calls: runs.length, pages: runs.reduce((s,r)=>s+r.end-r.start+1,0), maxRunsPerBook: Math.max(...[...books.values()].map(b=>b.runs.length)) }));
