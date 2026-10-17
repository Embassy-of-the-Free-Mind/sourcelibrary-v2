// latin-refs-5924 draw bookkeeping: per drawn book, walk its seeded candidate leaves and classify the outcome
// (accepted / unreachable / dropped-mislabelled / dropped-no-usable-leaf). Run from the work dir: `node draw-status.cjs`.
// A leaf is rejected when reader A wrote `REJECT …` or more than five `[?]`; a book is dropped as mislabelled after two
// not-Latin / handwriting rejects, and as having no usable leaf after all four candidates are rejected.
// PRIOR ART: none — scripts/eval/latin-r4-refs-5924.mjs `draw` has no reader-reject loop (its pages were located in an e-text).
const fs=require('fs');const d=require('./draw.json');const L=require('./leaves.json');
const read=s=>fs.existsSync('pass/A/'+s+'.txt')?fs.readFileSync('pass/A/'+s+'.txt','utf8'):null;
const EXCL=new Set(['lr-69b659b918b87551bfcfdd7a-p665']);
const out={};
for(const c of ['1600s','1500s']){let acc=0;const rows=[];
 for(const b of d.centuries[c].picked){let st='pending',slug=null,rej=[];
  for(const [i,cd] of b.candidates.entries()){const s=`lr-${b.book_id}-p${cd.page_number}`;const l=L[s];if(!l){st=i===0?'unfetched':'next:'+i;slug=s;break}
   if(l.error){st='unreachable';break} const t=read(s);if(t===null){st='needA';slug=s;break}
   const q=(t.match(/\[\?\]/g)||[]).length;if(/^REJECT/.test(t)||q>5){rej.push(q>5?'obscured ('+q+' [?])':t.slice(7,60));
     if(rej.filter(r=>/not Latin|German|Greek|Hebrew|handwriting|manuscript|Greek\/Latin|bilingual/i.test(r)).length>=2){st='dropped-mislabelled';break} continue}
   st='accepted';slug=s;break}
  if(st==='pending'&&rej.length) st='dropped-no-usable-leaf';
  if(st==='accepted')acc++;rows.push({book:b.book_id,st,slug,rej})}
 out[c]={acc,rows}; const cnt={};rows.forEach(r=>cnt[r.st.replace(/:\d/,'')]=(cnt[r.st.replace(/:\d/,'')]||0)+1);console.log(c,cnt)}
fs.writeFileSync('status.json',JSON.stringify(out,null,1));
