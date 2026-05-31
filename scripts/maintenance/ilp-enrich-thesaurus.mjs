#!/usr/bin/env node
/**
 * Enrich the author thesaurus FROM the Index Librorum Prohibitorum (#2250).
 * For each ILP entry we hold (Gemini-verified author_held>0), add the Index's
 * (often Latin/censor) name form as a variant of the canonical person, with
 * provenance. Precision-gated: date-window + distinctive + name-consistency with
 * the held book's author string (catches surname collisions: Pareus father/son,
 * Clusius/Garcia translator). Additive, reversible. Dry-run default; --apply.
 */
import { MongoClient } from 'mongodb';
import { parseWikidataYear, authorshipPlausible } from '../lib/author-date-window.mjs';
const APPLY=process.argv.includes('--apply');
const norm=s=>(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
const PART=new Set(['de','del','della','di','da','la','le','van','von','der','den','du','des','el','al','ibn','ben','of','the','don','st','saint','y','e','dos','seu','alias']);
const lat=t=>t.replace(/^j/,'i').replace(/y/g,'i').replace(/v/g,'u').replace(/(us|um|ius|is|ae|i|o|a|e)$/,'');
const sig=s=>[...new Set(norm(s).split(/[\s,.\[\]();|]+/).filter(t=>t.length>=4&&!PART.has(t)).map(lat).filter(Boolean))];
function nameConsistent(ilp, bookAuthor){ const ti=sig(ilp), tb=sig(bookAuthor); if(!ti.length||!tb.length) return false;
  const shared=ti.filter(t=>tb.includes(t)); if(!shared.length) return false;
  const iEx=ti.filter(t=>!tb.includes(t)), bEx=tb.filter(t=>!ti.includes(t));
  return !(iEx.length && bEx.length); } // both sides have a distinctive non-shared token => conflict
const slugify=s=>norm(s).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-{2,}/g,'-');

const SUPA=process.env.SUPABASE_URL, KEY=process.env.SUPABASE_ANON_KEY; const H={apikey:KEY,Authorization:`Bearer ${KEY}`};
const mc=new MongoClient(process.env.MONGODB_URI); await mc.connect();
const { ObjectId }=await import('mongodb');
const db=mc.db('bookstore'); const authors=db.collection('authors'), books=db.collection('books'), entities=db.collection('entities');

const allA=await authors.find({is_person:{$ne:false}},{projection:{slug:1,canonical_name:1,variants:1,viaf_id:1,wikidata_id:1,entity_ids:1}}).toArray();
const variantSet=new Set(); const docBySlug=new Map(allA.map(a=>[a.slug,a]));
for(const a of allA)for(const v of [a.canonical_name,...(a.variants||[])]){if(v)variantSet.add(norm(v));}
// person -> birth year
const entAll=[...new Set(allA.flatMap(a=>a.entity_ids||[]))];
const eDocs=await entities.find({_id:{$in:entAll.filter(s=>ObjectId.isValid(s)).map(s=>new ObjectId(s))}},{projection:{wikidata_birth_date:1}}).toArray();
const eBirth=new Map(eDocs.map(e=>[String(e._id),parseWikidataYear(e.wikidata_birth_date)]));
const birth=s=>{const d=docBySlug.get(s); for(const e of (d?.entity_ids||[])){const y=eBirth.get(String(e)); if(y!=null)return y;} return null;};

let offset=0, rows=[]; while(true){const r=await fetch(`${SUPA}/rest/v1/index_catalog_entries?select=author,author_held_count,author_held_sample_slug,condemnation_year&order=id&offset=${offset}&limit=1000`,{headers:H});const b=await r.json();rows.push(...b);if(b.length<1000)break;offset+=1000;}
const held=rows.filter(e=>(e.author_held_count||0)>0 && e.author_held_sample_slug && e.author);

const stamp=new Date().toISOString();
const byPerson=new Map(); // slug -> Set of new variant forms
let gKept=0, gNoBook=0, gNoAuthorId=0, gAlready=0, gNotDistinct=0, gDateFail=0, gNameConflict=0, gCompound=0;
const seenForm=new Set();
const samples=[];
for(const e of held){
  const form=e.author.trim(); const nf=norm(form);
  if(variantSet.has(nf)){gAlready++;continue;}
  if(/[;|&]/.test(form)){gCompound++;continue;} // multi-author Index entry — don't add as one person's variant
  if(sig(form).length<1 || nf.length<8){gNotDistinct++;continue;}
  const bk=await books.findOne({slug:e.author_held_sample_slug},{projection:{author_id:1,author:1,year:1,title:1}});
  if(!bk){gNoBook++;continue;}
  if(!bk.author_id){gNoAuthorId++;continue;}
  const by=birth(bk.author_id);
  if(!authorshipPlausible({bookYear:bk.year, birthYear:by, margin:10}).plausible){gDateFail++;continue;}
  if(!nameConsistent(form, bk.author)){gNameConflict++;continue;}
  gKept++;
  if(!byPerson.has(bk.author_id))byPerson.set(bk.author_id,new Set());
  byPerson.get(bk.author_id).add(form);
  const key=bk.author_id+'|'+nf; if(!seenForm.has(key)){seenForm.add(key); if(samples.length<40000) samples.push({form, person:docBySlug.get(bk.author_id)?.canonical_name, bookAuthor:bk.author, year:bk.year});}
}
console.log('=== ILP -> thesaurus enrichment (#2250) ===');
console.log(`mode: ${APPLY?'APPLY':'DRY RUN'}`);
console.log(`held ILP entries scanned: ${held.length}`);
console.log(`gates: already-variant ${gAlready} | compound ${gCompound} | not-distinctive ${gNotDistinct} | no-book ${gNoBook} | no-author_id ${gNoAuthorId} | date-fail ${gDateFail} | name-conflict ${gNameConflict}`);
console.log(`=> KEPT for enrichment: ${gKept} forms across ${byPerson.size} persons (${seenForm.size} distinct person+form)`);

// random sample 40 of distinct kept for residual error check
const N=Math.max(1,Math.floor(samples.length/40));
console.log('\n=== sample of kept additions (judge same person?) ===');
for(let i=0;i<samples.length;i+=N){const s=samples[i]; console.log(`add "${s.form}" -> "${s.person}" (via book by "${s.bookAuthor}" [${s.year}])`);}

if(APPLY){
  let mod=0;
  for(const [slug,forms] of byPerson){
    const variantSlugs=[...forms].map(slugify);
    const prov=[...forms].map(f=>({run:'ilp-enrich-2250',source:'index_librorum_prohibitorum',form:f,at:stamp}));
    const r=await authors.updateOne({_id:slug},{$addToSet:{variants:{$each:[...forms]}, variant_slugs:{$each:variantSlugs}}, $push:{variant_provenance:{$each:prov}}});
    mod+=r.modifiedCount;
  }
  console.log(`\nAPPLIED: enriched ${mod} persons.`);
} else console.log('\nDry run — pass --apply to write.');
await mc.close();
