/**
 * Exact text-byte measurement + seed recalibration for the nightly
 * storage-stats cron (issue #2972).
 *
 * Full-scans `pages` summing byte lengths of ocr.data and translation.data
 * (~80 min server-side on 13M docs), then writes the result as
 * system_config.storage_stats.text_seed. The nightly cron scales this seed
 * by pages-collection growth; rerun this occasionally (quarterly, or after
 * schema changes) to recalibrate.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/storage-stats-fullscan.mjs
 */
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI, {
  socketTimeoutMS: 0,
  serverSelectionTimeoutMS: 15000,
});
await client.connect();
const db = client.db('bookstore');

const strBytes = (f) => ({
  $cond: [{ $eq: [{ $type: f }, 'string'] }, { $strLenBytes: f }, 0],
});

console.log('Full scan of pages (expect ~80 min)...');
const t0 = Date.now();
const [agg] = await db
  .collection('pages')
  .aggregate(
    [
      {
        $project: {
          ocrB: strBytes('$ocr.data'),
          trB: strBytes('$translation.data'),
        },
      },
      {
        $group: {
          _id: null,
          docs: { $sum: 1 },
          ocr_bytes: { $sum: '$ocrB' },
          translation_bytes: { $sum: '$trB' },
          pages_with_ocr: { $sum: { $cond: [{ $gt: ['$ocrB', 0] }, 1, 0] } },
          pages_with_translation: { $sum: { $cond: [{ $gt: ['$trB', 0] }, 1, 0] } },
        },
      },
    ],
    { allowDiskUse: true },
  )
  .toArray();
console.log(JSON.stringify(agg), `(${((Date.now() - t0) / 60000).toFixed(1)} min)`);

const collStats = await db.command({ collStats: 'pages' });
const seed = {
  measured_at: new Date().toISOString(),
  ocr_bytes: agg.ocr_bytes,
  translation_bytes: agg.translation_bytes,
  pages_logical_bytes: collStats.size,
  pages_with_ocr: agg.pages_with_ocr,
  pages_with_translation: agg.pages_with_translation,
  docs_scanned: agg.docs,
};

await db
  .collection('system_config')
  .updateOne({ _id: 'storage_stats' }, { $set: { text_seed: seed } }, { upsert: true });
console.log('text_seed updated:', JSON.stringify(seed, null, 2));
await client.close();
