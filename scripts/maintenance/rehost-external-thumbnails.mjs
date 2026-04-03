/**
 * Re-host External Thumbnails to R2
 *
 * For books where fix-external-thumbnails.mjs couldn't help (no archived pages),
 * this script downloads the external thumbnail URL directly and uploads to R2.
 * Covers CDLI cuneiform photos, blocked IA/e-rara sources, etc.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/rehost-external-thumbnails.mjs
 *   node scripts/maintenance/rehost-external-thumbnails.mjs --dry-run
 *   node scripts/maintenance/rehost-external-thumbnails.mjs --limit 50
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1]) : 0;
})();
const CONCURRENCY = 5;

const R2_PREFIX = 'https://images.sourcelibrary.org';
const BLOB_PREFIX = 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com';

// R2 client
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 120000,
});
await client.connect();
const db = client.db('bookstore');

console.log(`\n=== Re-host External Thumbnails ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
if (LIMIT) console.log(`Limit: ${LIMIT}`);

// Find books with external thumbnails using known provider patterns.
// Direct queries by provider are fast (indexed). Avoids scanning all 9K books.
console.log('Finding external-thumbnail books by provider...');
const books = [];
const providers = ['e-rara', 'vatican', 'mdz', 'internet_archive', 'google_books',
  'loc', 'etcsl', 'iiif', 'cambridge', 'library_of_congress'];

for (const provider of providers) {
  try {
    const batch = await db.collection('books')
      .find(
        { visible: true, pages_count: { $gt: 0 }, 'image_source.provider': provider },
        { projection: { id: 1, title: 1, thumbnail: 1 } }
      )
      .hint('books_provider_browse_idx')
      .maxTimeMS(30000)
      .toArray();

    let count = 0;
    for (const b of batch) {
      if (b.thumbnail && !b.thumbnail.startsWith(R2_PREFIX) && !b.thumbnail.startsWith(BLOB_PREFIX)) {
        books.push(b);
        count++;
      }
    }
    if (count > 0) console.log(`  ${provider}: ${count} external thumbnails`);
  } catch (err) {
    console.log(`  ${provider}: query failed — ${err.message?.slice(0, 60)}`);
  }
}

console.log(`\nFound ${books.length} books with external thumbnails\n`);

let rehosted = 0, failed = 0, skipped = 0;

async function rehostOne(book) {
  const url = book.thumbnail;

  // Skip /api/image proxy URLs — can't fetch those externally
  if (url.startsWith('/api/')) {
    skipped++;
    return;
  }

  try {
    // Download
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      failed++;
      if (failed <= 10) console.log(`  [${res.status}] ${book.title?.slice(0, 40)} — ${url.slice(0, 60)}`);
      return;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 500) {
      // Probably an error page, not an image
      failed++;
      return;
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const key = `thumbnails/${book.id}.${ext}`;

    if (!DRY_RUN) {
      // Upload to R2
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=604800',
      }));

      const r2Url = `${R2_PUBLIC_URL}/${key}`;

      // Update book thumbnail
      await db.collection('books').updateOne(
        { id: book.id },
        {
          $set: {
            thumbnail: r2Url,
            updated_at: new Date(),
            'field_provenance.thumbnail': {
              source: 'rehost-external-thumbnails',
              method: 'direct-download',
              confidence: 1.0,
              date: new Date(),
              previous: url,
            },
          },
        }
      );
    }

    rehosted++;
  } catch (err) {
    failed++;
    if (failed <= 10) console.log(`  [ERR] ${book.title?.slice(0, 40)} — ${err.message?.slice(0, 60)}`);
  }
}

// Process with concurrency
const toProcess = LIMIT ? books.slice(0, LIMIT) : books;
let idx = 0;

async function worker() {
  while (idx < toProcess.length) {
    const i = idx++;
    if (i >= toProcess.length) break;
    await rehostOne(toProcess[i]);
    if ((rehosted + failed + skipped) % 50 === 0) {
      process.stdout.write(`  ${rehosted} rehosted, ${failed} failed, ${skipped} skipped (${rehosted + failed + skipped}/${toProcess.length})\r`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toProcess.length) }, () => worker()));

console.log(`\n\n=== Results ===`);
console.log(`Total: ${toProcess.length}`);
console.log(`${DRY_RUN ? 'Would rehost' : 'Rehosted'}: ${rehosted}`);
console.log(`Failed: ${failed}`);
console.log(`Skipped (proxy URLs): ${skipped}`);

await client.close();
