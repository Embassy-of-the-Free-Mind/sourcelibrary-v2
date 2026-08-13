#!/usr/bin/env node
/**
 * Import artworks from the Art Institute of Chicago (AIC) API.
 * All public domain works are CC0 — no authentication required.
 * IIIF Image API available for all works.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import-aic-artworks.mjs
 *
 *   Options:
 *     --dry-run         Show what would be imported without writing to DB
 *     --limit N         Max items to import (default: unlimited)
 *     --skip-images     Don't download/upload images to R2 (metadata only)
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const AIC_API = 'https://api.artic.edu/api/v1';
const AIC_IIIF = 'https://www.artic.edu/iiif/2';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const R2_PREFIX = 'artwork';
const THUMB_WIDTH = 600;
const MIN_DIMENSION = 800;
const DELAY_MS = 250; // AIC has no strict rate limits but be polite
const PAGE_SIZE = 100; // AIC max per page

// ─── Import targets ──────────────────────────────────────────────────────────
// Each: { label, query (Elasticsearch body), resourceTypeOverride? }

function makeQuery(opts = {}) {
  const must = [
    { term: { is_public_domain: true } },
  ];
  if (opts.dateFrom) must.push({ range: { date_start: { gte: opts.dateFrom } } });
  if (opts.dateTo) must.push({ range: { date_end: { lte: opts.dateTo } } });
  if (opts.classification) must.push({ match: { classification_title: opts.classification } });
  if (opts.artist) must.push({ match: { artist_title: opts.artist } });
  if (opts.department) must.push({ match: { department_title: opts.department } });

  return { bool: { must } };
}

const IMPORT_TARGETS = [
  // Italian Renaissance paintings
  { label: 'Italian Renaissance paintings', query: makeQuery({ dateFrom: 1400, dateTo: 1600, classification: 'Painting', department: 'Painting and Sculpture of Europe' }), resourceType: 'painting' },

  // Northern Renaissance paintings
  { label: 'Northern Renaissance paintings', query: makeQuery({ dateFrom: 1400, dateTo: 1600, classification: 'Painting' }), resourceType: 'painting' },

  // Renaissance prints and drawings
  { label: 'Renaissance prints', query: makeQuery({ dateFrom: 1400, dateTo: 1600, classification: 'Print' }), resourceType: 'print' },
  { label: 'Renaissance drawings', query: makeQuery({ dateFrom: 1400, dateTo: 1600, classification: 'Drawing and Watercolor' }), resourceType: 'drawing' },

  // Specific major artists (broader date ranges for late works)
  { label: 'Botticelli', query: makeQuery({ artist: 'Botticelli', dateTo: 1600 }), resourceType: 'painting' },
  { label: 'Giovanni di Paolo', query: makeQuery({ artist: 'Giovanni di Paolo', dateTo: 1500 }), resourceType: 'painting' },
  { label: 'El Greco', query: makeQuery({ artist: 'El Greco', dateTo: 1620 }), resourceType: 'painting' },
  { label: 'Correggio', query: makeQuery({ artist: 'Correggio', dateTo: 1600 }), resourceType: 'painting' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function guessResourceType(classification) {
  const c = (classification || '').toLowerCase();
  if (c.includes('painting')) return 'painting';
  if (c.includes('print') || c.includes('engraving') || c.includes('etching') || c.includes('woodcut')) return 'print';
  if (c.includes('drawing') || c.includes('watercolor')) return 'drawing';
  if (c.includes('sculpture') || c.includes('decorative')) return 'object';
  if (c.includes('textile')) return 'object';
  return 'print';
}

async function aicSearch(query, page = 1) {
  const body = {
    query,
    fields: [
      'id', 'title', 'artist_title', 'artist_display', 'date_start', 'date_end',
      'date_display', 'medium_display', 'dimensions', 'classification_title',
      'department_title', 'is_public_domain', 'image_id',
      'thumbnail', 'credit_line', 'place_of_origin',
      'style_title', 'technique_title', 'subject_titles',
    ],
    from: (page - 1) * PAGE_SIZE,
    size: PAGE_SIZE,
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${AIC_API}/artworks/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return res.json();
      if (res.status === 429) {
        await sleep((attempt + 1) * 5000);
        continue;
      }
      console.error(`  AIC search ${res.status}: ${await res.text()}`);
      return null;
    } catch (err) {
      await sleep(2000);
    }
  }
  return null;
}

async function uploadToR2(s3, imageUrl, key) {
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());

  // Validate minimum dimension
  const meta = await sharp(buffer).metadata();
  if (Math.max(meta.width || 0, meta.height || 0) < MIN_DIMENSION) return null;

  // Store at original resolution
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

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Images: ${skipImages ? 'SKIP' : 'UPLOAD'} | Limit: ${limit === Infinity ? 'none' : limit}`);

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

  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const seenIds = new Set();

  for (const target of IMPORT_TARGETS) {
    if (totalImported >= limit) break;

    console.log(`\n━━━ ${target.label} ━━━`);

    // Paginate through results
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && totalImported < limit) {
      const result = await aicSearch(target.query, page);
      if (!result?.data) break;

      if (page === 1) {
        const total = result.pagination?.total || 0;
        totalPages = Math.ceil(total / PAGE_SIZE);
        console.log(`  Found ${total} objects (${totalPages} pages)`);
      }

      for (const item of result.data) {
        if (totalImported >= limit) break;
        if (!item.image_id || !item.is_public_domain) continue;
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);

        const title = item.title || `AIC ${item.id}`;
        const artist = item.artist_title || 'Unknown';
        const slug = slugify(`aic-${artist}-${title}`);
        if (!slug || slug.length < 10) continue;

        // Check dupe
        const exists = await books.findOne(
          { $or: [{ slug }, { 'image_source.identifier': `aic-${item.id}` }] },
          { projection: { _id: 1 } }
        );
        if (exists) {
          totalSkipped++;
          continue;
        }

        const resourceType = target.resourceType || guessResourceType(item.classification_title);
        const year = item.date_start || '';

        // AIC IIIF Image URL: full resolution
        const iiifUrl = `${AIC_IIIF}/${item.image_id}/full/max/0/default.jpg`;

        if (dryRun) {
          console.log(`  [DRY] ${slug} — ${artist} — ${title.substring(0, 60)} — ${item.date_display || '?'}`);
          totalImported++;
          continue;
        }

        // Upload image
        let displayUrl = iiifUrl;
        let thumbUrl = `${AIC_IIIF}/${item.image_id}/full/600,/0/default.jpg`;
        let width = item.thumbnail?.width || 0;
        let height = item.thumbnail?.height || 0;

        if (s3) {
          const r2Key = `${R2_PREFIX}/${slug}.jpg`;
          try {
            const urls = await uploadToR2(s3, iiifUrl, r2Key);
            if (!urls) {
              totalSkipped++; // Below min resolution
              continue;
            }
            displayUrl = urls.display;
            thumbUrl = urls.thumb;
            width = urls.width || width;
            height = urls.height || height;
          } catch (err) {
            console.error(`  Failed to upload ${slug}: ${err.message}`);
            totalErrors++;
            continue;
          }
        }

        const doc = {
          id: generateId(),
          slug,
          title,
          display_title: title,
          author: artist,
          language: 'Visual',
          published: year ? String(year) : item.date_display?.match(/\d{4}/)?.[0] || '',
          resource_type: resourceType,
          medium: item.medium_display || '',
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
          commons_title: `AIC: ${title}`,
          commons_url: `https://www.artic.edu/artworks/${item.id}`,
          commons_full_url: iiifUrl,
          commons_license: 'CC0 1.0',
          commons_description: [
            item.medium_display,
            item.dimensions,
            item.credit_line,
            item.place_of_origin ? `Place of origin: ${item.place_of_origin}` : '',
          ].filter(Boolean).join('\n'),
          commons_categories: [
            item.classification_title,
            item.department_title,
            item.style_title,
            ...(item.subject_titles || []),
          ].filter(Boolean),
          image_source: {
            provider: 'aic',
            provider_name: 'Art Institute of Chicago',
            source_url: `https://www.artic.edu/artworks/${item.id}`,
            identifier: `aic-${item.id}`,
            license: 'CC0 1.0',
            attribution: item.credit_line || '',
            contributing_library: 'Art Institute of Chicago',
            access_date: new Date().toISOString(),
          },
          harvested_at: new Date(),
        };

        try {
          await books.insertOne(doc);
          console.log(`  ✓ ${slug} — ${artist} — ${title.substring(0, 50)} (${item.date_display || '?'})`);
          totalImported++;
        } catch (err) {
          if (err.code === 11000) {
            totalSkipped++;
            continue;
          }
          throw err;
        }

        await sleep(DELAY_MS);
      }

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
