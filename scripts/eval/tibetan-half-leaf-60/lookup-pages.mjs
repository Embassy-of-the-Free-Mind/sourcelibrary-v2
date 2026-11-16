#!/usr/bin/env node
// lookup-pages.mjs — read-only: for each scored page (pages0.json) fetch the collection (EAPnnn from
// books.image_source.source_url) and pages.archived_photo. Writes pages.json. No writes to Mongo (#60).
// PRIOR ART: scripts/eval/tibetan-nyingma-reference/sample_nyingma.mjs (draws pages; does not record the collection).
// Usage: node --env-file=<.env.production.local> lookup-pages.mjs <pages0.json> <pages.json>
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'node:fs';
const [inp, out] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(inp, 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const ids = [...new Set(rows.map(r => r.book))];
const books = await db.collection('books').find({ $or: [{ id: { $in: ids } }, { _id: { $in: ids.filter(i => /^[0-9a-f]{24}$/.test(i)).map(i => new ObjectId(i)) } }] },
  { projection: { id: 1, 'image_source.source_url': 1, title: 1 } }).toArray();
const bmap = {}; for (const b of books) { bmap[b.id || String(b._id)] = b; bmap[String(b._id)] = b; }
for (const r of rows) {
  const b = bmap[r.book]; const url = b?.image_source?.source_url || '';
  r.collection = (url.match(/EAP\d+/) || [null])[0]; r.source_url = url;
  const p = await db.collection('pages').findOne({ book_id: r.book, page_number: r.page },
    { projection: { archived_photo: 1, image_width: 1, image_height: 1 } });
  // image-pick-ok: the test reads the whole stored frame on purpose (the reader cuts leaves itself; the 1 Oct scores were read from this file)
  r.archived_photo = p?.archived_photo || null; r.db_w = p?.image_width; r.db_h = p?.image_height;
}
fs.writeFileSync(out, JSON.stringify(rows, null, 1));
const cnt = {}; for (const r of rows) { const k = `${r.set}/${r.collection}`; cnt[k] = (cnt[k] || 0) + 1; }
console.log(cnt, 'no photo:', rows.filter(r => !r.archived_photo).length);
await c.close();
