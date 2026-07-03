#!/usr/bin/env node
/**
 * Reconcile `is_first_translation` against catalog_search evidence.
 *
 * The search-translation-evidence.mjs pipeline writes
 * `translation_verification.has_english_translation` based on Open Library /
 * Google Books / Internet Archive results, but does NOT update the boolean
 * `is_first_translation` flag itself. This script does the reconciliation:
 *
 *  A1) is_first_translation unset + catalog says NO translation → set true
 *  A2) is_first_translation unset + catalog says YES translation → set false
 *  B)  is_first_translation=true + catalog says YES translation → flip to false
 *
 * Usage:
 *   node scripts/maintenance/reconcile-ft-from-catalog.mjs              # dry-run
 *   node scripts/maintenance/reconcile-ft-from-catalog.mjs --apply      # write
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

function loadEnv() {
  const env = {};
  try {
    const content = fs.readFileSync('.env.production.local', 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        env[m[1].trim()] = v;
      }
    }
  } catch {}
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';

async function main() {
  const dryRun = !process.argv.includes('--apply');
  console.log('=== Reconcile is_first_translation from catalog_search evidence ===');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'APPLYING');
  console.log();

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 3, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB);

  const A1 = { 'translation_verification.source': 'catalog_search',
               'translation_verification.has_english_translation': false,
               is_first_translation: { $exists: false } };
  const A2 = { 'translation_verification.source': 'catalog_search',
               'translation_verification.has_english_translation': true,
               is_first_translation: { $exists: false } };
  const B  = { is_first_translation: true,
               'translation_verification.source': 'catalog_search',
               'translation_verification.has_english_translation': true };

  const nA1 = await db.collection('books').countDocuments(A1);
  const nA2 = await db.collection('books').countDocuments(A2);
  const nB  = await db.collection('books').countDocuments(B);

  console.log(`A1) Set is_first=true  (unset + catalog NO trans):  ${nA1}`);
  console.log(`A2) Set is_first=false (unset + catalog YES trans): ${nA2}`);
  console.log(`B)  FLIP is_first→false (true→false, catalog YES): ${nB}`);
  console.log();

  if (dryRun) {
    console.log('Dry-run complete. Re-run with --apply.');
    await client.close();
    return;
  }

  const now = new Date();
  let totalUpdated = 0;

  // A1
  {
    const provenance = {
      source: 'catalog_search_reconciliation',
      method: 'catalog_no_translation_found',
      date: now,
      confidence: 'medium',
      script: 'reconcile-ft-from-catalog.mjs',
    };
    const r = await db.collection('books').updateMany(A1, {
      $set: {
        is_first_translation: true,
        updated_at: now,
        'field_provenance.is_first_translation': provenance,
      },
    });
    console.log(`A1) set FT=true on ${r.modifiedCount} books`);
    totalUpdated += r.modifiedCount;
  }

  // A2
  {
    const provenance = {
      source: 'catalog_search_reconciliation',
      method: 'catalog_found_existing_translation',
      date: now,
      confidence: 'high',
      script: 'reconcile-ft-from-catalog.mjs',
    };
    const r = await db.collection('books').updateMany(A2, {
      $set: {
        is_first_translation: false,
        updated_at: now,
        'field_provenance.is_first_translation': provenance,
      },
    });
    console.log(`A2) set FT=false on ${r.modifiedCount} books`);
    totalUpdated += r.modifiedCount;
  }

  // B — FLIP. Preserve the prior is_first_translation provenance in
  // field_provenance.is_first_translation_prior for auditability.
  {
    const provenance = {
      source: 'catalog_search_reconciliation',
      method: 'flipped_from_true_after_catalog_evidence',
      date: now,
      confidence: 'high',
      script: 'reconcile-ft-from-catalog.mjs',
      note: 'Was previously flagged is_first_translation:true; catalog search subsequently found a published English translation. Prior provenance preserved in field_provenance.is_first_translation_prior.',
    };

    let flipped = 0;
    const cursor = db.collection('books').find(B).project({ _id: 1, id: 1, field_provenance: 1 });
    for await (const book of cursor) {
      const set = {
        is_first_translation: false,
        updated_at: now,
        'field_provenance.is_first_translation': provenance,
      };
      // Preserve prior provenance if present
      const prior = book.field_provenance?.is_first_translation;
      if (prior) set['field_provenance.is_first_translation_prior'] = prior;
      const r = await db.collection('books').updateOne({ _id: book._id }, { $set: set });
      if (r.modifiedCount === 1) flipped++;
    }
    console.log(`B)  flipped FT true→false on ${flipped} books`);
    totalUpdated += flipped;
  }

  console.log();
  console.log(`Done. Total updates: ${totalUpdated}`);
  await client.close();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
