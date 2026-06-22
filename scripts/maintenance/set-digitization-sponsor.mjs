#!/usr/bin/env node
/**
 * Set (or clear) the "adopt a book" digitization sponsor credit on a book.
 *
 * Writes `digitization_sponsor` (+ optional `digitization_sponsor_url`) on the
 * books doc. The book page renders this as a gracious "Digitized thanks to ___"
 * line in the bibliographic panel (see src/components/book/BibliographicInfo.tsx).
 *
 * This is distinct from `image_source.sponsor`, which records the *institutional*
 * digitization funder (Google, Sloan, …). Use this for individual donors who
 * adopt a specific book.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/set-digitization-sponsor.mjs --book <id|slug> --name "Jane Smith" [--url "https://…"]
 *   node scripts/maintenance/set-digitization-sponsor.mjs --book <id|slug> --clear
 *
 * Flags:
 *   --book   Book `id` (string id field) or `slug`. Required.
 *   --name   Sponsor display name. Required unless --clear.
 *   --url    Optional link (donor page / tribute).
 *   --clear  Remove the sponsor credit instead of setting it.
 */
import { withMongo } from '../lib/mongo.mjs';

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const has = (flag) => process.argv.includes(flag);

const bookRef = arg('--book');
const name = arg('--name');
const url = arg('--url');
const clear = has('--clear');

if (!bookRef || (!clear && !name)) {
  console.error('Usage: --book <id|slug> --name "Name" [--url "https://…"]  |  --book <id|slug> --clear');
  process.exit(1);
}

await withMongo(async (db) => {
  const books = db.collection('books');
  const book = await books.findOne(
    { $or: [{ id: bookRef }, { slug: bookRef }] },
    { projection: { id: 1, slug: 1, title: 1, display_title: 1, digitization_sponsor: 1 } }
  );

  if (!book) {
    console.error(`No book found with id or slug "${bookRef}".`);
    process.exit(1);
  }

  const label = book.display_title || book.title || book.slug || book.id;

  let update;
  if (clear) {
    update = { $unset: { digitization_sponsor: '', digitization_sponsor_url: '' } };
  } else {
    update = { $set: { digitization_sponsor: name } };
    if (url) update.$set.digitization_sponsor_url = url;
    else update.$unset = { digitization_sponsor_url: '' };
  }

  const res = await books.updateOne({ id: book.id }, update);

  if (clear) {
    console.log(`Cleared digitization sponsor on "${label}" (was: ${book.digitization_sponsor || 'none'}). modified=${res.modifiedCount}`);
  } else {
    console.log(`Set "${label}" → "Digitized thanks to ${name}${url ? ` (${url})` : ''}". modified=${res.modifiedCount}`);
  }
}, { timeoutMs: 60000 });
