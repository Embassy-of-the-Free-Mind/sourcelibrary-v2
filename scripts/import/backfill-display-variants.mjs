#!/usr/bin/env node
/**
 * Backfill the missing 1200px display variant for pages already archived to R2.
 *
 * The archive-images worker wrote only `-full.jpg` and `-thumb.jpg`, but
 * page-image-url.ts derives the display URL by stripping `-full`, so it pointed
 * at a file that never existed and book pages rendered a broken cover. The
 * worker is fixed; this repairs pages archived before that.
 *
 * Reads the existing -full from R2 rather than re-fetching from archive.org.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/import/backfill-display-variants.mjs [--dry-run] [collection-slug]
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const DRY = process.argv.includes('--dry-run');
const SLUG = process.argv.slice(2).find(a => !a.startsWith('--')) || 'slime-moulds';
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const BUCKET = R2_BUCKET || 'sourcelibrary';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

const books = await db.collection('books')
  .find({ collections: SLUG }, { projection: { _id: 0, id: 1, title: 1 } }).toArray();

let made = 0, skipped = 0, failed = 0;
for (const b of books) {
  const pages = await db.collection('pages')
    .find({ book_id: b.id, archived_photo: { $regex: '-full\\.jpg$' } },
          { projection: { _id: 0, page_number: 1, archived_photo: 1 } })
    .sort({ page_number: 1 }).toArray();
  if (!pages.length) { console.log(`${String(b.title).slice(0,32).padEnd(34)} no -full pages`); continue; }

  // One probe per book: if the display variant exists, the book is already fine.
  const probe = pages[0].archived_photo.replace(/-full\.jpg$/, '.jpg');
  if ((await fetch(probe, { method: 'HEAD' })).ok) {
    console.log(`${String(b.title).slice(0,32).padEnd(34)} already has display variants`);
    continue;
  }
  if (DRY) { console.log(`${String(b.title).slice(0,32).padEnd(34)} would build ${pages.length} display variants`); made += pages.length; continue; }

  let bookMade = 0;
  for (const p of pages) {
    const key = new URL(p.archived_photo).pathname.replace(/^\//, '').replace(/-full\.jpg$/, '.jpg');
    try {
      const res = await fetch(p.archived_photo);
      if (!res.ok) { failed++; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const out = await sharp(buf).resize(1200, null, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 78, progressive: true }).toBuffer();
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: out, ContentType: 'image/jpeg' }));
      bookMade++; made++;
    } catch (e) { failed++; if (failed < 4) console.error('  ', key, e.message); }
  }
  console.log(`${String(b.title).slice(0,32).padEnd(34)} built ${bookMade}/${pages.length}`);
}
console.log(`\n${DRY ? 'Would build' : 'Built'} ${made} display variants, ${skipped} skipped, ${failed} failed.`);
await client.close();
