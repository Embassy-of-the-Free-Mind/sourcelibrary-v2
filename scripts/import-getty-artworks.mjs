#!/usr/bin/env node
/**
 * Import artworks from the J. Paul Getty Museum via their Open Content API.
 * CC0 — no authentication required. Full IIIF support.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import-getty-artworks.mjs
 *
 *   Options:
 *     --dry-run           Show what would be imported
 *     --limit N           Max items to import (default: unlimited)
 *     --skip-images       Metadata only (no R2 upload)
 *     --concurrency N     Parallel image downloads (default: 4)
 *     --classification X  Filter: Paintings, Drawings, Prints, Sculpture
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { makeBookDoc } from './lib/book-docs.mjs';

const GETTY_API = 'https://data.getty.edu/museum/collection';
const GETTY_IIIF = 'https://media.getty.edu/iiif/image';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const R2_PREFIX = 'artwork';
const THUMB_WIDTH = 600;
const MIN_DIMENSION = 800;
const DELAY_MS = 200;
const PAGE_SIZE = 100;

// ─── Import targets ──────────────────────────────────────────────────────────

const IMPORT_QUERIES = [
  // Italian Renaissance paintings
  { label: 'Italian Renaissance paintings', type: 'Paintings', culture: 'Italian', dateFrom: 1400, dateTo: 1600 },
  // Northern Renaissance paintings
  { label: 'Northern Renaissance paintings', type: 'Paintings', culture: 'Netherlandish', dateFrom: 1400, dateTo: 1600 },
  { label: 'German Renaissance paintings', type: 'Paintings', culture: 'German', dateFrom: 1400, dateTo: 1600 },
  { label: 'Flemish Renaissance paintings', type: 'Paintings', culture: 'Flemish', dateFrom: 1400, dateTo: 1600 },
  // Renaissance drawings
  { label: 'Renaissance drawings', type: 'Drawings', dateFrom: 1400, dateTo: 1600 },
  // Sculpture
  { label: 'Renaissance sculpture', type: 'Sculpture and Decorative Arts', dateFrom: 1400, dateTo: 1600 },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

function guessResourceType(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('painting')) return 'painting';
  if (t.includes('drawing')) return 'drawing';
  if (t.includes('print')) return 'print';
  if (t.includes('sculpture') || t.includes('decorative')) return 'object';
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

async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return res.json();
      if (res.status === 429) {
        await sleep((attempt + 1) * 5000);
        continue;
      }
      return null;
    } catch {
      await sleep(2000);
    }
  }
  return null;
}

// Getty search API
async function gettySearch(params) {
  const url = new URL(`${GETTY_API}/search`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  return fetchJson(url.toString());
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
  const concurrency = concurrencyIdx >= 0 ? parseInt(args[concurrencyIdx + 1]) : 4;
  const classIdx = args.indexOf('--classification');
  const classFilter = classIdx >= 0 ? args[classIdx + 1] : null;

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Images: ${skipImages ? 'SKIP' : 'UPLOAD'} | Limit: ${limit === Infinity ? 'none' : limit} | Concurrency: ${concurrency}`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

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

  // Pre-load existing Getty identifiers
  const existingIds = new Set();
  const cursor = books.find(
    { 'image_source.provider': 'getty' },
    { projection: { 'image_source.identifier': 1 }, maxTimeMS: 30000 }
  );
  for await (const doc of cursor) {
    if (doc.image_source?.identifier) existingIds.add(doc.image_source.identifier);
  }
  console.log(`${existingIds.size} existing Getty artworks\n`);

  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const seenIds = new Set();

  const targets = classFilter
    ? IMPORT_QUERIES.filter(q => q.type.toLowerCase().includes(classFilter.toLowerCase()))
    : IMPORT_QUERIES;

  for (const target of targets) {
    if (totalImported >= limit) break;

    console.log(`━━━ ${target.label} ━━━`);

    // Getty search uses Linked Art / search API
    // Try their collection search endpoint
    let page = 1;
    let hasMore = true;

    while (hasMore && totalImported < limit) {
      const params = {
        type: target.type,
        ...(target.culture && { culture: target.culture }),
        ...(target.dateFrom && { 'date[gte]': target.dateFrom }),
        ...(target.dateTo && { 'date[lte]': target.dateTo }),
        hasImage: 'true',
        openContent: 'true',
        page,
        size: PAGE_SIZE,
      };

      const result = await gettySearch(params);
      if (!result || !result.data || result.data.length === 0) {
        // Try alternative endpoint format
        if (page === 1) {
          console.log(`  No results (API may use different param format)`);
        }
        hasMore = false;
        break;
      }

      if (page === 1) {
        console.log(`  Found ${result.total || result.data.length} objects`);
      }

      // Collect items for batch processing
      const items = [];
      for (const item of result.data) {
        if (totalImported + items.length >= limit) break;
        const id = item.id || item.objectNumber;
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        if (existingIds.has(`getty-${id}`)) { totalSkipped++; continue; }
        items.push(item);
      }

      // Batch process with parallel downloads
      if (items.length > 0) {
        await parallelMap(items, async (item) => {
          const id = item.id || item.objectNumber;
          const title = item.title || `Getty ${id}`;
          const artist = item.artistName || item.attribution || 'Unknown';
          const slug = slugify(`getty-${artist}-${title}`);
          if (!slug || slug.length < 10) return;

          const resourceType = guessResourceType(target.type);

          if (dryRun) {
            console.log(`  [DRY] ${slug} — ${artist} — ${title.substring(0, 60)} — ${item.date || '?'}`);
            totalImported++;
            return;
          }

          // Getty IIIF image URL
          const imageUrl = item.imageUrl || item.primaryImageUrl;
          if (!imageUrl) { totalSkipped++; return; }

          let displayUrl = imageUrl;
          let thumbUrl = imageUrl;
          let width = 0, height = 0;

          if (s3) {
            const r2Key = `${R2_PREFIX}/${slug}.jpg`;
            try {
              const urls = await uploadToR2(s3, imageUrl, r2Key);
              if (!urls) { totalSkipped++; return; }
              displayUrl = urls.display;
              thumbUrl = urls.thumb;
              width = urls.width;
              height = urls.height;
            } catch (err) {
              console.error(`  ✗ ${slug}: ${err.message}`);
              totalErrors++;
              return;
            }
          }

          const doc = makeBookDoc({
            id: generateId(),
            slug,
            title,
            display_title: title,
            author: artist,
            language: 'Visual',
            published: item.dateBegin ? String(item.dateBegin) : item.date?.match(/\d{4}/)?.[0] || '',
            resource_type: resourceType,
            medium: item.medium || '',
            dimensions_display: item.dimensions || '',
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
            commons_title: `Getty: ${title}`,
            commons_url: `https://www.getty.edu/art/collection/object/${id}`,
            commons_full_url: imageUrl,
            commons_license: 'CC0 1.0',
            commons_description: [item.medium, item.dimensions, item.creditLine].filter(Boolean).join('\n'),
            commons_categories: [target.type, target.culture].filter(Boolean),
            image_source: {
              provider: 'getty',
              provider_name: 'J. Paul Getty Museum',
              source_url: `https://www.getty.edu/art/collection/object/${id}`,
              identifier: `getty-${id}`,
              license: 'CC0 1.0',
              attribution: item.creditLine || '',
              contributing_library: 'J. Paul Getty Museum, Los Angeles',
              access_date: new Date().toISOString(),
            },
            harvested_at: new Date(),
          });

          try {
            await books.insertOne(doc);
            console.log(`  ✓ ${slug} — ${artist} — ${title.substring(0, 50)} (${item.date || '?'})`);
            totalImported++;
          } catch (err) {
            if (err.code === 11000) { totalSkipped++; return; }
            throw err;
          }
        }, concurrency);
      }

      hasMore = result.data.length === PAGE_SIZE;
      page++;
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n━━━ DONE ━━━`);
  console.log(`Imported: ${totalImported}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`Errors: ${totalErrors}`);

  await client.close();
}

main().catch(console.error);
