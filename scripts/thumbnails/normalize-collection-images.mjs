#!/usr/bin/env node
/**
 * Normalize collection featured_images data:
 * 1. Promote image_url → thumbnail_url where missing and source is R2
 * 2. Archive external URLs (Gallica, Archive.org) to R2
 * 3. Report remaining gaps
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/thumbnails/normalize-collection-images.mjs
 *   node scripts/thumbnails/normalize-collection-images.mjs --dry-run
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const DRY_RUN = process.argv.includes('--dry-run');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

async function archiveToR2(url, key) {
  // Check if already exists
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return `${R2_PUBLIC}/${key}`;
  } catch {
    // Not found, proceed to upload
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': 'SourceLibrary/1.0 (collection-image-archiver)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/jpeg';

  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return `${R2_PUBLIC}/${key}`;
}

async function run() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const collections = await db.collection('collections').find({
    featured_images: { $exists: true, $ne: null },
    'featured_images.0': { $exists: true },
  }).project({ slug: 1, name: 1, featured_images: 1 }).toArray();

  console.log(`Processing ${collections.length} collections${DRY_RUN ? ' [DRY RUN]' : ''}`);

  let promoted = 0, archived = 0, archiveFailed = 0, alreadyGood = 0;
  const ops = [];

  for (const col of collections) {
    let changed = false;
    const images = col.featured_images;

    for (let i = 0; i < images.length; i++) {
      const img = images[i];

      // Already has thumbnail_url — good
      if (img.thumbnail_url) {
        if (i === 0) alreadyGood++;
        continue;
      }

      // Has extracted_url — also good (second priority in pickCardImage)
      if (img.extracted_url) continue;

      // Only has image_url
      if (!img.image_url) continue;

      const url = img.image_url;

      if (url.includes('images.sourcelibrary.org')) {
        // R2 source — just promote to thumbnail_url
        img.thumbnail_url = url;
        changed = true;
        if (i === 0) promoted++;
      } else {
        // External source — archive to R2
        const key = `collection-covers/${col.slug}-${i}.jpg`;
        try {
          if (!DRY_RUN) {
            const r2Url = await archiveToR2(url, key);
            img.thumbnail_url = r2Url;
            img.image_url_original = url; // Keep original for reference
            changed = true;
            if (i === 0) archived++;
            console.log(`  Archived: ${col.slug}[${i}] ${url.substring(0, 60)}... → ${r2Url}`);
          } else {
            console.log(`  Would archive: ${col.slug}[${i}] ${url.substring(0, 80)}`);
            if (i === 0) archived++;
          }
        } catch (err) {
          console.error(`  FAILED: ${col.slug}[${i}] ${err.message}`);
          if (i === 0) archiveFailed++;
        }
      }
    }

    if (changed && !DRY_RUN) {
      ops.push({
        updateOne: {
          filter: { slug: col.slug },
          update: { $set: { featured_images: images } },
        },
      });
    }
  }

  if (!DRY_RUN && ops.length > 0) {
    for (let i = 0; i < ops.length; i += 50) {
      const chunk = ops.slice(i, i + 50);
      await db.collection('collections').bulkWrite(chunk, { ordered: false });
    }
    console.log(`\nWritten ${ops.length} updates to DB`);
  }

  console.log('\n=== Summary ===');
  console.log(`Already good (has thumbnail_url): ${alreadyGood}`);
  console.log(`Promoted R2 image_url → thumbnail_url: ${promoted}`);
  console.log(`Archived external → R2: ${archived}`);
  console.log(`Archive failed: ${archiveFailed}`);
  console.log(`Total collections: ${collections.length}`);

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
