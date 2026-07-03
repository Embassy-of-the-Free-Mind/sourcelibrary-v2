/**
 * Re-host ALL external thumbnails to R2 (broader version)
 *
 * rehost-external-thumbnails.mjs only queries 10 specific providers and misses
 * ~600 books (bsb, bl, gallica, bodleian, heidelberg, ndl_japan, kyoto_rmda,
 * laurenziana). This script queries by thumbnail URL pattern directly so it
 * catches every visible book whose thumbnail is not on the CDN.
 *
 * Same R2 upload pattern, same field-update shape, same key convention
 * (thumbnails/<book.id>.jpg) as the canonical script.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/maintenance/rehost-all-external-thumbnails.mjs --dry-run
 *   node scripts/maintenance/rehost-all-external-thumbnails.mjs --limit 50
 *   node scripts/maintenance/rehost-all-external-thumbnails.mjs
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

console.log(`\n=== Re-host ALL External Thumbnails ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
if (LIMIT) console.log(`Limit: ${LIMIT}`);

console.log('Scanning visible books...');
const cursor = db.collection('books').find(
  {
    visible: true,
    pages_count: { $gt: 0 },
    thumbnail: { $exists: true, $ne: null },
  },
  { projection: { id: 1, title: 1, thumbnail: 1, 'image_source.provider': 1 } }
);

const books = [];
for await (const b of cursor) {
  const t = b.thumbnail || '';
  if (!t || !t.startsWith('http')) continue;
  if (t.startsWith(R2_PREFIX) || t.startsWith(BLOB_PREFIX)) continue;
  if (t.startsWith('/api/')) continue;
  books.push(b);
}
console.log(`Found ${books.length} books with external thumbnails\n`);

let rehosted = 0, failed = 0, skipped = 0;
const failByHost = new Map();

async function rehostOne(book) {
  const url = book.thumbnail;
  let host = '';
  try { host = new URL(url).host; } catch { skipped++; return; }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let res;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'SourceLibrary/1.0 (scholarly archive)' },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      failed++;
      failByHost.set(host, (failByHost.get(host) || 0) + 1);
      if (failed <= 20) console.log(`  [${res.status}] ${book.title?.slice(0, 40)} — ${host}`);
      return;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 500) {
      failed++;
      failByHost.set(host, (failByHost.get(host) || 0) + 1);
      return;
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const key = `thumbnails/${book.id}.${ext}`;

    if (!DRY_RUN) {
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=604800',
      }));

      const r2Url = `${R2_PUBLIC_URL}/${key}`;

      await db.collection('books').updateOne(
        { id: book.id },
        {
          $set: {
            thumbnail: r2Url,
            updated_at: new Date(),
            'field_provenance.thumbnail': {
              source: 'rehost-all-external-thumbnails',
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
    failByHost.set(host, (failByHost.get(host) || 0) + 1);
    if (failed <= 20) console.log(`  [ERR] ${book.title?.slice(0, 40)} — ${err.message?.slice(0, 60)}`);
  }
}

const toProcess = LIMIT ? books.slice(0, LIMIT) : books;
let idx = 0;
const total = toProcess.length;

async function worker() {
  while (idx < total) {
    const i = idx++;
    if (i >= total) break;
    await rehostOne(toProcess[i]);
    const done = rehosted + failed + skipped;
    if (done % 25 === 0) {
      process.stdout.write(`  ${rehosted} ok, ${failed} fail, ${skipped} skip (${done}/${total})\r`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()));

console.log(`\n\n=== Results ===`);
console.log(`Total:    ${total}`);
console.log(`${DRY_RUN ? 'Would rehost' : 'Rehosted'}: ${rehosted}`);
console.log(`Failed:   ${failed}`);
console.log(`Skipped:  ${skipped}`);

if (failByHost.size > 0) {
  console.log('\n=== Failures by host ===');
  [...failByHost.entries()].sort((a, b) => b[1] - a[1]).forEach(([h, n]) => {
    console.log(`  ${n.toString().padStart(4)}  ${h}`);
  });
}

await client.close();
