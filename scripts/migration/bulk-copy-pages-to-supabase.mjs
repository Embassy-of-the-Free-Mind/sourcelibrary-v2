#!/usr/bin/env node
/**
 * Bulk copy pages from MongoDB → Supabase Postgres.
 * Issue #947 Phase 1.
 *
 * Streams 3.3M pages in batches of 2000, flattens subdocs, inserts via
 * Supabase REST API with ON CONFLICT DO UPDATE (idempotent, restartable).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/migration/bulk-copy-pages-to-supabase.mjs
 *
 * Options:
 *   --dry-run         Count rows, don't write
 *   --limit=N         Stop after N pages (for testing)
 *   --book=BOOK_ID    Copy only one book's pages
 *   --skip-existing   Skip pages that already exist in Supabase (faster restart)
 *   --batch=N         Batch size (default 2000)
 */

import { MongoClient } from 'mongodb';
import pg from 'pg';

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
// Fallback to REST if no direct DB URL
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USE_DIRECT_PG = !!SUPABASE_DB_URL;

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!SUPABASE_DB_URL && !SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_DB_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);
const BOOK_ID = args.find(a => a.startsWith('--book='))?.split('=')[1];
const SKIP_EXISTING = args.includes('--skip-existing');
const BATCH_SIZE = parseInt(args.find(a => a.startsWith('--batch='))?.split('=')[1] || (USE_DIRECT_PG ? '500' : '100'), 10);

/**
 * Flatten a MongoDB page document to Supabase row format.
 */
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
    image_extraction_updated_at: doc.image_extraction_updated_at
      ? new Date(doc.image_extraction_updated_at).toISOString() : null,

    created_at: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
    updated_at: doc.updated_at ? new Date(doc.updated_at).toISOString() : new Date().toISOString(),
  };
}

// Column list for INSERT
const COLS = [
  'id', 'book_id', 'page_number',
  'photo', 'photo_original', 'archived_photo', 'cropped_photo', 'crop',
  'ocr_data', 'ocr_model', 'ocr_language', 'ocr_source', 'ocr_prompt_version',
  'ocr_batch_job_id', 'ocr_input_tokens', 'ocr_output_tokens', 'ocr_updated_at',
  'translation_data', 'translation_model', 'translation_language', 'translation_source_language',
  'translation_source', 'translation_prompt_version', 'translation_batch_job_id',
  'translation_input_tokens', 'translation_output_tokens', 'translation_updated_at',
  'translation_recitation_blocked', 'translation_safety_blocked', 'translation_safety_reason',
  'page_type', 'columns', 'script_type',
  'detected_images', 'image_extraction_updated_at',
  'created_at', 'updated_at',
];

// Columns to update on conflict (everything except id, book_id, page_number)
const UPDATE_COLS = COLS.filter(c => !['id', 'book_id', 'page_number'].includes(c));

let pgPool = null;

function getPgPool() {
  if (!pgPool) {
    pgPool = new pg.Pool({ connectionString: SUPABASE_DB_URL, max: 4, statement_timeout: 300000 });
  }
  return pgPool;
}

/**
 * Upsert a batch using direct Postgres (much faster, no statement timeout issues).
 */
async function upsertBatchPg(rows) {
  const pool = getPgPool();
  // Build a multi-row INSERT ON CONFLICT
  const values = [];
  const params = [];
  let paramIdx = 1;
  for (const row of rows) {
    const rowParams = [];
    for (const col of COLS) {
      let val = row[col];
      // JSONB columns need JSON.stringify
      if ((col === 'crop' || col === 'detected_images') && val !== null && typeof val === 'object') {
        val = JSON.stringify(val);
      }
      params.push(val ?? null);
      rowParams.push(`$${paramIdx++}`);
    }
    values.push(`(${rowParams.join(',')})`);
  }

  const updateSet = UPDATE_COLS.map(c => `${c} = EXCLUDED.${c}`).join(', ');
  const sql = `INSERT INTO pages (${COLS.join(',')}) VALUES ${values.join(',')} ON CONFLICT (id) DO UPDATE SET ${updateSet}`;

  await pool.query(sql, params);
}

/**
 * Upsert via REST API (fallback when no direct PG connection).
 */
async function upsertBatchRest(rows) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/pages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Supabase upsert failed (${resp.status}): ${text.substring(0, 500)}`);
  }
}

async function upsertBatch(rows) {
  if (USE_DIRECT_PG) return upsertBatchPg(rows);
  return upsertBatchRest(rows);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log('Connected to MongoDB');

  const filter = BOOK_ID ? { book_id: BOOK_ID } : {};
  const total = BOOK_ID
    ? await db.collection('pages').countDocuments(filter)
    : await db.collection('pages').estimatedDocumentCount();
  console.log(`Total pages in MongoDB: ${total.toLocaleString()}`);

  if (DRY_RUN) {
    console.log('Dry run — exiting.');
    await client.close();
    return;
  }

  // Projection: only fields we need (skip embedding, stale fields)
  const projection = {
    id: 1, book_id: 1, page_number: 1,
    photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1,
    ocr: 1, translation: 1,
    page_type: 1, columns: 1, script_type: 1,
    detected_images: 1, image_extraction_updated_at: 1,
    created_at: 1, updated_at: 1,
    _id: 0,
  };

  const cursor = db.collection('pages')
    .find(filter, { projection })
    .sort({ book_id: 1, page_number: 1 })
    .batchSize(BATCH_SIZE);

  let copied = 0;
  let skipped = 0;
  let errors = 0;
  let batch = [];
  const startTime = Date.now();

  for await (const doc of cursor) {
    if (!doc.id || !doc.book_id) {
      skipped++;
      continue;
    }

    batch.push(flattenPage(doc));

    if (batch.length >= BATCH_SIZE) {
      try {
        await upsertBatch(batch);
        copied += batch.length;
      } catch (err) {
        errors++;
        console.error(`Batch error at ${copied}: ${err.message}`);
        // Retry individual rows on batch failure
        for (const row of batch) {
          try {
            await upsertBatch([row]);
            copied++;
          } catch (rowErr) {
            errors++;
            if (errors <= 10) console.error(`  Row error ${row.id}: ${rowErr.message}`);
          }
        }
      }
      batch = [];

      // Progress
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (copied / (elapsed || 1)).toFixed(0);
      const pct = ((copied / total) * 100).toFixed(1);
      process.stdout.write(`\r  ${copied.toLocaleString()} / ${total.toLocaleString()} (${pct}%) — ${rate} rows/s — ${errors} errors`);

      if (LIMIT && copied >= LIMIT) {
        console.log(`\nReached limit of ${LIMIT}`);
        break;
      }
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    try {
      await upsertBatch(batch);
      copied += batch.length;
    } catch (err) {
      console.error(`Final batch error: ${err.message}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n\nDone: ${copied.toLocaleString()} copied, ${skipped} skipped, ${errors} errors in ${elapsed}s`);
  console.log(`Mode: ${USE_DIRECT_PG ? 'direct Postgres' : 'REST API'}, batch size: ${BATCH_SIZE}`);

  await client.close();
  if (pgPool) await pgPool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
