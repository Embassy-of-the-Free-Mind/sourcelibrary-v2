#!/usr/bin/env node
/**
 * Backfill is_first_translation boolean from existing ai_metadata.
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-first-translation.mjs
 */

import { MongoClient } from 'mongodb';

const FIRST_STATUSES = ['confirmed_first', 'likely_first'];

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Pass 1: ai_metadata.first_translation.status → is_first_translation: true
  const r1 = await books.updateMany(
    { 'ai_metadata.first_translation.status': { $in: FIRST_STATUSES } },
    { $set: { is_first_translation: true, updated_at: new Date() } },
  );
  console.log(`Pass 1 (ai_metadata → true): ${r1.modifiedCount} books`);

  // Pass 2: first_translation_assessment.status (older field) → true, if not already set
  const r2 = await books.updateMany(
    {
      'first_translation_assessment.status': { $in: FIRST_STATUSES },
      is_first_translation: { $ne: true },
    },
    { $set: { is_first_translation: true, updated_at: new Date() } },
  );
  console.log(`Pass 2 (first_translation_assessment → true): ${r2.modifiedCount} books`);

  // Pass 3: everything else with ai_metadata but NOT first → false
  const r3 = await books.updateMany(
    {
      'ai_metadata.first_translation.status': { $exists: true },
      'ai_metadata.first_translation.status': { $nin: FIRST_STATUSES },
      is_first_translation: { $ne: true },
    },
    { $set: { is_first_translation: false, updated_at: new Date() } },
  );
  console.log(`Pass 3 (ai_metadata not-first → false): ${r3.modifiedCount} books`);

  // Summary
  const trueCount = await books.countDocuments({ is_first_translation: true });
  const falseCount = await books.countDocuments({ is_first_translation: false });
  const unsetCount = await books.countDocuments({ is_first_translation: { $exists: false } });
  console.log(`\nSummary: ${trueCount} true, ${falseCount} false, ${unsetCount} unset`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
