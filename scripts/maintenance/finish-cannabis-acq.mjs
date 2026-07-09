// Finish the cannabis acquisition: import remaining titles, fix a language,
// batch-OCR every new book (+ the one that missed), tag all into the collection.
import { MongoClient, ObjectId } from 'mongodb';
const SECRET = process.env.CRON_SECRET;
const uri = process.env.MONGODB_URI;
const SLUG = 'cannabis-western-record';
const BASE = 'https://sourcelibrary.org';

const remaining = [
  ['rajanighantuanddhanvantarinighantuvaidyanarayanasarmapurandareanandashram331896_936_v','Rāja Nighaṇṭu & Dhanvantari Nighaṇṭu','Narahari Paṇḍita','1896','Sanskrit'],
  ['pharmacographia00dymogoog','Pharmacographia Indica, Vol. 1','Dymock, Warden & Hooper','1890','English'],
  ['encyclopdiem01lama','Encyclopédie méthodique: Botanique, Tome 1','Jean-Baptiste Lamarck','1785','French'],
  ['2752373R.nlm.nih.gov','Den groten herbarius met al den figueren der cruyden','Unknown','1532','Dutch'],
  ['denederlandtseh00nyla','De Nederlandtse herbarius of Kruydt-boeck','Petrus Nylandt','1670','Dutch'],
];

async function post(path, body){
  const r = await fetch(BASE+path,{method:'POST',headers:{'Authorization':'Bearer '+SECRET,'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  const t = await r.text(); let j; try{j=JSON.parse(t)}catch{j={raw:t.slice(0,140),status:r.status}}; return j;
}

const newIds = [
  '6a35798c82bf3ff3f867b045', // Seidenschnur (already imported)
  '6a3579a482bf3ff3f867b074', // O'Shaughnessy 1843
  '6a3579b882bf3ff3f867b0a1', // Sharngadhara
];

console.log('== import remaining ==');
for(const [iaid,title,author,published,language] of remaining){
  const d = await post('/api/import/ia',{ia_identifier:iaid,title,author,published,language});
  if(d.bookId){ newIds.push(d.bookId); console.log(`  ${iaid.slice(0,24)} -> ${d.bookId} (${d.pagesCreated}pp)`); }
  else console.log(`  ${iaid.slice(0,24)} -> ${JSON.stringify(d).slice(0,120)}`);
}

const client = new MongoClient(uri); await client.connect();
const db = client.db('bookstore'); const books=db.collection('books'); const colls=db.collection('collections');
// fix Sharngadhara language Marathi->Sanskrit
await books.updateOne({_id:new ObjectId('6a3579b882bf3ff3f867b0a1')},{$set:{language:'Sanskrit',updated_at:new Date()}});

// batch OCR: all new books + the Hemp Commission that missed
const ocrTargets = [...newIds, '6a356ec887fae58c35bbcfe8'];
console.log('\n== batch OCR submit ==');
for(const id of ocrTargets){
  // skip if already has an ocr batch job
  const has = await db.collection('batch_jobs').countDocuments({book_id:id, type:/ocr/i});
  if(has){ console.log(`  ${id} already has ${has} ocr jobs, skip`); continue; }
  const d = await post(`/api/books/${id}/batch-ocr-async`,{});
  console.log(`  ${id} -> ${d.success?('pages='+d.pagesSubmitted+' batches='+d.batchCount):JSON.stringify(d).slice(0,120)}`);
}

// tag all new books + Rumphius vol 4 into collection
const tag = [...newIds, '6958eacd538549809db83318'];
let tagged=0;
for(const id of tag){ const q={$or:[{id}]}; try{q.$or.push({_id:new ObjectId(id)})}catch{} ; const r=await books.updateOne(q,{$addToSet:{collections:SLUG},$set:{updated_at:new Date()}}); if(r.matchedCount)tagged++; }
console.log(`\ntagged ${tagged}/${tag.length}`);

const docs=await books.find({collections:SLUG},{projection:{language:1,visible:1,pages_count:1}}).toArray();
const live=docs.filter(b=>b.visible!==false&&(b.pages_count||0)>0);
const lm={}; for(const b of live){const l=b.language||'Unknown'; lm[l]=(lm[l]||0)+1;}
const languages=Object.entries(lm).map(([lang,count])=>({lang,count})).sort((a,b)=>b.count-a.count);
await colls.updateOne({slug:SLUG},{$set:{book_count:live.length,languages,updated_at:new Date()}});
console.log(`collection: tagged=${docs.length} live=${live.length}`);
console.log('languages:',JSON.stringify(languages));
await client.close();
