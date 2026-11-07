// PRIOR ART: none — reads leaf-shift-confirm-5021.mjs results.jsonl for the drawn flags.
// Part of the #5021 shift screen (scripts/eval/experiments/2026-11-03-shift-screen-5021.md). Paths are under $JOB_SCRATCH.
import fs from 'node:fs';
const S = process.env.JOB_SCRATCH;
const rd = f => fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(JSON.parse);
const res = rd(`${S}/opus/results.jsonl`);
const v = new Map(); const meta = new Map(); const human = new Set();
for (const r of res) { for (const x of r.verdicts || []) v.set(`${r.book_id}:${x.page}`, x.verdict); for (const p of r.human || []) human.add(`${r.book_id}:${p}`); meta.set(r.book_id, { title: r.title, language: r.language }); }
const drawn = JSON.parse(fs.readFileSync(`${S}/work/opus-drawn.json`,'utf8'));
const wilson = (k,n) => { if(!n) return null; const z=1.96,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d; return [Math.round((c-h)*100),Math.round((c+h)*100)]; };
const tally = xs => { const j = xs.map(d=>v.get(`${d.book_id}:${d.page}`)).filter(Boolean); const real = j.filter(x=>x==='next'||x==='prev').length; return { drawn: xs.length, judged: j.length, real, precision: j.length? +(real/j.length).toFixed(3):null, ci: wilson(real,j.length), verdicts: j.reduce((m,x)=>((m[x]=(m[x]||0)+1),m),{}) }; };
const by = (fn) => { const m={}; for (const d of drawn) (m[fn(d)] ||= []).push(d); return Object.fromEntries(Object.entries(m).sort((a,b)=>b[1].length-a[1].length).map(([k,xs])=>[k,tally(xs)])); };
const bucket = s=>s>0.95?'>.95':s>0.9?'.9-.95':s>0.8?'.8-.9':s>0.761?'.76-.8':'<cut';
const out = { all: tally(drawn), by_arm: by(d=>d.arm), by_bucket: by(d=>bucket(d.score)), by_screen_role: by(d=>d.role), by_language: by(d=>meta.get(d.book_id)?.language || d.language || '-') };
// Every confirmed page (drawn or widened), for containment.
const confirmed = [];
for (const r of res) for (const x of r.verdicts || []) if ((x.verdict==='next'||x.verdict==='prev') && !(r.human||[]).includes(x.page)) confirmed.push({ book_id: r.book_id, page: x.page, verdict: x.verdict, evidence: x.evidence, arm: r.run?.start!=null ? (r.tier==='B'?'random-below':'top') : null, language: r.language, title: r.title });
out.confirmed_pages = confirmed.length; out.confirmed_books = new Set(confirmed.map(c=>c.book_id)).size; out.human_pages_skipped = human.size;
fs.writeFileSync(`${S}/work/opus-confirmed.jsonl`, confirmed.map(c=>JSON.stringify(c)).join('\n')+'\n');
fs.writeFileSync(`${S}/work/opus-analysis.json`, JSON.stringify(out,null,1));
console.log(JSON.stringify({all:out.all,by_arm:out.by_arm,by_bucket:out.by_bucket,by_screen_role:out.by_screen_role,confirmed_pages:out.confirmed_pages,confirmed_books:out.confirmed_books,human:out.human_pages_skipped},null,0));
for (const [l,t] of Object.entries(out.by_language)) console.log(l.padEnd(24), t.judged, t.real, t.precision);
