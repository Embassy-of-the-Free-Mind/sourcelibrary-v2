#!/usr/bin/env node
/**
 * Normalize artwork images on R2 to canonical structure.
 *
 * For each artwork, ensures all 4 tiers exist with slug-based keys:
 *   artwork/{slug}.jpg        — display (2000px wide, q85)
 *   artwork/{slug}-thumb.jpg  — thumbnail (600px wide, q80)
 *   artwork/{slug}-grid.jpg   — grid square (center-crop, natural res, q80)
 *   artwork/{slug}-full.jpg   — original (q92)
 *
 * Source priority: -full.jpg > .jpg > -thumb.jpg > commons_full_url > commons_url
 *
 * Fixes:
 * - ID-based keys → slug-based
 * - archived/ paths → artwork/ paths
 * - Missing display tier
 * - thumbnail field pointing to -full.jpg
 * - Missing grid crops
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/normalize-artwork-images.mjs [--dry-run] [--limit 100] [--only-missing]
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_MISSING = process.argv.includes('--only-missing');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '0') || 999999;
const CONCURRENCY = 5;

const R2_PUBLIC = 'https://images.sourcelibrary.org';
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

function canonicalUrls(slug) {
  const prefix = slug.startsWith('art-') || slug.startsWith('rijks-') || slug.startsWith('met-') || slug.startsWith('nga-')
    ? slug : `art-${slug}`;
  return {
    display: `${R2_PUBLIC}/artwork/${prefix}.jpg`,
    thumb: `${R2_PUBLIC}/artwork/${prefix}-thumb.jpg`,
    grid: `${R2_PUBLIC}/artwork/${prefix}-grid.jpg`,
    full: `${R2_PUBLIC}/artwork/${prefix}-full.jpg`,
    displayKey: `artwork/${prefix}.jpg`,
    thumbKey: `artwork/${prefix}-thumb.jpg`,
    gridKey: `artwork/${prefix}-grid.jpg`,
    fullKey: `artwork/${prefix}-full.jpg`,
  };
}

function isCanonical(art) {
  const urls = canonicalUrls(art.slug);
  return (
    art.thumbnail === urls.display &&
    art.thumbnail_blob === urls.thumb &&
    art.grid_thumbnail === urls.grid &&
    art.archived_full_url === urls.full
  );
}

async function fetchBestSource(art, urls) {
  // Try sources in order of quality (largest first)
  const tryUrls = [
    urls.full,                    // canonical full
    art.archived_full_url,        // existing full (maybe non-canonical path)
    art.thumbnail,                // often points to -full.jpg (misnamed)
    urls.display,                 // canonical display
    art.thumbnail_blob,           // existing thumb (fallback)
  ].filter(Boolean);

  // Deduplicate
  const unique = [...new Set(tryUrls)];

  for (const url of unique) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const meta = await sharp(buf).metadata();
        if (meta.width && meta.width > 50) return { buf, meta, source: url };
      }
    } catch { /* try next */ }
  }

  // Last resort: fetch from Commons
  if (art.commons_url) {
    try {
      const decoded = decodeURIComponent(art.commons_url);
      const match = decoded.match(/File:(.+)$/);
      if (match) {
        const fileTitle = `File:${match[1]}`;
        const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=url|size&format=json`;
        const apiRes = await fetch(apiUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
        if (apiRes.ok) {
          const data = await apiRes.json();
          const page = Object.values(data.query.pages)[0];
          const info = page?.imageinfo?.[0];
          if (info?.url) {
            const res = await fetch(info.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              const meta = await sharp(buf).metadata();
              if (meta.width && meta.width > 50) return { buf, meta, source: 'commons' };
            }
          }
        }
      }
    } catch { /* give up */ }
  }

  return null;
}

async function processOne(db, art) {
  const urls = canonicalUrls(art.slug);

  if (ONLY_MISSING && isCanonical(art)) return 'skip';

  const source = await fetchBestSource(art, urls);
  if (!source) return 'no-source';

  const { buf, meta } = source;
  const w = meta.width;
  const h = meta.height;

  // Generate all 4 tiers
  const [displayBuf, thumbBuf, fullBuf] = await Promise.all([
    sharp(buf).resize({ width: 2000, withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer(),
    sharp(buf).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer(),
    sharp(buf).jpeg({ quality: 92, mozjpeg: true }).toBuffer(),
  ]);

  // Grid: center-crop to square at natural short dimension
  const side = Math.min(w, h);
  const left = Math.round((w - side) / 2);
  const top = Math.round((h - side) / 2);
  const gridBuf = await sharp(buf)
    .extract({ left, top, width: side, height: side })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  // Upload all 4
  const uploads = [
    [urls.displayKey, displayBuf],
    [urls.thumbKey, thumbBuf],
    [urls.gridKey, gridBuf],
    [urls.fullKey, fullBuf],
  ];

  for (const [key, body] of uploads) {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  }

  // Update DB with canonical URLs
  await db.collection('books').updateOne({ _id: art._id }, {
    $set: {
      thumbnail: urls.display,
      thumbnail_blob: urls.thumb,
      grid_thumbnail: urls.grid,
      archived_full_url: urls.full,
      full_width: meta.width,
      full_height: meta.height,
      image_normalized: true,
      image_normalized_at: new Date(),
    },
  });

  return 'ok';
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');
  console.log(ONLY_MISSING ? 'Only processing non-canonical records' : 'Processing all artworks');

  const query = { resource_type: { $exists: true } };
  if (ONLY_MISSING) {
    query.image_normalized = { $ne: true };
  }

  const arts = await db.collection('books').find(query, {
    projection: {
      _id: 1, slug: 1, thumbnail: 1, thumbnail_blob: 1,
      archived_full_url: 1, grid_thumbnail: 1,
      commons_url: 1, commons_full_url: 1,
    },
  }).limit(LIMIT).toArray();

  console.log(`Artworks to process: ${arts.length}`);

  if (DRY_RUN) {
    let needsFix = 0;
    for (const a of arts) {
      if (!isCanonical(a)) needsFix++;
    }
    console.log(`Need normalization: ${needsFix}`);
    await client.close();
    return;
  }

  let ok = 0, skipped = 0, noSource = 0, errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < arts.length; i += CONCURRENCY) {
    const batch = arts.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(a => processOne(db, a).catch(() => 'error')));

    for (const r of results) {
      if (r === 'ok') ok++;
      else if (r === 'skip') skipped++;
      else if (r === 'no-source') noSource++;
      else errors++;
    }

    const done = ok + skipped + noSource + errors;
    if (done % 100 < CONCURRENCY && ok > 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (ok + skipped) / elapsed;
      const remaining = rate > 0 ? (arts.length - done) / rate : 0;
      console.log(`  ${ok} normalized, ${skipped} skipped, ${noSource} no-source, ${errors} errors | ${rate.toFixed(1)}/s | ~${Math.round(remaining / 60)}m`);
    }
  }

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Normalized: ${ok}`);
  console.log(`Skipped (already canonical): ${skipped}`);
  console.log(`No source image: ${noSource}`);
  console.log(`Errors: ${errors}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
