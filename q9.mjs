import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const ps = await db.collection('pages').find({'ocr.data':/Temple of the Cross|Tablet of the Cross|Tablero de la Cruz/i},{projection:{book_id:1,page_number:1,'ocr.data':1}}).limit(60).toArray();
const bids=[...new Set(ps.map(p=>p.book_id))];
const bs = await db.collection('books').find({$or:[{id:{$in:bids}},{_id:{$in:bids}}]},{projection:{title:1,id:1,year:1}}).toArray();
console.log(bs);
for (const p of ps) { const t=p.ocr.data; const i=t.search(/(Temple|Tablet) of the Cross|Tablero/i); console.log(p.book_id, p.page_number, t.slice(Math.max(0,i-100), i+160).replace(/\n/g,' ')); }
await c.close();
