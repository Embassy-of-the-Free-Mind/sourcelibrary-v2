// Read-only: OCR revision history (text before each overwrite) for the adjudicated pages (#7611).
// PRIOR ART: none for a per-page revision dump; page_revisions is indexed by page_id (job-box traps) (#7611).
import { MongoClient } from 'mongodb';
import fs from 'fs'; import zlib from 'zlib';
const ids = JSON.parse(fs.readFileSync(process.argv[2]));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const out = {};
for (const pid of ids) out[pid] = await db.collection('page_revisions').find({ page_id: pid }).sort({ created_at: 1 }).toArray();
fs.writeFileSync(process.argv[3], zlib.gzipSync(JSON.stringify(out)));
const one = Object.values(out).find(v => v.length); console.log(JSON.stringify(one?.[0]).slice(0, 1200));
console.log(Object.values(out).reduce((a, v) => a + v.length, 0), 'rows');
await c.close();
