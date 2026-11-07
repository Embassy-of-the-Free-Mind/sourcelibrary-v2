// PRIOR ART: none — selects the screen frame from leaf-shift-risk-5021.mjs scores; CONTAIN=<2026-11-03 containment.json> TOPN=28000.
// Part of the #5021 shift screen (scripts/eval/experiments/2026-11-03-shift-screen-5021.md). Paths are under $JOB_SCRATCH.
// Screen frame for #5021: top-N pages by risk score (model "all") + a seeded random 2,000 from below the cut.
import fs from 'node:fs'; import zlib from 'node:zlib'; import readline from 'node:readline';
const S = process.env.JOB_SCRATCH, N = Number(process.env.TOPN || 28000), R = 2000;
const rd = f => fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(JSON.parse);
const excl = new Set(rd(`${S}/risk/labels.jsonl`).map(r=>`${r.book_id}:${r.page}`));
for (const f of ['gate-items.jsonl','gate2-items.jsonl']) for (const r of rd(`${S}/work/${f}`)) excl.add(`${r.book_id}:${r.page}`);
const C = JSON.parse(fs.readFileSync(process.env.CONTAIN,'utf8'));
for (const k of ['withheld_2026_11_03','confirmed_not_withheld','v2v5_confirmed_not_withheld']) for (const b of C[k]) for (const p of b.pages) excl.add(`${b.book_id}:${p}`);
const rows = [];
const rl = readline.createInterface({ input: fs.createReadStream(`${S}/risk/scores.tsv.gz`).pipe(zlib.createGunzip()) });
let first = true;
for await (const l of rl) { if (first) { first = false; continue; } const [b,p,s,s2,lang] = l.split('\t'); if (excl.has(`${b}:${p}`)) continue; rows.push([b, +p, +s, +s2, lang]); }
rows.sort((a,b)=>b[2]-a[2] || (a[0]<b[0]?-1:a[0]>b[0]?1:a[1]-b[1]));
const top = rows.slice(0, N), below = rows.slice(N);
function mulberry32(a){return()=>{a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const rnd = mulberry32(50213); const pick = new Set(); while (pick.size < R) pick.add(Math.floor(rnd()*below.length));
const items = [...top.map(r=>({book_id:r[0],page:r[1],score:r[2],score_nn:r[3],language:r[4],arm:'top'})), ...[...pick].sort((a,b)=>a-b).map(i=>below[i]).map(r=>({book_id:r[0],page:r[1],score:r[2],score_nn:r[3],language:r[4],arm:'random-below'}))];
fs.writeFileSync(`${S}/work/screen-items.jsonl`, items.map(i=>JSON.stringify(i)).join('\n')+'\n');
console.log(JSON.stringify({ frame: rows.length, excluded: excl.size, top: top.length, cut: top.at(-1)[2], below: below.length, random: R, top_books: new Set(top.map(r=>r[0])).size }));
