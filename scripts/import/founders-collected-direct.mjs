#!/usr/bin/env node
/**
 * Direct import (residential → Atlas) of the founding fathers' COLLECTED
 * multivolume works — the public-domain scholarly editions. Bypasses
 * /api/import/ia (Vercel→Atlas timeouts, 2026-07-05). Same doc shape as
 * founding-docs-direct.mjs. All original-language works → text_role:'original'.
 * Lands HIDDEN. Volume numbers are by id-sequence (approx where IA lacks a
 * volume field); refine later if needed. Washington uses Sparks (12v, v2 not
 * cleanly scanned in this edition); the complete Fitzpatrick set is 39v.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/founders-collected-direct.mjs --dry-run | --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
const COMMIT = process.argv.includes('--commit');

const SETS = [
  { author: 'John Adams', work: 'The Works of John Adams', pub: '1850', lang: 'English',
    ids: ['worksofjohnadams01adam','worksofjohnadams02adam','worksofjohnadams0003char','worksofjohnadams04adam','worksofjohnadams05adam','worksofjohnadams06adam','worksofjohnadams0007char','worksofjohnadams0008char','worksofjohnadams09adam','worksofjohnadams10adam'] },
  { author: 'Benjamin Franklin', work: 'The Writings of Benjamin Franklin (Smyth ed.)', pub: '1905', lang: 'English',
    ids: ['writingsofbenjam01franuoft','writingsofbenjam02franuoft','writingsofbenjam03franuoft','writingsofbenjam04franuoft','writingsofbenjam05franuoft','writingsofbenjam06franuoft','writingsofbenjam07franuoft','writingsofbenjam08franuoft','writingsofbenjam09franuoft','writingsofbenjam10franuoft'] },
  { author: 'Alexander Hamilton', work: 'The Works of Alexander Hamilton', pub: '1850', lang: 'English',
    ids: ['worksofalexander01hamirich','worksofalexander02hamirich','worksofalexander03hamirich','worksofalexander04hamirich','worksofalexander05hamirich','worksofalexander06hamirich','worksofalexander07hamirich'] },
  { author: 'Thomas Jefferson', work: 'The Works of Thomas Jefferson (Federal Edition, Ford)', pub: '1904', lang: 'English',
    ids: ['cu31924092892011','cu31924092892037','cu31924092892045','cu31924092892052','cu31924092892060','cu31924092892078','cu31924092892086','cu31924092892094','cu31924092892102'] },
  { author: 'James Madison', work: 'Letters and Other Writings of James Madison', pub: '1865', lang: 'English',
    ids: ['lettersandotherw01madiiala','lettersandotherw02madiiala','lettersandotherw03madiiala','lettersandotherw04madiiala'] },
  { author: 'George Washington', work: 'The Writings of George Washington (Sparks ed.)', pub: '1834', lang: 'English',
    ids: ['writingsofgeorge01wash','writingsofgeorge03wash','writingsofgeorge04wash','writingsofgeorge05wash','writingsofgeorge06wash','writingsofgeorge07wash','writingsofgeorgew08wash','writingsofgeorge09wash','writingsofgeorge10wash','writingsofgeorge11wash','writingsofgeorge12wash'] },
  { author: 'John Jay', work: 'The Life of John Jay, with Selections from his Correspondence and Miscellaneous Papers', pub: '1833', lang: 'English',
    ids: ['lifeofjohnjaywit01jaywuoft','lifeofjohnjaywit02jaywuoft'] },
  { author: 'Jonathan Edwards', work: 'The Works of President Edwards', pub: '1808', lang: 'English',
    ids: ['worksofpresident01edwa','worksofpresident02edwa','worksofpresident03edwa','worksofpresident04edwa','worksofpresident05edwa','worksofpresident06edwa','worksofpresident07edwa','worksofpresident08edwa'] },
];

const BOOKS = SETS.flatMap(s => s.ids.map((ia, i) => ({
  ia, title: `${s.work}, Vol. ${i + 1}`, author: s.author, language: s.lang, published: s.pub,
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
  for(const b of BOOKS){
    const fp=`ia:${b.ia}`;
    const existing=await db.collection('books').findOne({$or:[{ia_identifier:b.ia},{source_fingerprint:fp}]},{projection:{_id:1,slug:1}});
    if(existing){console.log(`SKIP  ${b.ia}`);skipped++;continue;}
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
