#!/usr/bin/env node
/**
 * Upgrade low-resolution artwork images from multiple sources.
 *
 * Strategy (in order):
 * 1. Commons higher-res: check if a larger version exists on Commons for the same file
 * 2. Google Art Project: check Commons category for GAP uploads (often 10000+ px)
 * 3. Museum IIIF: try fetching full-res from museum IIIF endpoints
 *
 * Only targets artworks where max(width, height) < 2000px.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/upgrade-artwork-images.mjs [--limit 50] [--dry-run] [--flag-only]
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const FLAG_ONLY = process.argv.includes('--flag-only');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '0') || 999999;

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) bot';
const MIN_UPGRADE_PX = 2000; // Only upgrade if current max dimension < this

const client = new MongoClient(process.env.MONGODB_URI);
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// ─── Strategy 1+2: Search Commons for higher-res alternative files ───────────

async function findHigherResOnCommons(title, author, currentMaxDim) {
  // Search Commons for alternate uploads of the same artwork
  // Prioritize Google Art Project versions (often 10000+ px)
  const searchTerms = `${author} ${title}`.replace(/[^\w\s]/g, '').substring(0, 100);
  const url = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchTerms)}&srnamespace=6&srlimit=15&format=json`;

  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;

  const data = await res.json();
  const results = data.query?.search || [];

  // Filter to image files only
  const imageResults = results.filter(r =>
    /\.(jpg|jpeg|png|tif|tiff)$/i.test(r.title)
  );

  // Get image info for each result
  let best = null;
  for (const r of imageResults) {
    try {
      const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(r.title)}&prop=imageinfo&iiprop=url|size&format=json`;
      const infoRes = await fetch(infoUrl, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(10000),
      });
      const infoData = await infoRes.json();
      const page = Object.values(infoData.query.pages)[0];
      const info = page?.imageinfo?.[0];
      if (!info) continue;

      const maxDim = Math.max(info.width, info.height);
      if (maxDim <= currentMaxDim) continue; // Not an upgrade

      const isGAP = r.title.includes('Google Art Project') || r.title.includes('Google Cultural');
      const score = maxDim + (isGAP ? 100000 : 0); // Prefer GAP versions

      if (!best || score > best.score) {
        best = {
          title: r.title,
          url: info.url,
          width: info.width,
          height: info.height,
          maxDim,
          isGAP,
          score,
        };
      }
    } catch { /* skip failed lookups */ }
  }

  return best;
}

// ─── Strategy 3: Museum IIIF ─────────────────────────────────────────────────

// Map known museum URLs in commons_description/credit to IIIF endpoints
const MUSEUM_IIIF = [
  { pattern: /uffizi|gallerie degli uffizi/i, baseUrl: 'https://www.uffizi.it/en/artworks/' },
  { pattern: /national gallery, london/i, baseUrl: 'https://www.nationalgallery.org.uk/' },
  { pattern: /rijksmuseum/i, iiifBase: 'https://iiif.micr.io/' },
  { pattern: /metropolitan museum|the met/i, apiBase: 'https://collectionapi.metmuseum.org/public/collection/v1/objects/' },
  { pattern: /national gallery of art|nga\.gov/i, iiifBase: 'https://api.nga.gov/iiif/' },
];

// ─── Image upload ────────────────────────────────────────────────────────────

async function uploadUpgradedImage(slug, imageBuffer, metadata) {
  const displayBuffer = await sharp(imageBuffer)
    .resize({ width: 3840, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  const thumbBuffer = await sharp(imageBuffer)
    .resize({ width: 600, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  const fullBuffer = await sharp(imageBuffer)
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  const prefix = slug.startsWith('art-') || slug.startsWith('rijks-') || slug.startsWith('met-')
    ? slug : `art-${slug}`;

  // Upload all 3 sizes
  for (const [key, buf, label] of [
    [`artwork/${prefix}.jpg`, displayBuffer, 'display'],
    [`artwork/${prefix}-thumb.jpg`, thumbBuffer, 'thumb'],
    [`artwork/${prefix}-full.jpg`, fullBuffer, 'full'],
  ]) {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buf,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  }

  return {
    thumbnail_blob: `https://images.sourcelibrary.org/artwork/${prefix}.jpg`,
    thumbnail: `https://images.sourcelibrary.org/artwork/${prefix}-thumb.jpg`,
    archived_full_url: `https://images.sourcelibrary.org/artwork/${prefix}-full.jpg`,
    full_width: metadata.width,
    full_height: metadata.height,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  console.log(DRY_RUN ? '=== DRY RUN ===' : FLAG_ONLY ? '=== FLAG ONLY ===' : '=== LIVE RUN ===');

  const query = {
    resource_type: { $exists: true },
    commons_width: { $lt: MIN_UPGRADE_PX },
    commons_height: { $lt: MIN_UPGRADE_PX },
    'image_source.provider': 'wikimedia_commons',
  };

  const cursor = books.find(query, {
    projection: {
      _id: 1, slug: 1, title: 1, author: 1,
      commons_title: 1, commons_full_url: 1,
      commons_width: 1, commons_height: 1,
    }
  }).limit(LIMIT);

  let upgraded = 0, flagged = 0, noUpgrade = 0, errors = 0, processed = 0;

  for await (const doc of cursor) {
    processed++;
    const maxDim = Math.max(doc.commons_width || 0, doc.commons_height || 0);
    const label = `[${processed}] ${doc.author} — ${doc.title?.substring(0, 40)} (${maxDim}px)`;

    try {
      // Search Commons for a higher-res version of this artwork
      const better = await findHigherResOnCommons(
        doc.title, doc.author, maxDim
      );

      if (better && better.maxDim >= MIN_UPGRADE_PX) {
        const src = better.isGAP ? 'Google Art Project' : 'Commons alternate';
        console.log(`${label} → UPGRADE via ${src} (${better.maxDim}px — ${better.title.substring(5, 60)})`);

        if (FLAG_ONLY) {
          await books.updateOne({ _id: doc._id }, {
            $set: { low_res: true, upgrade_available: src, upgrade_resolution: better.maxDim, upgrade_file: better.title }
          });
          flagged++;
        } else if (!DRY_RUN) {
          const imgRes = await fetch(better.url, {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(120000),
          });
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            const meta = await sharp(buf).metadata();
            const urls = await uploadUpgradedImage(doc.slug, buf, meta);
            await books.updateOne({ _id: doc._id }, {
              $set: {
                ...urls,
                commons_width: meta.width,
                commons_height: meta.height,
                commons_full_url: better.url,
                commons_title: better.title,
                image_upgraded: true,
                image_upgraded_at: new Date(),
                image_upgrade_source: src,
                updated_at: new Date(),
              },
              $unset: { low_res: '' }
            });
            console.log(`  Uploaded ${meta.width}x${meta.height}`);
            upgraded++;
          }
        } else {
          upgraded++;
        }
      } else {
        // Flag as low-res with no upgrade available
        if (!DRY_RUN) {
          await books.updateOne({ _id: doc._id }, {
            $set: { low_res: true, upgrade_available: null }
          });
        }
        noUpgrade++;
        if (processed <= 50 || processed % 100 === 0) {
          console.log(`${label} → no upgrade found`);
        }
      }

      await new Promise(r => setTimeout(r, 1500)); // Respect Commons rate limits
    } catch (err) {
      console.log(`${label} → ERROR: ${err.message?.substring(0, 60)}`);
      errors++;
      if (err.message?.includes('429')) {
        await new Promise(r => setTimeout(r, 30000));
      } else {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Processed: ${processed}`);
  console.log(`Upgraded (Commons hi-res): ${upgraded}`);
  console.log(`Flagged (GAP / manual): ${flagged}`);
  console.log(`No upgrade available: ${noUpgrade}`);
  console.log(`Errors: ${errors}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
