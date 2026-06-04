#!/usr/bin/env node
/**
 * Derive `books.sensitive: true` from erotic-collection membership — step 1 of
 * the sensitive-content gate (issue #2431).
 *
 * Policy (Derek, 2026-06-04): erotic content stays fully readable inside its
 * collections, but must not surface on global discovery surfaces (gallery
 * feed, homepage pickers, search, similar-images, browse covers). The
 * book-level flag is the signal those read paths will exclude on once the
 * gate ships; until then it also drives the materialization hold in
 * scripts/workers/generate-thumbnails.mjs (crops for sensitive books are not
 * generated, preserving the status-quo hold-out).
 *
 * Additive only: never unsets `sensitive` (a book may be flagged manually for
 * reasons other than collection membership). Books flagged but no longer in
 * an erotic collection are reported for human review.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/flag-sensitive-books.mjs            # dry run
 *   node scripts/maintenance/flag-sensitive-books.mjs --apply
 */

import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');

// Collection slugs whose members are sensitive. Keep in sync with issue #2431.
const SENSITIVE_COLLECTIONS = [
  'erotic-art',
  'eastern-erotic-literature',
  'european-vernacular-erotica',
  'kama',
  'erotic-literature', // orphan legacy tag, still present on some books
];

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books');

  const memberFilter = { collections: { $in: SENSITIVE_COLLECTIONS } };
  const toFlag = await books.countDocuments({ ...memberFilter, sensitive: { $ne: true } });
  const already = await books.countDocuments({ ...memberFilter, sensitive: true });
  console.log(`members of sensitive collections: ${toFlag + already} (${already} already flagged, ${toFlag} to flag)`);

  if (APPLY && toFlag > 0) {
    const r = await books.updateMany({ ...memberFilter, sensitive: { $ne: true } }, { $set: { sensitive: true } });
    console.log(`flagged: ${r.modifiedCount}`);
  } else if (!APPLY) {
    console.log('(dry run — pass --apply to write)');
  }

  // Flagged but no longer a member — report only, never auto-unset.
  const stale = await books.find(
    { sensitive: true, collections: { $nin: SENSITIVE_COLLECTIONS } },
    { projection: { id: 1, title: 1, collections: 1 } },
  ).limit(20).toArray();
  if (stale.length > 0) {
    console.log(`\nflagged but not in a sensitive collection (review by hand, not auto-unset):`);
    stale.forEach(b => console.log(`  ${b.id} ${(b.title || '').slice(0, 60)}`));
  }

  await client.close();
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
