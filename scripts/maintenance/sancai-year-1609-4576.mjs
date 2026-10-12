#!/usr/bin/env node
/**
 * Align `year` with `published` on the 13 Sancai Tuhui juan that carry 1607 (#4576).
 *
 * PRIOR ART: scripts/maintenance/tengyur-tidy-published-5497.mjs — same shape
 * (fixed filter, rollback file, sweep_log rows), but it rewrites `published`
 * for another work; no generic year/published reconciler exists in
 * scripts/maintenance/ (the corpus-wide question is #4043).
 *
 * All 108 witnesses of Q1761479 say `published: "1609"`; 95 say `year: 1609`
 * and 13 say `year: 1607`. Both fields are stamped `source: import` from
 * Internet Archive, whose records for these items carry no date at all, so
 * 1607 has no source behind it. 1609 is the printing (Wang Siyi's preface is
 * 1607). With `year` split, a `year_from=1609` filter drops 13 juan of one
 * print run.
 *
 * Touches only `year` and `field_provenance.year`. One `sweep_log` row per book.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/sancai-year-1609-4576.mjs \
 *     --before <rollback.json>            # dry run: writes the rollback file, prints the plan
 *   ... --before <rollback.json> --apply  # writes
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const FILTER = { work_id: 'Q1761479', published: '1609', year: 1607 };
const EXPECTED = 13;
const OLD_YEAR = 1607;
const NEW_YEAR = 1609;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const beforePath = args[args.indexOf('--before') + 1];
if (!args.includes('--before') || !beforePath) {
  console.error('--before <rollback.json> is required');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
try {
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = await db.collection('books')
    .find(FILTER, { projection: { _id: 1, id: 1, title: 1, year: 1, published: 1, 'field_provenance.year': 1 } })
    .toArray();
  if (books.length === 0) {
    console.log('nothing to do: no witness still carries year 1607');
    process.exit(0);
  }
  if (books.length !== EXPECTED) throw new Error(`expected ${EXPECTED} books, found ${books.length}`);

  if (!fs.existsSync(beforePath)) {
    fs.writeFileSync(beforePath, JSON.stringify({
      issue: 4576, filter: FILTER, written_at: new Date().toISOString(),
      fields: ['year', 'field_provenance.year'],
      books: books.map((b) => ({ _id: b._id, id: b.id, title: b.title, year: b.year, field_provenance_year: b.field_provenance?.year ?? null })),
    }, null, 2));
    console.log(`rollback file written: ${beforePath} (${books.length} books)`);
  } else {
    console.log(`rollback file exists, not overwritten: ${beforePath}`);
  }

  console.log(`${books.length} books: year ${OLD_YEAR} -> ${NEW_YEAR}${apply ? '' : ' (dry run)'}`);
  for (const b of books) console.log(`  ${b.id}  ${b.title}`);
  if (!apply) process.exit(0);

  const now = new Date();
  const res = await db.collection('books').bulkWrite(books.map((b) => ({
    updateOne: {
      filter: { _id: b._id, year: OLD_YEAR },
      update: {
        $set: {
          year: NEW_YEAR,
          'field_provenance.year': {
            source: 'maintenance',
            script: 'scripts/maintenance/sancai-year-1609-4576.mjs',
            date: now,
            previous_value: OLD_YEAR,
            note: 'aligned with published "1609", shared by all 108 witnesses of Q1761479 (#4576)',
          },
        },
      },
    },
  })), { ordered: false });
  console.log(`matched ${res.matchedCount}, modified ${res.modifiedCount}`);

  await recordSweepActions(db, books.map((b) => ({
    sweep: 'sancai-year-1609-4576', book_id: b.id, action: 'year-aligned-with-published',
    detail: { from: OLD_YEAR, to: NEW_YEAR },
  })));
} finally {
  await client.close();
}
