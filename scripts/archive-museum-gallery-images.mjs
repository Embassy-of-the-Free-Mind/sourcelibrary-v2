#!/usr/bin/env node
/**
 * Archive external museum gallery images to R2.
 *
 * Finds gallery_images with URLs pointing to external museums (AIC, Met, Cleveland)
 * and archives them to R2 at gallery/{book_id}/{page}-{idx}.jpg
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/archive-museum-gallery-images.mjs [--dry-run] [--limit 50] [--concurrency 4]
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '0') || 999999;
const CONCURRENCY = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--concurrency') || '0') || 4;

const EXTERNAL_PATTERNS = [
  'artic.edu',
  'images.metmuseum.org',
  'openaccess-api.clevelandart.org',
];

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) bot';

const client = new MongoClient(process.env.MONGODB_URI);
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

let success = 0, errors = 0, skipped = 0;

function isExternal(url) {
  if (!url) return false;
  return EXTERNAL_PATTERNS.some(p => url.includes(p));
}

async function archiveOne(db, doc) {
  // Find which URL field(s) are external
  const fields = ['image_url', 'thumbnail_url', 'extracted_url'];
  const externalFields = fields.filter(f => isExternal(doc[f]));

  if (externalFields.length === 0) {
    skipped++;
    return;
  }

  const bookId = doc.book_id;
  const page = String(doc.page_number || 0).padStart(4, '0');
  const idx = doc.detection_index || 0;

  const updates = {};

  for (const field of externalFields) {
    const url = doc[field];
    const suffix = field === 'thumbnail_url' ? '-thumb' : '';
    const key = `gallery/${bookId}/${page}-${idx}${suffix}.jpg`;
    const r2Url = `https://images.sourcelibrary.org/${key}`;

    try {
      // Check if already on R2
      try {
        await s3.send(new HeadObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
        }));
        // Already exists, just update URL
        updates[field] = r2Url;
        continue;
      } catch { /* not found, continue to download */ }

      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

      const buffer = Buffer.from(await res.arrayBuffer());

      // Convert to optimized JPEG
      const width = field === 'thumbnail_url' ? 150 : 1200;
      const jpegBuffer = await sharp(buffer)
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
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

      updates[field] = r2Url;
    } catch (err) {
      console.error(`  ✗ ${field} for ${doc.id}: ${err.message}`);
      errors++;
    }
  }

  if (Object.keys(updates).length > 0 && !DRY_RUN) {
    await db.collection('gallery_images').updateOne(
      { id: doc.id },
      { $set: { ...updates, updated_at: new Date() } }
    );
  }

  if (Object.keys(updates).length > 0) {
    success++;
    console.log(`  ✓ ${doc.id} → ${Object.keys(updates).join(', ')}`);
  }
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  // Find gallery images with external URLs
  const externalRegex = EXTERNAL_PATTERNS.map(p => p.replace(/\./g, '\\.')).join('|');
  const query = {
    $or: [
      { image_url: { $regex: externalRegex } },
      { thumbnail_url: { $regex: externalRegex } },
      { extracted_url: { $regex: externalRegex } },
    ],
  };

  const count = await db.collection('gallery_images').countDocuments(query);
  console.log(`Found ${count} gallery images with external museum URLs`);
  if (DRY_RUN) console.log('DRY RUN — no changes will be made');

  const cursor = db.collection('gallery_images').find(query).limit(LIMIT);
  const docs = await cursor.toArray();

  // Process in batches
  for (let i = 0; i < docs.length; i += CONCURRENCY) {
    const batch = docs.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(doc => archiveOne(db, doc)));
  }

  console.log(`\nDone: ${success} archived, ${errors} errors, ${skipped} skipped`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
