#!/usr/bin/env node
/**
 * Revert artwork images that upgrade-artwork-images.mjs replaced with the
 * WRONG image (free-text Commons search, no identity check — see
 * audit-upgraded-artwork-images.mjs for the audit that finds them).
 *
 * For every mismatch in the audit report, re-downloads the ORIGINAL Commons
 * file recorded at import time (image_source.identifier), regenerates the
 * three R2 sizes, fixes the Mongo record, and purges the Cloudflare cache
 * for the rewritten image URLs.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/revert-bad-artwork-upgrades.mjs [--dry-run] [--report PATH]
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { readFileSync } from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');
const REPORT = process.argv.find((_, i, a) => a[i - 1] === '--report') || 'scripts/output/artwork-upgrade-audit.json';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) bot';

const client = new MongoClient(process.env.MONGODB_URI);
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

async function commonsFileUrl(filename) {
  const title = filename.startsWith('File:') ? filename : `File:${filename}`;
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|size&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`commons api ${res.status}`);
  const data = await res.json();
  const page = Object.values(data.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) throw new Error('file not found on Commons');
  return info;
}

async function purgeCloudflare(urls) {
  for (let i = 0; i < urls.length; i += 30) {
    const chunk = urls.slice(i, i + 30);
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: chunk }),
    });
    const data = await res.json();
    if (!data.success) console.error('CF purge failed:', JSON.stringify(data.errors));
    await new Promise(r => setTimeout(r, 500));
  }
}

async function main() {
  const report = JSON.parse(readFileSync(REPORT, 'utf8'));
  const mismatches = report.results.filter(r => r.match === false);
  console.log(`${DRY_RUN ? '=== DRY RUN ===\n' : ''}Report has ${mismatches.length} mismatches to revert.`);

  await client.connect();
  const books = client.db('bookstore').collection('books');

  let reverted = 0, skipped = 0, errors = 0;
  const purgeUrls = [];

  for (const m of mismatches) {
    const label = `${m.slug} (${m.author} — ${m.title?.substring(0, 40)})`;
    // Original file reference: image_source.identifier when the importer set it,
    // else parse the (percent-encoded) Commons File: page URL in source_url.
    let originalFile = m.original_file;
    if (!originalFile) {
      const doc = await books.findOne({ slug: m.slug }, { projection: { 'image_source.source_url': 1 } });
      const srcUrl = doc?.image_source?.source_url || '';
      const match = srcUrl.match(/commons\.wikimedia\.org\/wiki\/(.+)$/);
      if (match) {
        const decoded = decodeURIComponent(match[1]);
        if (/^File:/i.test(decoded)) originalFile = decoded;
      }
    }
    if (m.original_provider !== 'wikimedia_commons' || !originalFile) {
      console.log(`SKIP ${label}: original is ${m.original_provider || 'unknown'} / ${originalFile || 'no file'} — handle manually`);
      skipped++;
      continue;
    }
    try {
      const info = await commonsFileUrl(originalFile);
      if (DRY_RUN) {
        console.log(`WOULD REVERT ${label} → ${info.url} (${info.width}x${info.height})`);
        reverted++;
        continue;
      }
      const imgRes = await fetch(info.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (!imgRes.ok) throw new Error(`download ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const meta = await sharp(buf).metadata();

      const prefix = m.slug.startsWith('art-') || m.slug.startsWith('rijks-') || m.slug.startsWith('met-') ? m.slug : `art-${m.slug}`;
      const display = await sharp(buf).resize({ width: 3840, withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      const thumb = await sharp(buf).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      const full = await sharp(buf).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      for (const [key, body] of [
        [`artwork/${prefix}.jpg`, display],
        [`artwork/${prefix}-thumb.jpg`, thumb],
        [`artwork/${prefix}-full.jpg`, full],
      ]) {
        await s3.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: body,
          ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable',
        }));
        purgeUrls.push(`https://images.sourcelibrary.org/${key}`);
      }

      await books.updateOne({ slug: m.slug }, {
        $set: {
          commons_title: originalFile.startsWith('File:') ? originalFile : `File:${originalFile}`,
          commons_full_url: info.url,
          commons_width: meta.width,
          commons_height: meta.height,
          thumbnail: `https://images.sourcelibrary.org/artwork/${prefix}-thumb.jpg`,
          thumbnail_blob: `https://images.sourcelibrary.org/artwork/${prefix}.jpg`,
          archived_full_url: `https://images.sourcelibrary.org/artwork/${prefix}-full.jpg`,
          image_upgrade_reverted: true,
          image_upgrade_reverted_at: new Date(),
          updated_at: new Date(),
        },
        $unset: { image_upgraded: '', image_upgraded_at: '', image_upgrade_source: '', image_mismatch_suspected: '', low_res: '' },
      });
      console.log(`REVERTED ${label} → ${meta.width}x${meta.height}`);
      reverted++;
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.log(`ERROR ${label}: ${err.message?.substring(0, 80)}`);
      errors++;
    }
  }

  if (!DRY_RUN && purgeUrls.length) {
    console.log(`Purging ${purgeUrls.length} URLs from Cloudflare…`);
    await purgeCloudflare(purgeUrls);
  }

  console.log(`\n━━━ Reverted: ${reverted}, skipped (non-Commons): ${skipped}, errors: ${errors}`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
