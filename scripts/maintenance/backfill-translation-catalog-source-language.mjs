#!/usr/bin/env node
/**
 * Backfill `source_language` (+ provenance) on translation_catalogs (Mongo).
 * Issue #2234 Phase 0. The catalog was built as a Latin-translation verifier,
 * so source language is mostly Latin by construction; non-Latin originals are
 * recovered by script detection on `original_title`.
 *
 * Provenance tiers (recorded in source_language_provenance):
 *   script_detected   — non-Latin script in original_title (high confidence)
 *   source_scope_classical — Loeb/Harvard classical series (Latin OR Greek; default la, lower conf)
 *   source_scope      — Latin by catalog construction (default la)
 *
 * NB: only the Mongo copy is updated (24,040 rows). The Supabase copy (26,789,
 * diverged) needs a separate sync/DDL — flagged, not done here.
 *
 * Usage: node scripts/maintenance/backfill-translation-catalog-source-language.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
const APPLY = process.argv.includes('--apply');
const CLASSICAL_MIXED = new Set(['loeb','extended_harvard_lcl']); // include Greek
function detectScript(s){
  if(!s) return null;
  if(/[一-鿿]/.test(s)) return /[぀-ヿ]/.test(s)?'ja':'zh';
  if(/[Ѐ-ӿ]/.test(s)) return 'ru';
  if(/[Ͱ-Ͽἀ-῿]/.test(s)) return 'grc';
  if(/[֐-׿]/.test(s)) return 'he';
  if(/[؀-ۿ]/.test(s)) return 'ar';
  if(/[ऀ-ॿ]/.test(s)) return 'sa';
  return null;
}
const c=new MongoClient(process.env.MONGODB_URI); await c.connect();
const tc=c.db('bookstore').collection('translation_catalogs');
const dist={}; let ops=[],applied=0,total=0;
for await (const r of tc.find({},{projection:{source:1,original_title:1,source_language:1}})){
  total++;
  const sd=detectScript(r.original_title);
  let lang,prov;
  if(sd){ lang=sd; prov='script_detected'; }
  else if(CLASSICAL_MIXED.has(r.source)){ lang='la'; prov='source_scope_classical'; }
  else { lang='la'; prov='source_scope'; }
  dist[prov]=(dist[prov]||0)+1;
  if(APPLY){ ops.push({updateOne:{filter:{_id:r._id},update:{$set:{source_language:lang,source_language_provenance:prov}}}});
    if(ops.length>=1000){applied+=(await tc.bulkWrite(ops)).modifiedCount;ops=[];} }
}
if(APPLY&&ops.length)applied+=(await tc.bulkWrite(ops)).modifiedCount;
console.log(`${APPLY?'APPLIED':'DRY-RUN'} over ${total} rows`);
console.log('by provenance:',JSON.stringify(dist,null,2));
if(APPLY){
  console.log(`modified ${applied}`);
  const byLang=await tc.aggregate([{$group:{_id:'$source_language',n:{$sum:1}}},{$sort:{n:-1}}]).toArray();
  console.log('source_language distribution:',byLang.map(x=>`${x._id}:${x.n}`).join(', '));
}
await c.close();
