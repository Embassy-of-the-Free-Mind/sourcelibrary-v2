#!/usr/bin/env node
/**
 * Load pages via Postgres COPY protocol — the fastest possible bulk load.
 * Requires direct Postgres connection (port 5432).
 *
 * Strategy:
 *   1. Drop indexes (COPY is 10x faster without them)
 *   2. COPY FROM STDIN using pg-copy-streams
 *   3. Recreate indexes
 *
 * Usage:
 *   PGPASSWORD=... node scripts/migration/load-pages-copy.mjs /tmp/pages-dump.jsonl
 *   --skip=N         Skip first N lines
 *   --limit=N        Stop after N rows
 *   --no-drop-index  Don't drop/recreate indexes
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import pg from 'pg';

const PGPASSWORD = process.env.PGPASSWORD || 'XfJasb4mx3@9PMD';
const args = process.argv.slice(2);
const inputFile = args.find(a => !a.startsWith('--')) || '/tmp/pages-dump.jsonl';
const SKIP = parseInt(args.find(a => a.startsWith('--skip='))?.split('=')[1] || '0', 10);
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);
const DROP_INDEX = !args.includes('--no-drop-index');
const BATCH = parseInt(args.find(a => a.startsWith('--batch='))?.split('=')[1] || '50', 10);

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

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_pages_book_pagenum ON pages(book_id, page_number)',
  'CREATE INDEX IF NOT EXISTS idx_pages_translation_updated ON pages(translation_updated_at DESC) WHERE translation_updated_at IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_pages_ocr_updated ON pages(ocr_updated_at DESC) WHERE ocr_updated_at IS NOT NULL',
  `CREATE INDEX IF NOT EXISTS idx_pages_gallery_quality ON pages(((detected_images->0->>'gallery_quality')::float) DESC) WHERE detected_images IS NOT NULL AND jsonb_array_length(detected_images) > 0`,
  'CREATE INDEX IF NOT EXISTS idx_pages_archive_needed ON pages(archived_photo) WHERE photo IS NOT NULL',
];

const INDEX_NAMES = [
  'idx_pages_book_pagenum', 'idx_pages_translation_updated', 'idx_pages_ocr_updated',
  'idx_pages_gallery_quality', 'idx_pages_archive_needed', 'pages_book_id_page_number_key',
];

async function main() {
  const client = new pg.Client({
    host: 'db.ykhxaecbbxaaqlujuzde.supabase.co',
    port: 5432, user: 'postgres', password: PGPASSWORD,
    database: 'postgres', ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query('SET statement_timeout = 0');
  await client.query('SET ROLE postgres');
  console.log('Connected to Supabase Postgres (direct, no timeout)');

  // Step 1: Optionally drop indexes for speed
  if (DROP_INDEX) {
    console.log('Dropping indexes...');
    for (const name of INDEX_NAMES) {
      await client.query(`DROP INDEX IF EXISTS ${name}`).catch(() => {});
    }
    // Also drop the UNIQUE constraint temporarily
    await client.query('ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_book_id_page_number_key').catch(() => {});
    console.log('Indexes dropped');
  }

  // Step 2: Truncate if starting fresh (no skip means fresh load)
  if (SKIP === 0) {
    const { rows } = await client.query('SELECT count(*) FROM pages');
    const existing = parseInt(rows[0].count);
    if (existing > 0) {
      console.log(`Table has ${existing} rows. Truncating for clean load...`);
      await client.query('TRUNCATE pages');
      console.log('Truncated');
    }
  }

  // Step 3: Load via parameterized multi-row INSERT (no COPY needed — direct PG is fast enough)
  console.log(`Loading from ${inputFile}, batch=${BATCH}, skip=${SKIP}${LIMIT ? ', limit=' + LIMIT : ''}`);
  const rl = createInterface({ input: createReadStream(inputFile), crlfDelay: Infinity });

  let lineNum = 0;
  let copied = 0;
  let errors = 0;
  let buffer = [];
  const startTime = Date.now();

  for await (const line of rl) {
    lineNum++;
    if (lineNum <= SKIP) continue;
    if (!line.trim()) continue;

    try {
      buffer.push(JSON.parse(line));
    } catch { continue; }

    if (buffer.length >= BATCH) {
      copied += await insertBatch(client, buffer);
      buffer = [];

      if (copied % 10000 < BATCH) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (copied / (elapsed || 1)).toFixed(0);
        console.log(`  ${copied.toLocaleString()} rows — ${rate} rows/s — ${errors} errors`);
      }

      if (LIMIT && copied >= LIMIT) break;
    }
  }

  if (buffer.length > 0) copied += await insertBatch(client, buffer);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\nLoad complete: ${copied.toLocaleString()} rows in ${elapsed}s (${(copied / (elapsed || 1)).toFixed(0)} rows/s)`);

  // Step 4: Recreate indexes
  if (DROP_INDEX) {
    console.log('Recreating indexes...');
    await client.query('ALTER TABLE pages ADD CONSTRAINT pages_book_id_page_number_key UNIQUE (book_id, page_number)');
    for (const ddl of INDEXES) {
      const start = Date.now();
      await client.query(ddl);
      console.log(`  Created in ${((Date.now() - start) / 1000).toFixed(1)}s: ${ddl.slice(0, 80)}`);
    }
    console.log('Indexes recreated');
    console.log('Running ANALYZE...');
    await client.query('ANALYZE pages');
    console.log('Done');
  }

  await client.end();

  async function insertBatch(client, rows) {
    const values = [];
    const params = [];
    let idx = 1;
    for (const row of rows) {
      const rowParams = [];
      for (const col of COLS) {
        let val = row[col];
        if ((col === 'crop' || col === 'detected_images') && val !== null && typeof val === 'object') {
          val = JSON.stringify(val);
        }
        params.push(val ?? null);
        rowParams.push(`$${idx++}`);
      }
      values.push(`(${rowParams.join(',')})`);
    }
    const sql = `INSERT INTO pages (${COLS.join(',')}) VALUES ${values.join(',')} ON CONFLICT (id) DO NOTHING`;
    try {
      await client.query(sql, params);
      return rows.length;
    } catch (err) {
      errors++;
      if (errors <= 5) console.error(`  Insert error: ${err.message.substring(0, 200)}`);
      return 0;
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
