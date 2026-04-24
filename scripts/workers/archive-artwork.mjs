#!/usr/bin/env node
// Hetzner artwork archiver — downloads Wikimedia/Met/etc artwork images to R2
// Run: set -a; source .env.production.local; set +a; node scripts/workers/archive-artwork.mjs
//
// Finds artworks with thumbnails not yet on images.sourcelibrary.org,
// downloads full-res, generates thumb, uploads both to R2, updates MongoDB.

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import axios from 'axios';

const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const CONCURRENCY = 3;
const RATE_MS = 200; // 5/s per worker = ~15/s total (well within Wikimedia limits)

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
});

async function upload(key, buf, mime) {
  await R2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buf, ContentType: mime }));
  return `${PUBLIC}/${key}`;
}

async function archiveArtwork(db, art) {
  const resp = await axios.get(art.thumbnail, {
    responseType: 'arraybuffer',
    timeout: 30000,
    headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly archive; contact@sourcelibrary.org)' }
  });
  const buf = Buffer.from(resp.data);
  if (buf.length < 500) throw new Error('too small: ' + buf.length);

  const slug = art.slug;
  await upload(`artwork/${slug}-full.jpg`, buf, 'image/jpeg');
  const thumb = await sharp(buf).resize(300, null, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
  await upload(`artwork/${slug}-thumb.jpg`, thumb, 'image/jpeg');

  await db.collection('books').updateOne({ _id: art._id }, { $set: {
    thumbnail: `${PUBLIC}/artwork/${slug}-full.jpg`,
    thumbnail_blob: `${PUBLIC}/artwork/${slug}-thumb.jpg`,
    archive_status: 'archive_complete',
    updated_at: new Date()
  }});
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const artworks = await db.collection('books').find(
    { status: 'live', content_type: 'artwork', thumbnail: { $not: /images\.sourcelibrary\.org/ } },
    { projection: { slug: 1, thumbnail: 1, title: 1 } }
  ).toArray();

  console.log(`[archive-artwork] ${artworks.length} artworks to archive`);
  if (!artworks.length) { await client.close(); return; }

  let ok = 0, fail = 0, i = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= artworks.length) break;
      const art = artworks[idx];
      try {
        await archiveArtwork(db, art);
        ok++;
        if (ok % 100 === 0) console.log(`  ${ok}/${artworks.length} archived (${fail} failed)`);
      } catch (e) {
        fail++;
        if (fail <= 10) console.log(`  FAIL: ${art.title?.substring(0,50)} — ${e.message?.substring(0,60)}`);
      }
      await new Promise(r => setTimeout(r, RATE_MS));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`\n[archive-artwork] Done: ${ok} archived, ${fail} failed`);
  const remaining = await db.collection('books').countDocuments({
    status: 'live', content_type: 'artwork', thumbnail: { $not: /images\.sourcelibrary\.org/ }
  });
  console.log(`[archive-artwork] Remaining: ${remaining}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
