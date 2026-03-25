#!/usr/bin/env node
/**
 * Migrate books with generic 'iiif' provider to their proper provider keys.
 * Matches on provider_name and iiif_manifest URL patterns.
 *
 * Usage:
 *   DRY_RUN=1 node scripts/migrate-iiif-providers.mjs   # preview only
 *   node scripts/migrate-iiif-providers.mjs               # apply changes
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.env.DRY_RUN === '1';

// Migration rules: match by provider_name first, then by iiif_manifest URL pattern
const MIGRATIONS = [
  // By provider_name (exact match)
  { match: { 'image_source.provider_name': 'e-rara (Swiss rare books)' }, provider: 'e-rara' },
  { match: { 'image_source.provider_name': 'Bibliotheca Philosophica Hermetica' }, provider: 'efm' },
  { match: { 'image_source.provider_name': 'Allard Pierson (BPH/Ritman Library)' }, provider: 'efm' },
  { match: { 'image_source.provider_name': 'Vatican Library' }, provider: 'vatican' },
  { match: { 'image_source.provider_name': 'British Library' }, provider: 'bl' },
  { match: { 'image_source.provider_name': 'Bayerische Staatsbibliothek' }, provider: 'mdz' },
  { match: { 'image_source.provider_name': 'Gallica (BnF)' }, provider: 'gallica' },
  { match: { 'image_source.provider_name': 'Library of Congress' }, provider: 'loc' },
  { match: { 'image_source.provider_name': 'Universitätsbibliothek Heidelberg' }, provider: 'heidelberg' },

  // Fallback: match by iiif_manifest URL (catches any missed by name)
  { match: { 'image_source.iiif_manifest': { $regex: 'e-rara\\.ch' } }, provider: 'e-rara' },
  { match: { 'image_source.iiif_manifest': { $regex: 'digi\\.vatlib\\.it' } }, provider: 'vatican' },
  { match: { 'image_source.iiif_manifest': { $regex: 'bl\\.digirati\\.io|\\.bl\\.uk' } }, provider: 'bl' },
  { match: { 'image_source.iiif_manifest': { $regex: 'gallica\\.bnf\\.fr' } }, provider: 'gallica' },
  { match: { 'image_source.iiif_manifest': { $regex: 'loc\\.gov' } }, provider: 'loc' },
  { match: { 'image_source.iiif_manifest': { $regex: 'digitale-sammlungen\\.de' } }, provider: 'mdz' },
  { match: { 'image_source.iiif_manifest': { $regex: 'digi\\.ub\\.uni-heidelberg\\.de' } }, provider: 'heidelberg' },
];

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const books = db.collection('books');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE MIGRATION ===');
  console.log();

  let totalMigrated = 0;

  for (const rule of MIGRATIONS) {
    const filter = {
      'image_source.provider': 'iiif',
      ...rule.match,
    };

    const count = await books.countDocuments(filter);
    if (count === 0) continue;

    console.log(`${rule.provider}: ${count} books (matched by ${Object.keys(rule.match)[0]})`);

    if (!DRY_RUN) {
      const result = await books.updateMany(filter, {
        $set: { 'image_source.provider': rule.provider },
      });
      console.log(`  → updated ${result.modifiedCount}`);
      totalMigrated += result.modifiedCount;
    } else {
      totalMigrated += count;
    }
  }

  // Show remaining iiif books
  const remaining = await books.countDocuments({
    'image_source.provider': 'iiif',
    status: { $ne: 'deleted' },
    pages_count: { $gt: 0 },
  });

  console.log();
  console.log(`Total migrated: ${totalMigrated}`);
  console.log(`Remaining as iiif: ${remaining}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
