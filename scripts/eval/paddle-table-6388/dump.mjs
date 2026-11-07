// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs'; import zlib from 'zlib';
const c = new MongoClient(process.env.MONGODB_URI, { compressors: ['zlib'] }); await c.connect();
const db = c.db('bookstore');
let ids = JSON.parse(fs.readFileSync('paddle-books.json'));
for (const l of fs.readFileSync('/root/paddle-skqs-rest-6388/applied-books.jsonl','utf8').split('\n').filter(Boolean)) { const b = JSON.parse(l).bid || JSON.parse(l).book_id; if (b) ids.push(b); }
ids = [...new Set(ids.map(String))];
console.log('books', ids.length);
const out = zlib.createGzip(); out.pipe(fs.createWriteStream('paddle-pages.jsonl.gz'));
let n = 0, np = 0; const t0 = Date.now();
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100);
  const cur = db.collection('pages').find({ book_id: { $in: chunk }, 'ocr.source': 'paddle' }, { projection: { book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.engine.postprocess': 1, 'ocr.engine.issue': 1, 'ocr.engine.run': 1 } }).batchSize(1000);
  for await (const p of cur) { out.write(JSON.stringify({ pid: String(p._id), bid: p.book_id, pn: p.page_number, text: p.ocr?.data, pp: p.ocr?.engine?.postprocess || null, iss: p.ocr?.engine?.issue, run: p.ocr?.engine?.run }) + '\n'); np++; }
  n += chunk.length; if (i % 1000 === 0) console.log(n, np, ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
out.end(); await new Promise(r => out.on('end', r)); console.log('DONE', n, np, ((Date.now() - t0) / 1000).toFixed(0));
await c.close();
