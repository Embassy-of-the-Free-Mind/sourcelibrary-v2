#!/usr/bin/env node
/**
 * Find near-duplicate illustrations across the library using CLIP embeddings.
 *
 * Detects the same woodblock, plate, or illustration reused across different
 * editions — common in early modern printing where blocks were shared or copied.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/clip-find-duplicates.mjs
 *
 * Options:
 *   --threshold N    Cosine similarity threshold (default: 0.92, range 0.85-0.99)
 *   --limit N        Max pairs to report (default: 100)
 *   --cross-book     Only show duplicates across different books (default)
 *   --same-book      Also include duplicates within the same book
 *   --json           Output as JSON instead of table
 */

import pg from 'pg';

const { Client: PgClient } = pg;

const THRESHOLD = parseFloat(process.argv.find(a => a.startsWith('--threshold='))?.split('=')[1] || '0.92');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '100');
const SAME_BOOK = process.argv.includes('--same-book');
const JSON_OUTPUT = process.argv.includes('--json');

async function main() {
  const connStr = (process.env.SUPABASE_DB_URL || '').replace(':6543/', ':5432/');
  if (!connStr) { console.error('Missing SUPABASE_DB_URL'); process.exit(1); }

  const client = new PgClient({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log(`Finding near-duplicates (threshold: ${THRESHOLD}, limit: ${LIMIT})...\n`);

  // Self-join on clip_embeddings to find high-similarity pairs
  const bookFilter = SAME_BOOK ? '' : 'AND a.book_id != b.book_id';

  const { rows } = await client.query(`
    SELECT
      a.id AS id_a, a.title AS title_a, a.book_id AS book_a, a.image_url AS url_a,
      b.id AS id_b, b.title AS title_b, b.book_id AS book_b, b.image_url AS url_b,
      1 - (a.embedding <=> b.embedding) AS similarity
    FROM clip_embeddings a
    JOIN clip_embeddings b ON a.id < b.id
      AND a.source_type = 'gallery_image'
      AND b.source_type = 'gallery_image'
      ${bookFilter}
      AND 1 - (a.embedding <=> b.embedding) > $1
    ORDER BY similarity DESC
    LIMIT $2
  `, [THRESHOLD, LIMIT]);

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(`Found ${rows.length} near-duplicate pairs:\n`);
    for (const r of rows) {
      console.log(`${r.similarity.toFixed(3)}  ${r.title_a?.slice(0, 50)}`);
      console.log(`        ${r.title_b?.slice(0, 50)}`);
      console.log(`        ${r.url_a}`);
      console.log(`        ${r.url_b}`);
      console.log();
    }
  }

  await client.end();
}

main().catch(console.error);
