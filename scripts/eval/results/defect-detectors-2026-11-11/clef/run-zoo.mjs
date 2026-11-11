// PRIOR ART: scripts/eval/jev/clef-image-screens.mjs (the Clef call shape, reused). Archived as run on 2026-11-11 from /root/jobs/clef-almeida; paths are that box's.
// Variant runs: V1 = error-zoo questions with examples, page level; V2 = one English sentence vs the source page.
import fs from 'node:fs';
import { withMongo } from '/root/sourcelibrary/scripts/lib/mongo.mjs';
const OUT='/root/jobs/clef-almeida', ACC='eb0562555fd5ce2a4ec0f29b6df10e7b', MODEL='clef', PRICE=0.24, CAP=Number(process.env.CAP_USD||1.4);
const VAR=process.argv[2]; const DRY=process.argv.includes('--dry');
const base=fs.readFileSync(OUT+'/cache.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse);
const TL=new Set(['T8/translation','T11/translation','T10/label','T10/translation','T17/translation','T5/translation','T12/label','O3/translation','O5/translation','O6/translation','O8/translation','O9/translation','T7/translation','T4/translation']);
const bad=base.filter(r=>r.label==='bad'&&r.classes.some(c=>TL.has(c)));
const books=new Set(bad.map(r=>r.key.split(':')[0]));
const perBook={}; const ctrl=base.filter(r=>r.label==='ctrl'&&books.has(r.key.split(':')[0])).filter(r=>{const b=r.key.split(':')[0]; perBook[b]=(perBook[b]||0)+1; return perBook[b]<=4;});
const items=[...bad,...ctrl];
const strip=(t)=>String(t||'').replace(/&nbsp;/g,' ').replace(/<(summary|keywords|meta|vocab|image-desc|language|script|page-type)[^>]*>[\s\S]*?<\/\1>/g,'').trim();
const stripNotes=(t)=>strip(t).replace(/<(note|gloss|margin)[^>]*>[\s\S]*?<\/\1>/g,' ').replace(/<[^>]+>/g,' ');
const QV1={
 reverse:{type:'noul',instructions:'Error class "sense inverted": at some place the English says the opposite of the source or drops a qualifier: cold and hot drugs reversed; a negation dropped; "each guest fearing for his own life" rendered "fearing for the bridegroom\'s life"; a rhetorical praeteritio read straight; a hedge removed. Answer yes only if such an inversion is present.'},
 added:{type:'noul',instructions:'Error class "addition": the English body supplies something the source does not say: a name or fact not on the page, a clause completed from the next page, a footnote invented whose text is elsewhere, or confident sentences built on gibberish OCR. Translator notes clearly marked as notes do not count.'},
 misread:{type:'noul',instructions:'Error class "misread carried into a fluent translation": the transcription misreads a word and the English translates the wrong word without any uncertainty: "Brother Facius was healed" (the saint becomes the patient); "by-laws" become "land"; "Are they fitting now?" for sitting; sin read as life; a CJK character misread so a whole false clause is built on it; long s read as f; Greek ligatures misread where grammar hinges.'},
 parallel:{type:'noul',instructions:'Error class "parallel edition mishandled": the page prints the same text in two languages (Greek with an editor\'s Latin, Syriac with French, a text with a facing printed English) and the English follows the editor\'s crib instead of the original, blends the two, paraphrases the printed facing translation, or translates both columns in full so the reader gets two versions of one passage.'},
 notes:{type:'noul',instructions:'Error class "invented scholarship": notes or glosses explain a reading with confident, false learning: "Saint Rotoi <note>likely a reference to a local feast day</note>"; a note calling a word "likely referring to dummy figures"; a date resolved, an interval named, facts asserted about the previous page, none of it printed on this page.'},
 seam:{type:'noul',instructions:'Error class "continuity leak": the next page\'s opening clause is finished at the end of this page, or the previous page\'s ending is translated again at the top, so a passage appears twice across the page break.'},
};
const QV2={
 reverse:QV1.reverse,
 added:{type:'noul',instructions:'This one English SENTENCE contains a word, name, negation or clause that renders nothing in the source page (supplied by the translator, not in the print). '+QV1.added.instructions.replace(/^.*?: /,'Examples of the class: ')},
 misread:{type:'noul',instructions:'This one English SENTENCE translates a word that is misread in the source transcription (long s read as f, a wrong character, a dropped negation), so it says something the author did not write. '+QV1.misread.instructions.replace(/^.*?Signs: /,'Examples: ')},
};
const CF=OUT+`/cache-${VAR}b.jsonl`;
const done=new Set(fs.existsSync(CF)?fs.readFileSync(CF,'utf8').split('\n').filter(Boolean).map(l=>{const j=JSON.parse(l);return j.key+'#'+(j.s??'');}):[]);
let tok=0; for (const l of (fs.existsSync(CF)?fs.readFileSync(CF,'utf8').split('\n').filter(Boolean):[])) tok+=JSON.parse(l).tokens||0;
async function ask(state,Q){ for(let a=0;a<4;a++){ const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/ai/run/@cf/cloudflare/${MODEL}`,{method:'POST',headers:{Authorization:'Bearer '+process.env.CF_ANALYTICS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,state,questions:Q})});
  if(r.status===429) throw new Error('QUOTA '+(await r.text()).slice(0,200)); if(!r.ok){console.error(r.status,(await r.text()).slice(0,200)); await new Promise(s=>setTimeout(s,2000*(a+1))); continue;}
  const j=(await r.json()).result; return {answers:Object.fromEntries(Object.entries(j.answers).map(([k,v])=>[k,v.noul])),tokens:j.usage.input_tokens}; } return null; }
await withMongo(async(db)=>{
  console.log(VAR,'bad',bad.length,'ctrl',ctrl.length,'spent so far $',(tok*PRICE/1e6).toFixed(3));
  let est=0,calls=0;
  for (const it of items) {
    const [b,p]=it.key.split(':'); const d=await db.collection('pages').findOne({book_id:b,page_number:+p},{projection:{'ocr.data':1,'translation.data':1}});
    const src=strip(d?.ocr?.data);
    const jobs=[];
    if (VAR==='v1') jobs.push({s:null,state:`SOURCE TRANSCRIPTION (OCR of the printed page):\n${src.slice(0,6000)}\n\nENGLISH TRANSLATION:\n${strip(d.translation.data).slice(0,6000)}`,Q:QV1});
    else { const sents=stripNotes(d.translation.data).replace(/\s+/g,' ').split(/(?<=[.;?!])\s+(?=[A-Z"“‘(\[])/).map(s=>s.trim()).filter(s=>s.length>=30).slice(0,30);
      sents.forEach((s,i)=>jobs.push({s:i,state:`SOURCE PAGE (OCR):\n${src.slice(0,3500)}\n\nONE SENTENCE OF THE ENGLISH TRANSLATION OF THIS PAGE:\n${s}`,Q:QV2})); }
    for (const j of jobs) { if (done.has(it.key+'#'+(j.s??''))) continue; est+=j.state.length/3.2+900; calls++;
      if (DRY) continue;
      if (tok*PRICE/1e6>=CAP) { console.log('CAP reached'); return; }
      const res=await ask(j.state,j.Q); if(!res) continue; tok+=res.tokens;
      fs.appendFileSync(CF,JSON.stringify({key:it.key,s:j.s,label:it.label,classes:it.classes,...res})+'\n'); }
  }
  console.log(DRY?`dry: ${calls} calls, est ${(est/1e6).toFixed(2)}M tok, ~$${(est*PRICE/1e6).toFixed(2)}`:`done; total $${(tok*PRICE/1e6).toFixed(3)}`);
});
