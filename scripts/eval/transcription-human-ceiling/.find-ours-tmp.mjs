// Read-only: find our books that could be the printed editions of the human pairs (#5762 track 2, Greek).
import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const pats = process.argv.slice(2);
for (const p of pats) {
  const re = new RegExp(p, 'i');
  const rows = await db.collection('books').find({ $or: [{ title: re }, { author: re }, { display_title: re }] },
    { projection: { id: 1, title: 1, author: 1, published: 1, pages_count: 1, visible: 1, language: 1, ia_identifier: 1 } }).limit(60).toArray();
  console.log('##', p, rows.length);
  for (const r of rows) console.log(' ', r.id, r.published, r.pages_count, r.visible, r.language, '|', String(r.title).slice(0, 90), '|', String(r.author).slice(0, 40), '|', r.ia_identifier || '');
}
await c.close();
