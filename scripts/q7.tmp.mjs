import { MongoClient } from 'mongodb';
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
for (const [b, pns] of [['6a48e2591e36bf8015227d14',[7,8,9,10]]]) for (const pn of pns) { const p = await db.collection('pages').findOne({ book_id: b, page_number: pn }, { projection: { 'ocr.data': 1 } }); console.log(b.slice(0,8), pn, (p?.ocr?.data||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,220)); }
await c.close();
