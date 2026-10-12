// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
import { MongoClient } from 'mongodb';
import fs from 'fs';
const c = new MongoClient(process.env.MONGODB_URI, { compressors: ['zlib'] }); await c.connect();
const db = c.db('bookstore');
const ids = JSON.parse(fs.readFileSync('paddle-books.json'));
const titles = {};
for (let i = 0; i < ids.length; i += 500) {
  const bs = await db.collection('books').find({ id: { $in: ids.slice(i, i + 500) } }, { projection: { id: 1, title: 1 } }).toArray();
  for (const b of bs) titles[b.id] = b.title;
}
console.log('titles', Object.keys(titles).length);
fs.writeFileSync('titles.json', JSON.stringify(titles));
const revs = JSON.parse(fs.readFileSync('contained-revs.json'));
const ps = await db.collection('pages').find({ id: { $in: revs.map(r => r.page_id) } }, { projection: { id: 1, book_id: 1, page_number: 1 } }).toArray();
console.log('contained pages found', ps.length);
fs.writeFileSync('contained-pn.json', JSON.stringify(ps.map(p => ({ id: p.id, bid: p.book_id, pn: p.page_number }))));
await c.close();
