/**
 * Populate dedup fields (normalized_title, normalized_author, source_fingerprint)
 * on books_warehouse so checkDuplicate() can actually match against it, and add
 * the supporting indexes. Without this, ~56% of warehouse books are invisible to
 * the title/author dedup tier and we re-acquire books we already hold.
 *
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/maintenance/backfill-warehouse-dedup-fields.ts
 */
import { MongoClient } from 'mongodb';
import { backfillDedupFields } from '../../src/lib/dedup';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

  const c = new MongoClient(uri);
  await c.connect();
  const db = c.db(process.env.MONGODB_DB || 'bookstore');
  const col = db.collection('books_warehouse');

  console.log('Ensuring books_warehouse dedup indexes...');
  await col.createIndex({ source_fingerprint: 1 });
  await col.createIndex({ normalized_title: 1, normalized_author: 1 });
  await col.createIndex({ 'image_source.iiif_manifest': 1 });

  console.log('Backfilling dedup fields on books_warehouse...');
  const r = await backfillDedupFields(db, 'books_warehouse');
  console.log('Done:', JSON.stringify(r));

  await c.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
