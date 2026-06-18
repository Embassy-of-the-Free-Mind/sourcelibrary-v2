#!/usr/bin/env node
/**
 * Per-model rates for translation anomalies — denominators for the collapse
 * numbers from detect-translation-collapse.mjs, plus a cheap EXCESS-text
 * (runaway/loop) count that IS well-defined by raw length alone.
 *
 *   collapse = translation body << OCR body  (computed by detect-translation-collapse.mjs)
 *   excess   = raw translation > EXCESS_RATIO × raw OCR  (computed here)
 *
 * Streams a single grouped aggregation over every comparable AI-translated text
 * page, so it pairs with the collapse dump to give true rates = flagged / total.
 *
 * READ-ONLY.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/translation-anomaly-rates.mjs
 */
import { MongoClient } from 'mongodb';

const EXCESS_RATIO = parseFloat((process.argv.find(a => a.startsWith('--excess-ratio=')) || '').split('=')[1] || '3');
const EXCESS_FLOOR = 200;   // min OCR chars before the ratio rule applies
const EXCESS_ABS = 20000;   // absolute runaway flag (chars)

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const client = new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 15_000, socketTimeoutMS: 0 });
await client.connect();
const db = client.db('bookstore');
try {
  const match = {
    page_type: 'text',
    'translation.source': 'ai',
    'translation.recitation_blocked': { $ne: true },
    'translation.safety_blocked': { $ne: true },
    'translation.data': { $type: 'string', $ne: '' },
    'ocr.data': { $type: 'string', $ne: '' },
  };

  console.log('Per-model translation totals + excess-text rates (READ-ONLY)');
  console.log(`  excess = rawTr > ${EXCESS_RATIO}× rawOcr (min ${EXCESS_FLOOR} OCR chars)  OR  rawTr > ${EXCESS_ABS} chars\n`);

  const rows = await db.collection('pages').aggregate([
    { $match: match },
    { $project: {
        model: { $ifNull: ['$translation.model', '(none)'] },
        ocrLen: { $strLenCP: '$ocr.data' },
        trLen: { $strLenCP: '$translation.data' },
    } },
    { $group: {
        _id: '$model',
        total: { $sum: 1 },
        excess: { $sum: { $cond: [ { $or: [
          { $gt: ['$trLen', EXCESS_ABS] },
          { $and: [ { $gte: ['$ocrLen', EXCESS_FLOOR] }, { $gt: ['$trLen', { $multiply: ['$ocrLen', EXCESS_RATIO] }] } ] },
        ] }, 1, 0 ] } },
    } },
    { $sort: { total: -1 } },
  ], { allowDiskUse: true }).toArray();

  let gT = 0, gX = 0;
  console.log('model'.padEnd(34) + 'total'.padStart(12) + 'excess'.padStart(10) + '  excess-rate');
  for (const r of rows) {
    gT += r.total; gX += r.excess;
    console.log(String(r._id).padEnd(34) + r.total.toLocaleString().padStart(12) + r.excess.toLocaleString().padStart(10) +
      `   ${(100 * r.excess / r.total).toFixed(3)}%`);
  }
  console.log('-'.repeat(70));
  console.log('TOTAL'.padEnd(34) + gT.toLocaleString().padStart(12) + gX.toLocaleString().padStart(10) +
    `   ${(100 * gX / gT).toFixed(3)}%`);

  // Emit JSON the rate-merge can read.
  console.log('\nDENOMINATORS_JSON ' + JSON.stringify(Object.fromEntries(rows.map(r => [r._id, r.total]))));
} finally {
  await client.close();
}
