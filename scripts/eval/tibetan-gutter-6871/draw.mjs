// PRIOR ART: scripts/eval/results/yigdzin-hidden-4523/page-outcomes.jsonl.gz is the frame (outcome worker-skip:guttered-skip); no prior draw over it.
// Draw 30 reference pages from the 5,132 guttered Tibetan pages: page-weighted, max 2 per book, seed 6871.
import fs from 'node:fs';
const P = JSON.parse(fs.readFileSync(process.env.JOB_SCRATCH + '/gutter-pages.json'));
let s = 6871; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pool = P.filter(p => p.src).sort((a, b) => a.id.localeCompare(b.id));
const per = {}, pick = [];
while (pick.length < 30) { const p = pool[Math.floor(rnd() * pool.length)]; if ((per[p.book_id] || 0) >= 2 || pick.includes(p)) continue; per[p.book_id] = (per[p.book_id] || 0) + 1; pick.push(p); }
fs.writeFileSync(process.env.JOB_SCRATCH + '/tib/draw.json', JSON.stringify(pick, null, 1));
console.log(pick.length, 'books', Object.keys(per).length, 'no-src', P.length - pool.length);
