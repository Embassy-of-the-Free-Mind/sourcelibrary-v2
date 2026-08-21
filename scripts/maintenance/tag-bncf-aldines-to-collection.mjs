#!/usr/bin/env node
/**
 * Tag every BNCF Aldine (`ia_identifier` starting `ita-bnc-ald`) into the
 * `aldine-press` collection.
 *
 * Why this exists: the BNCF Aldine corpus arrived in several import waves, and
 * only the waves that ran through a curation pass got `collections` set. As of
 * 2026-08-21, 120 of 638 held items carried no `aldine-press` membership at all
 * (many had no `collections` array whatsoever), so they were invisible on
 * /collections/aldine-press despite being the single most on-theme material we
 * hold. Fresh imports from `bncf-aldine-direct.mjs` land with `collections`
 * unset too, so this is the finishing step after any BNCF import wave.
 *
 * Records a ROW per book in `sweep_log` (never a new field on `books`) —
 * see .claude/docs/invariants/field-sprawl.md.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/tag-bncf-aldines-to-collection.mjs --dry-run
 *   node --env-file=.env.production.local scripts/maintenance/tag-bncf-aldines-to-collection.mjs --apply
 */

import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;
const COLLECTION_SLUG = 'aldine-press';
const SWEEP = 'bncf-aldine-collection-tag-2026-08';

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI not set — pass --env-file=.env.production.local');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');

// Fail loudly if the target collection does not exist — tagging books into a
// slug nothing renders is a silent no-op, which is exactly the failure mode
// this script is fixing.
// `collections` docs are keyed by `slug` here, not by an `id` field — the
// books' `collections[]` entries match that slug.
const target = await db.collection('collections').findOne({
  $or: [{ slug: COLLECTION_SLUG }, { id: COLLECTION_SLUG }],
});
if (!target) {
  console.error(`Collection '${COLLECTION_SLUG}' not found in \`collections\` — aborting.`);
  await client.close();
  process.exit(1);
}
console.log(`Target collection: ${target.name} (${COLLECTION_SLUG})`);

// Never pull a taken-down book onto a collection surface. Books hidden for
// rights reasons must stay off every listing (see the Kloss incident and
// .claude/docs/invariants/visibility-and-stats.md); `same_edition_duplicate`
// and curation holds are NOT takedowns and stay eligible.
const TAKEDOWN_REASON = /takedown|copyright|dmca|rights|kloss/i;

const query = { ia_identifier: /^ita-bnc-ald/, collections: { $ne: COLLECTION_SLUG } };
const candidates = await db.collection('books')
  .find(query)
  .project({ id: 1, ia_identifier: 1, title: 1, published: 1, visible: 1, collections: 1, hidden_reason: 1 })
  .toArray();

const excluded = candidates.filter(b => b.hidden_reason && TAKEDOWN_REASON.test(b.hidden_reason));
const todo = candidates.filter(b => !(b.hidden_reason && TAKEDOWN_REASON.test(b.hidden_reason)));
if (excluded.length) {
  console.log(`Excluding ${excluded.length} book(s) hidden for rights reasons:`);
  for (const b of excluded) console.log(`  ${b.ia_identifier} (${b.hidden_reason})`);
}

console.log(`${todo.length} BNCF Aldines missing '${COLLECTION_SLUG}'`);
if (DRY_RUN) {
  for (const b of todo.slice(0, 15)) {
    console.log(`  would tag ${b.ia_identifier} ${b.published ?? '?'} vis=${b.visible} "${String(b.title).slice(0, 50)}"`);
  }
  if (todo.length > 15) console.log(`  ...and ${todo.length - 15} more`);
  console.log('\nDRY RUN — re-run with --apply to write.');
  await client.close();
  process.exit(0);
}

let tagged = 0, failed = 0;
for (const b of todo) {
  try {
    const res = await db.collection('books').updateOne(
      { _id: b._id },
      { $addToSet: { collections: COLLECTION_SLUG }, $set: { updated_at: new Date() } }
    );
    if (res.modifiedCount !== 1) {
      console.warn(`  WARN ${b.ia_identifier}: modifiedCount=${res.modifiedCount}`);
      failed++;
      continue;
    }
    await recordSweepAction(db, {
      sweep: SWEEP,
      book_id: b.id || b._id.toHexString(),
      action: 'collection-tagged',
      detail: { collection: COLLECTION_SLUG, ia_identifier: b.ia_identifier },
    });
    tagged++;
  } catch (err) {
    console.error(`  ERROR ${b.ia_identifier}: ${err.message}`);
    failed++;
  }
}

const remaining = await db.collection('books').countDocuments(query);
const total = await db.collection('books').countDocuments({ ia_identifier: /^ita-bnc-ald/ });
console.log(`\nTagged ${tagged}, failed ${failed}. ${total} BNCF Aldines held, ${remaining} still missing the tag` +
  `${excluded.length ? ` (${excluded.length} of those deliberately excluded for rights reasons)` : ''}.`);
console.log(`Next: bump the collection's updated_at and run the Supabase catalog sync so /collections/${COLLECTION_SLUG} reflects this.`);

await client.close();
