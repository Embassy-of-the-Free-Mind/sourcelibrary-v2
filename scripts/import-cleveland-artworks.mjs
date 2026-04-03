#!/usr/bin/env node
/**
 * Import artworks from the Cleveland Museum of Art Open Access API.
 * All works with images are CC0 — no authentication required.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import-cleveland-artworks.mjs --object-ids 1983.1047,1970.156,1985.89
 *
 *   Options:
 *     --dry-run         Show what would be imported without writing to DB
 *     --skip-images     Don't download/upload images to R2 (metadata only)
 *     --object-ids A,B  Fetch specific accession numbers (e.g. 1983.1047,1970.156)
 *     --query "..."     Search query (e.g. "Dürer")
 *     --limit N         Max items to import (default: unlimited)
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const CMA_API = 'https://openaccess-api.clevelandart.org/api/artworks';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const R2_PREFIX = 'artwork';
const DISPLAY_MAX = 3840;
const THUMB_WIDTH = 600;
const DELAY_MS = 300;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Convert accession number to CMA API id format.
 * CMA API uses dashes instead of dots: 1983.1047 → 1983-1047
 */
function accessionToApiId(accession) {
  return accession.replace(/\./g, '-');
}

async function cmaFetchObject(accession) {
  // CMA API doesn't support direct accession lookup — use search instead
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${CMA_API}?q=${encodeURIComponent(accession)}&limit=1`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const json = await res.json();
        const obj = json.data?.[0];
        // Verify accession matches (search can return unrelated results)
        if (obj && obj.accession_number === accession) return obj;
        return null;
      }
      if (res.status === 429) {
        console.log(`  Rate limited, waiting ${(attempt + 1) * 5}s...`);
        await sleep((attempt + 1) * 5000);
        continue;
      }
      if (res.status === 404) return null;
      console.error(`  CMA API ${res.status} for ${accession}`);
      return null;
    } catch {
      await sleep(2000);
    }
  }
  return null;
}

async function cmaSearch(query, limit = 100) {
  const params = new URLSearchParams({
    q: query,
    has_image: '1',
    limit: String(limit),
  });
  const url = `${CMA_API}?${params}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const json = await res.json();
        return json.data || [];
      }
      if (res.status === 429) {
        console.log(`  Rate limited, waiting ${(attempt + 1) * 5}s...`);
        await sleep((attempt + 1) * 5000);
        continue;
      }
      console.error(`  CMA search ${res.status}`);
      return [];
    } catch {
      await sleep(2000);
    }
  }
  console.error(`  Failed after 3 retries for "${query}"`);
  return [];
}

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

function guessResourceType(medium, type) {
  const m = (medium + ' ' + (type || '')).toLowerCase();
  if (m.includes('painting') || m.includes('oil on') || m.includes('tempera')) return 'painting';
  if (m.includes('drawing') || m.includes('chalk') || m.includes('pen and ink') || m.includes('graphite')) return 'drawing';
  if (m.includes('engraving') || m.includes('etching') || m.includes('woodcut') || m.includes('print') || m.includes('lithograph')) return 'print';
  if (m.includes('fresco')) return 'fresco';
  if (m.includes('sculpture') || m.includes('bronze') || m.includes('marble')) return 'object';
  if (m.includes('manuscript') || m.includes('illuminat')) return 'manuscript';
  return 'print';
}

/**
 * Get the best available image URL from a CMA artwork object.
 * Prefers web (full size), falls back to print.
 */
function getImageUrl(obj) {
  if (obj.images?.print?.url) return obj.images.print.url;
  if (obj.images?.web?.url) return obj.images.web.url;
  return null;
}

async function uploadToR2(s3, imageUrl, key) {
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());

  const displayBuffer = await sharp(buffer)
    .resize({ width: DISPLAY_MAX, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
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

  const meta = await sharp(displayBuffer).metadata();
  return {
    display: `https://images.sourcelibrary.org/${key}`,
    thumb: `https://images.sourcelibrary.org/${thumbKey}`,
    width: meta.width,
    height: meta.height,
  };
}

function buildDoc(obj, slug, resourceType, displayUrl, thumbUrl, width, height) {
  const accession = obj.accession_number || '';
  const title = obj.title || `Cleveland Object ${accession}`;
  const artist = obj.creators?.map(c => c.description || c.name)?.join('; ')
    || obj.culture?.[0]
    || 'Unknown';

  // Extract year from creation_date or date fields
  const yearMatch = (obj.creation_date || obj.date_text || '').match(/-?\d{3,4}/);
  const published = obj.creation_date_earliest
    ? String(obj.creation_date_earliest)
    : yearMatch?.[0] || '';

  return {
    id: generateId(),
    slug,
    tenant_id: 'default',
    title,
    display_title: title,
    author: artist,
    language: 'Visual',
    published,
    resource_type: resourceType,
    medium: obj.technique || obj.type || '',
    dimensions_display: obj.measurements || '',
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
    // Cleveland-specific metadata (using commons_* fields for consistency)
    commons_width: width,
    commons_height: height,
    commons_title: `Cleveland Museum of Art: ${title}`,
    commons_url: obj.url || `https://www.clevelandart.org/art/${accession}`,
    commons_full_url: getImageUrl(obj) || '',
    commons_license: 'CC0 1.0',
    commons_description: [
      obj.technique,
      obj.measurements,
      obj.creditline,
      obj.department,
      obj.fun_fact,
    ].filter(Boolean).join('\n'),
    commons_categories: [obj.type, obj.department].filter(Boolean),
    image_source: {
      provider: 'cleveland',
      provider_name: 'Cleveland Museum of Art',
      source_url: obj.url || `https://www.clevelandart.org/art/${accession}`,
      identifier: `cleveland-${accession}`,
      license: 'CC0 1.0',
      attribution: obj.creditline || '',
      contributing_library: 'Cleveland Museum of Art',
      access_date: new Date().toISOString(),
    },
    harvested_at: new Date(),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipImages = args.includes('--skip-images');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;
  const objectIdsIdx = args.indexOf('--object-ids');
  const objectIds = objectIdsIdx >= 0
    ? args[objectIdsIdx + 1].split(',').map(s => s.trim()).filter(Boolean)
    : null;
  const queryIdx = args.indexOf('--query');
  const searchQuery = queryIdx >= 0 ? args[queryIdx + 1] : null;

  if (!objectIds && !searchQuery) {
    console.error('Provide --object-ids or --query');
    process.exit(1);
  }

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Images: ${skipImages ? 'SKIP' : 'UPLOAD'} | Limit: ${limit === Infinity ? 'none' : limit}${objectIds ? ` | Object IDs: ${objectIds.length}` : ''}`);

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

  // Collect artwork objects to process
  let artworks = [];

  if (objectIds) {
    // Fetch specific accession numbers
    for (const accession of objectIds) {
      if (totalImported + artworks.length >= limit) break;
      await sleep(DELAY_MS);
      console.log(`  Fetching ${accession}...`);
      const obj = await cmaFetchObject(accession);
      if (!obj) {
        console.error(`  Not found: ${accession}`);
        totalErrors++;
        continue;
      }
      artworks.push(obj);
    }
  } else if (searchQuery) {
    // Search mode
    console.log(`\nSearching: "${searchQuery}"`);
    artworks = await cmaSearch(searchQuery, Math.min(limit === Infinity ? 100 : limit, 100));
    console.log(`  Found ${artworks.length} results`);
  }

  // Process each artwork
  for (const obj of artworks) {
    if (totalImported >= limit) break;

    const accession = obj.accession_number || '';
    const imageUrl = getImageUrl(obj);
    if (!imageUrl) {
      console.log(`  Skip (no image): ${accession}`);
      totalSkipped++;
      continue;
    }

    const title = obj.title || `Cleveland Object ${accession}`;
    const artistName = obj.creators?.map(c => c.description || c.name)?.join(', ') || 'unknown';
    const slug = slugify(`cleveland-${artistName}-${title}`);
    if (!slug) {
      totalSkipped++;
      continue;
    }

    // Check for duplicates
    const exists = await books.findOne(
      { $or: [{ slug }, { 'image_source.identifier': `cleveland-${accession}` }] },
      { projection: { _id: 1 } }
    );
    if (exists) {
      console.log(`  Skip (exists): ${accession} — ${title.substring(0, 50)}`);
      totalSkipped++;
      continue;
    }

    const resourceType = guessResourceType(obj.technique || obj.type || '', obj.type || '');

    if (dryRun) {
      console.log(`  [DRY] ${slug} — ${artistName} — ${title.substring(0, 60)} — ${obj.creation_date || '?'}`);
      totalImported++;
      continue;
    }

    // Upload image to R2
    let displayUrl = imageUrl;
    let thumbUrl = imageUrl;
    let width = 0, height = 0;

    if (s3) {
      const r2Key = `${R2_PREFIX}/${slug}.jpg`;
      try {
        const urls = await uploadToR2(s3, imageUrl, r2Key);
        if (urls) {
          displayUrl = urls.display;
          thumbUrl = urls.thumb;
          width = urls.width || 0;
          height = urls.height || 0;
        }
      } catch (err) {
        console.error(`  Failed to upload ${slug}: ${err.message}`);
        totalErrors++;
        continue;
      }
    }

    const doc = buildDoc(obj, slug, resourceType, displayUrl, thumbUrl, width, height);
    await books.insertOne(doc);
    console.log(`  + ${slug} — ${artistName} — ${title.substring(0, 50)} (${obj.creation_date || '?'})`);
    totalImported++;
  }

  console.log(`\n--- DONE ---`);
  console.log(`Imported: ${totalImported}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`Errors: ${totalErrors}`);

  await client.close();
}

main().catch(console.error);
