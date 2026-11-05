#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/fix-hijri-bracketed-year.mjs (the same repair for one era, Hijri with a
 * bracketed CE year; this one covers the eras it does not: BCE, a CE/AD gloss, a year later than this one).
 * scripts/lib/catalogue-year.mjs `catalogYear` is the rule; this script only applies it to stored rows.
 *
 * fix-era-year — set `books.year` to the CE year (negative for BCE) where `published` already says it (#6866).
 *
 * WHY. The catalogue mirror took the first number in `published`, and some importers stored it as `year`:
 * "9 August in the year of the world 6957 … (= 1449 C.E.)" became 6957, "c. 2575–2551 BCE" became 2575 AD,
 * "AM 5686 [1926 CE]" became 5686. The library's date range then read "2030 BCE – 6957". The right year is in
 * the record already; nothing is inferred. A book is touched only where `catalogYear` (era-aware, never later
 * than this year) differs from what the mirror shows today. A year that cannot be read is removed, not guessed
 * ("2039" on a Sanskrit text with no era: `year` is set to null).
 *
 * Written through setCatalogueFields: value, `field_provenance.year` stamp (with the year it replaced) and history
 * entry in one update, which bumps `updated_at`, so the catalogue sync carries each change to `books_catalog`.
 * Reversible: the old year is in the stamp and in a sweep_log row (sweep `era-year-6866`).
 *
 *   node --env-file=.env.production.local scripts/maintenance/fix-era-year.mjs            # dry run
 *   node --env-file=.env.production.local scripts/maintenance/fix-era-year.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { catalogYear } from '../lib/catalogue-year.mjs';
import { setCatalogueFields } from '../lib/catalogue-fields.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'era-year-6866';
const SCRIPT = 'scripts/maintenance/fix-era-year.mjs';

/** What the mirror showed before #6866: a stored year, else the first three- or four-digit number. */
function mirrorYear(b) {
  if (typeof b.year === 'number') return b.year;
  const m = typeof b.published === 'string' && b.published.match(/\b([1-9][0-9]{2,3})\b/);
  return m ? Number(m[1]) : null;
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const books = db.collection('books');

let n = 0, scanned = 0;
const cur = books.find({}, { projection: { _id: 0, id: 1, title: 1, year: 1, published: 1, visible: 1 } }).batchSize(5000);
for await (const b of cur) {
  scanned++;
  const to = catalogYear(b);
  // A year already cleared to null by this script counts as done, though the old mirror rule would re-read it.
  if (to === mirrorYear(b) || (to === null && b.year === null)) continue;
  const from = typeof b.year === 'number' ? b.year : null;
  console.log(`${b.id} ${b.visible ? 'public' : 'hidden'} year ${from ?? '(none)'} → ${to ?? '(removed)'}  "${String(b.published).replace(/\s+/g, ' ').slice(0, 80)}"`);
  n++;
  if (!APPLY) continue;
  // setCatalogueFields stamps field_provenance.year with the value it replaces and refuses a record that
  // changed since it was read, so a concurrent writer's year is never overwritten (#6327).
  const r = await setCatalogueFields(db, b.id, { year: to }, {
    source: 'published_era', script: SCRIPT, method: 'catalogYear: era-aware read of `published`', evidence: { published: b.published },
  }).catch((e) => ({ error: e }));
  if (r.modified === 1) await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'year-era-to-ce', detail: { from, to, published: b.published, issue: 6866 } });
  else console.log(`  not written (${b.id}): ${r.error?.message ?? 'no change'}`);
}
console.log(`${APPLY ? 'fixed' : '[DRY RUN] would fix'} ${n} of ${scanned} books`);
await client.close();
