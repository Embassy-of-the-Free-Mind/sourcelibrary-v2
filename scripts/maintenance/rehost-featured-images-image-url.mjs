/**
 * Rehost collections.featured_images[].image_url from upstream to R2.
 *
 * Each entry is the high-res source used by ImageWithMagnifier on the collection
 * page (thumbnail_url is the page-extracted crop; image_url is typically the
 * full IIIF page from gallica/manchester/etc). Leaving image_url upstream
 * leaks the URL into rendered HTML and adds 1-3s to magnifier loads.
 *
 * Key:  collection-featured/<slug>/<idx>.jpg
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/maintenance/rehost-featured-images-image-url.mjs --dry-run
 *   node scripts/maintenance/rehost-featured-images-image-url.mjs
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = 4;

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
  { 'featured_images.image_url': { $regex: '^https?://' } },
  { projection: { slug: 1, featured_images: 1 } }
).toArray();

// Build flat work list: { slug, idx, url }
const work = [];
for (const c of colls) {
  const arr = c.featured_images || [];
  for (let i = 0; i < arr.length; i++) {
    const u = arr[i]?.image_url;
    if (!u || typeof u !== 'string' || !u.startsWith('http')) continue;
    if (u.startsWith(R2_PREFIX) || u.startsWith(BLOB_PREFIX)) continue;
    work.push({ slug: c.slug, idx: i, url: u });
  }
}

console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
console.log(`Entries to rehost: ${work.length} across ${new Set(work.map(w => w.slug)).size} collections\n`);

let ok = 0, fail = 0, qIdx = 0;

async function one(w) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let res;
    try {
      res = await fetch(w.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'SourceLibrary/1.0 (scholarly archive)' },
      });
    } finally { clearTimeout(timeout); }
    if (!res.ok) { fail++; console.log(`  [${res.status}] ${w.slug}#${w.idx} — ${new URL(w.url).host}`); return; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) { fail++; return; }

    const ct = res.headers.get('content-type') || 'image/jpeg';
    const ext = ct.includes('png') ? 'png' : 'jpg';
    const key = `collection-featured/${w.slug}/${w.idx}.${ext}`;

    if (!DRY_RUN) {
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: buf, ContentType: ct,
        CacheControl: 'public, max-age=604800',
      }));
      const r2Url = `${R2_PUBLIC_URL}/${key}`;
      await db.collection('collections').updateOne(
        { slug: w.slug },
        {
          $set: {
            [`featured_images.${w.idx}.image_url`]: r2Url,
            [`featured_images.${w.idx}.image_url_previous`]: w.url,
            updated_at: new Date(),
          },
        }
      );
    }
    ok++;
  } catch (err) {
    fail++;
    console.log(`  [ERR] ${w.slug}#${w.idx} — ${err.message?.slice(0, 60)}`);
  }
}

async function worker() {
  while (qIdx < work.length) {
    const i = qIdx++;
    if (i >= work.length) break;
    await one(work[i]);
    process.stdout.write(`  ${ok} ok, ${fail} fail (${ok + fail}/${work.length})\r`);
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, () => worker()));

console.log(`\n\nRehosted: ${ok}\nFailed:   ${fail}`);
await client.close();
