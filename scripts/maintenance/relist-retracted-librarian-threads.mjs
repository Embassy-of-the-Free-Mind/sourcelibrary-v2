#!/usr/bin/env node
/**
 * Put back the Librarian threads that the 2026-08-01 retraction took down —
 * this time without anybody's name on them.
 *
 * On 2026-08-01, unpublish-default-public-librarian-threads.mjs flipped 539
 * threads from 'public' to 'private' because the old default had published
 * them under their authors' real account names (#3505). That was right. It
 * also left the Recent feed at zero of 1,240 threads, permanently, because
 * nothing could refill it — every new thread defaulted private and the publish
 * toggle only worked before the first message.
 *
 * The rule now separates the two things that were one switch: a conversation
 * is listed, and no name travels with it. So the retraction can be undone on
 * its own terms — these 539 were listed before, and relisting them exposes
 * strictly less than what their authors actually saw at the time.
 *
 * SCOPE — this script touches ONLY threads carrying `visibility_retracted_at`.
 * That stamp is the exact record of "we took this down", which makes the set
 * something we can name rather than infer from dates:
 *
 *   539  stamped, currently private   → RELIST (515 have >=2 messages)
 *    20  pre-flip, author chose private, never stamped → LEAVE
 *   420  pre-flip anonymous 'unlisted', never listed   → LEAVE (relisting
 *        these would be new publication, not restoration)
 *   257  created after the flip, under "private by default" → LEAVE
 *
 * ORDER MATTERS. Run this only AFTER the anonymisation is live in production.
 * The Recent feed filters on visibility:'public' and the old code still serves
 * `creatorName` verbatim, so flipping these before the deploy would re-create
 * the original leak exactly — 537 signed-in threads back in the feed under
 * real names. The --apply path refuses to run until it has confirmed the
 * deployed API anonymises; see assertAnonymisationIsLive().
 *
 *   node scripts/maintenance/relist-retracted-librarian-threads.mjs            # dry run
 *   node scripts/maintenance/relist-retracted-librarian-threads.mjs --apply
 *   node scripts/maintenance/relist-retracted-librarian-threads.mjs --undo <backup.json>
 */

import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const undoIdx = process.argv.indexOf('--undo');
const UNDO = undoIdx !== -1 ? process.argv[undoIdx + 1] : null;
const ORIGIN = process.env.RELIST_ORIGIN || 'https://sourcelibrary.org';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Run with: node --env-file=.env.production.local scripts/...');
  process.exit(1);
}

const client = new MongoClient(uri);

/**
 * Refuse to publish into code that would leak.
 *
 * The check needs a positive control or "no name found" proves nothing: an
 * empty feed and a correctly anonymised one look identical. So it reads a
 * thread it knows exists and is anonymously readable, and looks for a field
 * only the new code emits (`isOwner`). A 200 that lacks it means the old
 * handler is still deployed.
 */
async function assertAnonymisationIsLive(threads) {
  const probe = await threads.findOne(
    { visibility: 'unlisted', messageCount: { $gte: 2 } },
    { projection: { _id: 1 } },
  );
  if (!probe) {
    throw new Error('No unlisted thread to probe with — cannot verify the deploy. Refusing.');
  }

  const url = `${ORIGIN}/api/embassy/threads/${probe._id.toString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'sourcelibrary-maintenance' } });
  if (!res.ok) {
    throw new Error(`Probe ${url} returned ${res.status} — expected 200. Refusing.`);
  }
  const data = await res.json();

  // Positive control: we know this thread exists and just read it.
  if (!Array.isArray(data.messages) || data.messages.length === 0) {
    throw new Error('Probe returned no messages — probe is not measuring anything. Refusing.');
  }
  if (typeof data.thread?.isOwner !== 'boolean') {
    throw new Error(
      'Deployed API has no `isOwner` field — the anonymisation is NOT live yet.\n' +
      'Merge and deploy the thread-visibility change first, or these threads go\n' +
      'back into the public feed under real names. Refusing.',
    );
  }
  const human = data.messages.find(m => m.authorType === 'human');
  if (human && human.authorName !== 'A reader') {
    throw new Error(
      `Deployed API served authorName="${human.authorName}" to an anonymous caller — ` +
      'expected "A reader". Refusing.',
    );
  }
  console.log(`Deploy check passed: ${url} anonymises (isOwner present, author "A reader").\n`);
}

async function main() {
  await client.connect();
  const threads = client.db('bookstore').collection('embassy_threads');

  if (UNDO) {
    const backup = JSON.parse(fs.readFileSync(UNDO, 'utf8'));
    const ids = backup.ids.map(id => new ObjectId(id));
    const res = await threads.updateMany(
      { _id: { $in: ids } },
      { $set: { visibility: 'private' } },
    );
    console.log(`Re-retracted ${res.modifiedCount} of ${ids.length} threads to private.`);
    return;
  }

  const filter = { visibility_retracted_at: { $exists: true }, visibility: 'private' };
  const docs = await threads
    .find(filter, { projection: { _id: 1, messageCount: 1, creatorId: 1, createdAt: 1 } })
    .toArray();

  const inFeed = docs.filter(d => (d.messageCount ?? 0) >= 2);
  const signedIn = docs.filter(d => d.creatorId != null);

  console.log(`retracted threads to relist: ${docs.length}`);
  console.log(`  will appear in Recent:     ${inFeed.length}`);
  console.log(`  authored while signed in:  ${signedIn.length} (names stay hidden)`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply (after the anonymisation is deployed).');
    return;
  }

  await assertAnonymisationIsLive(threads);

  const dir = path.join(process.cwd(), 'scripts', 'output');
  fs.mkdirSync(dir, { recursive: true });
  const backupPath = path.join(dir, `relist-librarian-threads-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    relisted_at: new Date().toISOString(),
    note: 'Threads moved private -> public (anonymised). Undo with --undo <this file>.',
    ids: docs.map(d => d._id.toString()),
  }, null, 2));
  console.log(`Backup written: ${backupPath}`);

  const res = await threads.updateMany(
    { _id: { $in: docs.map(d => d._id) } },
    { $set: { visibility: 'public' } },
  );
  console.log(`matched ${res.matchedCount}, modified ${res.modifiedCount}`);

  const remaining = await threads.countDocuments(filter);
  const nowPublic = await threads.countDocuments({ visibility: 'public', messageCount: { $gte: 2 } });
  console.log(`still retracted: ${remaining} (expect 0)`);
  console.log(`now in Recent feed: ${nowPublic}`);
}

main()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => client.close());
