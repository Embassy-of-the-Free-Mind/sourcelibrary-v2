#!/usr/bin/env node
/**
 * Archive full-resolution artwork originals to R2.
 * Downloads from commons_full_url and uploads as artwork/{slug}-full.jpg
 *
 * This gives us 3 sizes per artwork on R2:
 *   - artwork/{slug}-full.jpg  — original resolution (for download/zoom)
 *   - artwork/{slug}.jpg       — display (3840px, already exists)
 *   - artwork/{slug}-thumb.jpg — thumbnail (600px, already exists)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/archive-artwork-originals.mjs [--limit 100] [--dry-run] [--artist "Raphael"]
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '0') || 999999;
const ARTIST_FILTER = process.argv.find((_, i, a) => a[i - 1] === '--artist') || null;

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) bot';
const R2_PREFIX = 'artwork';

const client = new MongoClient(process.env.MONGODB_URI);
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function archiveOriginal(slug, sourceUrl) {
  const key = `${R2_PREFIX}/${slug}-full.jpg`;

  // Download original
  const res = await fetch(sourceUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const metadata = await sharp(buffer).metadata();

  // Convert to optimized JPEG at original resolution (no resize)
  // Some originals are TIFF or PNG — normalize to JPEG for consistent serving
  const jpegBuffer = await sharp(buffer)
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  if (!DRY_RUN) {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: jpegBuffer,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  }

  return {
    url: `https://images.sourcelibrary.org/${key}`,
    width: metadata.width,
    height: metadata.height,
    originalSize: (buffer.length / 1024 / 1024).toFixed(1),
    jpegSize: (jpegBuffer.length / 1024 / 1024).toFixed(1),
  };
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Find artworks that have a source URL but no archived full-res
  const query = {
    resource_type: { $exists: true },
    commons_full_url: { $exists: true, $ne: '' },
    'archived_full_url': { $exists: false },
  };
  if (ARTIST_FILTER) query.author = ARTIST_FILTER;

  const cursor = books.find(query, {
    projection: { _id: 1, slug: 1, author: 1, title: 1, commons_full_url: 1, commons_width: 1, commons_height: 1 },
  }).limit(LIMIT);

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}Archiving full-res originals to R2...`);

  let success = 0, errors = 0, skipped = 0, totalBytes = 0, processed = 0;

  for await (const doc of cursor) {
    processed++;
    const label = `[${processed}] ${doc.author} — ${doc.title?.substring(0, 45)}`;

    // Skip Commons URLs that are just HTML pages (not direct image links)
    const url = doc.commons_full_url;
    if (!url || url.includes('commons.wikimedia.org/wiki/')) {
      skipped++;
      continue;
    }

    try {
      console.log(label);
      const t0 = Date.now();
      const result = await archiveOriginal(doc.slug, url);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      console.log(`  ${result.width}x${result.height} | ${result.originalSize}MB → ${result.jpegSize}MB | ${elapsed}s`);
      totalBytes += parseFloat(result.jpegSize) * 1024 * 1024;
      success++;

      if (!DRY_RUN) {
        await books.updateOne({ _id: doc._id }, {
          $set: {
            archived_full_url: result.url,
            full_width: result.width,
            full_height: result.height,
            updated_at: new Date(),
          }
        });
      }

      // Rate limit: 1s between downloads
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.log(`  ERROR: ${err.message?.substring(0, 80)}`);
      errors++;
      if (err.message?.includes('429') || err.message?.includes('Too Many')) {
        console.log('  Rate limited — waiting 30s...');
        await new Promise(r => setTimeout(r, 30000));
      } else {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Archived: ${success}`);
  console.log(`Errors: ${errors}`);
  console.log(`Skipped (no direct URL): ${skipped}`);
  console.log(`Total size: ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);
  if (success > 0) {
    const avgMB = totalBytes / success / 1024 / 1024;
    console.log(`Avg size: ${avgMB.toFixed(1)} MB`);
    const remaining = 7069 - success;
    console.log(`Projected total storage: ${(avgMB * 7069 / 1024).toFixed(1)} GB`);
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
