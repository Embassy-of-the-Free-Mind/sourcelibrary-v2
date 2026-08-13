#!/usr/bin/env node
/**
 * Batch import artworks from the National Gallery of Art (Washington DC).
 * Uses their CC0 open data — pre-processed to JSONL for reliable parsing.
 * IIIF Image API for full-resolution images.
 *
 * Prerequisites:
 *   1. Download CSVs:
 *     curl -L https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/objects.csv -o /tmp/nga-data/objects.csv
 *     curl -L https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/published_images.csv -o /tmp/nga-data/published_images.csv
 *
 *   2. Convert to JSONL (Python csv module handles multiline fields correctly):
 *     python3 scripts/import-nga-csv-to-jsonl.py
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import-nga-artworks.mjs
 *
 *   Options:
 *     --dry-run           Show what would be imported
 *     --limit N           Max items to import (default: unlimited)
 *     --skip-images       Metadata only (no R2 upload)
 *     --concurrency N     Parallel image downloads (default: 6)
 *     --classification X  Filter: Painting, Drawing, Print, Sculpture
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const R2_PREFIX = 'artwork';
const THUMB_WIDTH = 600;
const MIN_DIMENSION = 800;
const NGA_IIIF = 'https://api.nga.gov/iiif';

// ─── JSONL Loading ──────────────────────────────────────────────────────────

async function loadJSONL(filePath) {
  const rows = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function generateId() {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function guessResourceType(classification) {
  const c = (classification || '').toLowerCase();
  if (c.includes('painting')) return 'painting';
  if (c.includes('drawing')) return 'drawing';
  if (c.includes('print')) return 'print';
  if (c.includes('sculpture')) return 'object';
  if (c.includes('photograph')) return 'print';
  return 'print';
}

async function parallelMap(items, fn, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function uploadToR2(s3, imageUrl, key) {
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());

  const meta = await sharp(buffer).metadata();
  if (Math.max(meta.width || 0, meta.height || 0) < MIN_DIMENSION) return null;

  // Full-res JPEG
  const displayBuffer = await sharp(buffer)
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: displayBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  // 600px thumbnail
  const thumbKey = key.replace(/\.jpg$/, '-thumb.jpg');
  const thumbBuffer = await sharp(buffer)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: thumbKey,
    Body: thumbBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  const displayMeta = await sharp(displayBuffer).metadata();
  return {
    display: `https://images.sourcelibrary.org/${key}`,
    thumb: `https://images.sourcelibrary.org/${thumbKey}`,
    width: displayMeta.width,
    height: displayMeta.height,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipImages = args.includes('--skip-images');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;
  const concurrencyIdx = args.indexOf('--concurrency');
  const concurrency = concurrencyIdx >= 0 ? parseInt(args[concurrencyIdx + 1]) : 6;
  const classIdx = args.indexOf('--classification');
  const classFilter = classIdx >= 0 ? args[classIdx + 1] : null;

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Images: ${skipImages ? 'SKIP' : 'UPLOAD'} | Limit: ${limit === Infinity ? 'none' : limit} | Concurrency: ${concurrency}`);
  console.log(`Filter: ${classFilter || 'all'}`);

  // ── Step 1: Load pre-processed JSONL ──
  console.log('\nLoading NGA objects (pre-filtered Renaissance art)...');
  let objects = await loadJSONL('/tmp/nga-data/objects.jsonl');
  console.log(`  ${objects.length} Renaissance artworks`);

  if (classFilter) {
    objects = objects.filter(obj => obj.classification?.toLowerCase().includes(classFilter.toLowerCase()));
    console.log(`  ${objects.length} after classification filter: ${classFilter}`);
  }

  console.log('Loading NGA images...');
  const images = await loadJSONL('/tmp/nga-data/images.jsonl');
  console.log(`  ${images.length} open-access images`);

  // ── Step 2: Build image lookup (objectid → primary image) ──
  const imageByObjectId = new Map();
  for (const img of images) {
    const objId = img.depictstmsobjectid;
    if (!imageByObjectId.has(objId) || img.viewtype === 'primary') {
      imageByObjectId.set(objId, img);
    }
  }

  // Filter to objects that have images
  const renaissance = objects.filter(obj => imageByObjectId.has(obj.objectid));
  console.log(`  ${renaissance.length} with images`);

  // Show breakdown
  const byCls = {};
  for (const obj of renaissance) {
    const cls = obj.classification || 'Other';
    byCls[cls] = (byCls[cls] || 0) + 1;
  }
  for (const [cls, count] of Object.entries(byCls).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cls}: ${count}`);
  }

  // ── Step 4: Connect to MongoDB ──
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Pre-load existing NGA slugs for fast dedup
  console.log('\nLoading existing NGA slugs for dedup...');
  const existingIdentifiers = new Set();
  const cursor = books.find(
    { 'image_source.provider': 'nga' },
    { projection: { 'image_source.identifier': 1 }, maxTimeMS: 30000 }
  );
  for await (const doc of cursor) {
    if (doc.image_source?.identifier) existingIdentifiers.add(doc.image_source.identifier);
  }
  console.log(`  ${existingIdentifiers.size} existing NGA artworks`);

  // Set up R2
  let s3 = null;
  if (!skipImages && !dryRun) {
    s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }

  // ── Step 5: Filter out dupes and apply limit ──
  const toImport = renaissance
    .filter(obj => !existingIdentifiers.has(`nga-${obj.objectid}`))
    .slice(0, limit);

  console.log(`\n${toImport.length} new artworks to import (after dedup)\n`);

  if (toImport.length === 0) {
    console.log('Nothing to import.');
    await client.close();
    return;
  }

  // ── Step 6: Batch import with parallel image downloads ──
  let imported = 0;
  let errors = 0;

  // Process in batches for progress reporting
  const BATCH_SIZE = concurrency * 2;
  for (let batchStart = 0; batchStart < toImport.length; batchStart += BATCH_SIZE) {
    const batch = toImport.slice(batchStart, batchStart + BATCH_SIZE);

    const results = await parallelMap(batch, async (obj) => {
      const img = imageByObjectId.get(obj.objectid);
      const title = obj.title || `NGA ${obj.objectid}`;
      const artist = obj.attribution || 'Unknown';
      const slug = slugify(`nga-${artist}-${title}`);
      if (!slug || slug.length < 10) return { status: 'skip' };

      const resourceType = guessResourceType(obj.classification);
      const year = obj.beginyear || '';

      if (dryRun) {
        console.log(`  [DRY] ${slug} — ${artist} — ${title.substring(0, 60)} — ${obj.displaydate || '?'}`);
        return { status: 'imported' };
      }

      // Build IIIF URL for full image
      const iiifUrl = `${NGA_IIIF}/${img.uuid}/full/full/0/default.jpg`;

      let displayUrl = iiifUrl;
      let thumbUrl = img.iiifthumburl || `${NGA_IIIF}/${img.uuid}/full/!600,600/0/default.jpg`;
      let width = parseInt(img.width) || 0;
      let height = parseInt(img.height) || 0;

      if (s3) {
        const r2Key = `${R2_PREFIX}/${slug}.jpg`;
        try {
          const urls = await uploadToR2(s3, iiifUrl, r2Key);
          if (!urls) return { status: 'skip' }; // Below min resolution
          displayUrl = urls.display;
          thumbUrl = urls.thumb;
          width = urls.width || width;
          height = urls.height || height;
        } catch (err) {
          console.error(`  ✗ ${slug}: ${err.message}`);
          return { status: 'error' };
        }
      }

      const doc = {
        id: generateId(),
        slug,
        title,
        display_title: title,
        author: artist,
        language: 'Visual',
        published: year ? String(year) : obj.displaydate?.match(/\d{4}/)?.[0] || '',
        resource_type: resourceType,
        medium: obj.medium || '',
        dimensions_display: obj.dimensions || '',
        thumbnail: thumbUrl,
        thumbnail_blob: displayUrl,
        pages_count: 1,
        pages_ocr: 0,
        pages_translated: 0,
        status: 'published',
        visible: true,
        categories: [`Visual Art — ${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)}`],
        created_at: new Date(),
        updated_at: new Date(),
        commons_width: width,
        commons_height: height,
        commons_title: `NGA: ${title}`,
        commons_url: `https://www.nga.gov/collection/art-object-page.${obj.objectid}.html`,
        commons_full_url: iiifUrl,
        commons_license: 'CC0 1.0',
        commons_description: [
          obj.medium,
          obj.dimensions,
          obj.creditline,
          obj.provenancetext ? `Provenance: ${obj.provenancetext.substring(0, 500)}` : '',
        ].filter(Boolean).join('\n'),
        commons_categories: [obj.classification, obj.subclassification, obj.departmentabbr].filter(Boolean),
        image_source: {
          provider: 'nga',
          provider_name: 'National Gallery of Art',
          source_url: `https://www.nga.gov/collection/art-object-page.${obj.objectid}.html`,
          identifier: `nga-${obj.objectid}`,
          license: 'CC0 1.0',
          attribution: obj.creditline || '',
          contributing_library: 'National Gallery of Art, Washington DC',
          access_date: new Date().toISOString(),
        },
        // Wikidata cross-reference if available
        ...(obj.wikidataid && { wikidata_id: obj.wikidataid }),
        harvested_at: new Date(),
      };

      try {
        await books.insertOne(doc);
        return { status: 'imported', slug, artist, title: title.substring(0, 50), date: obj.displaydate };
      } catch (err) {
        if (err.code === 11000) return { status: 'skip' };
        console.error(`  ✗ ${slug}: ${err.message}`);
        return { status: 'error' };
      }
    }, concurrency);

    // Report batch results
    for (const r of results) {
      if (r.status === 'imported') {
        imported++;
        if (r.slug) console.log(`  ✓ ${r.slug} — ${r.artist} — ${r.title} (${r.date || '?'})`);
      } else if (r.status === 'error') {
        errors++;
      }
    }

    const progress = Math.min(batchStart + BATCH_SIZE, toImport.length);
    if (progress % 50 === 0 || progress === toImport.length) {
      console.log(`  [${progress}/${toImport.length}] imported: ${imported}, errors: ${errors}`);
    }
  }

  console.log(`\n━━━ DONE ━━━`);
  console.log(`Imported: ${imported}`);
  console.log(`Errors: ${errors}`);
  console.log(`Skipped: ${toImport.length - imported - errors}`);

  await client.close();
}

main().catch(console.error);
