#!/usr/bin/env node
/**
 * Fix language mis-tags: works tagged language:'Latin' whose CONTENT is actually
 * another language (issue #2184). Title heuristics are unreliable — many
 * English-*titled* works are correctly Latin (De Rerum Natura, Gutenberg Bible,
 * Sarum Liturgy: Latin source, English display title). So we ask Gemini for the
 * primary CONTENT language and only re-tag when it is confidently NOT Latin.
 *
 * Conservative: candidate = language:'Latin' with an English-looking title (the
 * mis-tag signal). For each, Gemini judges content language + confidence. We
 * re-tag ONLY high-confidence non-Latin; preserve original in language_raw;
 * flag medium/low for review. No first-translation flags touched here.
 *
 * Usage: node scripts/maintenance/fix-language-mistags.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
const APPLY=process.argv.includes('--apply');
const KEY=process.env.GEMINI_API_KEY, M='gemini-3.1-flash-lite';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ENG=/^(The |An |A |Notes |Washington|Mercury,|An Essay|An Inquiry|An Enquiry|Games |Korean |Japanese Chess|Mancala|A History|A Short|A Treatise|The Game|The Natural|The Compleat|Justitia|The Faerie|Of |On the |Concerning )/;
async function lang(title){
  const p=`A book in our library is tagged as Latin. Title: "${title}". What language is the PRIMARY TEXT (the body content a reader reads) actually in? Many works have an English display title but a Latin source text (e.g. "On the Nature of Things (De Rerum Natura)" is Latin; "The Gutenberg Bible" is Latin). Judge the actual content language. JSON only: {"content_language":"<full English name>","is_latin":true|false,"confidence":"high"|"medium"|"low"}`;
  const u=`https://generativelanguage.googleapis.com/v1beta/models/${M}:generateContent?key=${KEY}`;
  for(let a=0;a<3;a++){let r;try{r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:p}]}],generationConfig:{temperature:0,responseMimeType:'application/json'}})});}catch{await sleep(1200);continue;}
    if(r.status===429||r.status>=500){await sleep(2000);continue;} if(!r.ok)return null; const d=await r.json(); const t=d?.candidates?.[0]?.content?.parts?.[0]?.text; if(!t)return null; try{return JSON.parse(t);}catch{return null;}}
  return null;
}
const c=new MongoClient(process.env.MONGODB_URI); await c.connect();
const B=c.db('bookstore').collection('books');
const cand=await B.find({language:'Latin', title:ENG},{projection:{title:1}}).toArray();
let retag=0,kept=0,flagged=0,err=0; const changes=[];
for(const b of cand){ const v=await lang(b.title); if(!v){err++;continue;}
  if(v.is_latin===false && v.confidence==='high'){ retag++; changes.push(`${v.content_language.padEnd(10)} ← ${(b.title||'').slice(0,55)}`);
    if(APPLY) await B.updateOne({_id:b._id},{$set:{language:v.content_language,languages:[v.content_language],language_raw:'Latin',language_corrected:'gemini_content_mistag'}}); }
  else if(v.is_latin===true){ kept++; }
  else { flagged++; if(APPLY) await B.updateOne({_id:b._id},{$set:{language_review:true}}); }
  await sleep(200);
}
console.log(`${APPLY?'APPLIED':'DRY-RUN'}: ${cand.length} candidates | re-tagged non-Latin=${retag}, confirmed Latin (kept)=${kept}, flagged=${flagged}, err=${err}`);
console.log('\nre-tags (high-confidence non-Latin):'); changes.forEach(x=>console.log('  '+x));
await c.close();
