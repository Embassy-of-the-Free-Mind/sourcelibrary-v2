// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
import { MongoClient } from 'mongodb';
import fs from 'fs';
const c = new MongoClient(process.env.MONGODB_URI, { compressors: ['zlib'] }); await c.connect();
const db = c.db('bookstore');
const t0=Date.now();
const ev = await db.collection('book_events').find({ type: 'paddle_zh_reocr' }).limit(2).toArray();
console.log(JSON.stringify(ev).slice(0,1500));
const ids = await db.collection('book_events').distinct('book_id', { type: 'paddle_zh_reocr' });
console.log('books', ids.length, (Date.now()-t0)/1000);
fs.writeFileSync('paddle-books.json', JSON.stringify(ids));
await c.close();
