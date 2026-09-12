#!/usr/bin/env node
/**
 * Kloss takedown enumeration repair — issue #4132.
 *
 * The takedown discipline keys on `hidden_reason`: that is how a sweep tells a
 * takedown apart from a merely-unprocessed hidden book. But only 813 of the
 * 1,517 `cmc_kloss` books carry a Kloss reason; the other 704 are `visible:
 * false` with a different or absent one. A sweep selecting `hidden_reason:
 * /kloss/i` therefore sees 54% of the set and reports success.
 *
 * Nothing is exposed today — all 1,517 are `visible: false` and the read gate
 * holds. This repairs the ENUMERATION, which is the half that failed in #4056.
 *
 * Only ever ADDS the reason to an already-hidden Kloss book. It never unhides
 * anything and never overwrites a reason that already names Kloss.
 *
 *   node --env-file=.env.production.local scripts/maintenance/kloss-hidden-reason-backfill.mjs [--apply]
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const REASON = 'kloss_manuscripts_removed_2026-07-08';
const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const books = client.db('bookstore').collection('books');

const KLOSS = { 'image_source.provider': 'cmc_kloss' };
const total = await books.countDocuments(KLOSS);
const hidden = await books.countDocuments({ ...KLOSS, visible: false });
const withReason = await books.countDocuments({ ...KLOSS, hidden_reason: /kloss/i });

console.log(`cmc_kloss books        : ${total}`);
console.log(`  visible: false       : ${hidden}`);
console.log(`  Kloss hidden_reason  : ${withReason}`);
console.log(`  MISSING the reason   : ${total - withReason}`);

// Refuse to touch anything that is not already hidden. If a Kloss book were
// visible, stamping a takedown reason on it would look like a takedown while
// leaving it public — worse than the gap being repaired.
const visibleKloss = await books.countDocuments({ ...KLOSS, visible: { $ne: false } });
if (visibleKloss > 0) {
  console.error(`\nREFUSING: ${visibleKloss} cmc_kloss book(s) are not visible:false. Hide them first, then re-run.`);
  await client.close();
  process.exit(1);
}

const targets = { ...KLOSS, visible: false, hidden_reason: { $not: /kloss/i } };
const sample = await books.find(targets, { projection: { slug: 1, hidden_reason: 1 } }).limit(5).toArray();
console.log('\nsample of what would change:');
for (const s of sample) console.log(`  ${String(s.slug).slice(0, 52).padEnd(54)} reason=${JSON.stringify(s.hidden_reason ?? null)}`);

if (!APPLY) {
  console.log(`\nDRY RUN — would set hidden_reason on ${await books.countDocuments(targets)} book(s). Pass --apply to write.`);
  await client.close();
  process.exit(0);
}

// Preserve what was there. The reasons being replaced are not merely unhelpful,
// they are FALSE — all 704 carry `pages_count > 0` and real page documents while
// claiming `no-pages-catalog-stub` (532) or `unprocessed` (172). They were
// presumably stamped before the pages landed and never revisited. Keeping the
// prior value means this sweep is reversible and auditable rather than a
// destructive overwrite of provenance.
const res = await books.updateMany(targets, [
  {
    $set: {
      hidden_reason_prior: { $ifNull: ['$hidden_reason', null] },
      hidden_reason: REASON,
      hidden_reason_backfilled_at: '$$NOW',
      updated_at: '$$NOW',
    },
  },
]);
console.log(`\nmatched=${res.matchedCount} modified=${res.modifiedCount}`);

// The invariant this exists to establish, asserted rather than assumed.
const remaining = await books.countDocuments({ ...KLOSS, hidden_reason: { $not: /kloss/i } });
console.log(`VERIFY cmc_kloss without a Kloss reason: ${remaining} ${remaining === 0 ? '(OK)' : '(STILL BROKEN)'}`);
await client.close();
process.exit(remaining === 0 ? 0 : 1);
