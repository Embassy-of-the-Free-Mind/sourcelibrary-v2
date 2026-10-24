#!/usr/bin/env node
/**
 * One-time re-queue of pages that archive-ocr gave up on because of quota refusals (#7228).
 *
 * PRIOR ART: /mnt/HC_Volume_105839809/jobs/zhla-archive-7176/runner/requeue.mjs (the #7176 stopgap,
 * on the main Hetzner box) — the same filter for the 1,654 #7176 BSB books only; this is it run
 * corpus-wide, once, now that archive-ocr no longer counts throttles. clear-transient-archive-failures.mjs
 * clears a different thing: the `archived_photo: "failed:…"` markers other archivers write.
 *
 * THE PROBLEM
 * archive-ocr.mjs counted every HTTP 429/503 in `archive_metadata.failure_count` and skips a page at 3.
 * A quota refusal is not a broken page; on 2026-10-23, 11,533 pages in the #7176 BSB set were capped
 * that way against 12 for real 404s. archive-ocr now records a throttle in `throttled_count` instead,
 * so no new page is capped this way; this script frees the ones already capped.
 *
 * WHAT IT WRITES
 * On pages with no archived image, `failure_count` ≥ 3, and a LAST failure that was a throttle
 * (THROTTLED_FAILURE_REASON): unset `failure_count`, keep `last_failure_*` as provenance, stamp
 * `requeued_throttled_at` / `requeued_by`. One sweep_log row per book touched.
 * WHAT READS IT: archive-ocr.mjs on its next scheduler run (about every 20 min). It only fetches
 * images, which is free, at each domain's rate limit; BSB's daily quota bounds how fast it drains.
 * A page whose last failure was a 404 or anything else stays capped.
 *
 *   node --env-file=.env.production.local scripts/maintenance/requeue-throttled-archive-pages-7228.mjs          # dry run
 *   node --env-file=.env.production.local scripts/maintenance/requeue-throttled-archive-pages-7228.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { THROTTLED_FAILURE_REASON } from '../lib/archive-failure-class.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'requeue-throttled-archive-7228';
const UNARCHIVED = [{ archived_photo: { $exists: false } }, { archived_photo: null }, { archived_photo: '' }];
const capped = (book_id) => ({
  book_id,
  $or: UNARCHIVED,
  'archive_metadata.failure_count': { $gte: 3 },
  'archive_metadata.last_failure_reason': THROTTLED_FAILURE_REASON,
});

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const pages = db.collection('pages');

// Books with any page still unarchived; `book_id` is indexed on pages, so each book is one cheap query.
const bookIds = await db.collection('books')
  .find({ pages_count: { $gt: 0 }, $expr: { $lt: [{ $ifNull: ['$pages_archived', 0] }, '$pages_count'] } }, { projection: { id: 1 } })
  .map((b) => b.id).toArray();
console.log(`[${SWEEP}] ${bookIds.length} books with unarchived pages; ${APPLY ? 'APPLY' : 'dry run'}`);

let found = 0, requeued = 0;
const logRows = [];
const byHost = new Map();
for (let i = 0; i < bookIds.length; i += 100) {
  for (const id of bookIds.slice(i, i + 100)) {
    const n = await pages.countDocuments(capped(id));
    if (!n) continue;
    found += n;
    const sample = await pages.findOne(capped(id), { projection: { photo: 1 } });
    const host = (() => { try { return new URL(sample.photo).hostname; } catch { return '?'; } })();
    byHost.set(host, (byHost.get(host) || 0) + n);
    if (!APPLY) continue;
    const r = await pages.updateMany(capped(id), {
      $unset: { 'archive_metadata.failure_count': '' },
      $set: { 'archive_metadata.requeued_throttled_at': new Date(), 'archive_metadata.requeued_by': SWEEP },
    });
    requeued += r.modifiedCount;
    logRows.push({ sweep: SWEEP, book_id: id, action: 'requeued-throttled-pages', detail: { pages: r.modifiedCount, host, issue: '#7228' } });
  }
  if (APPLY && logRows.length >= 500) await recordSweepActions(db, logRows.splice(0));
}
if (APPLY && logRows.length) await recordSweepActions(db, logRows);

console.log(`[${SWEEP}] throttle-capped pages: ${found}${APPLY ? `, requeued ${requeued}` : ''}`);
for (const [host, n] of [...byHost].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(8)}  ${host}`);
if (!APPLY) console.log('-- dry run (add --apply) --');
await mc.close();
