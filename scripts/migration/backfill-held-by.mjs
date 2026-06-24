#!/usr/bin/env node
/**
 * Backfill `held_by` array on all books.
 *
 * Phase 1: Set held_by = [image_source.provider] for all books with a provider
 * Phase 2: Add 'bph' to held_by for books that match BPH catalog (via dublin_core.dc_identifier UBN)
 * Phase 3: Add 'bph' to held_by for cmc_kloss books (Kloss is a BPH sub-collection)
 * Phase 4: Create index on { held_by: 1, visible: 1, pages_count: 1 }
 *
 * Usage:
 *   node scripts/migration/backfill-held-by.mjs --dry-run    # Preview (default)
 *   node scripts/migration/backfill-held-by.mjs --apply       # Write to DB
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

// Load env
function loadEnv() {
  for (const f of ['.env.production.local', '.env.local']) {
    try {
      const content = fs.readFileSync(f, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
        }
      }
    } catch { /* skip */ }
  }
}

loadEnv();

const DRY_RUN = !process.argv.includes('--apply');
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}\n`);

  // Phase 1: Set held_by = [provider] for all books that have a provider but no held_by
  const withProvider = await books.countDocuments({
    'image_source.provider': { $exists: true, $ne: null },
    held_by: { $exists: false },
  });
  console.log(`Phase 1: ${withProvider} books with provider but no held_by`);

  if (!DRY_RUN && withProvider > 0) {
    const result = await books.updateMany(
      {
        'image_source.provider': { $exists: true, $ne: null },
        held_by: { $exists: false },
      },
      [{ $set: { held_by: ['$image_source.provider'] } }]
    );
    console.log(`  Updated: ${result.modifiedCount}`);
  }

  // Phase 2: Add 'bph' to held_by for cmc_kloss books (Kloss is BPH sub-collection)
  const klossBooks = await books.countDocuments({
    'image_source.provider': 'cmc_kloss',
    held_by: { $not: { $elemMatch: { $eq: 'bph' } } },
  });
  console.log(`Phase 2: ${klossBooks} Kloss books missing 'bph' in held_by`);

  if (!DRY_RUN && klossBooks > 0) {
    const result = await books.updateMany(
      {
        'image_source.provider': 'cmc_kloss',
        held_by: { $not: { $elemMatch: { $eq: 'bph' } } },
      },
      { $addToSet: { held_by: 'bph' } }
    );
    console.log(`  Updated: ${result.modifiedCount}`);
  }

  // Phase 3: Match books against BPH catalog via dublin_core.dc_identifier (UBN)
  // Books imported from other providers (MDZ, IA, etc.) that BPH also holds
  // Fetch all BPH UBNs from Supabase to cross-reference
  console.log('Phase 3: Fetching BPH catalog UBNs from Supabase...');
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Fetch all UBNs from bph_works (paginated, Supabase limit is 1000)
  const bphUbns = new Set();
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bph_works?select=ubn&offset=${offset}&limit=${PAGE}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const data = await res.json();
    if (!data.length) break;
    for (const row of data) if (row.ubn) bphUbns.add(row.ubn);
    offset += PAGE;
    if (data.length < PAGE) break;
  }
  console.log(`  Loaded ${bphUbns.size} BPH catalog UBNs`);

  // Find non-BPH books whose dc_identifier matches a BPH UBN
  const booksWithUbn = await books.find(
    {
      'dublin_core.dc_identifier': { $exists: true, $ne: null },
      'image_source.provider': { $ne: 'bph' },
    },
    { projection: { _id: 1, id: 1, title: 1, 'dublin_core.dc_identifier': 1, 'image_source.provider': 1, held_by: 1 } }
  ).toArray();

  const bphMatches = booksWithUbn.filter(b => {
    const ubn = b.dublin_core?.dc_identifier;
    return ubn && bphUbns.has(String(ubn));
  });
  // Exclude books already tagged
  const toTag = bphMatches.filter(b => !b.held_by || !b.held_by.includes('bph'));
  console.log(`  ${booksWithUbn.length} non-BPH books with dc_identifier, ${bphMatches.length} match BPH catalog, ${toTag.length} need tagging`);

  if (!DRY_RUN && toTag.length > 0) {
    let matched = 0;
    for (const book of toTag) {
      await books.updateOne(
        { _id: book._id },
        { $addToSet: { held_by: 'bph' } }
      );
      matched++;
    }
    console.log(`  Added 'bph' to held_by for ${matched} books`);
  }

  // Phase 4: Create compound index
  console.log('\nPhase 4: Index { held_by: 1, visible: 1, pages_count: 1 }');
  if (!DRY_RUN) {
    try {
      await books.createIndex(
        { held_by: 1, visible: 1, pages_count: 1 },
        { name: 'held_by_visible_pages', background: true }
      );
      console.log('  Index created');
    } catch (e) {
      console.log(`  Index error: ${e.message}`);
    }
  }

  // Summary
  const totalHeldBy = await books.countDocuments({ held_by: { $exists: true } });
  const bphHeldBy = await books.countDocuments({ held_by: 'bph' });
  console.log(`\nSummary:`);
  console.log(`  Books with held_by: ${totalHeldBy}`);
  console.log(`  Books held by BPH: ${bphHeldBy}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
