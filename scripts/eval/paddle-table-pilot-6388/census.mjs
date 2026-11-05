// PRIOR ART: scripts/eval/paddle-table-6388/{books,dump,parity}.mjs — the same page set (every page whose served
// `ocr.source` is `paddle`, in the books with a `paddle_zh_reocr` event plus the paddle-skqs-rest-6388 applied list)
// and the same rule (`paddleTableRisk`). Those ran as three stages over a 450 MB dump; this is one read-only pass over
// the LIVE pages, because the list it writes drives a withhold and must reflect today's text, not the 15:43 dump.
//
// Usage (cwd = a scratch dir; writes flagged.jsonl and census.json there):
//   node --env-file=/root/sourcelibrary/.env.production.local <repo>/scripts/eval/paddle-table-pilot-6388/census.mjs
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { paddleTableRisk } from '../../lib/paddle-table-detect.mjs';

const APPLIED = '/root/paddle-skqs-rest-6388/applied-books.jsonl';
const c = new MongoClient(process.env.MONGODB_URI, { compressors: ['zlib'] });
await c.connect();
const db = c.db('bookstore');
let ids = (await db.collection('book_events').distinct('book_id', { type: 'paddle_zh_reocr' })).map(String);
for (const l of fs.readFileSync(APPLIED, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l); const b = r.bid || r.book_id; if (b) ids.push(String(b));
}
ids = [...new Set(ids)];
const titles = Object.fromEntries((await db.collection('books').find({ id: { $in: ids } }, { projection: { id: 1, title: 1 } }).toArray()).map((b) => [b.id, b.title]));
console.log('books', ids.length, 'titled', Object.keys(titles).length);

const fd = fs.openSync('flagged.jsonl', 'w');
const T = { books: ids.length, pages: 0, flagged: 0, gate: 0, by_issue: {}, unreadable_already: 0 };
const t0 = Date.now();
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100);
  const cur = db.collection('pages').find({ book_id: { $in: chunk }, 'ocr.source': 'paddle' },
    { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.engine.issue': 1, 'ocr.engine.run': 1, 'ocr.unreadable': 1 } }).batchSize(1000);
  const buf = [];
  for await (const p of cur) {
    T.pages++;
    const v = paddleTableRisk(p.ocr?.data, { title: titles[p.book_id] });
    if (v.gate) T.gate++;
    if (!v.flag) continue;
    T.flagged++;
    const iss = p.ocr?.engine?.issue ?? null;
    T.by_issue[iss] = (T.by_issue[iss] || 0) + 1;
    if (p.ocr?.unreadable === true) T.unreadable_already++;
    buf.push(JSON.stringify({ pid: p.id, bid: p.book_id, pn: p.page_number, iss, run: p.ocr?.engine?.run ?? null, title: titles[p.book_id] ?? null, reasons: v.reasons, unreadable: p.ocr?.unreadable === true }));
  }
  if (buf.length) fs.writeSync(fd, buf.join('\n') + '\n');
  if (i % 2000 === 0) console.log(i + chunk.length, T.pages, T.flagged, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
fs.closeSync(fd);
fs.writeFileSync('census.json', JSON.stringify({ ...T, at: new Date().toISOString() }, null, 2));
console.log('DONE', JSON.stringify(T));
await c.close();
