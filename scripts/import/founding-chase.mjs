#!/usr/bin/env node
/**
 * Chase the 3 founding-batch imports that failed on "no page count" (their
 * first-choice IA scans lacked IIIF/imagecount/jp2). Substitutes ECCO/EEBO
 * editions that carry an imagecount. Same doc shape / HIDDEN as the sibling
 * direct-insert scripts. (The 4th failure — a standalone Declaration of
 * Independence — is intentionally skipped: its text is already held inside
 * declarationofind00unit_2 (1796) and the 1781 Constitutions compendium.)
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/founding-chase.mjs --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
const COMMIT = process.argv.includes('--commit');
const BOOKS = [
  { ia: 'bim_early-english-books-1641-1700_a-letter-concerning-tole_locke-john_1689', title: 'A Letter Concerning Toleration', author: 'John Locke', language: 'English', published: '1689' },
  { ia: 'bim_eighteenth-century_commentaries-on-the-laws_blackstone-william-sir_1765_2', title: 'Commentaries on the Laws of England, Vol. 2', author: 'William Blackstone', language: 'English', published: '1766' },
  { ia: 'bim_eighteenth-century_commentaries-on-the-laws_blackstone-william-sir_1765_3', title: 'Commentaries on the Laws of England, Vol. 3', author: 'William Blackstone', language: 'English', published: '1768' },
];
function normalizeTitle(t){return t.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|gli|i|el|los|las)\s+/i,'').replace(/\s*[\(\[:]?\s*(vol\.?\s*\d+|tomus?\s*\d+|part\.?\s*\d+|band\s*\d+|tome?\s*\d+)[\)\]]?\s*$/i,'').replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();}
function normalizeAuthor(a){const c=a.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();return c.split(' ').filter(w=>w.length>0).sort().join(' ');}
function slugify(t,m=70){return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').substring(0,m).replace(/-$/,'');}
async function uniqueSlug(db,base){let s=base,i=2;while(await db.collection('books').findOne({slug:s},{projection:{_id:1}}))s=`${base}-${i++}`;return s;}
async function pageCountFor(ia,metadata){
  try{const r=await fetch(`https://iiif.archive.org/iiif/${ia}/manifest.json`,{signal:AbortSignal.timeout(20000)});if(r.ok){const m=await r.json();if(Array.isArray(m.items))return{n:m.items.length,src:'iiif_v3'};if(m.sequences?.[0]?.canvases)return{n:m.sequences[0].canvases.length,src:'iiif_v2'};}}catch{}
  const meta=metadata.metadata||{};if(meta.imagecount)return{n:parseInt(meta.imagecount,10),src:'imagecount'};
  const jp2=(metadata.files||[]).filter(f=>f.name.endsWith('.jp2')&&!f.name.includes('thumb'));if(jp2.length>1)return{n:jp2.length,src:'jp2_files'};return{n:0,src:'none'};
}
async function main(){
  const client=new MongoClient(process.env.MONGODB_URI,{maxPoolSize:3});await client.connect();const db=client.db('bookstore');
  let imported=0,skipped=0,failed=0;
  for(const b of BOOKS){
    const fp=`ia:${b.ia}`;
    if(await db.collection('books').findOne({$or:[{ia_identifier:b.ia},{source_fingerprint:fp}]},{projection:{_id:1}})){console.log(`SKIP ${b.ia}`);skipped++;continue;}
    let metadata;try{const mr=await fetch(`https://archive.org/metadata/${b.ia}`,{signal:AbortSignal.timeout(20000)});if(!mr.ok){console.log(`FAIL ${b.ia} meta ${mr.status}`);failed++;continue;}metadata=await mr.json();}catch(e){console.log(`FAIL ${b.ia} ${e}`);failed++;continue;}
    const meta=metadata.metadata||{};const {n:pageCount,src:pageCountSource}=await pageCountFor(b.ia,metadata);
    if(!pageCount){console.log(`FAIL ${b.ia} no page count`);failed++;continue;}
    const stripText=s=>String(s).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
    const firstOf=v=>{const raw=Array.isArray(v)?(typeof v[0]==='string'?v[0]:null):(typeof v==='string'?v:null);return raw?stripText(raw)||null:null;};
    const arrOf=v=>{const raw=Array.isArray(v)?v.filter(x=>typeof x==='string'):(typeof v==='string'?[v]:[]);return raw.map(stripText).filter(Boolean);};
    const iaCatalog={source:'internet_archive',identifier:b.ia,ark:meta['identifier-ark']||null,mediatype:meta.mediatype||null,collections:arrOf(meta.collection),publisher:firstOf(meta.publisher),place:firstOf(meta.publishplace)||firstOf(meta.place),description:firstOf(meta.description),subjects:arrOf(meta.subject),date_iso:firstOf(meta.date),scraped_at:new Date().toISOString()};
    for(const k of Object.keys(iaCatalog)){const v=iaCatalog[k];if(v==null||(Array.isArray(v)&&!v.length))delete iaCatalog[k];}
    const licenseUrl=meta.licenseurl||meta.license||null,rights=meta.rights||meta.possible_copyright_status||null;
    const contributor=typeof meta.contributor==='string'?stripText(meta.contributor):null;
    const bookId=new ObjectId(),bookIdStr=bookId.toHexString();const slug=await uniqueSlug(db,slugify(`${b.title} ${b.author}`));const now=new Date();
    const photo=i=>`https://archive.org/download/${b.ia}/page/n${i}/full/full/0/default.jpg`,thumb=i=>`https://archive.org/download/${b.ia}/page/n${i}/full/pct:15/0/default.jpg`;
    const bookDoc=makeBookDoc({_id:bookId,id:bookIdStr,slug,title:b.title,display_title:null,author:b.author,language:b.language,published:b.published,field_provenance:{language:'caller'},categories:['History','Political Philosophy'],ia_identifier:b.ia,thumbnail:thumb(0),pages_count:pageCount,pages_ocr:0,pages_translated:0,content_type:'book',text_role:'original',
      dublin_core:{dc_identifier:[`IA:${b.ia}`,...(iaCatalog.ark?[String(iaCatalog.ark)]:[])],dc_source:`https://archive.org/details/${b.ia}`,...(iaCatalog.subjects?.length?{dc_subject:iaCatalog.subjects}:{})},
      catalog_metadata:iaCatalog,image_source:{provider:'internet_archive',provider_name:'Internet Archive',source_url:`https://archive.org/details/${b.ia}`,identifier:b.ia,license:licenseUrl||'publicdomain',license_url:licenseUrl,rights,...(contributor?{contributing_library:contributor}:{}),access_date:now},
      page_count_source:pageCountSource,status:'draft',hidden:true,visible:false,source_fingerprint:fp,normalized_title:normalizeTitle(b.title),normalized_author:normalizeAuthor(b.author),created_at:now,updated_at:now});
    if(!COMMIT){console.log(`DRY  ${b.ia} "${b.title}" (${pageCount}pp)`);imported++;continue;}
    await db.collection('books').insertOne(bookDoc);
    const CHUNK=500;for(let s=0;s<pageCount;s+=CHUNK){const docs=[];for(let k=0;k<CHUNK&&s+k<pageCount;k++){const i=s+k,pid=new ObjectId();docs.push(makePageDoc({_id:pid,id:pid.toHexString(),book_id:bookIdStr,page_number:i+1,photo:photo(i),thumbnail:thumb(i),photo_original:photo(i),created_at:now,updated_at:now}));}await db.collection('pages').insertMany(docs,{ordered:false});}
    console.log(`OK   ${b.ia} "${b.title}" (${pageCount}pp)`);imported++;
  }
  await client.close();console.log(`\n=== ${COMMIT?'COMMITTED':'DRY'} — imported:${imported} skipped:${skipped} failed:${failed} ===`);
}
main().catch(e=>{console.error(e);process.exit(1);});
