#!/usr/bin/env node
/**
 * ingest-keeper-choice-queue.mjs (#3846) — load a keeper-choice triage
 * snapshot (scripts/output/keeper-choice-triage-*.json, produced by the
 * 2026-08-09 triage run) into the `edition_keeper_queue` collection so the
 * decisions stop living in gitignored JSON on one machine and become
 * reviewable at /admin/identity-review.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/ingest-keeper-choice-queue.mjs --file scripts/output/keeper-choice-triage-2026-08-09.json
 *   node scripts/maintenance/ingest-keeper-choice-queue.mjs --file ... --apply
 *
 * Upserts by edition_key. NEVER clobbers a row that has already been
 * reviewed (status != pending) — re-ingesting a newer triage only refreshes
 * pending rows' classification.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const fileArg = (process.argv.find((a) => a.startsWith('--file=')) || '').split('=')[1]
  || process.argv[process.argv.indexOf('--file') + 1];
if (!fileArg || !fs.existsSync(fileArg)) {
  console.error('usage: node ingest-keeper-choice-queue.mjs --file <triage.json> [--apply]');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(fileArg, 'utf8'));
const clusters = data.clusters || [];
console.log(`${fileArg}: ${clusters.length} clusters (generated ${data.generated})`);
for (const s of data.summary || []) console.log(`  ${s.bucket}: ${s.clusters} clusters / ${s.books} books`);

if (!APPLY) {
  console.log('\nDRY-RUN — pass --apply to upsert into edition_keeper_queue.');
  process.exit(0);
}

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db(process.env.MONGODB_DB || 'bookstore');
const queue = db.collection('edition_keeper_queue');

const now = new Date();
let inserted = 0, refreshed = 0, skippedReviewed = 0;
for (const c of clusters) {
  if (!c.edition_key || !Array.isArray(c.members) || c.members.length < 2) continue;
  try {
    const r = await queue.updateOne(
      { _id: c.edition_key, $or: [{ status: 'pending' }, { status: { $exists: false } }] },
      {
        $setOnInsert: { status: 'pending', created_at: now },
        $set: {
          bucket: c.bucket,
          keeper_suggested: c.keeper || null,
          ft_flag: c.ft_flag === true,
          page_ratio: c.page_ratio ?? null,
          members: c.members,
          source_file: fileArg.split('/').pop(),
          generated_at: data.generated || null,
          updated_at: now,
        },
      },
      { upsert: true }
    );
    if (r.upsertedCount) inserted++;
    else refreshed++;
  } catch (e) {
    // E11000: the row exists but is already reviewed (filter missed, upsert
    // tried to re-insert the _id) — exactly the case we must leave alone.
    if (e.code === 11000) skippedReviewed++;
    else throw e;
  }
}

const counts = await queue.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();
console.log(`\nUPSERTED — ${inserted} new, ${refreshed} pending refreshed, ${skippedReviewed} already-reviewed left untouched.`);
console.log('queue status:', counts.map((c) => `${c._id}=${c.n}`).join('  '));
await mc.close();
