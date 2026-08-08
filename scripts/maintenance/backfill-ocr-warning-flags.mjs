#!/usr/bin/env node
/**
 * Backfill `ocr.has_warning` over historical pages (#3756 provenance gap).
 *
 * Collectors stamp the flag at save time since 2026-08-08; history has years
 * of OCR whose <warning> tags — the model's own quality sensor, famously
 * unread through the false-split incident — are invisible to queries. One
 * bounded sweep makes them queryable.
 *
 * Only writes `true` (absent = unknown-or-none, matching the write-time
 * convention). Idempotent: skips pages already flagged. Dry-run by default.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/backfill-ocr-warning-flags.mjs
 *   node --env-file=.env.production.local scripts/maintenance/backfill-ocr-warning-flags.mjs --apply
 */

import { withMongo } from '../lib/mongo.mjs';

const APPLY = process.argv.includes('--apply');
const BATCH = 5000;

await withMongo(async (db) => {
  const pages = db.collection('pages');
  let scanned = 0, flagged = 0, lastId = null;

  for (;;) {
    const q = {
      'ocr.data': { $regex: '<warning[\\s>]', $options: 'i' },
      'ocr.has_warning': { $exists: false },
    };
    if (lastId) q._id = { $gt: lastId };
    const batch = await pages.find(q, { projection: { _id: 1 } })
      .sort({ _id: 1 }).limit(BATCH).toArray();
    if (batch.length === 0) break;
    scanned += batch.length;
    lastId = batch[batch.length - 1]._id;
    if (APPLY) {
      const r = await pages.updateMany(
        { _id: { $in: batch.map((d) => d._id) } },
        { $set: { 'ocr.has_warning': true } }
      );
      flagged += r.modifiedCount;
    } else {
      flagged += batch.length;
    }
    process.stderr.write(`\r  ${APPLY ? 'flagged' : 'would flag'}: ${flagged}   `);
  }
  process.stderr.write('\n');
  console.log(`${APPLY ? 'Flagged' : 'DRY RUN — would flag'} ${flagged} pages with <warning> OCR.`);
  if (!APPLY) console.log('Re-run with --apply to write.');
}, { timeoutMs: 4 * 3600_000, socketTimeoutMs: 30 * 60_000 });
