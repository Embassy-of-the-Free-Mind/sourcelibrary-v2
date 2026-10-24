#!/usr/bin/env node
// scope.mjs — the pages a guarded-Paddle apply over table + mixed would cover, counted now (#6871 row 3). Read-only.
//
// PRIOR ART: scripts/eval/zh-residue-refs-6871/recount.mjs (same definitions: held gpu-backlog-5660, unread = no
// ocr.data, reverted page ids excluded, seal books out of mixed); this splits off the 清文鑑 titles, which are out of
// scope (no credible reference), and counts per class only table + mixed.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-confirm-6871/scope.mjs > scope.json
import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const C = JSON.parse(readFileSync(here + '../zh-residue-refs-6871/classes.json', 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const rev = await db.collection('page_revisions').find({ source: 'revert-paddle-5660' }, { projection: { page_id: 1 } }).toArray();
const revPids = new Set(rev.map((r) => String(r.page_id)));
const out = { at: new Date().toISOString() };
for (const [cls, bids] of [['table', C.table.bids], ['mixed', C.mixed.bids.filter((b) => !C.seal.bids.includes(b))]]) {
  const o = { books: 0, books_held: 0, unread: 0, qwj_books: 0, qwj_unread: 0, in_scope_unread: 0 };
  for (const bid of bids) {
    const b = await db.collection('books').findOne({ $or: [{ id: bid }, { _id: bid }] }, { projection: { title: 1, 'pipeline_auto.hold.reason': 1 } });
    if (!b) continue;
    o.books++;
    if (b.pipeline_auto?.hold?.reason !== 'gpu-backlog-5660') continue;
    o.books_held++;
    const ps = await db.collection('pages').find({ book_id: bid, 'ocr.data': { $exists: false } }, { projection: { id: 1 } }).toArray();
    const n = ps.filter((p) => !revPids.has(String(p.id))).length;
    o.unread += n;
    if (/清文鑑/.test(b.title)) { o.qwj_books++; o.qwj_unread += n; } else o.in_scope_unread += n;
  }
  out[cls] = o;
}
console.log(JSON.stringify(out, null, 1));
await c.close();
