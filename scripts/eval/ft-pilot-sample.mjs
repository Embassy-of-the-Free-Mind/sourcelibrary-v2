#!/usr/bin/env node
/**
 * Draw the #2880 pilot sample: a stratified random sample of FT-eligible books,
 * with the Tier-0 catalog link captured per book (the #2885(a) free alignment
 * audit input). Read-only on the DB; writes a manifest a worker runs the
 * oracle (Tier-2 Claude, unified prompt — see .claude/docs/ft-verdict-contract.md)
 * and the Tier-1 baseline (ft-gemini-adjudicate.mjs) over.
 *
 * Strata = the two axes that drive measured accuracy: badged-vs-unbadged ×
 * Western-catalogued-vs-non-Western (68% vs 47% disposition precision). ~13/stratum.
 *
 * Tier-0 capture per book: work_id + the best translation_catalogs candidate by
 * author-surname + title-token overlap (candidate generation only; the worker
 * runs the full ft-prior-guard guards and compares to the oracle verdict to
 * score false-merge / recall-miss).
 *
 * Usage: set -a; source .env.production.local; set +a
 *        node scripts/eval/ft-pilot-sample.mjs [--per N] [--seed S]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const PER = parseInt(process.argv.find(a => a.startsWith('--per='))?.split('=')[1] || '13', 10);
const OUT = `scripts/eval/results/ft-pilot-sample-2026-06-29.json`;

const WESTERN = new Set(['latin','german','french','greek','ancient greek','italian','dutch','spanish','portuguese','russian','polish','english','latin-german','latin-english','czech','swedish','danish','hungarian']);
const isWestern = (l) => { const n=(l||'').toLowerCase().trim(); return WESTERN.has(n) || WESTERN.has(n.split(/[-\/, ]/)[0]); };

function surname(a){ if(!a)return''; const raw=a.includes(',')?a.split(',')[0]:a; const p=raw.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,'').trim().split(/\s+/); return p[p.length-1]||''; }
function sigtoks(s){ return (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>=4); }

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const books = db.collection('books');
const cats = db.collection('translation_catalogs');

const elig = { visible:true, pages_translated:{$gt:0}, language:{$nin:[null,'en','eng','English','english']} };
const strata = [
  { key:'badged · western',      m:{...elig, is_first_translation:true,  language:{$nin:[null]}} , west:true },
  { key:'badged · non-western',  m:{...elig, is_first_translation:true } , west:false },
  { key:'unbadged · western',    m:{...elig, is_first_translation:{$ne:true}} , west:true },
  { key:'unbadged · non-western',m:{...elig, is_first_translation:{$ne:true}} , west:false },
];

const proj = { _id:0, id:1, title:1, display_title:1, author:1, language:1, original_language:1, is_first_translation:1, work_id:1, 'translation_verification.disposition':1 };
const sample = [];
for (const s of strata) {
  // pull a generous random batch, filter by west/non-west in JS, take PER
  const batch = await books.aggregate([{ $match:s.m }, { $sample:{ size: PER*12 } }, { $project: proj }]).toArray();
  const filtered = batch.filter(b => isWestern(b.language) === s.west).slice(0, PER);
  for (const b of filtered) sample.push({ ...b, stratum: s.key });
}

// Tier-0 capture: best catalog candidate by surname + title overlap.
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
for (const b of sample) b.tier0 = await tier0(b);

const summary = {
  built:'2026-06-29', purpose:'#2880 search head-to-head pilot + #2885(a) Tier-0 alignment audit',
  n: sample.length,
  by_stratum: Object.fromEntries(strata.map(s=>[s.key, sample.filter(x=>x.stratum===s.key).length])),
  with_tier0_candidate: sample.filter(x=>x.tier0 && x.tier0.catalog_id).length,
  note:'Run the unified Tier-2 oracle (ft-verdict-contract.md §2) AND Tier-1 (ft-gemini-adjudicate.mjs) over `manifest`. Score: Gemini-vs-Claude agreement (head-to-head) + alignment audit (tier0.catalog_id present but oracle finds no prior = false merge; oracle finds a held prior with no tier0 = recall miss). Oracle is UNPRIMED — do not feed it tier0.',
};
fs.mkdirSync('scripts/eval/results',{recursive:true});
fs.writeFileSync(OUT, JSON.stringify({ summary, manifest: sample }, null, 2));
console.log(JSON.stringify(summary,null,2));
console.log('wrote', OUT);
await c.close();
