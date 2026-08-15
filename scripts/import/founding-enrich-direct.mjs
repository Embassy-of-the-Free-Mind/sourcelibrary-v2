#!/usr/bin/env node
/**
 * Direct import (residential → Atlas) of "american-founding" collection
 * ENRICHMENT — contemporary political influences (commonwealthmen/radical-
 * Whig, American pamphlets/sermons, Continental sources) plus original-
 * language editions of works we hold only in English translation (Vattel FR,
 * Burlamaqui FR, Pufendorf LA). Bypasses /api/import/ia (Vercel→Atlas
 * timeouts, 2026-07-05). Same doc shape as founders-collected-direct.mjs /
 * founding-influences2-direct.mjs. Lands HIDDEN, zero Gemini.
 *
 * text_role is set PER BOOK (not blanket 'original' — that was a prior bug):
 *   - English-native works (British/American authors writing in English) → 'original'
 *   - Non-English originals (French/Latin/Greek) → 'original'
 *   - English translations of a foreign work → 'modern-translation' (or
 *     'period-translation' if the TRANSLATED EDITION itself is pre-1700),
 *     with original_language + is_translation:true set.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/founding-enrich-direct.mjs --dry-run | --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
const COMMIT = process.argv.includes('--commit');
const COLLECTION_TAG = 'american-founding';

// Multi-volume sets — auto "Vol. N" titles.
const SETS = [
  { author: 'James Burgh', work: 'Political Disquisitions: or, An Enquiry into Public Errors, Defects, and Abuses', pub: '1774', lang: 'English', role: 'original',
    ids: ['politicaldisquis01burg', 'politicaldisquis02burg', 'politicaldisquis03burg'] },
  { author: 'Catharine Macaulay', work: 'The History of England from the Accession of James I to the Elevation of the House of Hanover', pub: '1769', lang: 'English', role: 'original',
    ids: ['historyofengland001maca', 'historyofengland002maca'] },
  { author: 'John Trenchard & Thomas Gordon', work: 'The Independent Whig', pub: '1732', lang: 'English', role: 'original',
    ids: ['independentwhigo01tren', 'independentwhigo02tren'] },
  { author: 'Abbé Raynal (tr. J. Justamond)', work: 'A Philosophical and Political History of the Settlements and Trade of the Europeans in the East and West Indies', pub: '1777', lang: 'English', role: 'modern-translation', originalLanguage: 'French', isTranslation: true,
    ids: ['philosophicalpol01rayn_1', 'philosophicalpol02rayniala', 'philosophicalpol03rayn_1'] },
  // Carnegie Endowment "Classics of International Law" facsimile (1916): Vols 1-2
  // are photoreproductions of Books I-IV of the actual 1758 French edition (Vol 3,
  // the Fenwick English translation, is skipped — we already hold an English
  // translation of this work). This is the ORIGINAL-LANGUAGE acquisition (Part B).
  { author: 'Emer de Vattel', work: 'Le Droit des gens, ou Principes de la loi naturelle (facsimile reproduction of the 1758 edition)', pub: '1758', lang: 'French', role: 'original',
    ids: ['ledroitdesgensou01vattuoft', 'ledroitdesgensou02vattuoft'] },
];

// Single-item, single-title docs.
const SINGLES = [
  { ia: 'observationsonn00pricgoog', author: 'Richard Price',
    title: 'Observations on the Nature of Civil Liberty, the Principles of Government, and the Justice and Policy of the War with America',
    lang: 'English', pub: '1776', role: 'original' },
  { ia: 'adiscourseonlov00pricgoog', author: 'Richard Price',
    title: 'A Discourse on the Love of Our Country',
    lang: 'English', pub: '1790', role: 'original' },
  { ia: 'observationsonre00macauoft', author: 'Catharine Macaulay',
    title: "Observations on the Reflections of the Right Hon. Edmund Burke on the Revolution in France",
    lang: 'English', pub: '1791', role: 'original' },
  { ia: 'bim_eighteenth-century_the-excellencie-of-a-fre_nedham-marchamont_1767', author: 'Marchamont Nedham',
    title: 'The Excellencie of a Free State',
    lang: 'English', pub: '1767', role: 'original' },
  { ia: 'bim_early-english-books-1641-1700_an-account-of-denmark-_molesworth-robert-moles_1694', author: 'Robert Molesworth',
    title: 'An Account of Denmark, as It Was in the Year 1692',
    lang: 'English', pub: '1694', role: 'original' },
  { ia: 'politicalworksa00fletgoog', author: 'Andrew Fletcher of Saltoun',
    title: 'The Political Works of Andrew Fletcher, Esq. of Saltoun',
    lang: 'English', pub: '1732', role: 'original' },
  { ia: 'discourseconcer00mayh', author: 'Jonathan Mayhew',
    title: 'A Discourse Concerning Unlimited Submission and Non-Resistance to the Higher Powers',
    lang: 'English', pub: '1750', role: 'original' },
  { ia: 'bim_eighteenth-century_a-vindication-of-the-gov_wise-john-pastor-to-a-_1772', author: 'John Wise',
    title: 'A Vindication of the Government of New-England Churches',
    lang: 'English', pub: '1772', role: 'original' },
  { ia: 'considerationso00dulagoog', author: 'Daniel Dulany',
    title: 'Considerations on the Propriety of Imposing Taxes in the British Colonies, for the Purpose of Raising a Revenue, by Act of Parliament',
    lang: 'English', pub: '1765', role: 'original' },
  { ia: 'inquirytotherights00blanrich', author: 'Richard Bland',
    title: 'An Inquiry into the Rights of the British Colonies',
    lang: 'English', pub: '1766', role: 'original' },
  { ia: 'bim_eighteenth-century_considerations-on-the-na_wilson-james_1774', author: 'James Wilson',
    title: 'Considerations on the Nature and the Extent of the Legislative Authority of the British Parliament',
    lang: 'English', pub: '1774', role: 'original' },
  { ia: 'bim_eighteenth-century_sketches-of-american-pol_webster-noah-lld_1785', author: 'Noah Webster',
    title: 'Sketches of American Policy',
    lang: 'English', pub: '1785', role: 'original' },
  { ia: 'advicetoprivileg00barl_0', author: 'Joel Barlow',
    title: 'Advice to the Privileged Orders in the Several States of Europe, Part I',
    lang: 'English', pub: '1792', role: 'original' },
  { ia: 'bim_eighteenth-century_observations-on-the-gove_mably-abb-de_1784', author: 'Abbé de Mably (tr.)',
    title: 'Observations on the Government and Laws of the United States of America',
    lang: 'English', pub: '1784', role: 'modern-translation', originalLanguage: 'French', isTranslation: true },
  { ia: 'bim_early-english-books-1641-1700_patriarcha-or-the-natu_filmer-sir-robert_1680', author: 'Robert Filmer',
    title: 'Patriarcha: or, the Natural Power of Kings',
    lang: 'English', pub: '1680', role: 'original' },
  { ia: 'worksofthatlearn03hook', author: 'Richard Hooker',
    title: "The Works of That Learned and Judicious Divine Mr. Richard Hooker, Containing Eight Books of the Laws of Ecclesiastical Polity, and Several Other Treatises",
    lang: 'English', pub: '1793', role: 'original' },
  // --- Part B: original-language editions of works held only in English translation ---
  { ia: 'principesdudroit01burluoft', author: 'Jean-Jacques Burlamaqui',
    title: 'Principes du droit naturel et politique',
    lang: 'French', pub: '1764', role: 'original' },
  { ia: 'samuelispufendor1672pufe', author: 'Samuel von Pufendorf',
    title: 'Samuelis Pufendorfii De Jure Naturae et Gentium Libri Octo',
    lang: 'Latin', pub: '1672', role: 'original' },
];

const BOOKS = [
  ...SETS.flatMap(s => s.ids.map((ia, i) => ({
    ia, title: `${s.work}, Vol. ${i + 1}`, author: s.author, language: s.lang,
    published: s.pub, role: s.role, originalLanguage: s.originalLanguage, isTranslation: s.isTranslation,
  }))),
  ...SINGLES.map(s => ({
    ia: s.ia, title: s.title, author: s.author, language: s.lang,
    published: s.pub, role: s.role, originalLanguage: s.originalLanguage, isTranslation: s.isTranslation,
  })),
];

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
    if(existing){console.log(`SKIP  ${b.ia} — "${b.title}" (already held)`);skipped++;continue;}
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
    const bookDoc=makeBookDoc({_id:bookId,id:bookIdStr,slug,title:b.title,display_title:null,author:b.author,language:b.language,published:b.published,field_provenance:{language:'caller'},categories:['History','Political Philosophy'],ia_identifier:b.ia,thumbnail:thumb(0),pages_count:pageCount,pages_ocr:0,pages_translated:0,content_type:'book',text_role:b.role,
      ...(b.isTranslation?{is_translation:true,original_language:b.originalLanguage}:{}),
      collections:[COLLECTION_TAG],
      dublin_core:{dc_identifier:[`IA:${b.ia}`,...(iaCatalog.ark?[String(iaCatalog.ark)]:[]),...(iaCatalog.oclc_id?[`OCLC:${iaCatalog.oclc_id}`]:[]),...(iaCatalog.lccn?[`LCCN:${iaCatalog.lccn}`]:[])],dc_source:`https://archive.org/details/${b.ia}`,...(iaCatalog.publisher?{dc_publisher:iaCatalog.publisher}:{}),...(iaCatalog.description?{dc_description:iaCatalog.description}:{}),...(iaCatalog.subjects?.length?{dc_subject:iaCatalog.subjects}:{})},
      catalog_metadata:iaCatalog,...(iaCatalog.place?{place_published:String(iaCatalog.place)}:{}),...(iaCatalog.publisher?{publisher:String(iaCatalog.publisher)}:{}),
      image_source:{provider:'internet_archive',provider_name:'Internet Archive',source_url:`https://archive.org/details/${b.ia}`,identifier:b.ia,license:licenseUrl||'publicdomain',license_url:licenseUrl,rights,...(contributor?{contributing_library:contributor}:{}),...(sponsor?{sponsor}:{}),access_date:now},
      page_count_source:pageCountSource,status:'draft',hidden:true,visible:false,source_fingerprint:fp,normalized_title:normalizeTitle(b.title),normalized_author:normalizeAuthor(b.author),created_at:now,updated_at:now});
    if(!COMMIT){console.log(`DRY   ${b.ia} — "${b.title}" (${pageCount}pp, ${pageCountSource}, role:${b.role}${b.isTranslation?'→'+b.originalLanguage:''})`);imported++;continue;}
    await db.collection('books').insertOne(bookDoc);
    const CHUNK=500;for(let s=0;s<pageCount;s+=CHUNK){const docs=[];for(let k=0;k<CHUNK&&s+k<pageCount;k++){const i=s+k,pid=new ObjectId();docs.push(makePageDoc({_id:pid,id:pid.toHexString(),book_id:bookIdStr,page_number:i+1,photo:photo(i),thumbnail:thumb(i),photo_original:photo(i),created_at:now,updated_at:now}));}await db.collection('pages').insertMany(docs,{ordered:false});}
    console.log(`OK    ${b.ia} → "${b.title}" (${pageCount}pp, role:${b.role})`);imported++;
  }
  await client.close();
  console.log(`\n=== ${COMMIT?'COMMITTED':'DRY-RUN'} — imported:${imported} skipped:${skipped} failed:${failed} ${fails.length?'['+fails.join(', ')+']':''} ===`);
}
main().catch(e=>{console.error(e);process.exit(1);});
