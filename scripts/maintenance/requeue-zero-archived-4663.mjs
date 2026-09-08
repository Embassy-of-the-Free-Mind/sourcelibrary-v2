#!/usr/bin/env node
/**
 * #4663 repair — return to the archive queue those books that were marked
 * `archived: true` having archived ZERO pages.
 *
 * PRIOR ART:
 *   The issue itself proposes a one-liner:
 *     db.acquisition_queue.updateMany(
 *       { archived: true, archive_note: /^partial:0\// },
 *       { $unset: { archived: '' }, $set: { archive_requeued_at: new Date() } })
 *   Measured 2026-09-08, that is STALE and should not be run as written: of a
 *   120-row sample, 87 (72.5%) had since been archived by another path and only
 *   33 were still at zero. The note records what was true on 2026-09-04, not what
 *   is true now. This script therefore re-checks each row against `pages` and
 *   requeues only the ones that are genuinely still empty.
 *   scripts/catalog-coverage/archive-acquired.ts — the consumer; its queue mode
 *   selects {status:'acquired', book_id, archived: {$ne:true}}, which is why
 *   clearing the flag is what makes a book visible again.
 *   scripts/maintenance/archiving-watchdog.mjs — cannot see these: it works off
 *   pipeline_auto.status, not the queue.
 *
 * ── ACTUATION, not recording ────────────────────────────────────────────────
 *
 * `acquisition_queue` is read by the hourly :45 archiver cron. Clearing
 * `archived` on a row puts that book back into its work queue, and the next run
 * will start fetching its page images to R2 without further instruction.
 * ~171 pages per book on the measured sample.
 *
 * Safe to re-run: archiveIiif only fetches pages that lack `archived_photo`, and
 * this script only ever CLEARS a false done-marker. It never marks anything done.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/requeue-zero-archived-4663.mjs
 *   node --env-file=.env.production.local scripts/maintenance/requeue-zero-archived-4663.mjs --execute
 */
import { MongoClient } from 'mongodb';

const EXECUTE = process.argv.includes('--execute');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const LIMIT = parseInt(arg('--limit', '100000'), 10);

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }
const client = new MongoClient(uri, { maxPoolSize: 4 });

try {
  await client.connect();
  const db = client.db('bookstore');
  const queue = db.collection('acquisition_queue');
  const pages = db.collection('pages');
  const books = db.collection('books');

  const rows = await queue
    .find({ archived: true, archive_note: /^partial:0\// }, { projection: { sn: 1, book_id: 1, archive_note: 1 } })
    .limit(LIMIT)
    .toArray();

  console.log(`${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} — ${rows.length} rows carry a partial:0/ note\n`);

  let requeued = 0;
  let alreadyFine = 0;
  let bookMissing = 0;
  let pagesQueued = 0;
  let checked = 0;

  for (const r of rows) {
    checked++;
    if (checked % 500 === 0) console.log(`  …checked ${checked}/${rows.length}`);

    const book = await books.findOne({ id: r.book_id }, { projection: { pages_count: 1, title: 1 } });
    if (!book) { bookMissing++; continue; }

    // The note is a claim from 2026-09-04. This is the check it needs.
    const archived = await pages.countDocuments({ book_id: r.book_id, archived_photo: { $regex: '^https?:' } });
    if (archived > 0) { alreadyFine++; continue; }

    pagesQueued += book.pages_count || 0;
    if (!EXECUTE) { requeued++; continue; }

    const res = await queue.updateOne(
      { sn: r.sn, archived: true },
      {
        $unset: { archived: '' },
        $set: {
          archive_requeued_at: new Date(),
          archive_requeue_reason:
            'archived:true was written with 0 pages archived (#4663); verified still 0 at requeue time',
          archive_note_previous: r.archive_note,
        },
      },
    );
    if (res.modifiedCount === 1) requeued++;
  }

  console.log(`\n=== ${EXECUTE ? 'EXECUTED' : 'DRY-RUN'} ===`);
  console.log(`  requeued (genuinely 0 archived): ${requeued}`);
  console.log(`  left alone (archived since the note was written): ${alreadyFine}`);
  console.log(`  book row missing: ${bookMissing}`);
  console.log(`  pages entering the archive queue: ${pagesQueued}`);
  if (EXECUTE && requeued) {
    console.log('\nThe :45 archive cron will now work through these. Watch:');
    console.log('  tail -f /var/log/sourcelibrary/archive-acquired.log');
  }
} finally {
  await client.close();
}
