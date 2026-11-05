// Sensitivity: Kanripo CER with <margin> text kept (hanOf drops it). The prereg figures stand; this is the row beside them. node cer-margin-kept.mjs --dir=<job scratch>
// PRIOR ART: matrix.mjs cer — prereg instrument, left as written; this reuses its helpers and bodyCer and only unwraps the tag.
import { plan, txt, DIR, hanOf, noMarks, median, r3 } from './matrix.mjs';
import { bodyCer } from '../ground-truth-5935/lib.mjs';
import fs from 'fs';
const F={S:'served',P:'P',F:'F',PO:'PO',O:'O',FF:'FF',PFL:'PFL',SFL:'SFL'};
const L=JSON.parse(fs.readFileSync(DIR+'/leaves.json')), un=(t)=>t.replace(/<\/?margin>/g,''), rows=[];
for (const d of ['setA','setB']) for (const s of plan(d).selected) { const l=L[s.key]; if(!l?.leaf) continue; const ref=hanOf(l.leaf), W=hanOf(l.before)+ref+hanOf(l.after);
  for (const a of Object.keys(F)) { const t=txt(d,s.key,F[a]); if(t==null) continue; const q=hanOf(un(t)), q0=hanOf(t), c=bodyCer(noMarks(q),noMarks(W),{expected:[...noMarks(ref)].length}).cer, c0=bodyCer(noMarks(q0),noMarks(W),{expected:[...noMarks(ref)].length}).cer; rows.push({d,key:s.key,a,c,c0,h:[...q].length,h0:[...q0].length,leaf:[...ref].length}); } }
for (const a of Object.keys(F)) { const x=rows.filter(r=>r.a===a); const ch=x.filter(r=>r.h!==r.h0); console.log(a,'n',x.length,'median prereg',r3(median(x.map(r=>r.c0))),'mean',r3(x.reduce((s,r)=>s+r.c0,0)/x.length),'| margin kept median',r3(median(x.map(r=>r.c))),'mean',r3(x.reduce((s,r)=>s+r.c,0)/x.length),'| pages changed',ch.length, ch.filter(r=>r.h0<r.leaf*.5).map(r=>`${r.d}:${r.key.slice(-6)} ${r.h0}->${r.h}/${r.leaf} cer ${r3(r.c0)}->${r3(r.c)}`).join(' ; ')); }
fs.writeFileSync(DIR+'/cer-margin-kept.json',JSON.stringify(rows));
