// PRIOR ART: scripts/eval/jev/clef-image-screens.mjs (the Clef call shape, reused). Archived as run on 2026-11-11 from /root/jobs/clef-almeida; paths are that box's.
// Clef (Workers AI, free tier) as a per-class screen, scored on a member's human-found defects (PR #8610) vs same-book controls.
import fs from 'node:fs';
import { withMongo } from '/root/sourcelibrary/scripts/lib/mongo.mjs';
const F='/root/sourcelibrary/.claude/worktrees/almeida-regression/scripts/eval/regression/almeida-2026-11-findings.jsonl';
const OUT='/root/jobs/clef-almeida'; const CACHE=OUT+'/cache.jsonl';
const ACC='eb0562555fd5ce2a4ec0f29b6df10e7b', MODEL=process.env.MODEL||'clef';
const TCLS=new Set(['T8','T11','T17','T10','T4','T5','T7','T12','O3','O5','O6','O8','O9','O11','E1','O12','O13','O15','D1']);
const rows=fs.readFileSync(F,'utf8').split('\n').filter(Boolean).map(JSON.parse)
  .filter(r=>TCLS.has(r.class) && ['translation','label','ocr'].includes(r.category) && r.pages?.length);
const bad=new Map(); // key book:page -> classes
for (const r of rows) for (const p of r.pages) { const k=p.book_id+':'+p.page_number; (bad.get(k)||bad.set(k,new Set()).get(k)).add(r.class+'/'+r.category); }
const allFlag=new Set(fs.readFileSync(F,'utf8').split('\n').filter(Boolean).map(JSON.parse).flatMap(r=>(r.pages||[]).map(p=>p.book_id+':'+p.page_number)));
const ctrl=new Map();
for (const k of bad.keys()) { const [b,n]=k.split(':'); for (const d of [-9,+7,-13]) { const m=+n+d; const kk=b+':'+m; if (m>2 && !allFlag.has(kk) && !ctrl.has(kk)) ctrl.set(kk,true); } }
const strip=(t)=>String(t||'').replace(/&nbsp;/g,' ').replace(/<(summary|keywords|meta|vocab|image-desc|language|script|page-type)[^>]*>[\s\S]*?<\/\1>/g,'').replace(/\s+\n/g,'\n').trim();
const Q={
 reverse:{type:'noul',instructions:'Somewhere the English says the opposite of the source (negates what it affirms, affirms what it denies, or inverts who does what to whom).'},
 added:{type:'noul',instructions:'The English contains words, a name, or a sentence that render nothing in the source text (supplied by the translator), outside clearly marked notes.'},
 omitted:{type:'noul',instructions:'The English leaves out a sentence, line, column or block that is present in the source text.'},
 parallel:{type:'noul',instructions:'The source prints the same text in two languages (e.g. Greek with a Latin version) and the English follows the wrong one, skips one, or translates both as separate text.'},
 reply:{type:'noul',instructions:'The English is not a translation of the page but a message from an assistant (a refusal, an apology, a request for text, a description of the image, or instructions).'},
 misread:{type:'noul',instructions:'The source transcription contains a misread word (wrong letter, long s read as f, a dropped negation) and the English translates the misread word instead of what the author wrote.'},
 notes:{type:'noul',instructions:'The English contains translator notes or glosses that explain, speculate or offer scholarship not printed on the page.'},
 tagging:{type:'noul',instructions:'Printed marginal notes, footnotes or critical apparatus are tagged as handwritten annotations, or handwritten notes are presented as printed text.'},
};
const cache=new Map(fs.existsSync(CACHE)?fs.readFileSync(CACHE,'utf8').split('\n').filter(Boolean).map(l=>{const j=JSON.parse(l);return [j.key+'|'+j.model,j];}):[]);
async function ask(state){ for(let a=0;a<4;a++){ const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/ai/run/@cf/cloudflare/${MODEL}`,{method:'POST',headers:{Authorization:'Bearer '+process.env.CF_ANALYTICS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,state,questions:Q})});
  if(r.status===429){ throw new Error('QUOTA 429 '+(await r.text()).slice(0,200)); } if(!r.ok){console.error(r.status,(await r.text()).slice(0,200)); await new Promise(s=>setTimeout(s,2000*(a+1))); continue;}
  const j=(await r.json()).result; return {answers:Object.fromEntries(Object.entries(j.answers).map(([k,v])=>[k,v.noul])),tokens:j.usage.input_tokens}; } return null; }
await withMongo(async(db)=>{
  const items=[...[...bad.keys()].map(k=>({key:k,label:'bad',classes:[...bad.get(k)]})),...[...ctrl.keys()].map(k=>({key:k,label:'ctrl',classes:[]}))];
  console.log('bad',bad.size,'ctrl',ctrl.size);
  let n=0,tok=0;
  for (const it of items) {
    if (cache.has(it.key+'|'+MODEL)) continue;
    const [b,p]=it.key.split(':'); const d=await db.collection('pages').findOne({book_id:b,page_number:+p},{projection:{'ocr.data':1,'translation.data':1}});
    if(!d?.translation?.data){ continue; }
    const state=`SOURCE TRANSCRIPTION (OCR of the printed page):\n${strip(d.ocr?.data).slice(0,6000)}\n\nENGLISH TRANSLATION:\n${strip(d.translation.data).slice(0,6000)}`;
    const res=await ask(state); if(!res) continue; tok+=res.tokens; n++;
    const rec={key:it.key,model:MODEL,label:it.label,classes:it.classes,...res}; fs.appendFileSync(CACHE,JSON.stringify(rec)+'\n'); cache.set(it.key+'|'+MODEL,rec);
    if(n%20===0) console.log(n,'calls',tok,'tokens');
  }
  console.log('done',n,'calls',tok,'tokens');
});
