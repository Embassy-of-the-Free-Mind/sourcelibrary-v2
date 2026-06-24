#!/usr/bin/env node
/**
 * Backfill reading_summary for BPH live books that are translated but never
 * summarized (legacy books stuck at pipeline_auto.status:'complete', which the
 * enrich cron skips — it only selects 'translate_complete'). See issue context:
 * Fludd UCH Vol.1 had this; ~1,137 BPH books share it.
 *
 * Runs enrich-worker --book=ID --phase=6 per book (Phase 6 ONLY — does not touch
 * existing chapters). Idempotent: re-queries the no-summary set each run, so
 * completed books drop out and it's safe to re-run / resume after interruption.
 *
 *   --limit=N   max books this run (default 25)
 *   --dry-run   list what would be processed
 */
import { MongoClient } from 'mongodb';
import { execFileSync } from 'child_process';
const LIMIT=parseInt((process.argv.find(a=>a.startsWith('--limit='))||'').split('=')[1]||'25',10);
const DRY=process.argv.includes('--dry-run');
const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000}); await c.connect();
const db=c.db('bookstore');
const q={ visible:true, held_by:'bph', pages_count:{$gt:0},
  $expr:{$gte:['$pages_translated',{$multiply:[0.9,'$pages_count']}]},
  'reading_summary.overview':{$in:['',null]} };
const books=await db.collection('books').find(q,{projection:{id:1,title:1,pages_count:1}})
  .sort({pages_count:1}).limit(LIMIT).toArray();   // small-first = fast early wins
const remaining=await db.collection('books').countDocuments(q);
console.log(`BPH books still needing summary: ${remaining} | this run: ${books.length}`);
await c.close();
if(DRY){ for(const b of books) console.log(`  ${b.id} ${(b.title||'').slice(0,55)} ${b.pages_count}p`); process.exit(0); }
let ok=0,fail=0;
for(const b of books){
  process.stdout.write(`  [${ok+fail+1}/${books.length}] ${(b.title||b.id).slice(0,45)} (${b.pages_count}p)... `);
  try{ execFileSync('node',['scripts/workers/enrich-worker.mjs',`--book=${b.id}`,'--phase=6'],{stdio:'ignore',timeout:600000}); ok++; console.log('ok'); }
  catch(e){ fail++; console.log('FAIL '+(e.message||'').slice(0,60)); }
}
console.log(`\nDone: ${ok} summarized, ${fail} failed. ${remaining-ok} BPH books still need summary.`);
