// PRIOR ART: none for T4 — the T1 job's census (.q2.mjs, untracked) groups Latin by period; this lists T4 books to match references.
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const langs = ['Hebrew','Aramaic','Arabic','Persian'];
const rows = await db.collection('books').find({language:{$in:langs}, visible:true, pages_count:{$gt:0}, pages_translated:{$gt:0}},
 {projection:{id:1,title:1,display_title:1,author:1,year:1,language:1,pages_translated:1,pages_count:1,original_language:1,text_role:1,ia_identifier:1,source:1,license:1,image_license:1,rights:1,collections:1}}).toArray();
fs.writeFileSync(process.argv[2], rows.map(r=>JSON.stringify(r)).join('\n'));
console.log(rows.length);
await c.close();
