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
 * Two sources, in order:
 *   1. `pages.translation_withheld` — the object the withhold moved aside.
 *   2. the `page_revisions` row written under
 *      `withhold-stale-translation-4523`, used when the field is gone (someone
 *      cleaned it up) but the snapshot survives.
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

const query = PAGE_ID ? { id: PAGE_ID } : { book_id: BOOK_ID, translation_withheld: { $exists: true } };
const docs = await pages.find(query).toArray();
if (!docs.length) { console.error('no matching pages'); await mongo.close(); process.exit(1); }

let restored = 0;
let skipped = 0;
for (const page of docs) {
  let update = restoreUpdate(page);
  let via = 'translation_withheld';

  if (!update) {
    // Fall back to the snapshot. Newest first: a page can have been withheld
    // more than once if it was restored and re-swept.
    const rev = await db.collection('page_revisions')
      .find({ page_id: page.id, field: 'translation', reason: WITHHOLD_REVISION_SOURCE })
      .sort({ created_at: -1 }).limit(1).next();
    if (!rev) { console.log(`${page.id}: nothing withheld and no snapshot — skipping`); skipped++; continue; }
    via = 'page_revisions';
    update = {
      $set: {
        translation: {
          data: rev.data,
          language: rev.language || 'English',
          model: rev.model,
          source: rev.source || 'ai',
          prompt_version: rev.prompt_version,
          edited_by: rev.edited_by,
          updated_at: rev.original_date || rev.created_at,
        },
        updated_at: new Date(),
      },
      $unset: { translation_withheld: '' },
    };
  }

  const text = update.$set.translation?.data || '';
  const stillStale = staleTranslationReason({ ...page, translation: update.$set.translation });
  console.log(`\n${page.book_id} p.${page.page_number} (${page.id}) via ${via}`);
  console.log(`  reason withheld: ${page.translation_withheld?.reason ?? '(from snapshot)'} · ${text.length} chars`);
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
