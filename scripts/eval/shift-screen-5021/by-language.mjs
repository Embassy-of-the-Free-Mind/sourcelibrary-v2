// PRIOR ART: none — per-language roll-up of the screen and the Opus precision by screen answer.
// Part of the #5021 shift screen (scripts/eval/experiments/2026-11-03-shift-screen-5021.md). Paths are under $JOB_SCRATCH.
import fs from 'node:fs';
const S = process.env.JOB_SCRATCH;
const rd = f => fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(JSON.parse);
const req = new Map(rd(`${S}/screen/scale/requests.jsonl`).map(r=>[r.key,r]));
const A = JSON.parse(fs.readFileSync(`${S}/work/opus-analysis.json`,'utf8'));
const prec = Object.fromEntries(Object.entries(A.by_screen_role).map(([k,v])=>[k,v.precision]));
const conf = rd(`${S}/work/opus-confirmed.jsonl`);
const plan = JSON.parse(fs.readFileSync(`${S}/work/contain-plan.json`,'utf8'));
const norm = l => { l = String(l||'-'); return /^latin/i.test(l)?'Latin':/^german/i.test(l)?'German':/^(ancient )?greek/i.test(l)?'Greek':/chinese/i.test(l)?'Chinese':/tibetan/i.test(l)?'Tibetan':/^english/i.test(l)?'English':/^french/i.test(l)?'French':/^russian/i.test(l)?'Russian':/^italian/i.test(l)?'Italian':/^dutch/i.test(l)?'Dutch':/sanskrit/i.test(l)?'Sanskrit':/japanese/i.test(l)?'Japanese':/arabic/i.test(l)?'Arabic':/hebrew/i.test(l)?'Hebrew':'other'; };
const t = {};
for (const a of rd(`${S}/screen/scale/answers.jsonl`)) { const r = req.get(a.key); if (r.arm !== 'top' || !a.role) continue; const L = norm(r.language); const x = (t[L] ||= { screened:0, flags:0, est:0, confirmed:0, contained:0 }); x.screened++; if (['next','prev','none'].includes(a.role)) { x.flags++; x.est += prec[a.role]; } }
for (const c of conf) { const L = norm(c.language); (t[L] ||= { screened:0, flags:0, est:0, confirmed:0, contained:0 }).confirmed++; }
for (const b of plan.contain) { const L = norm(b.language); t[L].contained += b.pages.length; }
const rows = Object.entries(t).sort((a,b)=>b[1].screened-a[1].screened).map(([L,x])=>({ language:L, screened:x.screened, flags:x.flags, est_real:Math.round(x.est), confirmed:x.confirmed, contained:x.contained, left:Math.round(x.est)-x.contained }));
fs.writeFileSync(`${S}/work/by-language.json`, JSON.stringify({ precision_by_role: prec, rows }, null, 1));
console.log(prec); for (const r of rows) console.log(Object.values(r).join('\t'));
const tot = rows.reduce((s,r)=>({screened:s.screened+r.screened,flags:s.flags+r.flags,est:s.est+r.est_real,conf:s.conf+r.confirmed,cont:s.cont+r.contained}),{screened:0,flags:0,est:0,conf:0,cont:0}); console.log(tot);
