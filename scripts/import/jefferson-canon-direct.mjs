#!/usr/bin/env node
/**
 * Direct import (residential → Atlas) of Thomas Jefferson canon acquisitions —
 * on-mission titles from Jefferson's 1771 Skipwith recommended-library list
 * (TASK 1) and his actual 1815 library sold to the Library of Congress
 * (TASK 2 backfill). Bypasses /api/import/ia (Vercel→Atlas timeouts,
 * 2026-07-05). Same doc shape as founders-collected-direct.mjs. All
 * original-language works → text_role:'original'. Lands HIDDEN.
 * Off-mission Skipwith categories (practical agriculture/husbandry, cookery,
 * dictionaries/grammars, travel guides, medical recipe books, most Fine
 * Arts novels/poems/plays) were deliberately excluded — see report.
 * Multi-volume sets marked "partial" in comments are missing volumes IA
 * never scanned separately (noted honestly in the final report, not hidden).
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/jefferson-canon-direct.mjs --dry-run | --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
const COMMIT = process.argv.includes('--commit');

// ===== TASK 1: Skipwith 1771 list — on-mission gaps =====
const SETS = [
  { author: 'Henry Home, Lord Kames', work: 'Elements of Criticism', pub: '1869', lang: 'English',
    ids: ['elementscritici00boydgoog'] },
  { author: 'William Hogarth', work: 'The Analysis of Beauty', pub: '1753', lang: 'English',
    ids: ['bim_eighteenth-century_the-analysis-of-beauty-_hogarth-william_1753'] },
  { author: 'Montesquieu', work: "Considérations sur les causes de la grandeur des Romains et de leur décadence", pub: '1761', lang: 'French',
    ids: ['considerationss00montgoog'] },
  { author: 'Sir James Steuart', work: 'An Inquiry into the Principles of Political Oeconomy', pub: '1767', lang: 'English',
    ids: ['bim_eighteenth-century_an-inquiry-into-the-prin_steuart-james-sir_1767_1','bim_eighteenth-century_an-inquiry-into-the-prin_steuart-james-sir_1767_2'] },
  { author: 'Henry St. John, Viscount Bolingbroke', work: 'The Philosophical Works', pub: '1754', lang: 'English',
    ids: ['philosophicalwo00boligoog','philosophicalwo01boligoog','philosophicalwo02boligoog','philosophicalwo03boligoog','philosophicalwo04boligoog'] },
  { author: 'David Hume', work: 'Essays, Moral, Political, and Literary', pub: '1898', lang: 'English',
    ids: ['essaysmoral01humeuoft'] },
  { author: 'Henry Home, Lord Kames', work: 'Principles of Equity', pub: '1767', lang: 'English',
    ids: ['bim_eighteenth-century_principles-of-equity_kames-henry-home-lord_1767'] },
  { author: 'Laurence Sterne', work: 'The Sermons of Mr. Yorick', pub: '1760', lang: 'English',
    ids: ['sternesermons01'] },
  { author: 'William Sherlock', work: 'A Practical Discourse Concerning Death', pub: '1767', lang: 'English',
    ids: ['bim_eighteenth-century_a-practical-discourse-co_sherlock-william_1767'] },
  { author: 'William Sherlock', work: 'A Practical Discourse Concerning a Future Judgment', pub: '1749', lang: 'English',
    ids: ['practicaldiscour00sheruoft'] },
  // Rollin, Ancient History — partial: 3 of 10 vols (consistent scan set)
  { author: 'Charles Rollin', work: 'The Ancient History of the Egyptians, Carthaginians, Assyrians, Babylonians, Medes and Persians, Grecians and Macedonians', pub: '1795', lang: 'English',
    ids: ['ancienthistoryof01roll_0','ancienthistoryof02roll_0','ancienthistoryof03roll_0'] },
  { author: 'Temple Stanyan', work: 'The Grecian History', pub: '1774', lang: 'English',
    ids: ['bim_eighteenth-century_the-grecian-history-fro_stanyan-temple_1774_1','bim_eighteenth-century_the-grecian-history-fro_stanyan-temple_1774_2'] },
  { author: 'Abbé de Vertot', work: 'The History of the Revolutions that Happened in the Government of the Roman Republic', pub: '1721', lang: 'English',
    ids: ['bim_eighteenth-century_histoire-des-revolution_vertot-abbe-de_1721_1','bim_eighteenth-century_histoire-des-revolution_vertot-abbe-de_1721_2'] },
  // Bayle, Dictionary — partial: 2 of 10 vols
  { author: 'Pierre Bayle', work: 'A General Dictionary, Historical and Critical', pub: '1741', lang: 'English',
    ids: ['bim_eighteenth-century_a-general-dictionary-hi_bayle-pierre_1741_1','bim_eighteenth-century_a-general-dictionary-hi_bayle-pierre_1741_2'] },
  { author: 'Jacques-Bénigne Bossuet', work: "Discours sur l'histoire universelle", pub: '1771', lang: 'French',
    ids: ['discourssurlhis01boss'] },
  { author: 'Arrigo Caterino Davila', work: 'The History of the Civil Wars of France', pub: '1758', lang: 'English',
    ids: ['bim_eighteenth-century_the-history-of-the-civil_davila-arrigo-caterino_1758_1','bim_eighteenth-century_the-history-of-the-civil_davila-arrigo-caterino_1758_2'] },
  // Hume, History of England — partial: 7 of 8 vols (vol 1 not separately scanned in this ed.)
  { author: 'David Hume', work: 'The History of England, from the Invasion of Julius Caesar to the Revolution in 1688', pub: '1791', lang: 'English',
    ids: ['bim_eighteenth-century_the-history-of-england-_hume-david-the-histori_1791_2','bim_eighteenth-century_the-history-of-england-_hume-david-the-histori_1791_3','bim_eighteenth-century_the-history-of-england-_hume-david-the-histori_1791_4','bim_eighteenth-century_the-history-of-england-_hume-david-the-histori_1791_5','bim_eighteenth-century_the-history-of-england-_hume-david-the-histori_1791_6','bim_eighteenth-century_the-history-of-england-_hume-david-the-histori_1791_7','bim_eighteenth-century_the-history-of-england-_hume-david-the-histori_1791_8'] },
  // Clarendon — partial: 6 of 8 vols (vols 2, 6 not separately scanned in this ed.)
  { author: 'Edward Hyde, Earl of Clarendon', work: 'The History of the Rebellion and Civil Wars in England', pub: '1826', lang: 'English',
    ids: ['civilwarengland01claruoft','civilwarengland03claruoft','civilwarengland04claruoft','civilwarengland05claruoft','civilwarengland07claruoft','civilwarengland08claruoft'] },
  { author: 'William Robertson', work: 'The History of Scotland', pub: '1759', lang: 'English',
    ids: ['bim_eighteenth-century_the-history-of-scotland-_robertson-william_1759_1','bim_eighteenth-century_the-history-of-scotland-_robertson-william_1759_2'] },
  { author: 'Sir William Keith', work: 'The History of the British Plantations in America (Virginia)', pub: '1738', lang: 'English',
    ids: ['bim_eighteenth-century_the-history-of-the-briti_keith-sir-william-bart_1738'] },
  { author: 'William Stith', work: 'The History of the First Discovery and Settlement of Virginia', pub: '1747', lang: 'English',
    ids: ['bim_eighteenth-century_the-history-of-the-first_stith-william_1747'] },
  // Buffon, Natural History — partial: 2 of 9 vols
  { author: 'Georges-Louis Leclerc, Comte de Buffon', work: 'Natural History, General and Particular', pub: '1791', lang: 'English',
    ids: ['naturalhistoryg00smelgoog','bim_eighteenth-century_histoire-naturelle-eng_buffon-georges-louis-le_1791_5'] },
  { author: 'George Lyttelton', work: 'Dialogues of the Dead', pub: '1768', lang: 'English',
    ids: ['bim_eighteenth-century_dialogues-of-the-dead_lyttelton-george-lyttel_1768'] },
  { author: 'François Fénelon', work: 'Dialogues des morts anciens et modernes', pub: '1809', lang: 'French',
    ids: ['dialoguesdesmor00unkngoog'] },
  { author: 'John Locke', work: 'Some Thoughts Concerning Education', pub: '1712', lang: 'English',
    ids: ['somethoughtscon01lockgoog'] },
  { author: 'John Locke', work: 'A Treatise on the Conduct of the Understanding', pub: '1851', lang: 'English',
    ids: ['treatiseonconduc00loc'] },

  // ===== TASK 2: 1815 library (Sowerby catalog) — on-mission backfill, capped ~50 =====
  // Gibbon — partial: 3 of ~12 vols (this 1821 scan set only has vols 4, 5, 7)
  { author: 'Edward Gibbon', work: 'The History of the Decline and Fall of the Roman Empire', pub: '1821', lang: 'English',
    ids: ['historyofthedecl04gibbiala','historyofthedecl05gibbiala','historyofthedecl07gibbiala'] },
  { author: 'Johann Lorenz von Mosheim', work: 'An Ecclesiastical History, Ancient and Modern', pub: '1819', lang: 'English',
    ids: ['mosheimsecclesia01moshuoft','mosheimsecclesia02moshuoft','mosheimsecclesia03moshuoft','mosheimsecclesia04moshuoft','mosheimsecclesia05moshuoft','mosheimsecclesia06moshuoft'] },
  { author: 'Thomas Rutherforth', work: 'Institutes of Natural Law', pub: '1779', lang: 'English',
    ids: ['bim_eighteenth-century_institutes-of-natural-la_rutherforth-t-thomas_1779_1','bim_eighteenth-century_institutes-of-natural-la_rutherforth-t-thomas_1779_2'] },
  { author: 'Johann Gottlieb Heineccius', work: 'A Methodical System of Universal Law', pub: '1763', lang: 'English',
    ids: ['bim_eighteenth-century_a-methodical-system-of-u_heineccius-johann-gottl_1763_1','bim_eighteenth-century_a-methodical-system-of-u_heineccius-johann-gottl_1763_2'] },
  { author: 'Robert Beverley', work: 'The History and Present State of Virginia', pub: '1705', lang: 'English',
    ids: ['bim_eighteenth-century_the-history-and-present-_beverley-robert_1705'] },
  { author: 'John Millar', work: 'An Historical View of the English Government', pub: '1790', lang: 'English',
    ids: ['viewofenglishgov00mill'] },
  { author: 'Gaetano Filangieri', work: 'The Science of Legislation', pub: '1791', lang: 'English',
    ids: ['bim_eighteenth-century_the-science-of-legislati_filangieri-gaetano_1791'] },
  { author: 'William Enfield', work: 'The History of Philosophy, from the Earliest Times to the Beginning of the Present Century', pub: '1791', lang: 'English',
    ids: ['b28771734_0001','b28771734_0002'] },
  { author: 'Joseph Priestley', work: 'An History of the Corruptions of Christianity', pub: '1838', lang: 'English',
    ids: ['historyofcorrupt00prie'] },
  { author: 'Joseph Priestley', work: 'An Essay on the First Principles of Government', pub: '1771', lang: 'English',
    ids: ['essayonfirstprin00prie'] },
  { author: 'Conyers Middleton', work: 'The History of the Life of Marcus Tullius Cicero', pub: '1741', lang: 'English',
    ids: ['bim_eighteenth-century_the-history-of-the-life-_middleton-conyers_1741_1','bim_eighteenth-century_the-history-of-the-life-_middleton-conyers_1741_2'] },
  { author: 'William Paley', work: 'The Principles of Moral and Political Philosophy', pub: '1786', lang: 'English',
    ids: ['bim_eighteenth-century_the-principles-of-moral-_paley-william_1786'] },
];

const BOOKS = SETS.flatMap(s => s.ids.map((ia, i) => ({
  ia, title: s.ids.length > 1 ? `${s.work}, Vol. ${i + 1}` : s.work, author: s.author, language: s.lang, published: s.pub,
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
