#!/usr/bin/env node
/**
 * Weekly catalog CSV snapshot.
 *
 * Queries Supabase books_catalog, generates a CSV, and uploads it to R2
 * at a stable public URL: https://images.sourcelibrary.org/exports/catalog.csv
 *
 * Run via Hetzner cron (weekly, Sunday 4am):
 *   cd /root/sourcelibrary && flock -n /tmp/sl-catalog-csv.lock bash -c \
 *     'set -a; source .env.production.local; set +a; node scripts/workers/catalog-csv-snapshot.mjs'
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

const CSV_COLUMNS = [
  'title', 'author', 'language', 'year', 'pages',
  'pages_transcribed', 'pages_translated', 'translation_pct',
  'is_first_english_translation', 'source_library',
  'categories', 'collections', 'url',
];

function csvEscape(val) {
  if (!val) return '';
  val = String(val);
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

async function fetchAllBooks() {
  const PAGE_SIZE = 1000;
  const allRows = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('books_catalog')
      .select('id, slug, title, display_title, author, language, year, pages_count, pages_ocr, pages_translated, pages_blank, is_first_translation, image_source_provider, categories, collections')
      .eq('visible', true)
      .gt('pages_count', 0)
      .order('sort_title', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    if (!data || data.length === 0) break;

    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

function buildCsv(books) {
  const lines = [CSV_COLUMNS.join(',')];

  for (const book of books) {
    const pagesOcr = book.pages_ocr || 0;
    const pagesBlank = book.pages_blank || 0;
    const pagesTranslated = book.pages_translated || 0;
    const denominator = pagesOcr - pagesBlank;
    const translationPct = denominator > 0
      ? Math.round((pagesTranslated / denominator) * 100)
      : 0;

    const slug = book.slug || book.id;
    const url = `https://sourcelibrary.org/book/${slug}`;

    lines.push([
      csvEscape(book.display_title || book.title || ''),
      csvEscape(book.author || ''),
      csvEscape(book.language || ''),
      String(book.year || ''),
      String(book.pages_count || 0),
      String(pagesOcr),
      String(pagesTranslated),
      String(translationPct),
      book.is_first_translation ? 'yes' : 'no',
      csvEscape(book.image_source_provider || ''),
      csvEscape((book.categories || []).join('; ')),
      csvEscape((book.collections || []).join('; ')),
      csvEscape(url),
    ].join(','));
  }

  return lines.join('\n');
}

async function uploadToR2(csv, key) {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: Buffer.from(csv, 'utf-8'),
    ContentType: 'text/csv; charset=utf-8',
    ContentDisposition: 'attachment; filename="sourcelibrary-catalog.csv"',
    CacheControl: 'public, max-age=604800',
  }));
  return `${PUBLIC_URL}/${key}`;
}

async function main() {
  console.log('[catalog-csv] Fetching books from Supabase...');
  const books = await fetchAllBooks();
  console.log(`[catalog-csv] ${books.length} books fetched`);

  const csv = buildCsv(books);
  console.log(`[catalog-csv] CSV generated: ${csv.length} bytes, ${books.length} rows`);

  // Upload to stable path (always overwritten)
  const url = await uploadToR2(csv, 'exports/catalog.csv');
  console.log(`[catalog-csv] Uploaded to ${url}`);

  // Also upload a dated snapshot for historical record
  const date = new Date().toISOString().slice(0, 10);
  const snapshotUrl = await uploadToR2(csv, `exports/catalog-${date}.csv`);
  console.log(`[catalog-csv] Snapshot: ${snapshotUrl}`);

  console.log('[catalog-csv] Done');
}

main().catch(err => {
  console.error('[catalog-csv] Fatal:', err);
  process.exit(1);
});
