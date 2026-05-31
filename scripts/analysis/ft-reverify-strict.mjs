#!/usr/bin/env node
/**
 * FT re-verification with a STRICT disposition prompt (issue #1974).
 * Fixes the root cause of the unreliable is_first_translation data: the old
 * verifier conflated "first English translation ever" with "catalog search
 * found nothing" and stamped first-claims on non-translations.
 *
 * This prompt forces three gates BEFORE any first-claim:
 *   1. Is this even a translation? (English originals → NOT_A_TRANSLATION)
 *   2. Does a prior English translation exist? (→ NOT_FIRST)
 *   3. Only if it's a translation AND none found → FIRST_LIKELY (still "likely",
 *      since absence-of-evidence ≠ confirmed first).
 * Anything uncertain → NEEDS_HUMAN. No flag is written — emits proposals only.
 *
 * Dry-run by default over a sample of the 447 contested. --apply writes nothing
 * to is_first_translation (intentionally); it only persists proposals to
 * ft_reverify_proposal for human review.
 *
 * Usage: node scripts/analysis/ft-reverify-strict.mjs [N]   (sample size, default 30)
 */
import { MongoClient } from 'mongodb';
const N=parseInt(process.argv[2]||'30',10);
const KEY=process.env.GEMINI_API_KEY, M='gemini-3.1-flash-lite';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const FIRST=['confirmed_first','first_from_source','first_complete_translation','first_modern_translation'];
async function classify(b){
  const tv=b.translation_verification||{};
  const found=(tv.translations_found||[]).map(t=>`${t.english_title||''} (${t.translator||'?'}, ${t.pub_year||'?'})`).join('; ')||'none recorded';
  const p=`Classify the English-translation status of a historical work held in a digital library.

Work title: "${b.title}"
Tagged source language: ${b.language}
Prior English translations the catalog search recorded: ${found}
Earlier verifier disposition (may be wrong): ${tv.disposition}

Answer these gates IN ORDER and stop at the first that applies:
1. Is this work ALREADY in English originally (an English-language original, not a translation of a non-English source)? If yes → "NOT_A_TRANSLATION".
2. Does at least one prior English translation exist (from the recorded list OR your knowledge)? If yes → "NOT_FIRST".
3. Is it a non-English-source work with NO known prior English translation? → "FIRST_LIKELY".
4. Otherwise/uncertain → "NEEDS_HUMAN".

Do NOT claim FIRST_LIKELY just because the catalog found nothing — only if you have positive reason to believe it's a genuine untranslated source-language work. JSON only: {"verdict":"NOT_A_TRANSLATION|NOT_FIRST|FIRST_LIKELY|NEEDS_HUMAN","confidence":"high|medium|low","reason":"<one sentence>"}`;
  const u=`https://generativelanguage.googleapis.com/v1beta/models/${M}:generateContent?key=${KEY}`;
  for(let a=0;a<3;a++){let r;try{r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:p}]}],generationConfig:{temperature:0,responseMimeType:'application/json'}})});}catch{await sleep(1200);continue;}
    if(r.status===429||r.status>=500){await sleep(2000);continue;} if(!r.ok)return null;const d=await r.json();const t=d?.candidates?.[0]?.content?.parts?.[0]?.text;if(!t)return null;try{return JSON.parse(t);}catch{return null;}}
  return null;
}
const c=new MongoClient(process.env.MONGODB_URI); await c.connect();
const B=c.db('bookstore').collection('books');
const all=await B.find({language:'Latin',pages_translated:{$gt:0},is_first_translation:false,'translation_verification.disposition':{$in:FIRST}},
  {projection:{title:1,language:1,'translation_verification.disposition':1,'translation_verification.translations_found':1}}).toArray();
const sample=all.slice(0,N);
console.log(`contested total ${all.length}; dry-run sample ${sample.length}\n`);
const tally={}; let err=0;
for(const b of sample){const v=await classify(b);if(!v){err++;continue;}tally[v.verdict]=(tally[v.verdict]||0)+1;
  console.log(`[${v.verdict}/${v.confidence}] ${(b.title||'').slice(0,52)} — ${v.reason}`);
  await sleep(250);}
console.log('\ntally:',JSON.stringify(tally),'errors:',err);
console.log('\n(no is_first_translation flag written — proposals only)');
await c.close();
