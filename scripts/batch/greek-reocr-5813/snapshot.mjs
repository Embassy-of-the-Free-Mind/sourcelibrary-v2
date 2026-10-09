#!/usr/bin/env node
// #5813 — local copy of what a page list serves BEFORE the re-OCR lands (old OCR, old translation),
// for the by-eye comparison and the agreement measure. The collector writes its own page_revisions
// snapshot; this is the job's working copy, read-only against Mongo.
//   node --env-file=… scripts/batch/greek-reocr-5813/snapshot.mjs --ids=pages.json --out=before.jsonl
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const ids = JSON.parse(fs.readFileSync(arg('ids'), 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const P = c.db('bookstore').collection('pages');
const out = fs.createWriteStream(arg('out'));
let n = 0;
for (let i = 0; i < ids.length; i += 500) {
  const rows = await P.find({ id: { $in: ids.slice(i, i + 500) } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1, 'ocr.prompt_version': 1, 'ocr.batch_job_id': 1, 'translation.data': 1, 'translation.model': 1, 'translation.updated_at': 1, 'translation.source': 1 } }).toArray();
  for (const r of rows) { out.write(JSON.stringify(r) + '\n'); n++; }
}
await new Promise((r) => out.end(r));
console.log(`${n}/${ids.length} pages snapshotted`);
await c.close();
