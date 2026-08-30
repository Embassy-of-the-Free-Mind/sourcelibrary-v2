#!/usr/bin/env node
/**
 * Direct import (residential → Atlas) of "influences on the American
 * founders" texts — the intellectual sources the founders read and cited
 * (Vattel, Burlamaqui, Hume's political essays, Milton's prose, Bolingbroke,
 * Plutarch's Lives, Hutcheson Vol II, Polybius in English) plus a second
 * batch of Lutz citation-ranking influences (De Lolme, Robertson) and two
 * founders' library catalogs (Jefferson, Washington) as primary reference
 * documents. Bypasses /api/import/ia (Vercel→Atlas timeouts, 2026-07-05).
 * Same doc shape as founders-collected-direct.mjs / founding-tail-direct.mjs.
 * All English editions → text_role:'original'. Lands HIDDEN.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/founding-influences2-direct.mjs --dry-run | --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
// normalizeTitle is now the ONE shared dedup-key implementation (#4444). The
// local normalizeAuthor below has DRIFTED from src/lib/dedup.ts — it is missing
// the `born|died|fl|circa|ca` date strip — and is left in place deliberately:
// swapping it would change this script's dedup keys. See #4444 for the plan.
import { normalizeTitle } from '../lib/dedup-normalize.mjs';
const COMMIT = process.argv.includes('--commit');

const SETS = [
  { author: 'Emer de Vattel', work: 'The Law of Nations (Le Droit des gens)', pub: '1787', lang: 'English',
    ids: ['bim_eighteenth-century_the-law-of-nations-or-_vattel-emer-de_1787'] },
  { author: 'Jean-Jacques Burlamaqui', work: 'The Principles of Natural and Politic Law', pub: '1763', lang: 'English',
    ids: ['principlesofnatu01burl','principlesofnatu02burl'] },
  { author: 'David Hume', work: 'Political Discourses', pub: '1752', lang: 'English',
    ids: ['bim_eighteenth-century_political-discourses-by_hume-david_1752'] },
  { author: 'John Milton', work: 'Areopagitica', pub: '1644', lang: 'English',
    ids: ['miltonareopagitica'] },
  { author: 'John Milton', work: 'The Tenure of Kings and Magistrates', pub: '1649', lang: 'English',
    ids: ['bim_early-english-books-1641-1700_the-tenure-of-kings-and-_milton-john_1649'] },
  { author: 'Henry St. John, Viscount Bolingbroke', work: 'The Idea of a Patriot King', pub: '1740', lang: 'English',
    ids: ['bim_eighteenth-century_the-idea-of-a-patriot-ki_bolingbroke-henry-st-j_1740'] },
  { author: 'Plutarch', work: "Plutarch's Lives (tr. from the Greek)", pub: '1769', lang: 'English',
    ids: ['plutarchslivesin01plutiala','plutarchslivesin02plutiala','plutarchslivesin03plutiala','plutarchslivesin04plutiala','plutarchslivesin05plutiala','plutarchslivesin06plutiala'] },
  { author: 'Francis Hutcheson', work: 'A System of Moral Philosophy, Vol. II', pub: '1755', lang: 'English',
    ids: ['bim_eighteenth-century_a-system-of-moral-philos_hutcheson-francis_1755_2'] },
  { author: 'Polybius', work: 'The History of Polybius, the Megalopolitan (tr. Sheeres/Dryden)', pub: '1698', lang: 'English',
    ids: ['historyofpolybiu01poly','historyofpolybiu02poly'] },
  // --- Lutz citation-ranking influences + founders' library catalogs (added post-review) ---
  { author: 'Jean Louis De Lolme', work: 'The Constitution of England', pub: '1775', lang: 'English',
    ids: ['constitutioneng07lolmgoog'] },
  { author: 'William Robertson', work: 'The History of America', pub: '1777', lang: 'English',
    ids: ['bim_eighteenth-century_the-history-of-america-_robertson-william_1777_1','bim_eighteenth-century_the-history-of-america-_robertson-william_1777_2'] },
  { author: 'William Robertson', work: 'The History of the Reign of the Emperor Charles V', pub: '1762', lang: 'English',
    ids: ['bim_eighteenth-century_the-history-of-the-reign_robertson-william_1762_1','bim_eighteenth-century_the-history-of-the-reign_robertson-william_1762_2'] },
];

// Single-item, single-title docs (no "Vol." suffix, no volume enumeration).
const SINGLES = [
  { ia: 'cataloguelibrar01goog', author: 'Thomas Jefferson',
    title: "Catalogue of the Library of the United States (Thomas Jefferson's Library, sold to Congress 1815)",
    lang: 'English', pub: '1815' },
  { ia: 'catalogueofwashi00bostuoft', author: 'Appleton P. C. Griffin (Boston Athenaeum)',
    title: 'A Catalogue of the Washington Collection in the Boston Athenaeum',
    lang: 'English', pub: '1897' },
];

const BOOKS = [
  ...SETS.flatMap(s => s.ids.length > 1
    ? s.ids.map((ia, i) => ({ ia, title: `${s.work}, Vol. ${i + 1}`, author: s.author, language: s.lang, published: s.pub }))
    : s.ids.map(ia => ({ ia, title: s.work, author: s.author, language: s.lang, published: s.pub }))),
  ...SINGLES.map(s => ({ ia: s.ia, title: s.title, author: s.author, language: s.lang, published: s.pub })),
];

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
main().catch(e=>{console.error(e);process.exit(1)});
