#!/usr/bin/env node
/**
 * Dump pages from MongoDB to JSONL file (one flattened row per line).
 * Much faster than streaming through REST API — eliminates Supabase latency from the cursor loop.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/dump-pages-jsonl.mjs > /tmp/pages.jsonl
 *   # Then load: node scripts/migration/load-pages-jsonl.mjs < /tmp/pages.jsonl
 */

import { MongoClient } from 'mongodb';
import { createWriteStream } from 'fs';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }

const outFile = process.argv[2] || '/tmp/pages-dump.jsonl';

function flattenPage(doc) {
  const ocr = doc.ocr || {};
  const translation = doc.translation || {};
  return {
    id: doc.id,
    book_id: doc.book_id,
    page_number: doc.page_number,
    photo: doc.photo || null,
    photo_original: doc.photo_original || null,
    archived_photo: doc.archived_photo || null,
    cropped_photo: doc.cropped_photo || null,
    crop: doc.crop || null,
    ocr_data: typeof ocr.data === 'string' ? ocr.data : null,
    ocr_model: ocr.model || null,
    ocr_language: ocr.language || null,
    ocr_source: ocr.source || null,
    ocr_prompt_version: ocr.prompt_version || null,
    ocr_batch_job_id: ocr.batch_job_id || null,
    ocr_input_tokens: ocr.input_tokens || null,
    ocr_output_tokens: ocr.output_tokens || null,
    ocr_updated_at: ocr.updated_at ? new Date(ocr.updated_at).toISOString() : null,
    translation_data: typeof translation.data === 'string' ? translation.data : null,
    translation_model: translation.model || null,
    translation_language: translation.language || null,
    translation_source_language: translation.source_language || null,
    translation_source: translation.source || null,
    translation_prompt_version: translation.prompt_version || null,
    translation_batch_job_id: translation.batch_job_id || null,
    translation_input_tokens: translation.input_tokens || null,
    translation_output_tokens: translation.output_tokens || null,
    translation_updated_at: translation.updated_at ? new Date(translation.updated_at).toISOString() : null,
    translation_recitation_blocked: translation.recitation_blocked || false,
    translation_safety_blocked: translation.safety_blocked || false,
    translation_safety_reason: translation.safety_reason || null,
    page_type: doc.page_type || null,
    columns: doc.columns || 1,
    script_type: doc.script_type || null,
    detected_images: doc.detected_images || null,
    image_extraction_updated_at: doc.image_extraction_updated_at ? new Date(doc.image_extraction_updated_at).toISOString() : null,
    created_at: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
    updated_at: doc.updated_at ? new Date(doc.updated_at).toISOString() : new Date().toISOString(),
  };
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  console.error('Connected to MongoDB');

  const total = await db.collection('pages').estimatedDocumentCount();
  console.error(`Dumping ${total.toLocaleString()} pages to ${outFile}`);

  const projection = {
    id: 1, book_id: 1, page_number: 1,
    photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1,
    ocr: 1, translation: 1,
    page_type: 1, columns: 1, script_type: 1,
    detected_images: 1, image_extraction_updated_at: 1,
    created_at: 1, updated_at: 1,
    _id: 0,
  };

  const cursor = db.collection('pages').find({}, { projection }).batchSize(1000);
  const out = createWriteStream(outFile);
  let count = 0;
  const startTime = Date.now();

  for await (const doc of cursor) {
    if (!doc.id || !doc.book_id) continue;
    out.write(JSON.stringify(flattenPage(doc)) + '\n');
    count++;
    if (count % 10000 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (count / (elapsed || 1)).toFixed(0);
      console.error(`  ${count.toLocaleString()} / ${total.toLocaleString()} — ${rate} rows/s`);
    }
  }

  out.end();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.error(`\nDone: ${count.toLocaleString()} pages dumped in ${elapsed}s`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
