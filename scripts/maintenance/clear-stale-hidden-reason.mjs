#!/usr/bin/env node
// One-time cleanup for issue #3334: unset stale `hidden_reason` on VISIBLE
// books. ~6.3K visible books carry residue (`launch_curation` 5,752,
// `unprocessed` 437, `unarchived` 64, …) from batch sweeps that flipped
// `visible: true` before the writers learned to $unset the reason — every
// current writer now clears it (set-launch-books.mjs, pipeline-orchestrator
// unhide paths, the visibility route), so this residue is purely historical.
// It misleads any consumer that reads the field as a state signal (the corpus
// exporter dropped 6,289 books this way, #3332).
//
// Touches ONLY the reason field on already-visible books — no visibility
// flips, so the takedown-sweep rule (never bulk-unhide by reason) is not in
// play. Rights-class reasons (copyright/takedown/dmca) are never unset, even
// on visible books: they're reported loudly for manual review instead.
//
// Usage:
//   set -a; source .env.production.local; set +a
//   node scripts/maintenance/clear-stale-hidden-reason.mjs             # dry-run
//   node scripts/maintenance/clear-stale-hidden-reason.mjs --apply \
//     --backup ~/sourcelibrary-ops/docs/backups/hidden-reason-backup.json
//
// Verify after: db.books.countDocuments({visible:true, hidden_reason:{$exists:true}}) → 0
// (modulo any rights-class rows, which are reported and kept).

import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../lib/mongo.mjs';

const APPLY = process.argv.includes('--apply');
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null; };
const BACKUP = argOf('--backup');

const RIGHTS_REASON_RE = /copyright|takedown|dmca|rights/i;

if (APPLY && !BACKUP) {
  console.error('--apply requires --backup <path> (id → reason provenance file)');
  process.exit(1);
}

await withMongo(async (db) => {
  const books = db.collection('books');
  const query = { visible: true, hidden_reason: { $exists: true } };

  const rows = await books.find(query)
    .project({ _id: 0, id: 1, slug: 1, hidden_reason: 1 })
    .toArray();

  const rights = rows.filter(r => RIGHTS_REASON_RE.test(String(r.hidden_reason)));
  const stale = rows.filter(r => !RIGHTS_REASON_RE.test(String(r.hidden_reason)));

  const byReason = {};
  for (const r of stale) byReason[r.hidden_reason] = (byReason[r.hidden_reason] || 0) + 1;
  console.log(`visible books with hidden_reason: ${rows.length}`);
  console.log(`stale (will unset): ${stale.length}`);
  for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}\t${reason}`);
  }
  if (rights.length) {
    console.log(`\nRIGHTS-CLASS reasons on VISIBLE books — NOT touched, review manually:`);
    for (const r of rights) console.log(`  ${r.id}\t${r.slug}\t${r.hidden_reason}`);
  }

  if (!APPLY) {
    console.log('\nDry-run (default). Re-run with --apply --backup <path> to unset.');
    return;
  }

  fs.mkdirSync(path.dirname(path.resolve(BACKUP)), { recursive: true });
  fs.writeFileSync(BACKUP, JSON.stringify({ cleared_at: new Date().toISOString(), issue: 3334, rows: stale }, null, 1));
  console.log(`\nBackup written: ${BACKUP} (${stale.length} rows)`);

  const res = await books.updateMany(
    { visible: true, hidden_reason: { $exists: true, $not: RIGHTS_REASON_RE } },
    { $unset: { hidden_reason: '' } },
  );
  console.log(`Unset hidden_reason on ${res.modifiedCount} books (matched ${res.matchedCount}).`);

  const remaining = await books.countDocuments(query);
  console.log(`Remaining visible-with-reason after cleanup: ${remaining} (expected ${rights.length})`);
});
