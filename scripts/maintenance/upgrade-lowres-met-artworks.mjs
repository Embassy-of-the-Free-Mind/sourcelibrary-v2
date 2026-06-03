#!/usr/bin/env node
/**
 * Targeted resolution upgrade for low-res Met artworks.
 *
 * Scoping (2026-06-03) found ~99 visible Met artworks stored under 1200px
 * (including 10 of the 11 truly-tiny <600px ones) whose Met objects serve
 * full-res primaryImage (typically 3–4000px) via the open-access API. The
 * broader Commons low-res population is mostly already at Commons' max res —
 * this script deliberately targets only the Met, where the win is real.
 *
 * For each: image_source.identifier → Met objectID → primaryImage → rehost the
 * artwork triplet at the SAME R2 keys derived from image_display
 * (`artwork/{base}.jpg` display ≤3840px, `-thumb.jpg` 600px, `-full.jpg`
 * original), then update commons_width/height + image_upgraded. Only applies
 * when the new image is meaningfully larger (>1.3× max dimension).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/upgrade-lowres-met-artworks.mjs --dry-run
 *   node scripts/maintenance/upgrade-lowres-met-artworks.mjs [--max-dim 1200]
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_DIM = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--max-dim') || '') || 1200;
const MET_API = 'https://collectionapi.metmuseum.org/public/collection/v1';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';
const DELAY_MS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = new MongoClient(process.env.MONGODB_URI);
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

async function main() {
  await client.connect();
  const books = client.db('bookstore').collection('books');

  const docs = await books.find({
    content_type: 'artwork', visible: true,
    'image_source.provider': 'met',
    commons_width: { $lt: MAX_DIM }, commons_height: { $lt: MAX_DIM },
  }, { projection: { title: 1, slug: 1, image_display: 1, commons_width: 1, commons_height: 1, 'image_source.identifier': 1 } }).toArray();

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}${docs.length} Met artworks under ${MAX_DIM}px`);
  let upgraded = 0, noBigger = 0, errors = 0;

  for (const d of docs) {
    const ident = String(d.image_source?.identifier || '').replace(/^met-/, '');
    const oldMax = Math.max(d.commons_width || 0, d.commons_height || 0);
    // Two storage shapes: artwork triplet (artwork/{base}.jpg) or page-style
    // (pages/{bookId}/{num}.jpg — artworks imported as 1-page books).
    const artBase = d.image_display?.match(/images\.sourcelibrary\.org\/artwork\/(.+?)(?:-full|-thumb)?\.jpg$/)?.[1];
    const pageM = d.image_display?.match(/images\.sourcelibrary\.org\/pages\/([^/]+)\/(\d+)(?:-thumb|-full)?\.jpg$/);
    const label = `${d.title?.slice(0, 45)} (${oldMax}px, met ${ident})`;
    if (!/^\d+$/.test(ident) || (!artBase && !pageM)) { errors++; console.log(`✗ ${label} — bad identifier or display URL`); continue; }
    try {
      const res = await fetch(`${MET_API}/objects/${ident}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) { errors++; console.log(`✗ ${label} — Met API ${res.status}`); await sleep(DELAY_MS); continue; }
      const o = await res.json();
      if (!o.primaryImage) { noBigger++; await sleep(DELAY_MS); continue; }
      const imgRes = await fetch(o.primaryImage, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (!imgRes.ok) { errors++; console.log(`✗ ${label} — image ${imgRes.status}`); await sleep(DELAY_MS); continue; }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      if (!buf.length) { errors++; await sleep(DELAY_MS); continue; }
      const meta = await sharp(buf).metadata();
      const newMax = Math.max(meta.width || 0, meta.height || 0);
      if (newMax < oldMax * 1.3) { noBigger++; console.log(`= ${label} — Met serves ${newMax}px, not meaningfully larger`); await sleep(DELAY_MS); continue; }
      if (DRY_RUN) { upgraded++; console.log(`↑ ${label} → ${meta.width}x${meta.height} [dry]`); await sleep(DELAY_MS); continue; }

      const display = await sharp(buf).resize({ width: 3840, withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      const thumb = await sharp(buf).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      const full = await sharp(buf).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      const keys = artBase
        ? [[`artwork/${artBase}.jpg`, display], [`artwork/${artBase}-thumb.jpg`, thumb], [`artwork/${artBase}-full.jpg`, full]]
        : [[`pages/${pageM[1]}/${pageM[2]}.jpg`, display], [`pages/${pageM[1]}/${pageM[2]}-thumb.jpg`, thumb], [`archived/${pageM[1]}/${parseInt(pageM[2], 10)}.jpg`, full]];
      for (const [key, body] of keys) {
        await s3.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: body,
          ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable',
        }));
      }
      await books.updateOne({ _id: d._id }, {
        $set: {
          commons_width: meta.width, commons_height: meta.height,
          image_upgraded: true, image_upgraded_at: new Date(),
          image_upgrade_source: 'met_api', updated_at: new Date(),
        },
        $unset: { low_res: '' },
      });
      upgraded++;
      console.log(`↑ ${label} → ${meta.width}x${meta.height}`);
    } catch (e) { errors++; console.log(`✗ ${label} — ${e.message?.slice(0, 60)}`); }
    await sleep(DELAY_MS);
  }

  console.log(`\n━━━ SUMMARY ━━━\nUpgraded: ${upgraded}\nNo bigger available: ${noBigger}\nErrors: ${errors}`);
  console.log('Note: R2 keys are overwritten in place with immutable cache headers — purge Cloudflare after a live run so the new resolution serves.');
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
