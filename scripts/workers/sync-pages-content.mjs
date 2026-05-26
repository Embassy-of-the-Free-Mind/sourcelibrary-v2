#!/usr/bin/env node
/**
 * Supabase pages-content sync worker.
 *
 * Closes the gap documented in #2020: the live OCR pipeline writes pages to
 * MongoDB but never inserts them into Supabase. The previous dual-write
 * (`syncPageBatch` in `lib/supabase-page-writer.mjs`) PATCHes existing rows
 * fire-and-forget, which silently no-ops on new books.
 *
 * This worker reads MongoDB as the source of truth and upserts pages whose
 * `updated_at` is newer than `now - WINDOW_MIN`. Idempotent on `id`.
 *
 * Crontab entry (Hetzner, every 5 minutes):
 *   *\/5 * * * * cd /root/sourcelibrary && flock -n /tmp/sl-sync-pages-content.lock \
 *     bash -c "set -a; source .env.production.local; set +a; node scripts/workers/sync-pages-content.mjs" \
 *     >> /var/log/sourcelibrary/sync-pages-content.log 2>&1
 *
 * Backfill mode (one-off catch-up for missed history):
 *   node scripts/workers/sync-pages-content.mjs --since=2026-05-23T00:00:00Z
 *   node scripts/workers/sync-pages-content.mjs --book=BOOK_ID
 *
 * Env vars: MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!MONGODB_URI || !SUPABASE_SERVICE_KEY) {
  console.error(`[${new Date().toISOString()}] Missing MONGODB_URI or SUPABASE_SERVICE_ROLE_KEY`);
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SINCE_ARG = args.find(a => a.startsWith('--since='))?.split('=')[1];
const BOOK_ID = args.find(a => a.startsWith('--book='))?.split('=')[1];
const WINDOW_MIN = parseInt(args.find(a => a.startsWith('--window-min='))?.split('=')[1] || '15', 10);
const BATCH_SIZE = parseInt(args.find(a => a.startsWith('--batch='))?.split('=')[1] || '500', 10);
const MAX_PAGES = parseInt(args.find(a => a.startsWith('--max='))?.split('=')[1] || '50000', 10);

/** Flatten a MongoDB page doc to Supabase row format (matches pages table schema). */
function flattenPage(doc) {
  const ocr = doc.ocr || {};
  const translation = doc.translation || {};
  return {
    id: doc.id,
    book_id: doc.book_id,
    page_number: doc.page_number,
    photo: doc.photo ?? null,
    photo_original: doc.photo_original ?? null,
    archived_photo: doc.archived_photo ?? null,
    cropped_photo: doc.cropped_photo ?? null,
    crop: doc.crop ?? null,
    ocr_data: typeof ocr.data === 'string' ? ocr.data : null,
    ocr_model: ocr.model ?? null,
    ocr_language: ocr.language ?? null,
    ocr_source: ocr.source ?? null,
    ocr_prompt_version: ocr.prompt_version ?? null,
    ocr_batch_job_id: ocr.batch_job_id ?? null,
    ocr_input_tokens: ocr.input_tokens ?? null,
    ocr_output_tokens: ocr.output_tokens ?? null,
    ocr_updated_at: ocr.updated_at ? new Date(ocr.updated_at).toISOString() : null,
    translation_data: typeof translation.data === 'string' ? translation.data : null,
    translation_model: translation.model ?? null,
    translation_language: translation.language ?? null,
    translation_source_language: translation.source_language ?? null,
    translation_source: translation.source ?? null,
    translation_prompt_version: translation.prompt_version ?? null,
    translation_batch_job_id: translation.batch_job_id ?? null,
    translation_input_tokens: translation.input_tokens ?? null,
    translation_output_tokens: translation.output_tokens ?? null,
    translation_updated_at: translation.updated_at ? new Date(translation.updated_at).toISOString() : null,
    translation_recitation_blocked: translation.recitation_blocked ?? false,
    translation_safety_blocked: translation.safety_blocked ?? false,
    translation_safety_reason: translation.safety_reason ?? null,
    page_type: doc.page_type ?? null,
    columns: doc.columns ?? 1,
    script_type: doc.script_type ?? null,
    detected_images: doc.detected_images ?? null,
    image_extraction_updated_at: doc.image_extraction_updated_at
      ? new Date(doc.image_extraction_updated_at).toISOString() : null,
    created_at: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
    updated_at: doc.updated_at ? new Date(doc.updated_at).toISOString() : new Date().toISOString(),
  };
}

async function upsertBatch(rows) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/pages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Supabase upsert failed (${resp.status}): ${text.substring(0, 300)}`);
  }
}

/** Recursive halve-and-retry: if a batch fails, split it. */
async function upsertWithRetry(rows, depth = 0) {
  if (rows.length === 0) return { synced: 0, failed: 0 };
  try {
    await upsertBatch(rows);
    return { synced: rows.length, failed: 0 };
  } catch (err) {
    if (depth >= 4 || rows.length <= 1) {
      console.error(`  Giving up on ${rows.length} rows at depth ${depth}: ${err.message}`);
      return { synced: 0, failed: rows.length };
    }
    const mid = Math.ceil(rows.length / 2);
    const left = await upsertWithRetry(rows.slice(0, mid), depth + 1);
    const right = await upsertWithRetry(rows.slice(mid), depth + 1);
    return { synced: left.synced + right.synced, failed: left.failed + right.failed };
  }
}

async function main() {
  const startTime = Date.now();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 2 });
  await client.connect();
  const db = client.db('bookstore');

  // Page rows MUST have id + book_id + page_number to satisfy NOT NULL constraints.
  const projection = {
    _id: 0,
    id: 1, book_id: 1, page_number: 1,
    photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1,
    ocr: 1, translation: 1,
    page_type: 1, columns: 1, script_type: 1,
    detected_images: 1, image_extraction_updated_at: 1,
    created_at: 1, updated_at: 1,
  };

  const stats = { seen: 0, skipped: 0, synced: 0, failed: 0 };
  const seenIds = new Set();
  let batch = [];

  async function flush() {
    if (batch.length === 0) return;
    if (!DRY_RUN) {
      const result = await upsertWithRetry(batch);
      stats.synced += result.synced;
      stats.failed += result.failed;
    }
    batch = [];
  }

  async function processDoc(doc) {
    if (!doc.id || !doc.book_id || doc.page_number == null) {
      stats.skipped++;
      return;
    }
    if (seenIds.has(doc.id)) return;
    seenIds.add(doc.id);
    stats.seen++;
    batch.push(flattenPage(doc));
    if (batch.length >= BATCH_SIZE) await flush();
  }

  // The `pages` collection has no index on top-level `updated_at`. It DOES have
  // indexes on `ocr.updated_at` and `translation.updated_at`. We can't $or those
  // — the planner picks a collection scan over the 3.3M-row table and times out.
  // Instead, run separate cursors with explicit hints and dedupe by id.
  if (BOOK_ID) {
    const cursor = db.collection('pages')
      .find({ book_id: BOOK_ID }, { projection })
      .hint('pages_book_pagenum_idx')
      .batchSize(BATCH_SIZE)
      .maxTimeMS(120_000)
      .limit(MAX_PAGES);
    for await (const doc of cursor) await processDoc(doc);
  } else {
    const since = SINCE_ARG
      ? new Date(SINCE_ARG)
      : new Date(Date.now() - WINDOW_MIN * 60 * 1000);

    const indexedScans = [
      { field: 'ocr.updated_at', index: 'pages_ocr_updated_idx' },
      { field: 'translation.updated_at', index: 'pages_translation_updated_idx' },
    ];

    for (const { field, index } of indexedScans) {
      if (stats.seen >= MAX_PAGES) break;
      const cursor = db.collection('pages')
        .find({ [field]: { $gte: since } }, { projection })
        .hint(index)
        .batchSize(BATCH_SIZE)
        .maxTimeMS(120_000)
        .limit(MAX_PAGES - stats.seen);
      for await (const doc of cursor) {
        await processDoc(doc);
        if (stats.seen >= MAX_PAGES) break;
      }
    }
  }
  await flush();

  await client.close();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const mode = BOOK_ID ? `book=${BOOK_ID}`
    : SINCE_ARG ? `since=${SINCE_ARG}`
    : `window=${WINDOW_MIN}min`;

  if (stats.seen > 0 || stats.failed > 0) {
    console.log(`[${new Date().toISOString()}] sync-pages-content ${mode}: seen=${stats.seen} synced=${stats.synced} skipped=${stats.skipped} failed=${stats.failed} in ${elapsed}s${DRY_RUN ? ' (dry-run)' : ''}`);
  }

  // Write cron_runs record for observability (skipped in dry-run and backfill modes)
  if (!DRY_RUN && !BOOK_ID && !SINCE_ARG && (stats.seen > 0 || stats.failed > 0)) {
    try {
      const cronClient = new MongoClient(MONGODB_URI, { maxPoolSize: 1 });
      await cronClient.connect();
      await cronClient.db('bookstore').collection('cron_runs').insertOne({
        cron: 'sync-pages-content',
        timestamp: new Date(),
        duration_ms: Date.now() - startTime,
        status: stats.failed > 0 ? 'failed' : 'success',
        actions: stats,
        summary: `Synced ${stats.synced} pages (${stats.failed} failed) from ${WINDOW_MIN}-min window`,
      });
      await cronClient.close();
    } catch (e) {
      console.warn(`  Could not write cron_runs record: ${e.message}`);
    }
  }

  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
