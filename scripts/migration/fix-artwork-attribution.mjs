#!/usr/bin/env node
/**
 * Fix artwork attribution: strip "(after)" from author names,
 * store as attribution_note field. GitHub issue #337.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/migration/fix-artwork-attribution.mjs [--dry-run]
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const client = new MongoClient(process.env.MONGODB_URI);

// Pattern: "Name (after)" or "Name (circle of)" etc.
const ATTRIBUTION_PATTERN = /^(.+?)\s*\((after|circle of|workshop of|manner of|follower of|school of|attributed to|style of)\)$/i;

// Non-artist names that should never generate artist pages
const NON_ARTIST_NAMES = [
  'Various',
  'Various (Rudolf II court)',
  'Unknown',
  'Unknown (Ferrara school)',
  'Anonymous',
  'Splendor Solis',
];

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  // 1. Fix "(after)" pattern in author names
  const withParens = await books.find(
    { author: ATTRIBUTION_PATTERN, resource_type: { $exists: true } },
    { projection: { author: 1, title: 1, slug: 1, _id: 1 } }
  ).toArray();

  console.log(`\nFound ${withParens.length} artworks with attribution qualifiers in author:`);
  for (const doc of withParens) {
    const match = doc.author.match(ATTRIBUTION_PATTERN);
    if (!match) continue;
    const cleanAuthor = match[1].trim();
    const note = match[2].toLowerCase();
    console.log(`  "${doc.author}" → "${cleanAuthor}" (${note}) — ${doc.title?.substring(0, 50)}`);
    if (!DRY_RUN) {
      await books.updateOne(
        { _id: doc._id },
        { $set: { author: cleanAuthor, attribution_note: note, updated_at: new Date() } }
      );
    }
  }

  // 2. Report non-artist author counts (informational — no migration needed)
  console.log('\nNon-artist author names (no migration needed, filtered in UI):');
  for (const name of NON_ARTIST_NAMES) {
    const count = await books.countDocuments({ author: name, resource_type: { $exists: true } });
    if (count > 0) console.log(`  ${name}: ${count}`);
  }

  // 3. Summary
  const total = await books.countDocuments({ resource_type: { $exists: true } });
  const withNote = await books.countDocuments({ attribution_note: { $exists: true } });
  console.log(`\nTotal artworks: ${total}`);
  console.log(`With attribution_note: ${withNote}`);

  await client.close();
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
