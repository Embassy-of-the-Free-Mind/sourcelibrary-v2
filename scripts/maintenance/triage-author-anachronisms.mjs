#!/usr/bin/env node
/**
 * Triage + fix the date-anachronism candidates (#2250 §5). Two provable classes:
 *  A) MISATTRIBUTION: an old author's book sits under a modern/early-modern
 *     namesake (disjoint surname + namesake born >1700). Unlink the book
 *     (clear author_id + author_entity_id) so it reverts to string identity.
 *  B) WRONG-ANCHOR: ALL of a person's books predate their (modern, >1800) birth
 *     year => the wikidata_id resolved to a modern namesake. Clear the bad
 *     wikidata anchor + dates + portrait ("null beats a wrong anchor").
 * Outlier single bad book dates are left for review. Additive provenance backs up
 * every cleared value (reversible). Dry-run default; --apply.
 */
import { MongoClient } from 'mongodb';
import { parseWikidataYear, authorshipPlausible } from '../../scripts/lib/author-date-window.mjs';
const APPLY=process.argv.includes('--apply');
const norm=s=>(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const PART=new Set(['de','del','della','di','da','la','le','van','von','der','den','du','des','el','al','ibn','ben','of','the','don','st','saint','y','e','dos','ed','trans','attrib','jr','sr']);
const GIVEN=new Set(['william','johann','johannes','john','jean','georg','george','thomas','samuel','simon','philipp','philip','michael','pierre','andreas','jacob','heinrich','karl','charles','robert','daniel','martin','peter','paul','franz','francis','wilhelm','ludwig','conrad','sebastian','bernard','bernhard','anna','maria','elizabeth','james','richard','forbes']);
const lat=t=>t.replace(/^j/,'i').replace(/y/g,'i').replace(/v/g,'u').replace(/(us|um|ius|is|ae|i|o|a|e)$/,'');
const surnames=s=>new Set(norm(s).split(/[\s,.\[\]();|&]+/).filter(t=>t.length>=4&&!PART.has(t)).map(lat).filter(Boolean).filter(t=>!GIVEN.has(t)));
const mc=new MongoClient(process.env.MONGODB_URI); await mc.connect();
const { ObjectId }=await import('mongodb');
const db=mc.db('bookstore'); const authors=db.collection('authors'), books=db.collection('books'), entities=db.collection('entities');
const persons=await authors.find({is_person:{$ne:false},'entity_ids.0':{$exists:true}},{projection:{slug:1,canonical_name:1,entity_ids:1,viaf_id:1,wikidata_id:1}}).toArray();
const entAll=[...new Set(persons.flatMap(p=>p.entity_ids))];
const eDocs=await entities.find({_id:{$in:entAll.filter(s=>ObjectId.isValid(s)).map(s=>new ObjectId(s))}},{projection:{wikidata_birth_date:1,wikidata_death_date:1,wikidata_id:1,portrait_url:1}}).toArray();
const eMap=new Map(eDocs.map(e=>[String(e._id),e]));
const birthOf=p=>{for(const e of p.entity_ids){const y=parseWikidataYear(eMap.get(String(e))?.wikidata_birth_date);if(y!=null)return y;}return null;};
const bks=await books.find({visible:{$ne:false},author_id:{$exists:true,$ne:null},year:{$type:'number'}},{projection:{author_id:1,year:1,author:1,id:1}}).toArray();
const bbp=new Map(); for(const b of bks){if(!bbp.has(b.author_id))bbp.set(b.author_id,[]);bbp.get(b.author_id).push(b);}
const stamp=new Date().toISOString();

const unlinkOps=[]; const anchorClears=[];
for(const p of persons){ const by=birthOf(p); if(by==null)continue;
  const all=bbp.get(p.slug)||[]; const bad=all.filter(b=>!authorshipPlausible({bookYear:b.year,birthYear:by,margin:10}).plausible);
  if(!bad.length)continue;
  const pSur=surnames(p.canonical_name);
  const disjoint=bad.filter(b=>{const bs=surnames(b.author); return ![...bs].some(t=>pSur.has(t));});
  if(disjoint.length && by>1700){ for(const b of disjoint) unlinkOps.push({updateOne:{filter:{_id:b._id},update:{$unset:{author_id:'',author_entity_id:''},$push:{author_link_provenance:{run:'triage-2250',method:'unlink-misattribution',note:`predated namesake "${p.canonical_name}" (b.${by})`,was_author_id:p.slug,at:stamp}}}}}); }
  else if(by>1800 && all.length>=1 && all.every(b=>b.year<by-10)){
    const eid=p.entity_ids.find(e=>parseWikidataYear(eMap.get(String(e))?.wikidata_birth_date)!=null); const e=eMap.get(String(eid));
    anchorClears.push({p,eid,e,by});
  }
}
console.log('=== triage-author-anachronisms ===');
console.log(`mode: ${APPLY?'APPLY':'DRY RUN'}`);
console.log(`A) unlink misattributed books: ${unlinkOps.length}`);
console.log(`B) clear wrong wikidata anchors: ${anchorClears.length} persons`);
if(APPLY){
  if(unlinkOps.length){ const r=await books.bulkWrite(unlinkOps,{ordered:false}); console.log(`   unlinked ${r.modifiedCount} books`); }
  let cleared=0;
  for(const {p,eid,e,by} of anchorClears){
    // back up + clear the bad wikidata anchor on the entity (dates/portrait/qid)
    await entities.updateOne({_id:new ObjectId(eid)},{$set:{anchor_correction:{run:'triage-2250',reason:`all books predate birth ${by}`,prev:{wikidata_id:e.wikidata_id,wikidata_birth_date:e.wikidata_birth_date,wikidata_death_date:e.wikidata_death_date,portrait_url:e.portrait_url},at:stamp}},$unset:{wikidata_id:'',wikidata_birth_date:'',wikidata_death_date:'',portrait_url:''}});
    await authors.updateOne({_id:p.slug},{$set:{anchor_correction:{run:'triage-2250',prev_wikidata_id:p.wikidata_id,at:stamp}},$unset:{wikidata_id:''}});
    cleared++;
  }
  console.log(`   cleared ${cleared} anchors`);
  // recompute book_count on the namesake docs whose misattributed books were unlinked
  const namesakes=[...new Set(unlinkOps.map(o=>o.updateOne.update.$push.author_link_provenance.was_author_id))];
  for(const slug of namesakes){
    const d=await authors.findOne({_id:slug},{projection:{variants:1,entity_ids:1}}); if(!d)continue;
    const or=[{author_id:slug}]; if((d.entity_ids||[]).length)or.push({author_entity_id:{$in:d.entity_ids}}); if((d.variants||[]).length)or.push({author:{$in:d.variants}});
    await authors.updateOne({_id:slug},{$set:{book_count:await books.countDocuments({visible:{$ne:false},$or:or})}});
  }
  console.log(`   recomputed book_count on ${namesakes.length} namesake docs`);
} else console.log('\nDry run — pass --apply to write.');
await mc.close();
