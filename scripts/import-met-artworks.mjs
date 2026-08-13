#!/usr/bin/env node
/**
 * Import artworks from The Metropolitan Museum of Art Open Access API.
 * All Open Access works are CC0 — no authentication required.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import-met-artworks.mjs
 *
 *   Options:
 *     --dry-run         Show what would be imported without writing to DB
 *     --limit N         Max items to import (default: unlimited)
 *     --skip-images     Don't download/upload images to R2 (metadata only)
 *     --query "..."     Override search query
 *     --object-ids N,N  Fetch specific object IDs directly (skip search)
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const MET_API = 'https://collectionapi.metmuseum.org/public/collection/v1';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const R2_PREFIX = 'artwork';
const DISPLAY_MAX = 99999; // Store original resolution — no downscaling
const THUMB_WIDTH = 600;
const DELAY_MS = 300; // Met rate limits aggressively despite claiming 80/s

// ─── Import targets ──────────────────────────────────────────────────────────
// Each entry: { query, artistFilter?, department?, dateBegin?, dateEnd?, type? }

const IMPORT_TARGETS = [
  // ── Existing targets ──
  // Dürer — engravings and woodcuts
  { query: 'Albrecht Durer', artistFilter: /d[üu]rer/i, department: 3, dateEnd: 1600, type: 'print' },
  { query: 'Durer', artistFilter: /d[üu]rer/i, department: 9, dateEnd: 1600, type: 'painting' },

  // Rembrandt prints
  { query: 'Rembrandt', artistFilter: /rembrandt/i, department: 3, dateEnd: 1700, type: 'print' },

  // Leonardo
  { query: 'Leonardo da Vinci', artistFilter: /^leonardo da vinci$/i, dateEnd: 1600, type: 'drawing' },

  // Bosch
  { query: 'Hieronymus Bosch', artistFilter: /bosch/i, dateEnd: 1600, type: 'painting' },

  // Bruegel
  { query: 'Bruegel', artistFilter: /bruegel/i, dateEnd: 1700, type: 'print' },

  // Cranach — Reformation art, Luther portraits
  { query: 'Lucas Cranach', artistFilter: /cranach/i, dateEnd: 1600, type: 'painting' },

  // Esoteric / alchemical subjects
  { query: 'alchemy', dateBegin: 1400, dateEnd: 1700, type: 'print' },
  { query: 'astrolabe', dateBegin: 1400, dateEnd: 1700, type: 'object' },
  { query: 'emblem book', dateBegin: 1400, dateEnd: 1700, type: 'print' },

  // ── Renaissance expansion ──

  // European Paintings dept (11) — Italian Renaissance
  { query: 'Raphael', artistFilter: /raphael|raffaello|sanzio/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Titian', artistFilter: /titian|tiziano/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Bellini', artistFilter: /bellini/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Botticelli', artistFilter: /botticelli/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Mantegna', artistFilter: /mantegna/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Tintoretto', artistFilter: /tintoretto/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Veronese', artistFilter: /veronese/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Caravaggio', artistFilter: /caravaggio/i, department: 11, dateBegin: 1500, dateEnd: 1620, type: 'painting' },
  { query: 'Correggio', artistFilter: /correggio/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Bronzino', artistFilter: /bronzino/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Pontormo', artistFilter: /pontormo/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Andrea del Sarto', artistFilter: /andrea del sarto/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Piero della Francesca', artistFilter: /piero della francesca/i, department: 11, dateBegin: 1400, dateEnd: 1500, type: 'painting' },
  { query: 'Lippi', artistFilter: /lippi/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Ghirlandaio', artistFilter: /ghirlandaio/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Perugino', artistFilter: /perugino/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Signorelli', artistFilter: /signorelli/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Carpaccio', artistFilter: /carpaccio/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Lorenzo Lotto', artistFilter: /lotto/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },

  // Northern Renaissance paintings
  { query: 'van Eyck', artistFilter: /van eyck/i, department: 11, dateBegin: 1400, dateEnd: 1500, type: 'painting' },
  { query: 'Memling', artistFilter: /memling/i, department: 11, dateBegin: 1400, dateEnd: 1500, type: 'painting' },
  { query: 'Rogier van der Weyden', artistFilter: /weyden/i, department: 11, dateBegin: 1400, dateEnd: 1500, type: 'painting' },
  { query: 'Gerard David', artistFilter: /gerard david/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'Holbein', artistFilter: /holbein/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },
  { query: 'El Greco', artistFilter: /greco/i, department: 11, dateBegin: 1500, dateEnd: 1620, type: 'painting' },
  { query: 'Altdorfer', artistFilter: /altdorfer/i, department: 11, dateBegin: 1400, dateEnd: 1600, type: 'painting' },

  // Drawings & Prints dept (9) — Renaissance prints
  { query: 'Mantegna', artistFilter: /mantegna/i, department: 9, dateBegin: 1400, dateEnd: 1600, type: 'print' },
  { query: 'Schongauer', artistFilter: /schongauer/i, department: 9, dateBegin: 1400, dateEnd: 1600, type: 'print' },
  { query: 'Lucas van Leyden', artistFilter: /lucas van leyden|lucas.*leyden/i, department: 9, dateBegin: 1400, dateEnd: 1600, type: 'print' },
  { query: 'Marcantonio Raimondi', artistFilter: /raimondi/i, department: 9, dateBegin: 1400, dateEnd: 1600, type: 'print' },
  { query: 'Goltzius', artistFilter: /goltzius/i, department: 9, dateBegin: 1400, dateEnd: 1620, type: 'print' },

  // Sculpture (12)
  { query: 'Renaissance', department: 12, dateBegin: 1400, dateEnd: 1600, type: 'object' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function metSearch(query, opts = {}) {
  const params = new URLSearchParams({
    q: query,
    hasImages: 'true',
    isPublicDomain: 'true',
  });
  if (opts.department) params.set('departmentIds', String(opts.department));
  if (opts.dateBegin) params.set('dateBegin', String(opts.dateBegin));
  if (opts.dateEnd) params.set('dateEnd', String(opts.dateEnd));

  const url = `${MET_API}/search?${params}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const data = await res.json();
      return data.objectIDs || [];
    }
    if (res.status === 403 || res.status === 429) {
      console.log(`  Rate limited, waiting ${(attempt + 1) * 5}s...`);
      await sleep((attempt + 1) * 5000);
      continue;
    }
    throw new Error(`Met search ${res.status}`);
  }
  console.error(`  Failed after 3 retries for "${query}"`);
  return [];
}

async function metObject(id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${MET_API}/objects/${id}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return res.json();
      if (res.status === 403 || res.status === 429) {
        await sleep((attempt + 1) * 3000);
        continue;
      }
      return null;
    } catch {
      await sleep(2000);
    }
  }
  return null;
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

function guessResourceType(medium, classification) {
  const m = (medium + ' ' + classification).toLowerCase();
  if (m.includes('painting') || m.includes('oil on') || m.includes('tempera')) return 'painting';
  if (m.includes('drawing') || m.includes('chalk') || m.includes('pen and ink')) return 'drawing';
  if (m.includes('engraving') || m.includes('etching') || m.includes('woodcut') || m.includes('print') || m.includes('lithograph')) return 'print';
  if (m.includes('fresco')) return 'fresco';
  if (m.includes('sculpture') || m.includes('bronze') || m.includes('marble')) return 'object';
  return 'print'; // default for Drawings & Prints dept
}

async function uploadToR2(s3, imageUrl, key) {
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());

  // Store at original resolution — no resize
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

  const meta = await sharp(displayBuffer).metadata();
  return {
    display: `https://images.sourcelibrary.org/${key}`,
    thumb: `https://images.sourcelibrary.org/${thumbKey}`,
    width: meta.width,
    height: meta.height,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipImages = args.includes('--skip-images');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;
  const queryIdx = args.indexOf('--query');
  const singleQuery = queryIdx >= 0 ? args[queryIdx + 1] : null;
  const objectIdsIdx = args.indexOf('--object-ids');
  const explicitIds = objectIdsIdx >= 0
    ? args[objectIdsIdx + 1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
    : null;

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Images: ${skipImages ? 'SKIP' : 'UPLOAD'} | Limit: ${limit === Infinity ? 'none' : limit}${explicitIds ? ` | Object IDs: ${explicitIds.length}` : ''}`);

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

  // Helper: process a single Met object through the import pipeline
  async function importObject(id, obj, resourceTypeOverride) {
    const title = obj.title || `Met Object ${id}`;
    const slug = slugify(`met-${obj.artistDisplayName || 'unknown'}-${title}`);
    if (!slug) return;

    // Check if already exists
    const exists = await books.findOne(
      { $or: [{ slug }, { 'image_source.identifier': `met-${id}` }] },
      { projection: { _id: 1 } }
    );
    if (exists) {
      totalSkipped++;
      return;
    }

    const resourceType = resourceTypeOverride || guessResourceType(obj.medium || '', obj.classification || '');
    const artist = obj.artistDisplayName || 'Unknown';

    if (dryRun) {
      console.log(`  [DRY] ${slug} — ${artist} — ${title.substring(0, 60)} — ${obj.objectDate || '?'}`);
      totalImported++;
      return;
    }

    // Upload image
    let displayUrl = obj.primaryImage;
    let thumbUrl = obj.primaryImageSmall || obj.primaryImage;
    let width = 0, height = 0;

    if (s3) {
      const r2Key = `${R2_PREFIX}/${slug}.jpg`;
      try {
        const urls = await uploadToR2(s3, obj.primaryImage, r2Key);
        if (urls) {
          displayUrl = urls.display;
          thumbUrl = urls.thumb;
          width = urls.width || 0;
          height = urls.height || 0;
        }
      } catch (err) {
        console.error(`  Failed to upload ${slug}: ${err.message}`);
        totalErrors++;
        return;
      }
    }

    const doc = {
      id: generateId(),
      slug,
      title,
      display_title: title,
      author: artist,
      language: 'Visual',
      published: obj.objectBeginDate ? String(obj.objectBeginDate) : obj.objectDate?.match(/\d{4}/)?.[0] || '',
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
      // Met-specific metadata
      commons_width: width,
      commons_height: height,
      commons_title: `Met: ${title}`,
      commons_url: obj.objectURL || `https://www.metmuseum.org/art/collection/search/${id}`,
      commons_full_url: obj.primaryImage,
      commons_license: 'CC0 1.0',
      commons_description: [
        obj.medium,
        obj.dimensions,
        obj.creditLine,
        obj.repository,
      ].filter(Boolean).join('\n'),
      commons_categories: [obj.classification, obj.department].filter(Boolean),
      image_source: {
        provider: 'met',
        provider_name: 'The Metropolitan Museum of Art',
        source_url: obj.objectURL || `https://www.metmuseum.org/art/collection/search/${id}`,
        identifier: `met-${id}`,
        license: 'CC0 1.0',
        attribution: obj.creditLine || '',
        contributing_library: obj.repository || 'The Metropolitan Museum of Art',
        access_date: new Date().toISOString(),
      },
      harvested_at: new Date(),
    };

    try {
      await books.insertOne(doc);
      console.log(`  ✓ ${slug} — ${artist} — ${title.substring(0, 50)} (${obj.objectDate || '?'})`);
      totalImported++;
    } catch (err) {
      if (err.code === 11000) {
        totalSkipped++;
        return;
      }
      throw err;
    }
  }

  // ─── Explicit object IDs mode ───────────────────────────────────────────────
  if (explicitIds) {
    console.log(`\n━━━ Fetching ${explicitIds.length} explicit object IDs ━━━`);
    for (const id of explicitIds) {
      if (totalImported >= limit) break;
      await sleep(DELAY_MS);
      const obj = await metObject(id);
      if (!obj || !obj.primaryImage) {
        console.log(`  Skipped ${id} (no image or not found)`);
        totalSkipped++;
        continue;
      }
      if (!obj.isPublicDomain) {
        console.log(`  Skipped ${id} (not public domain)`);
        totalSkipped++;
        continue;
      }
      await importObject(id, obj);
    }
  } else {
  // ─── Search-based mode ────────────────────────────────────────────────────
  const targets = singleQuery
    ? [{ query: singleQuery, type: 'print' }]
    : IMPORT_TARGETS;

  const seenIds = new Set();

  for (const target of targets) {
    if (totalImported >= limit) break;

    console.log(`\n━━━ "${target.query}" (${target.type || 'any'}) ━━━`);

    const objectIDs = await metSearch(target.query, target);
    console.log(`  Found ${objectIDs.length} objects`);

    // Dedupe across targets
    const newIDs = objectIDs.filter(id => !seenIds.has(id));
    newIDs.forEach(id => seenIds.add(id));
    if (newIDs.length < objectIDs.length) {
      console.log(`  ${objectIDs.length - newIDs.length} already seen`);
    }

    for (const id of newIDs) {
      if (totalImported >= limit) break;

      await sleep(DELAY_MS);
      const obj = await metObject(id);
      if (!obj || !obj.primaryImage) {
        totalSkipped++;
        continue;
      }

      // Apply artist filter if specified
      if (target.artistFilter && !target.artistFilter.test(obj.artistDisplayName || '')) {
        totalSkipped++;
        continue;
      }

      // Skip non-public-domain
      if (!obj.isPublicDomain) {
        totalSkipped++;
        continue;
      }

      await importObject(id, obj, target.type);
    }
  }
  }

  console.log(`\n━━━ DONE ━━━`);
  console.log(`Imported: ${totalImported}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`Errors: ${totalErrors}`);

  await client.close();
}

main().catch(console.error);
