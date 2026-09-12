#!/usr/bin/env node
/**
 * PRIOR ART: none — there was no restore path for a withheld translation
 * before this. `scripts/maintenance/reset-book-ocr.mjs` restores OCR from
 * `page_revisions` but for a different field, a different reason code, and
 * with a job-cancellation step that has no analogue here (nothing is queued
 * against a withheld translation). Looked in `scripts/maintenance/`,
 * `scripts/audit/`, and `git grep restore-.*revision`.
 *
 * Puts a withheld translation back (#4523).
 *
 * A withhold is only reversible if the reverse is a thing you can run, so this
 * is part of the deliverable rather than a note that it "could" be undone.
 * The text lives in ONE place: the `page_revisions` row written under
 * `withhold-stale-translation-4523`. `pages.translation_withheld` keeps only
 * metadata, deliberately — the reader serialises the whole page document into
 * its RSC payload, so text left there would ship inside the HTML. That makes
 * the snapshot load-bearing, and a withheld page with no snapshot is a bug the
 * drift audit reports as UNBACKED rather than something this script papers
 * over.
 *
 * Restoring puts the page back into the stale set, so the standing sweep would
 * withhold it again on its next run. That is correct — the way OUT of the set
 * is to retranslate the page, not to un-withhold it. Use this to inspect, to
 * repair a mistaken withhold, or to prove recoverability; pass --force to
 * restore a page that still matches the stale predicate.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/restore-withheld-translation.mjs --page=<pageId>
 *   … --book=<bookId>     every withheld page of one book
 *   … --apply             write (default is a dry run that prints the text head)
 *   … --force             restore even though the page is still stale
 */
import { MongoClient } from 'mongodb';
import { staleTranslationReason, restoreUpdate, WITHHOLD_REVISION_SOURCE } from '../lib/stale-translation.mjs';

const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=') ?? d;
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const PAGE_ID = ARG('--page', null);
const BOOK_ID = ARG('--book', null);
if (!PAGE_ID && !BOOK_ID) { console.error('--page=<id> or --book=<id> required'); process.exit(1); }

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const pages = db.collection('pages');

const query = PAGE_ID ? { id: PAGE_ID } : { book_id: BOOK_ID, 'translation_withheld.reason': { $exists: true } };
const docs = await pages.find(query).toArray();
if (!docs.length) { console.error('no matching pages'); await mongo.close(); process.exit(1); }

let restored = 0;
let skipped = 0;
for (const page of docs) {
  if (!page.translation_withheld) { console.log(`${page.id}: nothing withheld — skipping`); skipped++; continue; }

  // The text is NOT on the page — the withhold keeps only metadata there, so
  // that it cannot ride the reader's flight payload. `page_revisions` is the
  // one place holding it. Newest first: a page can have been withheld more
  // than once if it was restored and re-swept.
  const rev = await db.collection('page_revisions')
    .find({ page_id: page.id, field: 'translation', reason: WITHHOLD_REVISION_SOURCE })
    .sort({ created_at: -1 }).limit(1).next();
  if (!rev?.data) {
    console.log(`${page.id}: withheld but NO SNAPSHOT — cannot restore, and this page should be reported by the drift audit as UNBACKED`);
    skipped++;
    continue;
  }

  const update = restoreUpdate(page, rev.data);
  const text = update.$set.translation.data;
  const stillStale = staleTranslationReason({ ...page, translation: update.$set.translation });
  console.log(`\n${page.book_id} p.${page.page_number} (${page.id})`);
  console.log(`  reason withheld: ${page.translation_withheld?.reason} · ${text.length} chars (recorded ${page.translation_withheld?.chars ?? '—'})`);
  console.log(`  head: ${text.slice(0, 140).replace(/\n/g, ' ')}`);
  if (stillStale && !FORCE) {
    console.log(`  STILL STALE (${stillStale}) — the sweep would withhold it again. Pass --force to restore anyway.`);
    skipped++;
    continue;
  }
  if (!APPLY) { console.log('  dry run — pass --apply to write'); continue; }

  const res = await pages.updateOne({ id: page.id }, update);
  if (res.modifiedCount === 1) { restored++; console.log('  restored'); }
  else console.log(`  NOT WRITTEN (modifiedCount ${res.modifiedCount})`);
}

console.log(`\n${APPLY ? 'restored' : 'would restore'}: ${restored} · skipped: ${skipped}`);
await mongo.close();
