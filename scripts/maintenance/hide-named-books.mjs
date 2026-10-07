#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/hide-cdli-fabricated.mjs hides books chosen by a rule
 * (provider = cdli) with one hard-coded reason; hide-unarchived-books.mjs and
 * hide-efm-duplicates.mjs hide by rule and expect a later automatic un-hide. This one
 * hides a NAMED list read from a file, each book with its own reason, so a list that
 * must stay private (rights suspicions) can live outside this public repo.
 *
 * Withhold named books from public view. Reversible, nothing deleted: `visible:false` +
 * `hidden:true` (always written together) + `hidden_reason`, the flip-guard that stops a
 * bulk "make visible" sweep republishing them (#3099). Use a reason that names the class
 * and the issue, e.g. `rights_review_4809`, `broken_structure_5900`; rights-class reasons
 * must match /copyright|rights|takedown|dmca/ so read-side screens recognise them.
 *
 * List file: JSON array of { id, reason, note? }.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/hide-named-books.mjs <list.json>          # dry run
 *   node --env-file=.env.production.local scripts/maintenance/hide-named-books.mjs <list.json> --apply
 * Then sync the Supabase mirror: node scripts/workers/sync-books-catalog.mjs
 */
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const file = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!file || file.startsWith('--')) { console.error('usage: hide-named-books.mjs <list.json> [--apply]'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }

const list = JSON.parse(readFileSync(file, 'utf8'));
for (const row of list) {
  if (!row.id || !row.reason || !/_\d{3,}$/.test(row.reason)) {
    console.error(`bad row (needs id and a reason ending in an issue number): ${JSON.stringify(row)}`);
    process.exit(1);
  }
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
let hidden = 0;
for (const row of list) {
  // Books are addressed by `id`; some carry a re-minted `_id` (book-deletion-and-identity.md).
  const book = await db.collection('books').findOne({ $or: [{ id: row.id }, { _id: row.id }] }, { projection: { id: 1, title: 1, visible: 1, hidden: 1, hidden_reason: 1 } });
  if (!book) { console.log(`NOT FOUND ${row.id}`); continue; }
  console.log(`${book.id}  visible=${book.visible} reason=${book.hidden_reason ?? '-'} → ${row.reason}  ${String(book.title).slice(0, 60)}`);
  if (!APPLY) continue;
  const r = await db.collection('books').updateOne({ id: book.id }, {
    $set: { visible: false, hidden: true, hidden_reason: row.reason, hidden_at: new Date(), updated_at: new Date() },
  });
  hidden += r.modifiedCount;
}
console.log(APPLY ? `hidden: ${hidden} of ${list.length}` : `[DRY RUN] ${list.length} book(s); pass --apply to hide`);
await client.close();
