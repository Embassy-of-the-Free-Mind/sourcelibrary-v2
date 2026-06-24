#!/usr/bin/env node
/**
 * One-time deploy backfill for Phase 1.97 (trailing-dupe dedup).
 *
 * `pipeline_auto.dedup_complete` is a new field, unset on every existing book.
 * Phase 2 (OCR) now gates on `dedup_complete: true` (when Phase 1.97 is not
 * paused). Deploying that gate naively would throttle OCR to ~50 books/tick
 * while the CURRENT archive_complete backlog drains through Phase 1.97.
 *
 * This marks every book already at/past archive_complete as deduped, so the
 * gate applies only to books promoted AFTER deploy (which flow cleanly in-tick,
 * 1.97 → 2). The existing backlog's dupes are out of scope for the live gate by
 * design — run `scripts/maintenance/dedup-ia-trailing-pages.mjs --apply` once
 * over the backlog separately if those savings are wanted.
 *
 * Run from an Atlas-allowlisted host (e.g. the Hetzner box) — a dev machine IP
 * is typically not allowlisted.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-dedup-complete.mjs            # dry-run (count only)
 *   node scripts/maintenance/backfill-dedup-complete.mjs --apply    # write
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const APPLY = process.argv.includes('--apply');

// archive_complete is the gated state. Books PAST it (ocr_submitted onward) are
// already in/through OCR, so they also never need re-dedup-gating. Mark both so
// a book that advances between this backfill and deploy isn't stranded.
const PAST_OR_AT_GATE = [
  'archive_complete', 'ocr_submitted', 'ocr_complete',
  'translate_submitted', 'translate_partial', 'translate_complete',
  'enriched', 'chapters_complete', 'images_submitted', 'images_complete', 'complete',
];

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const filter = {
    'pipeline_auto.status': { $in: PAST_OR_AT_GATE },
    'pipeline_auto.dedup_complete': { $exists: false },
  };

  const count = await db.collection('books').countDocuments(filter);
  console.log(`[backfill-dedup-complete] ${APPLY ? 'APPLY' : 'DRY RUN'} — ${count} books at/past archive_complete missing dedup_complete`);

  if (APPLY && count > 0) {
    const r = await db.collection('books').updateMany(filter, {
      $set: { 'pipeline_auto.dedup_complete': true },
    });
    console.log(`  Marked ${r.modifiedCount} books dedup_complete=true`);
  } else if (!APPLY) {
    console.log('  (dry-run — re-run with --apply to write)');
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
