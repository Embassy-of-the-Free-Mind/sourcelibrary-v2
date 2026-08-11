#!/usr/bin/env node
/**
 * Standing detector: confirmed transcoding damage in bibliographic metadata (#3705).
 *
 * ## Why a detector rather than an import-time guard
 *
 * The damage arrives from upstream — `archive.org/metadata/bub_gb_53bpjY1fnuMC` serves
 * `rhL·torōn` in its own `title`, so our importers copied it faithfully and there is no
 * single importer bug to fix. Roughly thirty scripts under `scripts/import/` and
 * `scripts/maintenance/` read IA metadata, each with its own inline field mapping, so a
 * guard retrofitted into one of them says nothing about the other twenty-nine, and a
 * guard retrofitted into all thirty is a large diff that the thirty-first import script
 * silently escapes anyway.
 *
 * A detector is the honest shape for that situation: it does not care which writer
 * introduced the value, it just asks whether the corpus currently holds one. Same
 * reasoning as `scripts/audit/r2-key-book-scope.mjs`.
 *
 * Exits 1 when it finds anything, so it can gate a cron or a CI step.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/metadata-mojibake.mjs
 */
import { MongoClient } from 'mongodb';
import { MOJIBAKE_RULES, REPAIRABLE_BOOK_FIELDS, findMojibake } from '../lib/mojibake.mjs';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Run with: node --env-file=.env.production.local …');
  process.exit(1);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ANY_RULE = new RegExp(MOJIBAKE_RULES.map((r) => escape(r.from)).join('|'));

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

let findings = 0;

const books = await db.collection('books')
  .find({
    $or: [
      ...REPAIRABLE_BOOK_FIELDS.map((f) => ({ [f]: ANY_RULE })),
      { 'source_work_dates.work_title': ANY_RULE },
    ],
  })
  .project(Object.fromEntries([...REPAIRABLE_BOOK_FIELDS, 'source_work_dates', 'visible'].map((f) => [f, 1])))
  .toArray();

for (const b of books) {
  for (const f of REPAIRABLE_BOOK_FIELDS) {
    const hits = findMojibake(b[f]);
    if (hits.length === 0) continue;
    findings++;
    console.log(`books/${b._id} ${f} (visible=${b.visible}): ${hits.map((h) => `${h.count}× ${h.from}`).join(', ')}`);
    console.log(`   ${JSON.stringify(b[f]).slice(0, 160)}`);
  }
}

// Authors: check the canonical name only. A tombstone's `variants[]` legitimately RETAINS
// the damaged string — it is the lookup key that lets a record still carrying the old
// spelling resolve to the right person — so flagging variants would report the repair
// itself as a defect, every run, forever.
const authors = await db.collection('authors')
  .find({ $or: [{ canonical_name: ANY_RULE }, { display_name: ANY_RULE }] })
  .toArray();

for (const a of authors) {
  findings++;
  console.log(`authors/${a._id} canonical_name: ${JSON.stringify(a.canonical_name)}`);
}

console.log('\n' + '='.repeat(60));
if (findings === 0) {
  console.log('CLEAN — no confirmed mojibake in book or author metadata.');
} else {
  console.log(`FOUND ${findings} damaged field(s).`);
  console.log('Repair with: node --env-file=.env.production.local scripts/maintenance/repair-metadata-mojibake.mjs --apply');
}

await client.close();
process.exit(findings === 0 ? 0 : 1);
