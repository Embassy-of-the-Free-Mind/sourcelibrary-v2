#!/usr/bin/env node
/**
 * Rebuild the canonical author layer (GitHub #2179). DRY-RUN: cluster distinct
 * book-author strings into one record per person and report quality. No writes.
 * Merge order: shared VIAF → shared Wikidata → distinctive surname. VIAF/Wikidata
 * are HARVESTED from the (otherwise-retired) entities, used only as merge keys.
 */
import { MongoClient, ObjectId } from 'mongodb';
const PARTICLES = new Set(['de','del','della','di','da','la','le','van','von','der','den','du','des','el','al','ibn','ben','a','ab','zu','of','the','don','fr','st','saint','y','e','des','dos']);
const PLACEHOLDER = /^(anonymous|unknown|various|anon|n\/a|none|egyptian|sumerian|babylonian|assyrian|traditional)\b|collection|monastery|temple|press|library|dynasty|school of|circle of|workshop|^mtena/i;
const norm = (s)=> (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
function surnameKey(a){
  let s=norm(a).replace(/\([^)]*\)/g,'').replace(/,?\s*\d{3,4}\b.*$/,'').replace(/[^a-z\s,]/g,' ');
  // surname = token(s) before first comma, else the longest token
  let sur;
  if (a.includes(',')) sur = s.split(',')[0];
  else { const toks=s.split(/\s+/).filter(t=>t.length>=3&&!PARTICLES.has(t)); sur = toks.sort((x,y)=>y.length-x.length)[0]||''; }
  const tok=(sur||'').split(/\s+/).filter(t=>t.length>=4&&!PARTICLES.has(t)).sort((x,y)=>y.length-x.length)[0]||'';
  return tok.replace(/^j/,'i').replace(/^gi/,'i').replace(/v/g,'u').replace(/(us|um|ius|is|ae|i|o|a|e)$/,'');
}

const mc=new MongoClient(process.env.MONGODB_URI); await mc.connect();
const db=mc.db('bookstore'); const books=db.collection('books'); const ents=db.collection('entities');
const rows=await books.aggregate([
  {$match:{visible:{$ne:false},pages_count:{$gt:0},author:{$type:'string',$ne:''}}},
  {$group:{_id:'$author',n:{$sum:1},ents:{$addToSet:'$author_entity_id'}}},
],{allowDiskUse:true}).toArray();
const authors=rows.filter(r=>!PLACEHOLDER.test(r._id.trim()));

// harvest viaf/wikidata/name per referenced entity
const allIds=[...new Set(authors.flatMap(r=>r.ents).filter(Boolean).map(String))];
const entDocs=await ents.find({_id:{$in:allIds.filter(s=>ObjectId.isValid(s)).map(s=>new ObjectId(s))}},{projection:{viaf_id:1,wikidata_id:1,canonical_name:1,name:1,book_count:1}}).toArray();
const em=new Map(entDocs.map(e=>[String(e._id),e]));
for(const r of authors){ r.viaf=null; r.wd=null; r.entName=null; r.entBooks=0;
  for(const id of r.ents){ const e=id&&em.get(String(id)); if(!e)continue; if(e.viaf_id&&!r.viaf){r.viaf=e.viaf_id;r.entName=e.canonical_name||e.name;} if(e.wikidata_id&&!r.wd)r.wd=e.wikidata_id; if((e.book_count||0)>r.entBooks){r.entBooks=e.book_count||0; if(!r.entName)r.entName=e.canonical_name||e.name;} }
}

// union-find
const parent=new Map(authors.map((r,i)=>[i,i])); const find=(x)=>{while(parent.get(x)!==x){parent.set(x,parent.get(parent.get(x)));x=parent.get(x);}return x;};
const union=(a,b)=>{const ra=find(a),rb=find(b); if(ra!==rb)parent.set(ra,rb);};
const byViaf=new Map(), byWd=new Map(), bySur=new Map(); const surCount=new Map();
authors.forEach((r,i)=>{ if(r.viaf){(byViaf.get(r.viaf)||byViaf.set(r.viaf,[]).get(r.viaf)).push(i);} if(r.wd){(byWd.get(r.wd)||byWd.set(r.wd,[]).get(r.wd)).push(i);} const k=surnameKey(r._id); r.sur=k; if(k){surCount.set(k,(surCount.get(k)||0)+1);} });
for(const g of byViaf.values()) for(let j=1;j<g.length;j++) union(g[0],g[j]);
for(const g of byWd.values()) for(let j=1;j<g.length;j++) union(g[0],g[j]);
// distinctive-surname merge (surname appears in <=4 distinct strings)
authors.forEach((r,i)=>{ if(r.sur&&surCount.get(r.sur)<=4){ if(!bySur.has(r.sur))bySur.set(r.sur,[]); bySur.get(r.sur).push(i);} });
for(const g of bySur.values()) for(let j=1;j<g.length;j++) union(g[0],g[j]);

const clusters=new Map();
authors.forEach((r,i)=>{const root=find(i); if(!clusters.has(root))clusters.set(root,[]); clusters.get(root).push(r);});
console.log(`distinct book-author strings: ${authors.length}  →  canonical authors: ${clusters.size}\n`);
const check=(re)=>{ const cs=new Set(); for(const r of authors) if(re.test(r._id)) cs.add(find(authors.indexOf(r))); return cs.size; };
console.log('Fragmented-people sanity (records → should be 1):');
for(const [nm,re] of [['Spinoza',/spinoza/i],['Giordano Bruno',/giordano bruno|bruno, giordano/i],['Erasmus',/erasmus|roterodam/i],['Calvin',/calvin/i],['Aquinas',/aquinas|aquino/i],['Paracelsus',/paracelsus/i],['Galileo',/galile/i]]) console.log(`  ${nm.padEnd(16)} → ${check(re)} canonical record(s)`);
await mc.close();
