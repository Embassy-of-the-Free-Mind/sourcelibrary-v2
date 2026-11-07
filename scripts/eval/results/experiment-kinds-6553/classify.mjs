import fs from 'fs'; import {execFileSync} from 'child_process';
const [,, entriesF, outDir, startB, endB] = process.argv;
const L = fs.readFileSync(entriesF,'utf8').trim().split('\n').map(JSON.parse);
const tax = fs.readFileSync(new URL('./taxonomy.md', import.meta.url),'utf8');
const fmt=o=>`### ${o.file}\nheader: stage=${o.stage} measure=${o.measure} status=${o.status}\nverdict: ${o.verdict}\ndecision: ${o.decision}\nheading: ${o.heading}\nlead: ${o.lead}\ndecision-lines: ${o.decision_lines}\n`;
const B=40; const nb=Math.ceil(L.length/B);
for (let b=+startB; b<Math.min(+endB,nb); b++) {
  const out=`${outDir}/batch-${String(b).padStart(2,'0')}.json`; if (fs.existsSync(out)) continue;
  const chunk=L.slice(b*B,(b+1)*B);
  const p=`${tax}
Classify each of the ${chunk.length} Source Library experiment write-ups below (a digital library of historical sources with AI OCR and translation).
For each give:
- kind: one id from KINDS
- feeds: one value from FEEDS (what this result should change)
- change_claimed: true if the write-up says a change was actually made (a route/prompt/threshold switched, a PR merged, a repair applied, a guard added), false otherwise
- change_ref: the PR/issue/file it names as the change (e.g. "PR #5740"), or null
- subject: one of ocr|translation|metadata|image|pipeline|search|librarian|reader|product|eval-method|corpus|ops — what system the result is about
Output ONLY a JSON array, one object per write-up, in order: [{"file":"...","kind":"...","feeds":"...","change_claimed":true,"change_ref":"...","subject":"..."}]

${chunk.map(fmt).join('\n')}`;
  const pf=`${outDir}/batch-${b}.prompt`; fs.writeFileSync(pf,p);
  for (let attempt=0; attempt<2; attempt++) {
    try {
      const r = execFileSync(new URL('./lean.sh', import.meta.url).pathname, [pf, out+'.raw'], {timeout: 590000});
      const o = JSON.parse(fs.readFileSync(out+'.raw','utf8'));
      const t=o.result; const arr=JSON.parse(t.slice(t.indexOf('['), t.lastIndexOf(']')+1));
      if (arr.length!==chunk.length) throw new Error('len '+arr.length);
      fs.writeFileSync(out, JSON.stringify({cost:o.total_cost_usd, labels:arr}));
      console.log('batch',b,'ok',o.total_cost_usd); break;
    } catch(e) { console.log('batch',b,'fail',attempt,e.message.slice(0,200)); }
  }
}
