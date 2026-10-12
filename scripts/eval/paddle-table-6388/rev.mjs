// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
import { MongoClient } from 'mongodb';
import fs from 'fs';
const c = new MongoClient(process.env.MONGODB_URI, { compressors: ['zlib'] }); await c.connect();
const db = c.db('bookstore');
const rows = await db.collection('page_revisions').find({ reason: 'contain_paddle_zh_6388' }).toArray();
console.log(rows.length, JSON.stringify(Object.keys(rows[0])), JSON.stringify(rows[0]).slice(0,1200));
fs.writeFileSync('contained-revs.json', JSON.stringify(rows));
await c.close();
