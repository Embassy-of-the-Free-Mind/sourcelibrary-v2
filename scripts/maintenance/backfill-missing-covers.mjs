#!/usr/bin/env node
/**
 * Give a live book a cover when it has a page image and simply never had one set.
 *
 * `scripts/audit/record-completeness.mjs` reported 121 live books with no
 * `thumbnail`, which is a real defect — no cover in any grid. But the report is
 * the start of the question, not the answer: 105 of the 121 are ETCSL, which is
 * a TEXT corpus. Those editions are transliterations of Sumerian literature with
 * no page images at all, so having no cover is correct, and manufacturing one
 * would be inventing an artefact for a book that has none.
 *
 * Only the books that actually hold a page image are touched — ten of them.
 *
 * The general point, worth more than the ten rows: a completeness audit measures
 * ABSENCE, and absence has more than one cause. Before backfilling a missing
 * field, ask whether the record is incomplete or whether the thing is simply
 * not that kind of book.
 *
 *   node --env-file=.env.production.local scripts/maintenance/backfill-missing-covers.mjs [--commit]
 */
import { MongoClient } from 'mongodb';

const COMMIT = process.argv.includes('--commit');
const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 });
await client.connect();
const db = client.db('bookstore');

const books = await db.collection('books')
  .find({ visible: true, pages_count: { $gt: 0 }, $or: [{ thumbnail: { $exists: false } }, { thumbnail: null }, { thumbnail: '' }] })
  .project({ id: 1, title: 1, 'image_source.provider': 1 })
  .toArray();
console.log(`${COMMIT ? 'WRITING' : 'DRY RUN'} — ${books.length} live books with no cover\n`);

let fixed = 0, textOnly = 0;
for (const b of books) {
  const p = await db.collection('pages').findOne(
    { book_id: b.id, page_number: { $gt: 0 } },
    { sort: { page_number: 1 }, projection: { display_photo: 1, image_thumb: 1, photo: 1 } },
  );
  const url = p?.display_photo || p?.image_thumb || p?.photo;
  if (!url) { textOnly++; continue; }
  console.log(`  ${String(b.image_source?.provider || '-').padEnd(16)} ${String(b.title).slice(0, 50).padEnd(52)} ← ${String(url).slice(-46)}`);
  if (COMMIT) {
    await db.collection('books').updateOne({ id: b.id }, { $set: { thumbnail: url, thumbnail_source: 'first_page', updated_at: new Date() } });
  }
  fixed++;
}
console.log(`\n${fixed} covered from their first page · ${textOnly} hold no page image at all (text-only editions — correctly coverless)`);
if (!COMMIT) console.log('\nDRY RUN — pass --commit to write.');
await client.close();
