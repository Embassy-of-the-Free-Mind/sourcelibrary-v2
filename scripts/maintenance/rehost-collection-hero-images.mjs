/**
 * Rehost collections.hero_image from upstream (gallica/IIIF/Met) to R2.
 *
 * Collection hero images are rendered as <link rel="preload"> and large
 * background images on the collection page. Upstream IIIF servers add 1-3s
 * to first paint. Same pattern as rehost-all-external-thumbnails.mjs, just
 * targeting the collections.hero_image field.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/maintenance/rehost-collection-hero-images.mjs --dry-run
 *   node scripts/maintenance/rehost-collection-hero-images.mjs
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = 5;

const R2_PREFIX = 'https://images.sourcelibrary.org';
const BLOB_PREFIX = 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const colls = await db.collection('collections').find(
  { hero_image: { $regex: '^https?://' } },
  { projection: { slug: 1, hero_image: 1 } }
).toArray();

const targets = colls.filter(c =>
  c.hero_image &&
  !c.hero_image.startsWith(R2_PREFIX) &&
  !c.hero_image.startsWith(BLOB_PREFIX)
);

console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
console.log(`Collections with external hero_image: ${targets.length}\n`);

let rehosted = 0, failed = 0;
let idx = 0;

async function one(coll) {
  const url = coll.hero_image;
  let host = '';
  try { host = new URL(url).host; } catch { failed++; return; }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let res;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'SourceLibrary/1.0 (scholarly archive)' },
      });
    } finally { clearTimeout(timeout); }

    if (!res.ok) { failed++; console.log(`  [${res.status}] ${coll.slug} — ${host}`); return; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) { failed++; return; }

    const ct = res.headers.get('content-type') || 'image/jpeg';
    const ext = ct.includes('png') ? 'png' : 'jpg';
    const key = `collection-heroes/${coll.slug}.${ext}`;

    if (!DRY_RUN) {
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buf,
        ContentType: ct,
        CacheControl: 'public, max-age=604800',
      }));

      const r2Url = `${R2_PUBLIC_URL}/${key}`;
      await db.collection('collections').updateOne(
        { slug: coll.slug },
        {
          $set: {
            hero_image: r2Url,
            updated_at: new Date(),
            'field_provenance.hero_image': {
              source: 'rehost-collection-hero-images',
              method: 'direct-download',
              confidence: 1.0,
              date: new Date(),
              previous: url,
            },
          },
        }
      );
    }
    rehosted++;
  } catch (err) {
    failed++;
    console.log(`  [ERR] ${coll.slug} — ${err.message?.slice(0, 60)}`);
  }
}

async function worker() {
  while (idx < targets.length) {
    const i = idx++;
    if (i >= targets.length) break;
    await one(targets[i]);
    process.stdout.write(`  ${rehosted} ok, ${failed} fail (${rehosted + failed}/${targets.length})\r`);
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()));

console.log(`\n\nRehosted: ${rehosted}\nFailed:   ${failed}`);
await client.close();
