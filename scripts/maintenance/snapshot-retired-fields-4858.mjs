#!/usr/bin/env node
/**
 * Preserve every value the #4858 cleanup is about to remove, BEFORE it runs
 * (field-sprawl.md "Deleting a field safely": preserve each removed value keyed to the book first).
 *
 * PRIOR ART: scripts/maintenance/cleanup-tenant-id-pollution.mjs — the cleanup itself; it unsets
 * in place and records nothing. scripts/maintenance/restore-orphan-book-fields.mjs — restores
 * book-level fields from sweep_log, but has no page-level snapshot and no pageCount family.
 *
 * Writes:
 *   --out <file>   one JSONL row per page carrying `tenant_id` or a non-subdomain `tenantId`:
 *                  {id, book_id, tenant_id?, tenantId?} — the full backup (one pass over `pages`,
 *                  unindexed, so run it off-peak);
 *   sweep_log      one row per book: sweep 'cleanup-4858-snapshot', action 'pages-retired-field-values',
 *                  detail {field, values: {value: count}, pages, backup file}; and one row per book
 *                  with `pageCount`: action 'book-pageCount', detail {pageCount, pages_count}.
 * Read-only on pages and books. Usage (Hetzner, detached):
 *   node --env-file=.env.production.local scripts/maintenance/snapshot-retired-fields-4858.mjs --out=/root/logs/cleanup-4858-snapshot-pages.jsonl [--write-sweep-log]
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const ARG = (n, d) => {
  const a = process.argv.find((x) => x.startsWith(`${n}=`));
  return a ? a.slice(n.length + 1) : d;
};
const OUT = ARG('--out', null);
const WRITE = process.argv.includes('--write-sweep-log');
if (!OUT) { console.error('--out required'); process.exit(1); }
const SUBDOMAIN_TENANT_IDS = [
  'bce03f71-c18d-4460-b8ad-224c817f9aa0', 'bf458cc2-37d5-4c44-9870-bfe95a50bcf0', 'fd1907e5-5965-4bea-a978-77be3dff08a8',
];
const SWEEP = 'cleanup-4858-snapshot';

const m = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 7_200_000 });
await m.connect();
const db = m.db('bookstore');
const out = fs.createWriteStream(OUT);
const byBook = new Map();
let n = 0; const t0 = Date.now();
const cur = db.collection('pages').find(
  { $or: [{ tenant_id: { $exists: true } }, { tenantId: { $exists: true, $nin: SUBDOMAIN_TENANT_IDS } }] },
  { projection: { _id: 0, id: 1, book_id: 1, tenant_id: 1, tenantId: 1 }, batchSize: 5000 },
);
for await (const p of cur) {
  out.write(`${JSON.stringify(p)}\n`);
  n++;
  const b = byBook.get(p.book_id) || { tenant_id: {}, tenantId: {}, pages: 0 };
  if (p.tenant_id !== undefined) b.tenant_id[p.tenant_id] = (b.tenant_id[p.tenant_id] || 0) + 1;
  if (p.tenantId !== undefined) b.tenantId[p.tenantId] = (b.tenantId[p.tenantId] || 0) + 1;
  b.pages++; byBook.set(p.book_id, b);
  if (n % 100000 === 0) console.log(JSON.stringify({ pages: n, books: byBook.size, s: Math.round((Date.now() - t0) / 1000) }));
}
await new Promise((r) => out.end(r));
const values = {};
for (const b of byBook.values()) for (const [v, c] of Object.entries(b.tenant_id)) values[`tenant_id=${v}`] = (values[`tenant_id=${v}`] || 0) + c;
for (const b of byBook.values()) for (const [v, c] of Object.entries(b.tenantId)) values[`tenantId=${v}`] = (values[`tenantId=${v}`] || 0) + c;
const pcBooks = await db.collection('books').find({ pageCount: { $exists: true } }, { projection: { _id: 0, id: 1, pageCount: 1, pages_count: 1 } }).toArray();
console.log(JSON.stringify({ done: true, pages: n, books: byBook.size, values, pageCount_books: pcBooks.length, pageCount_disagree: pcBooks.filter((b) => b.pageCount !== b.pages_count).length }));

if (WRITE) {
  for (const [book_id, b] of byBook) {
    await recordSweepAction(db, { sweep: SWEEP, book_id, action: 'pages-retired-field-values', detail: { issue: 4858, pages: b.pages, tenant_id: b.tenant_id, tenantId: b.tenantId, backup: OUT } });
  }
  for (const b of pcBooks) {
    await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'book-pageCount', detail: { issue: 4858, pageCount: b.pageCount, pages_count: b.pages_count } });
  }
  console.log(JSON.stringify({ sweep_log_rows: byBook.size + pcBooks.length }));
}
await m.close();
