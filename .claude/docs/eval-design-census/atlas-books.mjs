// PRIOR ART: scripts/eval/benchmark-dashboard-data.mjs — counts referenced pages per cell from results files; this census counts LIVE pages per catalogue stratum against references, for eval-design.md §11 (2026-09-25 snapshot, not a tool).
// Cheap books-only dump from Atlas (no pages queries): live books with the fields strata.mjs needs.
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI missing');
const client = new MongoClient(uri);
await client.connect();
const col = client.db('bookstore').collection('books');
const cur = col.find({ visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1, language: 1, original_language: 1, languages: 1, published: 1, pages_count: 1, visible: 1, hidden: 1, hidden_reason: 1, contributing_library: 1, ia_identifier: 1 } });
const out = fs.createWriteStream(process.argv[2] || './atlas-books.jsonl');
let n = 0;
for await (const b of cur) { out.write(JSON.stringify(b) + '\n'); n++; }
out.end();
console.log('live books dumped:', n);
await client.close();
