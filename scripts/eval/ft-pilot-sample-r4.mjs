#!/usr/bin/env node
/**
 * Draw the #2880 pilot ROUND 2 increment: +PER per stratum, EXCLUDING the 52
 * books already in Round 1, and OVERSAMPLING books that have a real Tier-0
 * catalog match (so the #2885a false-merge / recall-miss audit finally has
 * cases to score — Round 1 had zero tier0.best). Read-only on the DB.
 *
 * Same strata + Western/non-Western logic as ft-pilot-sample.mjs.
 *
 * Usage: set -a; source .env.production.local; set +a
 *        node scripts/eval/ft-pilot-sample-r2.mjs [--per=13]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const PER = parseInt(process.argv.find(a => a.startsWith('--per='))?.split('=')[1] || '13', 10);
const OUT = `scripts/eval/results/ft-pilot-sample-r4-2026-06-30.json`;
const TIER0_TARGET = 4; // aim for up to this many tier0-best books per stratum (rest random)

const WESTERN = new Set(['latin','german','french','greek','ancient greek','italian','dutch','spanish','portuguese','russian','polish','english','latin-german','latin-english','czech','swedish','danish','hungarian']);
const isWestern = (l) => { const n=(l||'').toLowerCase().trim(); return WESTERN.has(n) || WESTERN.has(n.split(/[-\/, ]/)[0]); };
function surname(a){ if(!a)return''; const raw=a.includes(',')?a.split(',')[0]:a; const p=raw.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,'').trim().split(/\s+/); return p[p.length-1]||''; }
function sigtoks(s){ return (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>=4); }

// exclude Round-1 AND Round-2 ids
const priorIds = ['ft-pilot-sample-2026-06-29.json','ft-pilot-sample-r2-2026-06-30.json','ft-pilot-sample-r3-2026-06-30.json']
  .flatMap(f => JSON.parse(fs.readFileSync('scripts/eval/results/'+f,'utf8')).manifest.map(b => b.id));
const EXCLUDE = new Set(priorIds);

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const books = db.collection('books');
const cats = db.collection('translation_catalogs');

const elig = { visible:true, pages_translated:{$gt:0}, language:{$nin:[null,'en','eng','English','english']} };
const strata = [
  { key:'badged · western',      m:{...elig, is_first_translation:true } , west:true },
  { key:'badged · non-western',  m:{...elig, is_first_translation:true } , west:false },
  { key:'unbadged · western',    m:{...elig, is_first_translation:{$ne:true}} , west:true },
  { key:'unbadged · non-western',m:{...elig, is_first_translation:{$ne:true}} , west:false },
];
const proj = { _id:0, id:1, title:1, display_title:1, author:1, language:1, original_language:1, is_first_translation:1, work_id:1, 'translation_verification.disposition':1 };

async function tier0(b){
  const sn = surname(b.author); if(!sn || sn.length<3) return null;
  const rows = await cats.find({ $or:[{author_surname:{$regex:sn,$options:'i'}},{canonical_author_normalized:{$regex:sn,$options:'i'}},{author_normalized:{$regex:sn,$options:'i'}}] })
    .project({ english_title:1, canonical_work:1, translator:1, pub_year_int:1, source_language:1, completeness:1, source:1 }).limit(40).toArray();
  if(!rows.length) return null;
  const bt = new Set(sigtoks(b.display_title||b.title));
  let best=null, bestOv=0;
  for(const r of rows){ const ct=new Set([...sigtoks(r.english_title),...sigtoks(r.canonical_work)]); let inter=0; for(const t of bt) if(ct.has(t)) inter++; const ov= bt.size? inter/bt.size : 0; if(ov>bestOv){bestOv=ov; best=r;} }
  if(!best || bestOv<0.3) return { candidates: rows.length, best:null, note:'surname matched, no title overlap >=0.3' };
  return { candidates: rows.length, title_overlap:+bestOv.toFixed(2), catalog_id:String(best._id), english_title:best.english_title, translator:best.translator, pub_year:best.pub_year_int, source_language:best.source_language, completeness:best.completeness, source:best.source };
}

const sample = [];
for (const s of strata) {
  // large batch so we can find tier0-best books AND have enough non-tier0 fill
  const batch = (await books.aggregate([{ $match:s.m }, { $sample:{ size: PER*40 } }, { $project: proj }]).toArray())
    .filter(b => !EXCLUDE.has(b.id) && isWestern(b.language) === s.west);
  // compute tier0 on a bounded prefix to find matches without scanning everything
  const scanN = Math.min(batch.length, PER*12);
  for (let i=0;i<scanN;i++) batch[i].tier0 = await tier0(batch[i]);
  const withT0 = batch.slice(0,scanN).filter(b => b.tier0 && b.tier0.catalog_id);
  const without = batch.slice(0,scanN).filter(b => !(b.tier0 && b.tier0.catalog_id));
  const pick = [...withT0.slice(0, TIER0_TARGET), ...without].slice(0, PER);
  // ensure tier0 computed for any pick that wasn't in the scanned prefix (shouldn't happen, but safe)
  for (const b of pick) if (b.tier0 === undefined) b.tier0 = await tier0(b);
  for (const b of pick) sample.push({ ...b, stratum: s.key });
}

const summary = {
  built:'2026-06-30', round:4, purpose:'#2880 pilot Round 4 expansion (+'+PER+'/stratum), excludes Round 1, oversamples Tier-0 matches for #2885a',
  n: sample.length,
  by_stratum: Object.fromEntries(strata.map(s=>[s.key, sample.filter(x=>x.stratum===s.key).length])),
  with_tier0_candidate: sample.filter(x=>x.tier0 && x.tier0.catalog_id).length,
  excluded_round1: EXCLUDE.size,
  note:'Run BOTH tiers. Oracle uses the CORRECTED NA rubric (ft-verdict-contract.md §2, rev 2026-06-30): not_applicable ONLY for already-English / wordless visual art; a container/scripture-volume/compilation we produced the first English of (no prior English of the content) is a FIRST; a complete prior English of the content is not_first. Oracle UNPRIMED — do not feed tier0.',
};
fs.mkdirSync('scripts/eval/results',{recursive:true});
fs.writeFileSync(OUT, JSON.stringify({ summary, manifest: sample }, null, 2));
console.log(JSON.stringify(summary,null,2));
console.log('wrote', OUT);
await c.close();
