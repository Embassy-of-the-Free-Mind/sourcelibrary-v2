/**
 * Backfill the language-keyed translations map (#2835).
 *
 * Copies the legacy per-language field `pages.translation_es` into the general
 * `pages.translations.es` map, so the new read path (src/lib/page-translations.ts)
 * sees pilot Spanish content under the canonical model.
 *
 * - Additive + idempotent: only sets translations.es when translation_es exists
 *   and translations.es is absent. Never deletes translation_es (the legacy
 *   field stays readable; the es-translate worker can be migrated separately).
 * - $0, no model calls.
 *
 *   node scripts/maintenance/backfill-translations-map.mjs            # dry-run
 *   node scripts/maintenance/backfill-translations-map.mjs --apply
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const uri = process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.DATABASE_URL;
const c = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const pages = db.collection('pages');

const filter = {
  'translation_es.data': { $type: 'string', $ne: '' },
  $or: [{ 'translations.es.data': { $exists: false } }, { 'translations.es.data': '' }, { 'translations.es.data': null }],
};

const total = await pages.countDocuments(filter, { maxTimeMS: 60000 }).catch((e) => `err:${e.codeName}`);
console.log(`MODE: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log(`pages with legacy translation_es needing translations.es backfill: ${total}`);

if (!APPLY) {
  const sample = await pages.find(filter, { projection: { id: 1, book_id: 1, page_number: 1, 'translation_es.model': 1 } }).limit(5).toArray();
  console.log('sample:', sample.map((p) => `${p.book_id} p${p.page_number}`).join(', '));
  console.log('\nDRY-RUN — re-run with --apply to write translations.es from translation_es.');
  await c.close();
  process.exit(0);
}

// Copy in batches via aggregation-pipeline update ($set translations.es = translation_es).
let modified = 0;
const cursor = pages.find(filter, { projection: { _id: 1, translation_es: 1 } }).batchSize(500);
const ops = [];
for await (const p of cursor) {
  ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { 'translations.es': p.translation_es } } } });
  if (ops.length >= 500) {
    const r = await pages.bulkWrite(ops, { ordered: false });
    modified += r.modifiedCount;
    ops.length = 0;
    await new Promise((r) => setTimeout(r, 50)); // throttle IOPS
  }
}
if (ops.length) {
  const r = await pages.bulkWrite(ops, { ordered: false });
  modified += r.modifiedCount;
}
console.log(`backfilled translations.es on ${modified} pages.`);
await c.close();
