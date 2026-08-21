#!/usr/bin/env node
/**
 * Retract Librarian threads that were published by DEFAULT, not by choice.
 *
 * POST /api/embassy/chat defaulted `visibility` to 'public', and the client's
 * toggle started on 'public' too. A signed-in reader's conversation therefore
 * appeared in the public "Recent" feed (GET /api/embassy/threads) carrying
 * `creatorName` — their real account name. A reader wrote in on 2026-07-30 to
 * ask why her questions showed her first and last name.
 *
 * The default is now 'private'. This retracts what the old default published.
 *
 * Because nobody could opt out of a default they never saw, every existing
 * 'public' thread is treated as un-chosen and flipped to 'private'. Readers who
 * actually want a thread public can re-publish it from the toggle.
 *
 * The affected _ids are written to a backup file BEFORE any write, so the flip
 * is one command to reverse.
 *
 *   node scripts/maintenance/unpublish-default-public-librarian-threads.mjs            # dry run
 *   node scripts/maintenance/unpublish-default-public-librarian-threads.mjs --apply
 *   node scripts/maintenance/unpublish-default-public-librarian-threads.mjs --restore <backup.json>
 */

import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const restoreIdx = process.argv.indexOf('--restore');
const RESTORE = restoreIdx !== -1 ? process.argv[restoreIdx + 1] : null;

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Run with: set -a; source .env.production.local; set +a; node ...');
  process.exit(1);
}

const client = new MongoClient(uri);

async function main() {
  await client.connect();
  const threads = client.db('bookstore').collection('embassy_threads');

  if (RESTORE) {
    const backup = JSON.parse(fs.readFileSync(RESTORE, 'utf8'));
    const ids = backup.ids.map(id => new ObjectId(id));
    const res = await threads.updateMany(
      { _id: { $in: ids } },
      { $set: { visibility: 'public' }, $unset: { visibility_retracted_at: '' } },
    );
    console.log(`Restored ${res.modifiedCount} of ${ids.length} threads to public.`);
    return;
  }

  // Only threads that are actually reachable in the public feed. The feed
  // filters on messageCount >= 2, but retract every 'public' thread regardless
  // — a one-message thread gains a second message the moment it is continued.
  const filter = { visibility: 'public' };
  const docs = await threads
    .find(filter, { projection: { _id: 1, creatorName: 1, messageCount: 1, createdAt: 1 } })
    .toArray();

  const inFeed = docs.filter(d => (d.messageCount ?? 0) >= 2);
  const named = new Set(docs.map(d => d.creatorName).filter(Boolean));

  console.log(`public threads:            ${docs.length}`);
  console.log(`  currently in Recent feed: ${inFeed.length}`);
  console.log(`  distinct named creators:  ${named.size}`);
  console.log(`  names exposed:            ${[...named].join(', ')}`);

  if (!APPLY) {
    console.log('\nDRY RUN — no writes. Re-run with --apply to retract.');
    return;
  }

  const outDir = path.join(process.cwd(), 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(outDir, `librarian-public-threads-backup-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ retracted_at: new Date().toISOString(), ids: docs.map(d => d._id.toString()) }, null, 2),
  );
  console.log(`\nBackup written: ${backupPath}`);

  const res = await threads.updateMany(
    filter,
    { $set: { visibility: 'private', visibility_retracted_at: new Date() } },
  );
  console.log(`matched ${res.matchedCount}, modified ${res.modifiedCount}`);

  const remaining = await threads.countDocuments({ visibility: 'public' });
  console.log(`public threads remaining:  ${remaining}`);
  if (remaining !== 0) console.warn('WARNING: expected 0 public threads remaining.');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => client.close());
