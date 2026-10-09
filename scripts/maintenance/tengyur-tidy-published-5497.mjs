#!/usr/bin/env node
/**
 * Tidy the Derge Tengyur volumes' `published` field (#5497).
 *
 * PRIOR ART: scripts/maintenance/repair-manifest-metadata-4572.mjs — rewrites
 * `published` from catalogue dates for IIIF imports; its selection and parsing
 * are specific to that defect, and no generic book-field writer exists in
 * scripts/maintenance/.
 *
 * The importer wrote a whole imprint sentence into `published` — "Delhi: Delhi
 * Karmapae Choedhey, …, 1982–1985 (reproduced from clear prints of the
 * 18th-century Derge blocks, carved 1737–1744)" — and the page <title> appends
 * `published`, so every tab and search result carried it. `publisher` and
 * `place_published` already hold the imprint parts. This sets `published` to
 * the date alone and keeps the provenance sentence, once, at the end of
 * `description`.
 *
 * Touches only `published` and `description`. Never visible / hidden /
 * publication / pipeline_auto. One `sweep_log` row per book.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/tengyur-tidy-published-5497.mjs \
 *     --before <rollback.json>            # dry run: writes the rollback file, prints the plan
 *   ... --before <rollback.json> --apply  # writes
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const FILTER = { 'pipeline_auto.hold.reason': 'tengyur-import-5497' };
const EXPECTED = 213;
const OLD_PUBLISHED = 'Delhi: Delhi Karmapae Choedhey, Gyalwae Sungrab Partun Khang, 1982–1985 (reproduced from clear prints of the 18th-century Derge blocks, carved 1737–1744)';
const NEW_PUBLISHED = '1982–1985';
const PROVENANCE = 'Reproduced at Delhi by Delhi Karmapae Choedhey, Gyalwae Sungrab Partun Khang, 1982–1985, from clear prints of the 18th-century Derge blocks (carved 1737–1744).';

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
    .find(FILTER, { projection: { _id: 1, id: 1, title: 1, published: 1, description: 1 } })
    .toArray();
  if (books.length !== EXPECTED) throw new Error(`expected ${EXPECTED} books, found ${books.length}`);

  const plan = [];
  for (const b of books) {
    if (b.published === NEW_PUBLISHED) continue; // already tidied
    if (b.published !== OLD_PUBLISHED) throw new Error(`${b.id}: unexpected published ${JSON.stringify(b.published)}`);
    const desc = typeof b.description === 'string' ? b.description.trim() : '';
    const description = desc.includes(PROVENANCE) ? desc : (desc ? `${desc} ${PROVENANCE}` : PROVENANCE);
    plan.push({ _id: b._id, id: b.id, set: { published: NEW_PUBLISHED, description } });
  }

  // Rollback file first, always — the old value of every field this run may touch.
  if (!fs.existsSync(beforePath)) {
    fs.writeFileSync(beforePath, JSON.stringify({
      issue: 5497, filter: FILTER, written_at: new Date().toISOString(),
      fields: ['published', 'description'],
      books: books.map((b) => ({ _id: b._id, id: b.id, title: b.title, published: b.published ?? null, description: b.description ?? null })),
    }, null, 2));
    console.log(`rollback file written: ${beforePath} (${books.length} books)`);
  } else {
    console.log(`rollback file exists, not overwritten: ${beforePath}`);
  }

  console.log(`${plan.length} of ${books.length} books to update${apply ? '' : ' (dry run)'}`);
  if (plan[0]) console.log('example:', JSON.stringify(plan[0].set, null, 1));
  if (!apply || !plan.length) process.exit(0);

  const res = await db.collection('books').bulkWrite(plan.map((p) => ({
    updateOne: { filter: { _id: p._id, published: OLD_PUBLISHED }, update: { $set: p.set } },
  })), { ordered: false });
  console.log(`matched ${res.matchedCount}, modified ${res.modifiedCount}`);

  await recordSweepActions(db, plan.map((p) => ({
    sweep: 'tengyur-tidy-published-5497', book_id: p.id, action: 'published-to-date',
    detail: { from: OLD_PUBLISHED, to: NEW_PUBLISHED, description_appended: true },
  })));
} finally {
  await client.close();
}
