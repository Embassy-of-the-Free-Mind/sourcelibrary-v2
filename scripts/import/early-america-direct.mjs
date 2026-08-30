#!/usr/bin/env node
/**
 * Direct import (residential → Atlas) of the American founding intellectual arc:
 * document gaps, founding fathers' works, early American philosophy, and the
 * influences the founders drew on. Bypasses /api/import/ia (Vercel→Atlas
 * timeouts, 2026-07-05). Same doc shape as founding-docs-direct.mjs / the route.
 * All items are original-language works → text_role:'original'. Lands HIDDEN.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/early-america-direct.mjs --dry-run | --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
const COMMIT = process.argv.includes('--commit');

const BOOKS = [
  // --- Document gaps ---
  { ia: 'declarationofind00unit_2', title: 'The Declaration of Independence, and the Constitution of the United States of America', author: 'United States', language: 'English', published: '1796' },
  { ia: 'constitutionfran00fran', title: "Constitution française présentée au roi par l'Assemblée nationale (avec la Déclaration des droits de l'homme et du citoyen, 1789)", author: 'Assemblée nationale constituante', language: 'French', published: '1791' },
  // --- Founding fathers: standalone works ---
  { ia: 'lifeofbenjaminfr00franiala', title: 'The Autobiography of Benjamin Franklin', author: 'Benjamin Franklin', language: 'English', published: '1840' },
  { ia: 'defenceofconstit00adam_0', title: 'A Defence of the Constitutions of Government of the United States of America, Vol. 1', author: 'John Adams', language: 'English', published: '1787' },
  { ia: 'defenceofconstit02adam', title: 'A Defence of the Constitutions of Government of the United States of America, Vol. 2', author: 'John Adams', language: 'English', published: '1787' },
  { ia: 'defenceofconstit003adam', title: 'A Defence of the Constitutions of Government of the United States of America, Vol. 3', author: 'John Adams', language: 'English', published: '1787' },
  { ia: 'washingtonsfarew01wash', title: "Washington's Farewell Address to the People of the United States", author: 'George Washington', language: 'English', published: '1810' },
  { ia: 'lettersfromfarme00dick_1', title: 'Letters from a Farmer in Pennsylvania to the Inhabitants of the British Colonies', author: 'John Dickinson', language: 'English', published: '1768' },
  { ia: 'rightsofbritishc00otis', title: 'The Rights of the British Colonies Asserted and Proved', author: 'James Otis', language: 'English', published: '1764' },
  { ia: 'bim_eighteenth-century_rights-of-man-part-the-_paine-thomas_1792', title: 'Rights of Man, Part the Second: Combining Principle and Practice', author: 'Thomas Paine', language: 'English', published: '1792' },
  // --- Early American philosophy ---
  { ia: 'carefulstrictinq1804edwa', title: 'A Careful and Strict Inquiry into the Modern Prevailing Notions of the Freedom of the Will', author: 'Jonathan Edwards', language: 'English', published: '1804' },
  { ia: 'treatiseconcerni1746edwa', title: 'A Treatise Concerning Religious Affections', author: 'Jonathan Edwards', language: 'English', published: '1746' },
  { ia: 'bloudytenentofpe00will_0', title: 'The Bloudy Tenent of Persecution, for Cause of Conscience', author: 'Roger Williams', language: 'English', published: '1644' },
  { ia: 'journaloflifegos00wooliala', title: 'A Journal of the Life, Gospel Labours, and Christian Experiences of John Woolman', author: 'John Woolman', language: 'English', published: '1774' },
  { ia: 'bim_eighteenth-century_the-principles-of-action_colden-cadwallader_1751', title: 'The Principles of Action in Matter', author: 'Cadwallader Colden', language: 'English', published: '1751' },
  { ia: 'christianphiloso00math', title: 'The Christian Philosopher: A Collection of the Best Discoveries in Nature', author: 'Cotton Mather', language: 'English', published: '1721' },
  // --- Influences on the founders ---
  { ia: 'twotreatisesofgo00lock_1', title: 'Two Treatises of Government', author: 'John Locke', language: 'English', published: '1690' },
  { ia: 'essayconcerningh01lock_2', title: 'An Essay Concerning Human Understanding, Vol. 1', author: 'John Locke', language: 'English', published: '1710' },
  { ia: 'essayconcerningh02lock_0', title: 'An Essay Concerning Human Understanding, Vol. 2', author: 'John Locke', language: 'English', published: '1710' },
  { ia: 'nby_540263', title: 'A Letter Concerning Toleration', author: 'John Locke', language: 'English', published: '1689' },
  { ia: 'lawsofenglandc01blacuoft', title: 'Commentaries on the Laws of England, Vol. 1', author: 'William Blackstone', language: 'English', published: '1765' },
  { ia: 'lawsofenglandc02blacuoft', title: 'Commentaries on the Laws of England, Vol. 2', author: 'William Blackstone', language: 'English', published: '1766' },
  { ia: 'lawsofenglandc03blacuoft', title: 'Commentaries on the Laws of England, Vol. 3', author: 'William Blackstone', language: 'English', published: '1768' },
  { ia: 'lawsofenglandc04blacuoft', title: 'Commentaries on the Laws of England, Vol. 4', author: 'William Blackstone', language: 'English', published: '1769' },
  { ia: 'discoursesconcer00sidnuoft', title: 'Discourses Concerning Government', author: 'Algernon Sidney', language: 'English', published: '1704' },
  { ia: 'commonwealthof00harr', title: 'The Commonwealth of Oceana', author: 'James Harrington', language: 'English', published: '1656' },
  { ia: 'bim_eighteenth-century_catos-letters-_trenchard-john_1723_1', title: 'Cato\'s Letters, or Essays on Liberty, Civil and Religious, Vol. 1', author: 'John Trenchard & Thomas Gordon', language: 'English', published: '1723' },
  { ia: 'bim_eighteenth-century_catos-letters-_trenchard-john_1723_2', title: 'Cato\'s Letters, or Essays on Liberty, Civil and Religious, Vol. 2', author: 'John Trenchard & Thomas Gordon', language: 'English', published: '1723' },
  { ia: 'bim_eighteenth-century_catos-letters-_trenchard-john_1723_3', title: 'Cato\'s Letters, or Essays on Liberty, Civil and Religious, Vol. 3', author: 'John Trenchard & Thomas Gordon', language: 'English', published: '1723' },
  { ia: 'bim_eighteenth-century_catos-letters-_trenchard-john_1723_4', title: 'Cato\'s Letters, or Essays on Liberty, Civil and Religious, Vol. 4', author: 'John Trenchard & Thomas Gordon', language: 'English', published: '1723' },
  { ia: 'leviathanormatte00hobb_3', title: 'Leviathan, or the Matter, Forme, and Power of a Common-Wealth Ecclesiasticall and Civil', author: 'Thomas Hobbes', language: 'English', published: '1651' },
  { ia: 'oflawofnaturenat00pufe', title: 'Of the Law of Nature and Nations, Eight Books', author: 'Samuel von Pufendorf', language: 'English', published: '1729' },
];

function normalizeTitle(t){return t.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|gli|i|el|los|las)\s+/i,'').replace(/\s*[\(\[:]?\s*(vol\.?\s*\d+|tomus?\s*\d+|part\.?\s*\d+|band\s*\d+|tome?\s*\d+)[\)\]]?\s*$/i,'').replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();}
function normalizeAuthor(a){const c=a.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\b(dr|prof|rev|saint|st|sir|fr|bp)\b\.?\s*/g,'').replace(/\s*\([\d\s\-–,?.]+\)\s*/g,'').replace(/,\s*[\d\s\-–?.]+$/,'').replace(/[\[\]]/g,'').replace(/\b(born|died|fl\.?|circa|ca?\.?)\s*\d{3,4}\b/g,'').replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();return c.split(' ').filter(w=>w.length>0).sort().join(' ');}
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
    if(existing){console.log(`SKIP  ${b.ia} — present (${existing.slug})`);skipped++;continue;}
    let metadata;
    try{const mr=await fetch(`https://archive.org/metadata/${b.ia}`,{signal:AbortSignal.timeout(20000)});if(!mr.ok){console.log(`FAIL  ${b.ia} — metadata ${mr.status}`);failed++;fails.push(b.ia);continue;}metadata=await mr.json();}
    catch(e){console.log(`FAIL  ${b.ia} — metadata ${e}`);failed++;fails.push(b.ia);continue;}
    const meta=metadata.metadata||{};
    const restricted=meta['access-restricted-item']==='true'||meta['access-restricted-item']===true;
    const {n:pageCount,src:pageCountSource}=await pageCountFor(b.ia,metadata);
    if(!pageCount){console.log(`FAIL  ${b.ia} — no page count`);failed++;fails.push(b.ia);continue;}
    const stripText=s=>String(s).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
    const firstOf=v=>{const raw=Array.isArray(v)?(typeof v[0]==='string'?v[0]:null):(typeof v==='string'?v:null);return raw?stripText(raw)||null:null;};
    const arrOf=v=>{const raw=Array.isArray(v)?v.filter(x=>typeof x==='string'):(typeof v==='string'?[v]:[]);return raw.map(stripText).filter(Boolean);};
    const iaCatalog={source:'internet_archive',identifier:b.ia,ark:meta['identifier-ark']||null,mediatype:meta.mediatype||null,collections:arrOf(meta.collection),access_restricted:restricted,publisher:firstOf(meta.publisher),place:firstOf(meta.publishplace)||firstOf(meta.place),creator:firstOf(meta.creator),description:firstOf(meta.description),subjects:arrOf(meta.subject),oclc_id:firstOf(meta['oclc-id']),lccn:firstOf(meta.lccn),date_iso:firstOf(meta.date),scan_date:firstOf(meta.scandate),scanning_center:firstOf(meta.scanningcenter),scraped_at:new Date().toISOString()};
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
    if(!COMMIT){console.log(`DRY   ${b.ia} — "${b.title.slice(0,50)}" (${pageCount}pp,${pageCountSource})`);imported++;continue;}
    await db.collection('books').insertOne(bookDoc);
    const CHUNK=500;for(let s=0;s<pageCount;s+=CHUNK){const docs=[];for(let k=0;k<CHUNK&&s+k<pageCount;k++){const i=s+k,pid=new ObjectId();docs.push(makePageDoc({_id:pid,id:pid.toHexString(),book_id:bookIdStr,page_number:i+1,photo:photo(i),thumbnail:thumb(i),photo_original:photo(i),created_at:now,updated_at:now}));}await db.collection('pages').insertMany(docs,{ordered:false});}
    console.log(`OK    ${b.ia} → ${bookIdStr} "${b.title.slice(0,46)}" (${pageCount}pp)`);imported++;
  }
  await client.close();
  console.log(`\n=== ${COMMIT?'COMMITTED':'DRY-RUN'} — imported:${imported} skipped:${skipped} failed:${failed} ${fails.length?'['+fails.join(', ')+']':''} ===`);
}
main().catch(e=>{console.error(e);process.exit(1);});
