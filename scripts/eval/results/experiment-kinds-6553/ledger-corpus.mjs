// PRIOR ART: none — scratch builder for part 7 mistake corpus
import fs from 'fs'; import path from 'path';
const D='scripts/eval/experiments'; const out=[];
const re=/retract|we were wrong|was wrong|overstated|invalidat|artifact of|was a bug|bug in the|does not hold|did not hold|correction:|erratum|mis-?measur|supersed|turned out|mistak|confound|leak/i;
for (const f of fs.readdirSync(D).filter(f=>/^20\d\d-/.test(f))) {
  const t=fs.readFileSync(path.join(D,f),'utf8'); const sup=/^status:\s*superseded/m.test(t);
  const ret=/retract|we were wrong|was wrong|overstated|invalidat|artifact of|was a bug|bug in the (judge|harness|script)|does not hold|did not hold|correction:|erratum|mis-?measur/i.test(t);
  if(!sup&&!ret) continue;
  const dec=(t.match(/^decision:\s*(.*)$/m)||[])[1]||''; const sb=(t.match(/^superseded_by:\s*(.*)$/m)||[])[1]||'';
  const lines=t.split('\n'); const snip=[];
  lines.forEach((l,i)=>{ if(re.test(l) && !/^(decision|superseded_by|status):/.test(l)) snip.push(l.slice(0,400)); });
  out.push({id:'W:'+f, src: sup?'superseded':'retraction', decision:dec.slice(0,300), superseded_by:sb, snippets:snip.slice(0,4).join(' || ').slice(0,1200)});
}
// lessons-learned + handoffs: lines with lesson/root cause
for (const p of ['memory/lessons-learned.md', ...fs.readdirSync('.claude/handoffs').filter(f=>f.endsWith('.md')).map(f=>'.claude/handoffs/'+f)]) {
  const t=fs.readFileSync(p,'utf8'); const m=t.split('\n').filter(l=>/lesson|root cause|mistake|should have|wrong/i.test(l)).slice(0,3);
  if(m.length) out.push({id:'H:'+path.basename(p), src: p.startsWith('memory')?'lessons':'handoff', snippets:m.join(' || ').slice(0,900)});
}
// TAKEN sample: seeded 80
let s=7; const rnd=()=>{s=(s*1103515245+12345)%2147483648; return s/2147483648};
const tk=fs.readFileSync('/data/scratch/sl/claude-jobs/taken.txt','utf8').trim().split('\n');
const idx=tk.map((l,i)=>[rnd(),i]).sort((a,b)=>a[0]-b[0]).slice(0,80).map(x=>x[1]).sort((a,b)=>a-b);
for(const i of idx) out.push({id:'T:'+i, src:'taken', snippets:tk[i].slice(0,500)});
fs.writeFileSync(process.argv[2], out.map(o=>JSON.stringify(o)).join('\n')+'\n');
const c={}; out.forEach(o=>c[o.src]=(c[o.src]||0)+1); console.log(c, JSON.stringify(out).length);
