// PRIOR ART: none — census for #5695 T2; scripts/eval/translation-corpus-audit/draw.mjs samples pages, does not census books by language.
import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const rows = await db.collection('books').aggregate([
  { $match: { language: { $regex: /greek/i }, visible: true, pages_translated: { $gt: 0 } } },
  { $project: { id:1, title:1, author:1, language:1, published:1, pages_translated:1, pages_count:1, content_type:1, provider: 1, source:1, work_id:1 } },
]).toArray();
await c.close();
console.error(rows.length);
process.stdout.write(JSON.stringify(rows));
