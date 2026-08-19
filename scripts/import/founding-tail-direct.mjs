#!/usr/bin/env node
/**
 * Direct import (residential → Atlas) of the remaining "American founding"
 * TAIL items — Washington's complete Fitzpatrick edition, the missing
 * Jefferson Federal Edition volumes, Anti-Federalist source collections, and
 * Elliot's Debates. Bypasses /api/import/ia (Vercel→Atlas timeouts,
 * 2026-07-05). Same doc shape as founders-collected-direct.mjs. All original-
 * language works → text_role:'original'. Lands HIDDEN.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/founding-tail-direct.mjs --dry-run | --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
const COMMIT = process.argv.includes('--commit');

const SETS = [
  { author: 'George Washington', work: 'The Writings of George Washington (Fitzpatrick ed.)', pub: '1931', lang: 'English',
    ids: ['writingsofgeorge001wash','writingsofgeorge002wash','writingsofgeorge003wash','writingsofgeorge004wash','writingsofgeorge005wash','writingsofgeorge006wash','writingsofgeorge007wash','writingsofgeorge008wash','writingsofgeorge009wash','writingsofgeorge010wash','writingsofgeorge011wash','writingsofgeorge012wash','writingsofgeorge13wash','writingsofgeorge14wash','writingsofgeorge15wash','writingsofgeorge16wash','writingsofgeorge17wash','writingsofgeorge18wash','writingsofgeorge19wash','writingsofgeorge20wash','writingsofgeorge21wash','writingsofgeorge22wash','writingsofgeorge23wash','writingsofgeorge24wash','writingsofgeorge25wash','writingsofgeorge26wash','writingsofgeorge27wash','writingsofgeorge28wash','writingsofgeorge29wash','writingsofgeorge30wash','writingsofgeorge31wash','writingsofgeorge32wash','writingsofgeorge33wash','writingsofgeorge34wash','writingsofgeorge35wash','writingsofgeorge36wash','writingsofgeorge37wash','writingsofgeorge38wash','writingsofgeorge39wash'] },
  { author: 'Thomas Jefferson', work: 'The Works of Thomas Jefferson (Federal Edition, Ford)', pub: '1905', lang: 'English',
    ids: ['worksthomasjeff07fordgoog','worksthomasjeff00fordgoog','worksthomasjeff02fordgoog'],
    titles: ['The Works of Thomas Jefferson (Federal Edition, Ford), Vol. 10','The Works of Thomas Jefferson (Federal Edition, Ford), Vol. 11','The Works of Thomas Jefferson (Federal Edition, Ford), Vol. 12'] },
  { author: 'Jonathan Elliot (ed.)', work: 'The Debates in the Several State Conventions on the Adoption of the Federal Constitution', pub: '1888', lang: 'English',
    ids: ['debatesinseveral01elli','debatesinseveral02elli','debatesinseveral03elli','debatesinseveral04elli','debatesinseveral05elli'] },
  { author: 'Various (ed. Paul Leicester Ford)', work: 'Pamphlets on the Constitution of the United States', pub: '1888', lang: 'English',
    ids: ['pamphletsonconst00forduoft'], titles: ['Pamphlets on the Constitution of the United States, Published During Its Discussion by the People, 1787-1788'] },
  { author: 'Various (ed. Paul Leicester Ford)', work: 'Essays on the Constitution of the United States', pub: '1892', lang: 'English',
    ids: ['essaysonconstitu00forduoft'], titles: ['Essays on the Constitution of the United States, Published During Its Discussion by the People, 1787-1788'] },
  { author: 'Samuel Johnson', work: 'Early American Philosophy — Samuel Johnson', pub: 'various', lang: 'English',
    ids: ['elementaphiloso00johngoog','bim_eighteenth-century_ethices-elementa_johnson-samuel-dd-_1746','elementsofphilos00john'],
    titles: [
      'Elementa Philosophica: Containing Chiefly Noetica, or Things Relating to the Mind or Understanding; and Ethica, or Things Relating to the Moral Behaviour',
      'Ethices Elementa, or the First Principles of Moral Philosophy',
      'The Elements of Philosophy',
    ],
    published: ['1752','1746','1754'] },
];

const BOOKS = SETS.flatMap(s => s.ids.map((ia, i) => ({
  ia, title: s.titles ? s.titles[i] : `${s.work}, Vol. ${i + 1}`, author: s.author, language: s.lang,
  published: Array.isArray(s.published) ? s.published[i] : s.pub,
})));

function normalizeTitle(t){return t.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|gli|i|el|los|las)\s+/i,'').replace(/\s*[\(\[:]?\s*(vol\.?\s*\d+|tomus?\s*\d+|part\.?\s*\d+|band\s*\d+|tome?\s*\d+)[\)\]]?\s*$/i,'').replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();}
function normalizeAuthor(a){const c=a.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\b(dr|prof|rev|saint|st|sir|fr|bp)\b\.?\s*/g,'').replace(/\s*\([\d\s\-–,?.]+\)\s*/g,'').replace(/,\s*[\d\s\-–?.]+$/,'').replace(/[\[\]]/g,'').replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();return c.split(' ').filter(w=>w.length>0).sort().join(' ');}
function slugify(t,m=70){return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').substring(0,m).replace(/-$/,'');}
async function uniqueSlug(db,base){let s=base,i=2;while(await db.collection('books').findOne({slug:s},{projection:{_id:1}}))s=`${base}-${i++}`;return s;}
async function pageCountFor(ia,metadata){
  try{const r=await fetch(`https://iiif.archive.org/iiif/${ia}/manifest.json`,{signal:AbortSignal.timeout(20000)});if(r.ok){const m=await r.json();if(Array.isArray(m.items))return{n:m.items.length,src:'iiif_v3'};if(m.sequences?.[0]?.canvases)return{n:m.sequences[0].canvases.length,src:'iiif_v2'};}}catch{}
  const meta=metadata.metadata||{};if(meta.imagecount)return{n:parseInt(meta.imagecount,10),src:'imagecount'};
  const jp2=(metadata.files||[]).filter(f=>f.name.endsWith('.jp2')&&!f.name.includes('thumb'));if(jp2.length>1)return{n:jp2.length,src:'jp2_files'};return{n:0,src:'none'};
}
async function main(){
  if(!process.env.MONGODB_URI){console.error('MONGODB_URI missing');process.exit(1);}
  const client=new MongoClient(process.env.MONGODB_URI,{maxPoolSize:3});await client.connect();const db=client.db('bookstore');
  let imported=0,skipped=0,failed=0;const fails=[];
  // Prefetch already-held ids in ONE batch pass (ia_identifier is unindexed; a
  // per-item $or does a full collection scan each ~27s). One $in scan instead.
  const allIas=BOOKS.map(b=>b.ia);const allFps=allIas.map(ia=>`ia:${ia}`);
  const held=new Set();
  for(const d of await db.collection('books').find({$or:[{ia_identifier:{$in:allIas}},{source_fingerprint:{$in:allFps}}]},{projection:{ia_identifier:1,source_fingerprint:1}}).toArray()){
    if(d.ia_identifier)held.add(d.ia_identifier);if(d.source_fingerprint)held.add(d.source_fingerprint);
  }
  for(const b of BOOKS){
    const fp=`ia:${b.ia}`;
    if(held.has(b.ia)||held.has(fp)){console.log(`SKIP  ${b.ia}`);skipped++;continue;}
    let metadata;
    try{const mr=await fetch(`https://archive.org/metadata/${b.ia}`,{signal:AbortSignal.timeout(20000)});if(!mr.ok){console.log(`FAIL  ${b.ia} — metadata ${mr.status}`);failed++;fails.push(b.ia);continue;}metadata=await mr.json();}
    catch(e){console.log(`FAIL  ${b.ia} — ${e}`);failed++;fails.push(b.ia);continue;}
    const meta=metadata.metadata||{};
    const restricted=meta['access-restricted-item']==='true'||meta['access-restricted-item']===true;
    const {n:pageCount,src:pageCountSource}=await pageCountFor(b.ia,metadata);
    if(!pageCount){console.log(`FAIL  ${b.ia} — no page count`);failed++;fails.push(b.ia);continue;}
    const stripText=s=>String(s).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
    const firstOf=v=>{const raw=Array.isArray(v)?(typeof v[0]==='string'?v[0]:null):(typeof v==='string'?v:null);return raw?stripText(raw)||null:null;};
    const arrOf=v=>{const raw=Array.isArray(v)?v.filter(x=>typeof x==='string'):(typeof v==='string'?[v]:[]);return raw.map(stripText).filter(Boolean);};
    const iaCatalog={source:'internet_archive',identifier:b.ia,ark:meta['identifier-ark']||null,mediatype:meta.mediatype||null,collections:arrOf(meta.collection),access_restricted:restricted,publisher:firstOf(meta.publisher),place:firstOf(meta.publishplace)||firstOf(meta.place),creator:firstOf(meta.creator),description:firstOf(meta.description),subjects:arrOf(meta.subject),oclc_id:firstOf(meta['oclc-id']),lccn:firstOf(meta.lccn),date_iso:firstOf(meta.date),scan_date:firstOf(meta.scandate),scraped_at:new Date().toISOString()};
    for(const k of Object.keys(iaCatalog)){const v=iaCatalog[k];if(v===null||v===undefined||(Array.isArray(v)&&v.length===0))delete iaCatalog[k];}
    const licenseUrl=meta.licenseurl||meta.license||null,rights=meta.rights||meta.possible_copyright_status||null;
    const contributor=typeof meta.contributor==='string'?stripText(meta.contributor):null,sponsor=typeof meta.sponsor==='string'?stripText(meta.sponsor):null;
    const bookId=new ObjectId(),bookIdStr=bookId.toHexString();
    const slug=await uniqueSlug(db,slugify(`${b.title} ${b.author}`));const now=new Date();
    const photo=i=>`https://archive.org/download/${b.ia}/page/n${i}/full/full/0/default.jpg`;
    const thumb=i=>`https://archive.org/download/${b.ia}/page/n${i}/full/pct:15/0/default.jpg`;
    const bookDoc=makeBookDoc({_id:bookId,id:bookIdStr,slug,title:b.title,display_title:null,author:b.author,language:b.language,published:b.published,field_provenance:{language:'caller'},categories:['History','Political Philosophy'],ia_identifier:b.ia,thumbnail:thumb(0),pages_count:pageCount,pages_ocr:0,pages_translated:0,content_type:'book',text_role:'original',
      dublin_core:{dc_identifier:[`IA:${b.ia}`,...(iaCatalog.ark?[String(iaCatalog.ark)]:[]),...(iaCatalog.oclc_id?[`OCLC:${iaCatalog.oclc_id}`]:[]),...(iaCatalog.lccn?[`LCCN:${iaCatalog.lccn}`]:[])],dc_source:`https://archive.org/details/${b.ia}`,...(iaCatalog.publisher?{dc_publisher:iaCatalog.publisher}:{}),...(iaCatalog.description?{dc_description:iaCatalog.description}:{}),...(iaCatalog.subjects?.length?{dc_subject:iaCatalog.subjects}:{})},
      catalog_metadata:iaCatalog,...(iaCatalog.place?{place_published:String(iaCatalog.place)}:{}),...(iaCatalog.publisher?{publisher:String(iaCatalog.publisher)}:{}),
      image_source:{provider:'internet_archive',provider_name:'Internet Archive',source_url:`https://archive.org/details/${b.ia}`,identifier:b.ia,license:licenseUrl||'publicdomain',license_url:licenseUrl,rights,...(contributor?{contributing_library:contributor}:{}),...(sponsor?{sponsor}:{}),access_date:now},
      page_count_source:pageCountSource,status:'draft',hidden:true,visible:false,source_fingerprint:fp,normalized_title:normalizeTitle(b.title),normalized_author:normalizeAuthor(b.author),created_at:now,updated_at:now});
    if(!COMMIT){console.log(`DRY   ${b.ia} — "${b.title}" (${pageCount}pp)`);imported++;continue;}
    await db.collection('books').insertOne(bookDoc);
    const CHUNK=500;for(let s=0;s<pageCount;s+=CHUNK){const docs=[];for(let k=0;k<CHUNK&&s+k<pageCount;k++){const i=s+k,pid=new ObjectId();docs.push(makePageDoc({_id:pid,id:pid.toHexString(),book_id:bookIdStr,page_number:i+1,photo:photo(i),thumbnail:thumb(i),photo_original:photo(i),created_at:now,updated_at:now}));}await db.collection('pages').insertMany(docs,{ordered:false});}
    console.log(`OK    ${b.ia} → "${b.title}" (${pageCount}pp)`);imported++;
  }
  await client.close();
  console.log(`\n=== ${COMMIT?'COMMITTED':'DRY-RUN'} — imported:${imported} skipped:${skipped} failed:${failed} ${fails.length?'['+fails.join(', ')+']':''} ===`);
}
main().catch(e=>{console.error(e);process.exit(1);});
