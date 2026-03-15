#!/usr/bin/env node
/**
 * Backfill content_hash (SHA-256) on all pages with OCR or translation data.
 *
 * Zero cost — just reads text, computes hash, writes one field.
 * Processes in batches of 500 with bulkWrite for speed.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-content-hashes.mjs
 */

import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const BATCH_SIZE = 500;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

function contentHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function backfill() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');
  const pages = db.collection('pages');

  // Phase 1: Translation hashes
  console.log('Phase 1: Backfilling translation content_hash...');
  let cursor = pages.find(
    { 'translation.data': { $exists: true, $ne: '' }, 'translation.content_hash': { $exists: false } },
    { projection: { _id: 1, 'translation.data': 1 } }
  ).batchSize(BATCH_SIZE);

  let processed = 0;
  let ops = [];

  for await (const doc of cursor) {
    if (!doc.translation?.data) continue;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { 'translation.content_hash': contentHash(doc.translation.data) } }
      }
    });

    if (ops.length >= BATCH_SIZE) {
      await pages.bulkWrite(ops, { ordered: false });
      processed += ops.length;
      process.stdout.write(`\rTranslation: ${processed.toLocaleString()} pages hashed`);
      ops = [];
    }
  }
  if (ops.length > 0) {
    await pages.bulkWrite(ops, { ordered: false });
    processed += ops.length;
  }
  console.log(`\rTranslation: ${processed.toLocaleString()} pages hashed — done`);

  // Phase 2: OCR hashes
  console.log('Phase 2: Backfilling OCR content_hash...');
  cursor = pages.find(
    { 'ocr.data': { $exists: true, $ne: '' }, 'ocr.content_hash': { $exists: false } },
    { projection: { _id: 1, 'ocr.data': 1 } }
  ).batchSize(BATCH_SIZE);

  processed = 0;
  ops = [];

  for await (const doc of cursor) {
    if (!doc.ocr?.data) continue;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { 'ocr.content_hash': contentHash(doc.ocr.data) } }
      }
    });

    if (ops.length >= BATCH_SIZE) {
      await pages.bulkWrite(ops, { ordered: false });
      processed += ops.length;
      process.stdout.write(`\rOCR: ${processed.toLocaleString()} pages hashed`);
      ops = [];
    }
  }
  if (ops.length > 0) {
    await pages.bulkWrite(ops, { ordered: false });
    processed += ops.length;
  }
  console.log(`\rOCR: ${processed.toLocaleString()} pages hashed — done`);

  await client.close();
  console.log('Backfill complete.');
}

backfill().catch(e => { console.error(e); process.exit(1); });
