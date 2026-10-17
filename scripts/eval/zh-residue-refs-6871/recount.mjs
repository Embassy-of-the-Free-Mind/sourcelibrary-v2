#!/usr/bin/env node
// recount.mjs — exact recount of the Chinese held residue (#5660 → #6871 item 3) by failure class. Read-only.
//
// PRIOR ART: scripts/audit/gpu-queue-5660.mjs — counts the whole held cohort and the reverted pages, but not by
// class; the class book lists were never joined to it. This script reuses its definitions ("unread" = no
// `ocr.data`; reverted = page ids in page_revisions source 'revert-paddle-5660') and splits by classes.json.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-residue-refs-6871/recount.mjs [--json out.json]
//
// Classes (a book is in at most one; order of precedence: seal > mixed > table, see README):
//   table, mixed, seal  — book lists in classes.json; pages with no ocr.data
//   reverted            — the revert-paddle-5660 page ids still with no ocr.data
//   other               — every other held gpu-backlog-5660 page with no ocr.data
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const C = JSON.parse(readFileSync(here + 'classes.json', 'utf8'));
const out = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

const held = await books.find({ 'pipeline_auto.hold.reason': 'gpu-backlog-5660' }, { projection: { _id: 1, id: 1 } }).toArray();
const heldIds = new Set(held.map(b => String(b.id ?? b._id)));

const rev = await db.collection('page_revisions').find({ source: 'revert-paddle-5660' }, { projection: { page_id: 1, book_id: 1 } }).toArray();
const revPids = [...new Set(rev.map(r => String(r.page_id)))];

const classOf = new Map();
for (const k of ['table', 'mixed', 'seal']) for (const b of C[k].bids) classOf.set(b, k); // later wins: seal > mixed > table

async function unreadByBook(bids) {
  const res = new Map();
  for (let i = 0; i < bids.length; i += 200) {
    const rows = await pages.aggregate([
      { $match: { book_id: { $in: bids.slice(i, i + 200) } } },
      { $group: { _id: '$book_id', total: { $sum: 1 }, unread: { $sum: { $cond: [{ $ifNull: ['$ocr.data', false] }, 0, 1] } } } },
    ]).toArray();
    for (const r of rows) res.set(r._id, { total: r.total, unread: r.unread });
  }
  return res;
}

const allBids = [...new Set([...heldIds, ...classOf.keys()])];
const per = await unreadByBook(allBids);

const revPages = [];
for (let i = 0; i < revPids.length; i += 500)
  revPages.push(...await pages.find({ id: { $in: revPids.slice(i, i + 500) } }, { projection: { id: 1, book_id: 1, 'ocr.data': 1 } }).toArray());
const revStillEmpty = revPages.filter(p => !p.ocr?.data);
const revByBook = new Map();
for (const p of revStillEmpty) revByBook.set(p.book_id, (revByBook.get(p.book_id) ?? 0) + 1);

const R = { at: new Date().toISOString(), held_books: heldIds.size, classes: {} };
const add = (k, bid, n, held) => {
  const r = (R.classes[k] ??= { books_listed: 0, books_held: 0, books_with_unread: 0, pages_unread: 0, books_not_held_with_unread: 0 });
  r.books_listed++; if (held) r.books_held++;
  if (n > 0) { r.books_with_unread++; r.pages_unread += n; if (!held) r.books_not_held_with_unread++; }
};
for (const bid of allBids) {
  const k = classOf.get(bid) ?? 'other';
  // reverted pages are counted in their own class, not their book's
  const n = Math.max(0, (per.get(bid)?.unread ?? 0) - (revByBook.get(bid) ?? 0));
  add(k, bid, n, heldIds.has(bid));
}
R.classes.reverted = { revision_rows: rev.length, pages: revPids.length, pages_found: revPages.length, pages_unread: revStillEmpty.length, books: revByBook.size };
R.held_pages_unread = [...heldIds].reduce((a, b) => a + (per.get(b)?.unread ?? 0), 0);

console.log(JSON.stringify(R, null, 1));
if (out) writeFileSync(out, JSON.stringify(R, null, 1));
await c.close();
