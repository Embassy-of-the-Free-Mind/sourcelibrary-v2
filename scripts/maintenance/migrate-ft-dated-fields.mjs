#!/usr/bin/env node
/**
 * Backfill: copy the legacy date-stamped first-translation markers to their
 * stable names on translation_verification (#2332 Task 2).
 *
 *   audit_applied_2026_05_30     → audit_applied
 *   discovery_estimate_2026_05_30 → discovery_estimate
 *   discovery_applied_2026_05_30  → discovery_applied
 *   catalog_lookup_2026_05_30     → catalog_lookup
 *
 * Additive + idempotent + reversible: each field is copied ONLY when the legacy
 * value exists and the stable target is absent; the legacy field is left in
 * place (nothing is deleted). Safe to re-run.
 *
 * The writers/skip-filters already dual-read (stable OR legacy), so this backfill
 * is NOT required for correctness — it exists so a later cleanup PR can drop the
 * legacy branch once every doc carries the stable name. (prior_translations_*
 * is intentionally excluded — its writer, discover-prior-translations.mjs / #2244,
 * is not yet merged to main.)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/migrate-ft-dated-fields.mjs            # dry run (counts only)
 *   node scripts/maintenance/migrate-ft-dated-fields.mjs --apply    # write
 */
import { MongoClient } from 'mongodb';

const apply = process.argv.includes('--apply');
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const TV = 'translation_verification';
const FIELDS = [
  'audit_applied',
  'discovery_estimate',
  'discovery_applied',
  'catalog_lookup',
];

const client = await MongoClient.connect(uri);
const books = client.db(process.env.MONGODB_DB || 'bookstore').collection('books');

console.log(`=== Migrate FT dated fields → stable names (${apply ? 'APPLYING' : 'DRY RUN'}) ===\n`);

let grandTotal = 0;
for (const stable of FIELDS) {
  const legacy = `${stable}_2026_05_30`;
  const filter = {
    [`${TV}.${legacy}`]: { $exists: true },
    [`${TV}.${stable}`]: { $exists: false },
  };
  const pending = await books.countDocuments(filter);
  grandTotal += pending;

  if (!apply) {
    console.log(`  ${legacy} → ${stable}: ${pending} doc(s) would be copied`);
    continue;
  }
  if (pending === 0) { console.log(`  ${legacy} → ${stable}: 0 (nothing to do)`); continue; }

  const res = await books.updateMany(filter, [
    { $set: { [`${TV}.${stable}`]: `$${TV}.${legacy}` } },
  ]);
  console.log(`  ${legacy} → ${stable}: matched ${res.matchedCount}, modified ${res.modifiedCount}`);
}

console.log(`\n${apply ? 'Done.' : `Dry run — ${grandTotal} total copies pending. Re-run with --apply to write.`}`);
await client.close();
