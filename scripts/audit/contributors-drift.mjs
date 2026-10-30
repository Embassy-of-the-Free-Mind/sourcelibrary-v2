#!/usr/bin/env node
/**
 * Standing check: does every book's `contributors[]` still agree with its
 * `author` / `author_id`? (#7787)
 *
 * PRIOR ART: scripts/audit/thesaurus-variant-shape.mjs audits the thesaurus
 * side; nothing compared a book's two author representations, because until
 * #7787 there was only one.
 *
 * `contributors` has one writer, but `author` and `author_id` have a dozen
 * (importers, the 02:10 canonical-link backfill, the admin editor), none of
 * which know the list exists. So the list can go stale without anyone
 * touching it. This reports each book where `contributorsDrift` finds that it
 * has, and exits 1 when any do. Read-only.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/contributors-drift.mjs [--json]
 */
import { MongoClient } from 'mongodb';
import { contributorsDrift } from '../lib/contributors.mjs';

const JSON_OUT = process.argv.includes('--json');
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const books = mc.db('bookstore').collection('books');

let checked = 0;
const drift = [];
for await (const b of books.find({ contributors: { $exists: true, $ne: [] } },
  { projection: { author: 1, author_id: 1, contributors: 1 } }).batchSize(2000)) {
  checked++;
  const why = contributorsDrift(b);
  if (why) drift.push({ book_id: String(b._id), why, author: b.author, author_id: b.author_id ?? null });
}
await mc.close();

if (JSON_OUT) console.log(JSON.stringify({ checked, drifted: drift.length, drift }, null, 2));
else {
  console.log(`checked ${checked} books with contributors; ${drift.length} drifted`);
  for (const d of drift.slice(0, 50)) console.log(`  ${d.book_id}  ${d.why}  "${d.author}"  author_id=${d.author_id}`);
}
process.exit(drift.length ? 1 : 0);
