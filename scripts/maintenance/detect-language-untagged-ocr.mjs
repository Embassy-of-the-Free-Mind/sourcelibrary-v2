#!/usr/bin/env node
/**
 * Detect language for books with OCR text but Unknown/null language (#2234 #9).
 * Title-script detection is unreliable here (scholarly editions: "The
 * Oxyrhynchus Papyri" is Greek; "Atharva-Veda" is Sanskrit), so we ask Gemini
 * for the work's ORIGINAL/primary language, gate on high confidence, preserve
 * the original in language_raw, and flag low-confidence for review (no guessing).
 * Usage: node scripts/maintenance/detect-language-untagged-ocr.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
const APPLY=process.argv.includes('--apply');
const KEY=process.env.GEMINI_API_KEY, M='gemini-3.1-flash-lite';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function detect(title){
  const prompt=`What is the ORIGINAL/primary language of the historical work titled "${title}"? For a scholarly edition (e.g. a papyri or Veda edition), give the language of the SOURCE TEXT, not the title. Respond JSON only: {"language":"<full English name e.g. Latin, Greek, Sanskrit, Italian, French, German, English>"|null,"confidence":"high"|"medium"|"low"}. Use null + low if genuinely unsure.`;
  const u=`https://generativelanguage.googleapis.com/v1beta/models/${M}:generateContent?key=${KEY}`;
  for(let a=0;a<3;a++){ let r; try{ r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0,responseMimeType:'application/json'}})});}catch{await sleep(1200);continue;}
    if(r.status===429||r.status>=500){await sleep(2000);continue;} if(!r.ok)return null;
    const d=await r.json(); const t=d?.candidates?.[0]?.content?.parts?.[0]?.text; if(!t)return null; try{return JSON.parse(t);}catch{return null;} }
  return null;
}
const c=new MongoClient(process.env.MONGODB_URI); await c.connect();
const B=c.db('bookstore').collection('books');
const cand=await B.find({language:{$in:['Unknown',null]},pages_ocr:{$gt:0}},{projection:{title:1}}).toArray();
let set=0,flagged=0,err=0; const results=[];
for(const b of cand){ const v=await detect(b.title); 
  if(!v){err++;continue;}
  if(v.language && v.confidence==='high'){ set++; results.push(`${v.language}  ← ${(b.title||'').slice(0,45)}`);
    if(APPLY) await B.updateOne({_id:b._id},{$set:{language:v.language,languages:[v.language],language_raw:'Unknown',language_detected:'gemini_title'}}); }
  else { flagged++; if(APPLY) await B.updateOne({_id:b._id},{$set:{language_review:true}}); }
  await sleep(200);
}
console.log(`${APPLY?'APPLIED':'DRY-RUN'}: ${cand.length} books | high-conf set=${set}, low-conf flagged=${flagged}, errors=${err}`);
console.log('\nhigh-confidence detections:'); results.forEach(r=>console.log('  '+r));
await c.close();
