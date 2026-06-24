#!/usr/bin/env node
/**
 * QA sweep (#2250 §5): find build mis-merges by date impossibility — books whose
 * edition year predates their assigned author's birth (the Mozart/Chrysostom
 * pattern). Read-only; flags contamination candidates for review.
 */
import { MongoClient } from 'mongodb';
import { parseWikidataYear, authorshipPlausible } from '../lib/author-date-window.mjs';
const MARGIN = 10;
const mc=new MongoClient(process.env.MONGODB_URI); await mc.connect();
const db=mc.db('bookstore'); const authors=db.collection('authors'), books=db.collection('books'), entities=db.collection('entities');

// 1. persons -> birthYear via their entities
const persons=await authors.find({is_person:{$ne:false},'entity_ids.0':{$exists:true}},{projection:{slug:1,canonical_name:1,entity_ids:1}}).toArray();
const allEnt=[...new Set(persons.flatMap(p=>p.entity_ids))];
const { ObjectId }=await import('mongodb');
const entDocs=await entities.find({_id:{$in:allEnt.filter(s=>ObjectId.isValid(s)).map(s=>new ObjectId(s))}},{projection:{wikidata_birth_date:1}}).toArray();
const entBirth=new Map(entDocs.map(e=>[String(e._id), parseWikidataYear(e.wikidata_birth_date)]));
const birthBySlug=new Map();
for(const p of persons){ for(const e of p.entity_ids){ const y=entBirth.get(String(e)); if(y!=null){ birthBySlug.set(p.slug, y); break; } } }
const nameBySlug=new Map(persons.map(p=>[p.slug,p.canonical_name]));
console.log('persons with a birth year:', birthBySlug.size);

// 2. live books with author_id + year
const bks=await books.find({visible:{$ne:false}, author_id:{$exists:true,$ne:null}, year:{$type:'number'}},{projection:{author_id:1,year:1,title:1,author:1}}).toArray();
console.log('live books with author_id + year:', bks.length);

// 3. flag impossibilities, group by person
const flagged=new Map();
for(const b of bks){ const by=birthBySlug.get(b.author_id); if(by==null)continue;
  const r=authorshipPlausible({bookYear:b.year, birthYear:by, margin:MARGIN});
  if(!r.plausible){ if(!flagged.has(b.author_id))flagged.set(b.author_id,{birth:by,books:[]}); flagged.get(b.author_id).books.push(b); }
}
const sorted=[...flagged.entries()].sort((a,b)=>{const ga=Math.min(...a[1].books.map(x=>x.year)); const gb=Math.min(...b[1].books.map(x=>x.year)); return (a[1].birth-ga)<(b[1].birth-gb)?1:-1;});
console.log(`\n=== CONTAMINATION CANDIDATES: ${flagged.size} persons, ${[...flagged.values()].reduce((s,v)=>s+v.books.length,0)} books predating birth ===`);
for(const [slug,v] of sorted.slice(0,40)){
  const worst=v.books.sort((a,b)=>a.year-b.year)[0];
  console.log(`${nameBySlug.get(slug)} (b.${v.birth}) <- ${v.books.length} bk; e.g. "${(worst.title||'').slice(0,40)}" by "${worst.author}" [${worst.year}]`);
}
await mc.close();
